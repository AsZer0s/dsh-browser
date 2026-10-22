import test from 'node:test'
import assert from 'node:assert/strict'
import { configSchema, commandSchema } from '../src/config.ts'
import { browserUrl } from '../src/browser.ts'

test('configuration resolves defaults and rejects invalid bounds and unknown fields', () => {
  assert.equal(configSchema.parse({}).viewportWidth, 1280)
  assert.equal(configSchema.parse({}).humanFrameIntervalMs, 150)
  for (const humanFrameIntervalMs of [49, 2001]) assert.throws(() => configSchema.parse({ humanFrameIntervalMs }))
  for (const value of [{ maxSessions: 0 }, { jpegQuality: 100 }, { frameIntervalMs: 1 }, { headless: 'yes' }, { unsupported: true }]) {
    assert.throws(() => configSchema.parse(value))
  }
})

test('commands validate required arguments, finite bounds, and extra fields', () => {
  assert.deepEqual(commandSchema.parse({ action: 'snapshot' }), { action: 'snapshot' })
  for (const value of [{ action: 'fill', selector: '#name' }, { action: 'scroll', deltaY: Infinity }, { action: 'snapshot', code: 'alert(1)' }, { action: 'evaluate' }]) {
    assert.throws(() => commandSchema.parse(value))
  }
})

test('URL admission permits HTTP(S), rejects credentials and the DSH listener', () => {
  const origin = 'http://127.0.0.1:3080'
  assert.equal(browserUrl('https://example.com', origin), 'https://example.com/')
  assert.equal(browserUrl('http://localhost:5173/', origin), 'http://localhost:5173/')
  for (const [input, expected] of [
    ['0u.nz', 'https://0u.nz/'], ['  0u.nz/path?q=1#top  ', 'https://0u.nz/path?q=1#top'],
    ['example.com:8443/path', 'https://example.com:8443/path'], ['//example.com/path', 'https://example.com/path'],
    ['localhost:5173', 'http://localhost:5173/'], ['127.0.0.1:5173', 'http://127.0.0.1:5173/'],
    ['[::1]:5173', 'http://[::1]:5173/'], ['http://0u.nz', 'http://0u.nz/'],
  ]) assert.equal(browserUrl(input, origin), expected)
  for (const url of ['', '   ', 'not a host', 'https://', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,test', 'ftp://example.com', 'https://user:pass@example.com', 'user:pass@example.com', 'user@example.com', origin, 'http://localhost:3080', 'http://[::1]:3080', 'http://127.0.0.2:3080', 'localhost:3080', '127.0.0.1:3080', '//127.0.0.1:3080', 'example.com\\@127.0.0.1:3080']) {
    assert.throws(() => browserUrl(url, origin))
  }
})
