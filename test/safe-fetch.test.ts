import assert from 'node:assert/strict'
import test from 'node:test'
import { isPrivateAddress } from '../src/utils/safe-fetch.js'

test('bloque les plages IPv4 privées et locales', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.10', '169.254.1.1']) {
    assert.equal(isPrivateAddress(address), true, address)
  }
})

test('accepte une adresse IPv4 publique', () => {
  assert.equal(isPrivateAddress('1.1.1.1'), false)
})

test('bloque les adresses IPv6 locales', () => {
  assert.equal(isPrivateAddress('::1'), true)
  assert.equal(isPrivateAddress('fd00::1'), true)
})
