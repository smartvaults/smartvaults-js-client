const { Crypto } = require('@peculiar/webcrypto')
const { TextEncoder, TextDecoder } = require('util')
const { default: $JSDOMEnvironment, TestEnvironment } = require('jest-environment-jsdom')

Object.defineProperty(exports, '__esModule', {
  value: true
})

class JSDOMEnvironment extends $JSDOMEnvironment {
  constructor(...args) {
    const { global } = super(...args)
    global.TextEncoder = TextEncoder
    global.TextDecoder = TextDecoder
    global.Uint8Array = Uint8Array
    Object.defineProperty(this.global, 'crypto', {
      value: new Crypto()
    })
  }
}

exports.default = JSDOMEnvironment
exports.TestEnvironment = TestEnvironment === $JSDOMEnvironment ? JSDOMEnvironment : TestEnvironment
