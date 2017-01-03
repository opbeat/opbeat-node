'use strict'

// Based on https://github.com/othiym23/shimmer/blob/master/index.js

var log = require('../logger')

exports.wrap = wrap
exports.massWrap = massWrap
exports.unwrap = unwrap

function isFunction (funktion) {
  return funktion && {}.toString.call(funktion) === '[object Function]'
}

function wrap (nodule, name, wrapper) {
  if (!nodule || !nodule[name]) {
    log.i.debug('no original function %s to wrap', name)
    return
  }

  if (!wrapper) {
    log.i.debug(new Error(), 'no wrapper function')
    return
  }

  if (!isFunction(nodule[name]) || !isFunction(wrapper)) {
    log.i.debug('original object and wrapper must be functions')
    return
  }

  if (nodule[name].__obWrapped) {
    log.i.debug('function %s already wrapped', name)
    return
  }

  var original = nodule[name]
  var wrapped = wrapper(original, name)

  wrapped.__obWrapped = true
  wrapped.__obUnwrap = function __obUnwrap () {
    if (nodule[name] === wrapped) {
      nodule[name] = original
      wrapped.__obWrapped = false
    }
  }

  nodule[name] = wrapped

  return wrapped
}

function massWrap (nodules, names, wrapper) {
  if (!nodules) {
    log.i.debug(new Error(), 'must provide one or more modules to patch')
    return
  } else if (!Array.isArray(nodules)) {
    nodules = [nodules]
  }

  if (!(names && Array.isArray(names))) {
    log.i.debug('must provide one or more functions to wrap on modules')
    return
  }

  nodules.forEach(function (nodule) {
    names.forEach(function (name) {
      wrap(nodule, name, wrapper)
    })
  })
}

function unwrap (nodule, name) {
  if (!nodule || !nodule[name]) {
    log.i.debug(new Error(), 'no function to unwrap.')
    return
  }

  if (!nodule[name].__obUnwrap) {
    log.i.debug('no original to unwrap to -- has %s already been unwrapped?', name)
  } else {
    return nodule[name].__obUnwrap()
  }
}
