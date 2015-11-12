'use strict'

var http = require('http')
var util = require('util')
var events = require('events')
var uuid = require('node-uuid')
var OpbeatHttpClient = require('opbeat-http-client')
var ReleaseTracker = require('opbeat-release-tracker')
var config = require('./lib/config')
var parsers = require('./lib/parsers')
var request = require('./lib/request')
var connect = require('./lib/middleware/connect')
var Instrumentation = require('./lib/instrumentation')

var userAgent = 'opbeat-nodejs/' + require('./package').version
var agent // singleton agent

var Opbeat = module.exports = function (opts) {
  if (!(this instanceof Opbeat)) return new Opbeat(opts)
  if (global.__opbeat_agent) {
    agent.logger.info('Cannot initialize the Opbeat agent more than once');
    return agent;
  }
  global.__opbeat_agent = true
  agent = this

  events.EventEmitter.call(this)

  opts = config(opts)
  this.appId = opts.appId
  this.organizationId = opts.organizationId
  this.secretToken = opts.secretToken
  this.active = opts.active
  this.logLevel = opts.logLevel
  this.logger = opts.logger
  this.hostname = opts.hostname
  this.stackTraceLimit = opts.stackTraceLimit
  this.captureExceptions = opts.captureExceptions
  this.exceptionLogLevel = opts.exceptionLogLevel
  this.filter = opts.filter
  this._apiHost = opts._apiHost
  this._ff_captureFrame = opts._ff_captureFrame
  this._ff_instrument = opts._ff_instrument

  connect = connect.bind(this)
  this.middleware = { connect: connect, express: connect }

  var ins = new Instrumentation(this)
  this._instrumentation = ins
  this.startTransaction = ins.startTransaction.bind(ins)
  this.endTransaction = ins.endTransaction.bind(ins)
  this.setTransactionName = ins.setTransactionName.bind(ins)
  this.buildTrace = ins.buildTrace.bind(ins)

  if (!this.active) {
    this.logger.info('Opbeat logging is disabled for now')
  } else if (!this.appId || !this.organizationId || !this.secretToken) {
    this.logger.info('[WARNING] Opbeat logging is disabled. To enable, specify organization id, app id and secret token')
    this.active = false
  } else {
    this._start()
  }
}

util.inherits(Opbeat, events.EventEmitter)

Opbeat.prototype._start = function () {
  this._httpClient = OpbeatHttpClient({
    appId: this.appId,
    organizationId: this.organizationId,
    secretToken: this.secretToken,
    userAgent: userAgent,
    _apiHost: this._apiHost
  })

  Error.stackTraceLimit = this.stackTraceLimit
  if (this.captureExceptions) this.handleUncaughtExceptions()

  this.on('error', this._internalErrorLogger)
  this.on('logged', function (url, uuid) {
    agent.logger.info('[%s] Opbeat logged error successfully at %s', uuid, url)
  })
}

Opbeat.prototype.captureError = function (err, data, cb) {
  var captureTime = new Date()

  if (typeof data === 'function') {
    cb = data
    data = {}
  } else if (!data) {
    data = {}
  } else if (data.request instanceof http.IncomingMessage) {
    data.http = parsers.parseRequest(data.request)
  }
  delete data.request

  var trace = this._instrumentation.currentTrace
  if (!data.http && trace && trace.transaction.req) data.http = parsers.parseRequest(trace.transaction.req)

  var level = this.exceptionLogLevel || 'error'
  level = level === 'warning' ? 'warn' : level

  var errUUID = data.extra && data.extra.uuid || uuid.v4()

  if (!util.isError(err)) {
    var isMessage = true
    var customCulprit = 'culprit' in data
    parsers.parseMessage(err, data)
    this.logger[level]('[%s]', errUUID, data.message)
    err = new Error(data.message)
  } else if (this._ff_captureFrame && !err.uncaught) {
    var captureFrameError = new Error()
  }

  if (!isMessage) {
    agent.logger.info('[%s] logging error with Opbeat:', errUUID)
    agent.logger[level](err.stack)
  }

  parsers.parseError(err, data, function (data) {
    if (isMessage) {
      // Messages shouldn't have an exception and the algorithm for finding the
      // culprit might show the Opbeat agent and we don't want that
      delete data.exception
      if (!customCulprit) delete data.culprit
      data.stacktrace.frames.shift()
    }

    var done = function () {
      data.stacktrace.frames.reverse() // opbeat expects frames in reverse order
      data.machine = { hostname: agent.hostname }
      data.extra = data.extra || {}
      data.extra.node = process.version
      if (!data.extra.uuid) data.extra.uuid = errUUID
      data.timestamp = captureTime.toISOString()

      if (agent.filter) data = agent.filter(err, data)
      if (agent.active) request.error(agent, data, cb)
    }

    if (captureFrameError && !data.stacktrace.frames.some(function (frame) { return frame.in_app })) {
      // prepare to add a top frame to the stack trace specifying the location
      // where captureError was called from. This can make it easier to debug
      // async stack traces.
      parsers.parseError(captureFrameError, {}, function (result) {
        // ignore the first frame as it will be the opbeat module
        data.stacktrace.frames.unshift(result.stacktrace.frames[1])
        done()
      })
    } else {
      done()
    }
  })
}

// The optional callback will be called with the error object after the
// error have been logged to Opbeat. If no callback have been provided
// we will automatically terminate the process, so if you provide a
// callback you must remember to terminate the process manually.
Opbeat.prototype.handleUncaughtExceptions = function (cb) {
  if (this._uncaughtExceptionListener) process.removeListener('uncaughtException', this._uncaughtExceptionListener)

  this._uncaughtExceptionListener = function (err) {
    var data = {
      extra: { uuid: uuid.v4() },
      level: agent.exceptionLogLevel
    }

    agent.logger.debug('[%s] Opbeat caught unhandled exception', data.extra.uuid)

    // Since we exit the node-process we cannot guarantee that the
    // listeners will be called, so to ensure a uniform result,
    // we'll remove all event listeners if an uncaught exception is
    // found
    agent.removeAllListeners()
    // But make sure emitted errors doesn't cause yet another uncaught
    // exception
    agent.on('error', agent._internalErrorLogger)

    err.uncaught = true

    agent.captureError(err, data, function (opbeatErr, url) {
      if (opbeatErr) {
        agent.logger.info('[%s] Could not notify Opbeat!', data.extra.uuid)
        agent.logger.error(opbeatErr.stack)
      } else {
        agent.logger.info('[%s] Opbeat logged error successfully at %s', data.extra.uuid, url)
      }
      cb ? cb(err, url) : process.exit(1)
    })
  }

  process.on('uncaughtException', this._uncaughtExceptionListener)
}

Opbeat.prototype.trackRelease = function (data, cb) {
  if (data.path) {
    this.logger.warn('Detected use of deprecated path option to trackRelease function!')
    if (!data.cwd) data.cwd = data.path
  }
  if (!this._releaseTracker) this._releaseTracker = ReleaseTracker(this._httpClient)
  this._releaseTracker(data, function (err) {
    if (cb) cb(err)
    if (err) agent.emit('error', err)
  })
}

Opbeat.prototype.trackDeployment = Opbeat.prototype.trackRelease

Opbeat.prototype._internalErrorLogger = function (err, uuid) {
  if (uuid) this.logger.info('[%s] Could not notify Opbeat!', uuid)
  else this.logger.info('Could not notify Opbeat!')
  this.logger.error(err.stack)
}
