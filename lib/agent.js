'use strict'

var http = require('http')
var util = require('util')
var EventEmitter = require('events').EventEmitter
var uuid = require('uuid')
var OpbeatHttpClient = require('opbeat-http-client')
var ReleaseTracker = require('opbeat-release-tracker')
var config = require('./config')
var log = require('./logger')
var Filters = require('./filters')
var parsers = require('./parsers')
var request = require('./request')
var connect = require('./middleware/connect')
var Instrumentation = require('./instrumentation')

var version = require('../package').version
var userAgent = 'opbeat-nodejs/' + version

var noop = function () {}

module.exports = Agent

function Agent () {
  EventEmitter.call(this)

  var boundConnect = connect.bind(this)
  this.middleware = { connect: boundConnect, express: boundConnect }

  this._instrumentation = new Instrumentation(this)
  this._filters = new Filters()
  this._platform = {}

  // configure the agent with default values
  this._config()
}

util.inherits(Agent, EventEmitter)

Agent.prototype.startTransaction = function () {
  return this._instrumentation.startTransaction.apply(this._instrumentation, arguments)
}

Agent.prototype.endTransaction = function () {
  return this._instrumentation.endTransaction.apply(this._instrumentation, arguments)
}

Agent.prototype.setTransactionName = function () {
  return this._instrumentation.setTransactionName.apply(this._instrumentation, arguments)
}

Agent.prototype.buildTrace = function () {
  return this._instrumentation.buildTrace.apply(this._instrumentation, arguments)
}

Agent.prototype._config = function (opts) {
  opts = config(opts)

  if (opts.logger) {
    log.setLogger(opts.logger)
  } else {
    log.init(opts.logLevel, opts.logFile)
  }

  this.appId = opts.appId
  this.organizationId = opts.organizationId
  this.secretToken = opts.secretToken
  this.active = opts.active
  this.hostname = opts.hostname
  this.stackTraceLimit = opts.stackTraceLimit
  this.captureExceptions = opts.captureExceptions
  this.captureTraceStackTraces = opts.captureTraceStackTraces
  this.exceptionLogLevel = opts.exceptionLogLevel
  this.timeout = {
    active: opts.timeout,
    errorThreshold: opts.timeoutErrorThreshold
  }
  this.instrument = opts.instrument
  this._logBody = opts.logBody
  this._ignoreUrlStr = opts.ignoreUrlStr
  this._ignoreUrlRegExp = opts.ignoreUrlRegExp
  this._ignoreUserAgentStr = opts.ignoreUserAgentStr
  this._ignoreUserAgentRegExp = opts.ignoreUserAgentRegExp
  this.ff_captureFrame = opts.ff_captureFrame
  this._apiHost = opts._apiHost
  this._apiPort = opts._apiPort
  this._apiSecure = opts._apiSecure

  return opts
}

Agent.prototype.start = function (opts) {
  if (global.__opbeat_initialized) throw new Error('Do not call opbeat.start() more than once')
  global.__opbeat_initialized = true

  opts = this._config(opts)

  this._filters.config(opts)

  if (!this.active) {
    log.i.info('Opbeat agent is inactive due to configuration')
    return this
  } else if (!this.appId || !this.organizationId || !this.secretToken) {
    log.i.error('Opbeat isn\'t correctly configured: Missing organizationId, appId or secretToken')
    this.active = false
    return this
  } else {
    log.i.debug({node: process.version, agent: version, org: this.organizationId, app: this.appId, instrument: this.instrument}, 'agent configured correctly')
  }

  this._instrumentation.start()

  this._httpClient = OpbeatHttpClient({
    appId: this.appId,
    organizationId: this.organizationId,
    secretToken: this.secretToken,
    userAgent: userAgent,
    _apiHost: this._apiHost,
    _apiPort: this._apiPort,
    _apiSecure: this._apiSecure
  })

  Error.stackTraceLimit = this.stackTraceLimit
  if (this.captureExceptions) this.handleUncaughtExceptions()

  this.on('error', function (err, uuid) {
    log.i.error({uuid: uuid}, 'Could not notify Opbeat')
    console.error(err.stack)
  })
  this.on('logged', function (url, uuid) {
    log.i.info({uuid: uuid}, 'Opbeat logged error successfully at %s', url)
  })

  return this
}

Agent.prototype.addFilter = function (fn) {
  if (typeof fn !== 'function') {
    log.i.error('Can\'t add filter of type %s', typeof fn)
    return
  }

  this._filters.add(fn)
}

