'use strict'

var uuid = require('uuid')
var objectAssign = require('object-assign')
var express = require('./express-utils')
var debug = require('debug')('opbeat')
var Trace = require('./trace')

module.exports = Transaction

function Transaction (agent, name, type) {
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
        debug('tried to set transaction.name on already ended transaction %o', {id: this.id})
        return
      }
      debug('setting transaction name %o', {id: this.id, name: name})
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
        debug('tried to set transaction.result on already ended transaction %o', {id: this.id})
        return
      }
      debug('setting transaction result %o', {id: this.id, result: result})
      this._result = result
    }
  })

  this.id = uuid.v4()
  this._defaultName = name || ''
  this._customName = ''
  this._context = null
  this.type = type || 'custom'
  this.result = 200
  this.traces = []
  this._builtTraces = []
  this.ended = false
  this._abortTime = 0
  this._agent = agent
  this._agent._instrumentation.currentTransaction = this

  debug('start transaction %o', {id: this.id, name: name, type: type})

  // A transaction should always have a root trace spanning the entire
  // transaction.
  this._rootTrace = new Trace(this)
  this._rootTrace.start('transaction', 'transaction')
  this._start = this._rootTrace._start
}

Transaction.prototype.setUserContext = function (context) {
  if (!context) return
  if (!this._context) this._context = {}
  this._context.user = objectAssign(this._context.user || {}, context)
}

Transaction.prototype.setExtraContext = function (context) {
  if (!context) return
  if (!this._context) this._context = {}
  this._context.extra = objectAssign(this._context.extra || {}, context)
}

Transaction.prototype.buildTrace = function () {
  if (this.ended) {
    debug('transaction already ended - cannot build new trace %o', {id: this.id})
    return null
  }

  var trace = new Trace(this)
  this._builtTraces.push(trace)
  return trace
}

Transaction.prototype.duration = function () {
  return this._rootTrace.duration()
}

Transaction.prototype.setDefaultName = function (name) {
  debug('setting default transaction name: %s %o', name, {id: this.id})
  this._defaultName = name
}

Transaction.prototype.setDefaultNameFromRequest = function () {
  var req = this.req
  var path = express.getPathFromRequest(req)

  if (!path) {
    debug('could not extract route name from request %o', {
      url: req.url,
      type: typeof path,
      null: path === null, // because typeof null === 'object'
      route: !!req.route,
      regex: req.route ? !!req.route.regexp : false,
      mountstack: req._opbeat_mountstack ? req._opbeat_mountstack.length : false,
      id: this.id
    })
    path = 'unknown route'
  }

  this.setDefaultName(req.method + ' ' + path)
}

Transaction.prototype.end = function () {
  if (this.ended) {
    debug('tried to call transaction.end() on already ended transaction %o', {id: this.id})
    return
  }

  if (!this._defaultName && this.req) this.setDefaultNameFromRequest()

  this._builtTraces.forEach(function (trace) {
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
  // the transaction without any traces as it's still valuable data.
  if (!trans) {
    debug('WARNING: no currentTransaction found %o', {current: trans, traces: this.traces.length, id: this.id})
    this.traces = []
  } else if (trans !== this) {
    debug('WARNING: transaction is out of sync %o', {traces: this.traces.length, id: this.id, other: trans.id})
    this.traces = []
  }

  this._agent._instrumentation.addEndedTransaction(this)
  debug('ended transaction %o', {id: this.id, type: this.type, result: this.result, name: this.name})
}

Transaction.prototype._recordEndedTrace = function (trace) {
  if (this.ended) {
    debug('Can\'t record ended trace after parent transaction have ended - ignoring %o', {id: this.id, trace: trace.name})
    return
  }

  this.traces.push(trace)
}
