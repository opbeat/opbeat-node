'use strict'

var semver = require('semver')
var shimmer = require('../shimmer')
var log = require('../../logger')

module.exports = function (ws, agent, version) {
  if (!semver.satisfies(version, '^1.0.0')) {
    log.i.debug('ws version %s not suppoted - aborting...', version)
    return ws
  }

  log.i.debug('shimming ws.prototype.send function')
  shimmer.wrap(ws.prototype, 'send', wrapSend)

  return ws

  function wrapSend (orig) {
    return function wrappedSend () {
      var trace = agent.buildTrace()
      var uuid = trace && trace.transaction._uuid

      log.i.debug({uuid: uuid}, 'intercepted call to ws.prototype.send')

      if (!trace) return orig.apply(this, arguments)

      var args = [].slice.call(arguments)
      var cb = args[args.length - 1]
      if (typeof cb === 'function') {
        args[args.length - 1] = done
      } else {
        cb = null
        args.push(done)
      }

      trace.start('Send WebSocket Message', 'websocket.send')

      return orig.apply(this, args)

      function done () {
        trace.end()
        if (cb) cb.apply(this, arguments)
      }
    }
  }
}
