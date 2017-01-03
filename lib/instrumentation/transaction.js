'use strict'

var uuid = require('uuid')
var Trace = require('./trace')
var log = require('../logger')

module.exports = Transaction

function Transaction (agent, name, type, result) {
  Object.defineProperty(this, 'name', {
    configurable: true,
    enumerable: true,
    get: function () {
      // Fall back to a somewhat useful name in case no _defaultName is set.
      // This might happen if res.writeHead wasn't called.
      return this._customName ||
        this._defaultName ||
        (this.req ? this.req.method + ' unknown route (unnamed)' : 'unnamed')
    },
    set: function (name) {
      if (this.ended) {
        log.i.debug({uuid: this._uuid}, 'tried to set transaction.name on already ended transaction')
        return
      }
      log.i.debug({uuid: this._uuid, name: name}, 'setting transaction name')
      this._customName = name
    }
  })

  Object.defineProperty(this, 'result', {
    configurable: true,
    enumerable: true,
    get: function () {
      return this._result
    },
    set: function (result) {
      if (this.ended) {
        log.i.debug({uuid: this._uuid}, 'tried to set transaction.result on already ended transaction')
        return
      }
      log.i.debug({uuid: this._uuid, result: result}, 'setting transaction result')
      this._result = result
    }
  })

  this._defaultName = name || ''
  this._customName = ''
  this.type = type || 'request'
  this.result = result
  this.traces = []
  this._buildTraces = []
  this.ended = false
  this._abortTime = 0
  this._uuid = uuid.v4()
  this._agent = agent
  this._agent._instrumentation.currentTransaction = this

  log.i.debug({uuid: this._uuid, name: name, type: type, result: result}, 'start transaction')

  // A transaction should always have a root trace spanning the entire
  // transaction.
  this._rootTrace = new Trace(this)
  this._rootTrace.start('transaction', 'transaction')
  this._start = this._rootTrace._start
}

Transaction.prototype.buildTrace = function () {
  if (this.ended) {
    log.i.debug({uuid: this._uuid}, 'transaction already ended - cannot build new trace')
    return null
  }

  var trace = new Trace(this)
  this._buildTraces.push(trace)
  return trace
}

Transaction.prototype.duration = function () {
  return this._rootTrace.duration()
}

Transaction.prototype.setDefaultName = function (name) {
  log.i.debug({uuid: this._uuid}, 'setting default transaction name: %s', name)
  this._defaultName = name
}

Transaction.prototype.setDefaultNameFromRequest = function () {
  var req = this.req
  var path

  // Get proper route name from Express 4.x
  if (req._opbeat_static) {
    path = 'static file'
  } else if (req.route) {
    path = req.route.path || req.route.regexp && req.route.regexp.source || ''
    if (req._opbeat_mountstack) path = req._opbeat_mountstack.join('') + (path === '/' ? '' : path)
  } else if (req._opbeat_mountstack && req._opbeat_mountstack.length > 0) {
    // in the case of custom middleware that terminates the request
    // so it doesn't reach the regular router (like express-graphql),
    // the req.route will not be set, but we'll see something on the
    // mountstack and simply use that
    path = req._opbeat_mountstack.join('')
  }

  if (!path) {
    log.i.debug({
      url: req.url,
      type: typeof path,
      null: path === null, // because typeof null === 'object'
      route: !!req.route,
      regex: req.route ? !!req.route.regexp : false,
      mountstack: req._opbeat_mountstack ? req._opbeat_mountstack.length : false,
      uuid: this._uuid
    }, 'could not extract route name from request')
    path = 'unknown route'
  }

  this.setDefaultName(req.method + ' ' + path)
}

Transaction.prototype.end = function () {
  if (this.ended) {
    log.i.debug({uuid: this._uuid}, 'tried to call transaction.end() on already ended transaction')
    return
  }

  if (!this._defaultName && this.req) this.setDefaultNameFromRequest()

  this._buildTraces.forEach(function (trace) {
    if (trace.ended || !trace.started) return
    trace.truncate()
  })

  this._rootTrace.end()
  this.ended = true

  var trans = this._agent._instrumentation.currentTransaction

  // These two edge-cases should normally not happen, but if the hooks into
  // Node.js doesn't work as intended it might. In that case we want to
  // gracefully handle it. That involves ignoring all traces under the given
  // transaction as they will most likely be incomplete. We still want to send
  // the transaction without any traces to Opbeat as it's still valuable data.
  if (!trans) {
    log.i.debug({current: trans, traces: this.traces.length, uuid: this._uuid}, 'WARNING: no currentTransaction found')
    this.traces = []
  } else if (trans !== this) {
    log.i.debug({traces: this.traces.length, uuid: this._uuid, other: trans._uuid}, 'WARNING: transaction is out of sync')
    this.traces = []
  }

  this._agent._instrumentation.addEndedTransaction(this)
  log.i.debug({uuid: this._uuid, type: this.type, result: this.result, name: this.name}, 'ended transaction')
}

Transaction.prototype._recordEndedTrace = function (trace) {
  if (this.ended) {
    log.i.debug({uuid: this._uuid, trace: trace.signature}, 'Can\'t record ended trace after parent transaction have ended - ignoring')
    return
  }

  this.traces.push(trace)
}