Agent.prototype.captureError = function (err, payload, cb) {
  var agent = this
  var captureTime = new Date()

  if (typeof payload === 'function') {
    cb = payload
    payload = {}
  } else if (!payload) {
    payload = {}
  } else if (payload.request instanceof http.IncomingMessage) {
    payload.http = parsers.parseRequest(payload.request, {body: this._logBody})
  }
  delete payload.request

  var trans = this._instrumentation.currentTransaction
  if (!payload.http && trans && trans.req) payload.http = parsers.parseRequest(trans.req, {body: this._logBody})

  var errUUID = payload.extra && payload.extra.uuid || uuid.v4()

  if (!util.isError(err)) {
    var isMessage = true
    var customCulprit = 'culprit' in payload
    parsers.parseMessage(err, payload)
    log.i.error({uuid: errUUID}, payload.message)
    err = new Error(payload.message)
  } else if (this.ff_captureFrame && !err.uncaught) {
    var captureFrameError = new Error()
  }

  if (!isMessage) {
    log.i.error({uuid: errUUID}, 'logging error with Opbeat')
    console.error(err.stack)
  }

  parsers.parseError(err, payload, function (payload) {
    if (isMessage) {
      // Messages shouldn't have an exception and the algorithm for finding the
      // culprit might show the Opbeat agent and we don't want that
      delete payload.exception
      if (!customCulprit) delete payload.culprit
      if (payload.stacktrace) payload.stacktrace.frames.shift()
    }

    var done = function () {
      if (payload.stacktrace) payload.stacktrace.frames.reverse() // opbeat expects frames in reverse order
      payload.machine = { hostname: agent.hostname }
      payload.extra = payload.extra || {}
      payload.extra.node = process.version
      if (!payload.extra.uuid) payload.extra.uuid = errUUID
      payload.timestamp = captureTime.toISOString()

      payload = agent._filters.process(payload)
      if (!payload) log.i.info('Error not sent to Opbeat - Ignored by filter')

      if (payload && agent.active) request.error(agent, payload, cb)
      else if (cb) cb()
    }

    if (captureFrameError && (!payload.stacktrace || !payload.stacktrace.frames.some(function (frame) { return frame.in_app }))) {
      // prepare to add a top frame to the stack trace specifying the location
      // where captureError was called from. This can make it easier to debug
      // async stack traces.
      parsers.parseError(captureFrameError, {}, function (result) {
        // ignore the first frame as it will be the opbeat module
        if (result.stacktrace) var frame = result.stacktrace.frames[1]
        if (payload.stacktrace) payload.stacktrace.frames.unshift(frame)
        else if (frame) payload.stacktrace = { frames: [frame] }
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
Agent.prototype.handleUncaughtExceptions = function (cb) {
  var agent = this

  if (this._uncaughtExceptionListener) process.removeListener('uncaughtException', this._uncaughtExceptionListener)

  this._uncaughtExceptionListener = function (err) {
    var payload = {
      extra: { uuid: uuid.v4() },
      level: agent.exceptionLogLevel
    }

    log.i.debug({uuid: payload.extra.uuid}, 'Opbeat caught unhandled exception')

    // Since we exit the node-process we cannot guarantee that the
    // listeners will be called, so to ensure a uniform result,
    // we'll remove all event listeners if an uncaught exception is
    // found
    agent.removeAllListeners()
    // But make sure emitted errors doesn't cause yet another uncaught
    // exception
    agent.on('error', function (err, uuid) {
      log.i.error({uuid: uuid}, 'Could not notify Opbeat')
      console.error(err.stack)
    })

    err.uncaught = true

    agent.captureError(err, payload, function (opbeatErr, url) {
      if (opbeatErr) {
        log.i.error({uuid: payload.extra.uuid}, 'Could not notify Opbeat')
        console.error(opbeatErr.stack)
      } else {
        log.i.info({uuid: payload.extra.uuid}, 'Opbeat logged error successfully at %s', url)
      }
      cb ? cb(err, url) : process.exit(1)
    })
  }

  process.on('uncaughtException', this._uncaughtExceptionListener)
}

Agent.prototype.trackRelease = function (opts, cb) {
  if (!this._releaseTracker) this._releaseTracker = ReleaseTracker(this._httpClient)
  this._releaseTracker(opts, cb || noop)
}
