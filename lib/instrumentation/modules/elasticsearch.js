'use strict'

var debug = require('debug')('opbeat')
var shimmer = require('../shimmer')

module.exports = function (elasticsearch, opbeat, version) {
  debug('shimming elasticsearch.Transport.prototype.request')
  shimmer.wrap(elasticsearch.Transport && elasticsearch.Transport.prototype, 'request', wrapRequest)

  return elasticsearch

  function wrapRequest (original) {
    return function wrappedRequest (params, cb) {
      var trace = opbeat.buildTrace()
      var uuid = trace && trace.transaction._uuid
      var method = params && params.method
      var path = params && params.path
      var query = params && params.query

      debug('intercepted call to elasticsearch.Transport.prototype.request %o', {uuid: uuid, method: method, path: path})

      if (trace && method && path) {
        trace.start('Elasticsearch: ' + method + ' ' + path, 'db.elasticsearch.request')

        if (query) trace.extra.sql = JSON.stringify(query)

        if (typeof cb === 'function') {
          var args = Array.prototype.slice.call(arguments)
          args[1] = function () {
            trace.end()
            return cb.apply(this, arguments)
          }
          return original.apply(this, args)
        } else {
          var p = original.apply(this, arguments)
          p.then(function () {
            trace.end()
          })
          return p
        }
      } else {
        debug('could not trace elasticsearch request %o', {uuid: uuid})
        return original.apply(this, arguments)
      }
    }
  }
}
