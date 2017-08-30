'use strict'

var mysql = require('mysql')

exports.reset = reset

function reset (cb) {
  var client = mysql.createConnection({user: 'root', database: 'mysql'})

  client.connect(function (err) {
    if (err) throw err
    client.query('DROP DATABASE IF EXISTS test_opbeat', function (err) {
      if (err) throw err
      client.query('CREATE DATABASE test_opbeat', function (err) {
        if (err) throw err
        client.end(cb)
      })
    })
  })
}
