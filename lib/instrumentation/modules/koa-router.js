'use strict'

var semver = require('semver')
var shimmer = require('../shimmer')
var log = require('../../logger')

module.exports = function (Router, agent, version) {
  if (!semver.satisfies(version, '^5.2.0')) {
    log.i.debug('koa-router version %s not suppoted - aborting...', version)
    return Router
  }

  log.i.debug('shimming koa-router prototype.match function')
  shimmer.wrap(Router.prototype, 'match', function (orig) {
    return function (_, method) {
      var matched = orig.apply(this, arguments)

      if (typeof method !== 'string') {
        log.i.debug('unexpected method type in koa-router prototype.match: %s', typeof method)
        return matched
      }

      if (matched && matched.pathAndMethod && matched.pathAndMethod.length) {
        var match = matched.pathAndMethod[matched.pathAndMethod.length - 1]
        var path = match && match.path
        if (typeof path === 'string') {
          var name = method + ' ' + path
          agent._instrumentation.setDefaultTransactionName(name)
        } else {
          log.i.debug('unexpected path type in koa-router prototype.match: %s', typeof path)
        }
      } else {
        log.i.debug('unexpected match result in koa-router prototype.match: %s', typeof matched)
      }

      return matched
    }
  })

  return Router
}
