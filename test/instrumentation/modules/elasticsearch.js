'use strict'

process.env.OPBEAT_TEST = true

var agent = require('../../..').start({
  appId: 'test',
  organizationId: 'test',
  secretToken: 'test',
  captureExceptions: false
})

// In Node.js v0.10 there's no built-in Promise library
if (!global.Promise) global.Promise = require('bluebird')

var test = require('tape')
var elasticsearch = require('elasticsearch')

test('client.ping with callback', function userLandCode (t) {
  resetAgent(done(t, 'HEAD', '/'))

  agent.startTransaction('foo1')

  var client = new elasticsearch.Client()

  client.ping(function (err) {
    t.error(err)
    agent.endTransaction()
    agent._instrumentation._queue._flush()
  })
})

test('client.ping with promise', function userLandCode (t) {
  resetAgent(done(t, 'HEAD', '/'))

  agent.startTransaction('foo2')

  var client = new elasticsearch.Client()

  client.ping().then(function () {
    agent.endTransaction()
    agent._instrumentation._queue._flush()
  }, function (err) {
    t.error(err)
  })
})

test('client.search with callback', function userLandCode (t) {
  resetAgent(done(t, 'POST', '/_search', '{"q":"pants"}'))

  agent.startTransaction('foo3')

  var client = new elasticsearch.Client()
  var query = {q: 'pants'}

  client.search(query, function (err) {
    t.error(err)
    agent.endTransaction()
    agent._instrumentation._queue._flush()
  })
})

// { transactions:
//    [ { transaction: 'foo',
//        result: 200,
//        kind: 'custom',
//        timestamp: '2017-04-19T13:56:00.000Z',
//        durations: [ 113.242003 ] } ],
//   traces:
//    { groups:
//       [ { transaction: 'foo',
//           signature: 'ES HEAD /',
//           kind: 'db.elasticsearch.request',
//           transaction_kind: 'custom',
//           timestamp: '2017-04-19T13:56:00.000Z',
//           parents: [ 'transaction' ],
//           extra: { _frames: [Object] } },
//         { transaction: 'foo',
//           signature: 'HEAD localhost:9200/',
//           kind: 'ext.http.http.truncated',
//           transaction_kind: 'custom',
//           timestamp: '2017-04-19T13:56:00.000Z',
//           parents: [ 'transaction' ],
//           extra: { _frames: [Object] } },
//         { transaction: 'foo',
//           signature: 'transaction',
//           kind: 'transaction',
//           transaction_kind: 'custom',
//           timestamp: '2017-04-19T13:56:00.000Z',
//           parents: [],
//           extra: { _frames: [Object] } } ],
//      raw:
//       [ [ 113.242003,
//           [ 0, 85.036591, 27.50339 ],
//           [ 1, 95.930828, 17.186125 ],
//           [ 2, 0, 113.242003 ],
//           { extra: [Object], user: {} } ] ] } }
function done (t, method, path, query) {
  return function (endpoint, headers, data, cb) {
    t.equal(data.transactions.length, 1)
    t.ok(/^foo\d$/.test(data.transactions[0].transaction))
    t.equal(data.transactions[0].kind, 'custom')

    t.equal(data.traces.groups.length, 3)

    t.equal(data.traces.groups[0].kind, 'ext.http.http')
    t.equal(data.traces.groups[0].transaction_kind, 'custom')
    t.deepEqual(data.traces.groups[0].parents, ['transaction'])
    t.equal(data.traces.groups[0].signature, method + ' localhost:9200' + path)
    t.ok(/^foo\d$/.test(data.traces.groups[0].transaction))

    t.equal(data.traces.groups[1].kind, 'db.elasticsearch.request')
    t.equal(data.traces.groups[1].transaction_kind, 'custom')
    t.deepEqual(data.traces.groups[1].parents, ['transaction'])
    t.equal(data.traces.groups[1].signature, 'Elasticsearch: ' + method + ' ' + path)
    t.ok(/^foo\d$/.test(data.traces.groups[1].transaction))
    t.ok(data.traces.groups[1].extra._frames.some(function (frame) {
      return frame.function === 'userLandCode'
    }), 'include user-land code frame')
    t.equal(data.traces.groups[1].extra.sql, query || '{}')

    t.equal(data.traces.groups[2].kind, 'transaction')
    t.equal(data.traces.groups[2].transaction_kind, 'custom')
    t.deepEqual(data.traces.groups[2].parents, [])
    t.equal(data.traces.groups[2].signature, 'transaction')
    t.ok(/^foo\d$/.test(data.traces.groups[2].transaction))

    var totalTraces = data.traces.raw[0].length - 2
    var totalTime = data.traces.raw[0][0]

    t.equal(data.traces.raw.length, 1)
    t.equal(totalTraces, 3)

    for (var i = 1; i < totalTraces + 1; i++) {
      t.equal(data.traces.raw[0][i].length, 3)
      t.ok(data.traces.raw[0][i][0] >= 0, 'group index should be >= 0')
      t.ok(data.traces.raw[0][i][0] < data.traces.groups.length, 'group index should be within allowed range')
      t.ok(data.traces.raw[0][i][1] >= 0)
      t.ok(data.traces.raw[0][i][2] <= totalTime)
    }

    t.equal(data.traces.raw[0][totalTraces][1], 0, 'root trace should start at 0')
    t.equal(data.traces.raw[0][totalTraces][2], data.traces.raw[0][0], 'root trace should last to total time')

    t.deepEqual(data.transactions[0].durations, [data.traces.raw[0][0]])

    t.end()
  }
}

function resetAgent (cb) {
  agent._instrumentation._queue._clear()
  agent._instrumentation.currentTransaction = null
  agent._httpClient = { request: cb || function () {} }
  agent.captureError = function (err) { throw err }
}
