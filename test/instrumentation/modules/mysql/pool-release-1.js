'use strict'

var agent = require('../../../..').start({
  appId: 'test',
  organizationId: 'test',
  secretToken: 'test',
  captureExceptions: false
})

var test = require('tape')
var mysql = require('mysql')
var utils = require('./_utils')

test('release connection prior to transaction', function (t) {
  createPool(function (pool) {
    pool.getConnection(function (err, conn) {
      t.error(err)
      conn.release() // important to release connection before starting the transaction

      agent.startTransaction('foo')
      t.ok(agent._instrumentation.currentTransaction)

      pool.getConnection(function (err, conn) {
        t.error(err)
        t.ok(agent._instrumentation.currentTransaction)
        pool.end()
        t.end()
      })
    })
  })
})

function createPool (cb) {
  setup(function () {
    var pool = mysql.createPool({
      user: 'root',
      database: 'test_opbeat'
    })

    cb(pool)
  })
}

function setup (cb) {
  utils.reset(cb)
}
