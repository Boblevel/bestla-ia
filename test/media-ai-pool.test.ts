import assert from 'node:assert/strict'
import test from 'node:test'
import { CENTRAL_CLOUDFLARE_IMAGE_WORKERS } from '../src/core/cloudflare-pool.js'

test('le pool Cloudflare central contient un Worker principal et un secours', () => {
  assert.equal(CENTRAL_CLOUDFLARE_IMAGE_WORKERS.length, 2)
  assert.equal(CENTRAL_CLOUDFLARE_IMAGE_WORKERS[0]?.label, 'principal')
  assert.equal(CENTRAL_CLOUDFLARE_IMAGE_WORKERS[1]?.label, 'secours')
  for (const worker of CENTRAL_CLOUDFLARE_IMAGE_WORKERS) {
    const url = new URL(worker.url)
    assert.equal(url.protocol, 'https:')
    assert.match(url.hostname, /\.workers\.dev$/)
    assert.equal(url.pathname, '/')
  }
})
