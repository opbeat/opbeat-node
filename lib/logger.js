'use strict'

var fs = require('fs')
var pino = require('pino')
var pkg = require('../package')

exports.setLogger = setLogger
exports.init = init

// temporary logger until the real one can be initialized
setLogger(pino({
  name: pkg.name,
  serializers: {err: pino.stdSerializers.err}
}))

function setLogger (logger) {
  exports.i = logger
}

function init (level, dest) {
  if (typeof dest === 'string') {
    switch (dest.toLowerCase()) {
      case 'stdout':
        dest = process.stdout
        break
      case 'stderr':
        dest = process.stderr
        break
      default:
        dest = fs.createWriteStream(dest)
    }
  }

  setLogger(pino({
    name: pkg.name,
    serializers: {err: pino.stdSerializers.err},
    level: level
  }, dest))
}
