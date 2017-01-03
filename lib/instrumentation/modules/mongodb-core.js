'use strict'

var semver = require('semver')
var log = require('../../logger')
var shimmer = require('../shimmer')

var SERVER_FNS = ['insert', 'update', 'remove', 'auth']
var CURSOR_FNS_FIRST = ['_find', '_getmore']

module.exports = function (mongodb, agent, version) {
  if (!semver.satisfies(version, '>=1.2.7 <3.0.0')) {
    log.i.debug('mongodb-core version %s not suppoted - aborting...', version)
    return mongodb
  }

  if (mongodb.Server) {
    log.i.debug('shimming mongodb-core.Server.prototype.command')
    shimmer.wrap(mongodb.Server.prototype, 'command', wrapCommand)
    log.i.debug('shimming mongodb-core.Server.prototype functions: %s', SERVER_FNS)
    shimmer.massWrap(mongodb.Server.prototype, SERVER_FNS, wrapQuery)
  }

  if (mongodb.Cursor) {
    log.i.debug('shimming mongodb-core.Cursor.prototype functions: %s', CURSOR_FNS_FIRST)
    shimmer.massWrap(mongodb.Cursor.prototype, CURSOR_FNS_FIRST, wrapCursor)
  }

  return mongodb

  function wrapCommand (orig) {
    return function wrappedFunction (ns, cmd) {
      var trace = agent.buildTrace()
      var uuid = trace && trace.transaction._uuid

      log.i.debug({uuid: uuid, ns: ns}, 'intercepted call to mongodb-core.Server.prototype.command')

      if (trace && arguments.length > 0) {
        var index = arguments.length - 1
        var cb = arguments[index]
        if (typeof cb === 'function') {
          var type
          if (cmd.findAndModify) type = 'findAndModify'
          else if (cmd.createIndexes) type = 'createIndexes'
          else if (cmd.ismaster) type = 'ismaster'
          else if (cmd.count) type = 'count'
          else type = 'command'

          arguments[index] = wrappedCallback
          trace.start(ns + '.' + type, 'db.mongodb.query')
        }
      }

      return orig.apply(this, arguments)

      function wrappedCallback () {
        log.i.debug({uuid: uuid}, 'intercepted mongodb-core.Server.prototype.command callback')
        trace.end()
        return cb.apply(this, arguments)
      }
    }
  }

  function wrapQuery (orig, name) {
    return function wrappedFunction (ns) {
      var trace = agent.buildTrace()
      var uuid = trace && trace.transaction._uuid

      log.i.debug({uuid: uuid, ns: ns}, 'intercepted call to mongodb-core.Server.prototype.%s', name)

      if (trace && arguments.length > 0) {
        var index = arguments.length - 1
        var cb = arguments[index]
        if (typeof cb === 'function') {
          arguments[index] = wrappedCallback
          trace.start(ns + '.' + name, 'db.mongodb.query')
        }
      }

      return orig.apply(this, arguments)

      function wrappedCallback () {
        log.i.debug({uuid: uuid}, 'intercepted mongodb-core.Server.prototype.%s callback', name)
        trace.end()
        return cb.apply(this, arguments)
      }
    }
  }

  function wrapCursor (orig, name) {
    return function wrappedFunction () {
      var trace = agent.buildTrace()
      var uuid = trace && trace.transaction._uuid

      log.i.debug({uuid: uuid}, 'intercepted call to mongodb-core.Cursor.prototype.%s', name)

      if (trace && arguments.length > 0) {
        var cb = arguments[0]
        if (typeof cb === 'function') {
          arguments[0] = wrappedCallback
          trace.start(this.ns + '.' + (this.cmd.find ? 'find' : name), 'db.mongodb.query')
        }
      }

      return orig.apply(this, arguments)

      function wrappedCallback () {
        log.i.debug({uuid: uuid}, 'intercepted mongodb-core.Cursor.prototype.%s callback', name)
        trace.end()
        return cb.apply(this, arguments)
      }
    }
  }
}
