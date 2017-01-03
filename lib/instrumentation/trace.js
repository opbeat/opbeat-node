'use strict'

var log = require('../logger')

module.exports = Trace

function Trace (transaction) {
  this.transaction = transaction
  this.started = false
  this.truncated = false
  this.ended = false
  this.extra = {}
  this.signature = null
  this.type = null
  this._start = 0
  this._hrtime = null
  this._diff = null
  this._stackObj = null
  this._agent = transaction._agent
  this._parent = transaction._rootTrace

  log.i.debug({uuid: this.transaction._uuid}, 'init trace')
}

Trace.prototype.start = function (signature, type) {
  if (this.started) {
    log.i.debug({uuid: this.transaction._uuid, signature: this.signature, type: this.type}, 'tried to call trace.start() on already started trace')
    return
  }

  this.started = true
  this.signature = signature || this.signature
  this.type = type || this.type || 'custom.code'

  if (!this._stackObj) this._recordStackTrace()

  this._start = Date.now()
  this._hrtime = process.hrtime()

  log.i.debug({uuid: this.transaction._uuid, signature: signature, type: type}, 'start trace')
}

Trace.prototype.customStackTrace = function (stackObj) {
  log.i.debug({uuid: this.transaction._uuid}, 'applying custom stack trace to trace')
  this._recordStackTrace(stackObj)
}

Trace.prototype.truncate = function () {
  if (!this.started) {
    log.i.debug({uuid: this.transaction._uuid, signature: this.signature, type: this.type}, 'tried to truncate non-started trace - ignoring')
    return
  } else if (this.ended) {
    log.i.debug({uuid: this.transaction._uuid, signature: this.signature, type: this.type}, 'tried to truncate already ended trace - ignoring')
    return
  }
  this.truncated = true
  this.end()
}

Trace.prototype.end = function () {
  if (this.ended) {
    log.i.debug({uuid: this.transaction._uuid, signature: this.signature, type: this.type}, 'tried to call trace.end() on already ended trace')
    return
  }

  this._diff = process.hrtime(this._hrtime)
  this._agent._instrumentation._recoverTransaction(this.transaction)

  this.ended = true
  log.i.debug({uuid: this.transaction._uuid, signature: this.signature, type: this.type}, 'ended trace')
  this.transaction._recordEndedTrace(this)
}

Trace.prototype.duration = function () {
  if (!this.ended) {
    log.i.debug({uuid: this.transaction._uuid, signature: this.signature, type: this.type}, 'tried to call trace.duration() on un-ended trace')
    return null
  }

  var ns = this._diff[0] * 1e9 + this._diff[1]
  return ns / 1e6
}

Trace.prototype.startTime = function () {
  if (!this.ended || !this.transaction.ended) {
    log.i.debug({uuid: this.transaction._uuid, signature: this.signature, type: this.type}, 'tried to call trace.startTime() for un-ended trace/transaction')
    return null
  }

  if (!this._parent) return 0
  var start = this._parent._hrtime
  var ns = (this._hrtime[0] - start[0]) * 1e9 + (this._hrtime[1] - start[1])
  return ns / 1e6
}

Trace.prototype.ancestors = function () {
  if (!this.ended || !this.transaction.ended) {
    log.i.debug({uuid: this.transaction._uuid, signature: this.signature, type: this.type}, 'tried to call trace.ancestors() for un-ended trace/transaction')
    return null
  }

  if (!this._parent) return []
  return this._parent.ancestors().concat(this._parent.signature)
}

Trace.prototype._recordStackTrace = function (obj) {
  if (!obj) {
    obj = {}
    Error.captureStackTrace(obj, this)
  }
  this._stackObj = { err: obj }
}
