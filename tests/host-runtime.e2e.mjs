import test from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import * as plugin from '../lib/index.js'

const runtime = process.env.DSH_TEST_RUNTIME

test('installed DSH Connection mounts browser routes across separate service fibers', { skip: !runtime }, async t => {
  const moduleUrl = name => pathToFileURL(resolve(runtime, 'node_modules', '@deepseek-ai', name, 'lib', 'index.js')).href
  const { Context } = await import(moduleUrl('cordis'))
  const { HostConnectionService } = await import(moduleUrl('dsh-client-connection'))
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin({ name: 'host-runtime-dependencies', apply(scope) {
    scope.provide('webServer', { getOrigin: () => 'http://127.0.0.1:3080' })
    scope.provide('tools', { register: () => () => {} })
    scope.provide('sessions', { get: id => id === 'runtime-session' ? { id } : undefined })
  } })
  await ctx.plugin({ name: 'host-runtime-connection', apply(scope) { new HostConnectionService(scope, [], {}) } })
  const fiber = await ctx.plugin(plugin, {})
  assert.equal(fiber.state, 2, 'browser plugin activated')
  const api = ctx.get('connection').createSharedFetchHandler('/api')
  const request = () => new Request('http://127.0.0.1:3080/api/dsh-browser/frame', {
    method: 'POST', body: JSON.stringify({ type: 'client-request', rpcId: 'installed-runtime', method: 'dsh-browser/frame', payload: { sessionId: 'runtime-session' } }),
  })
  assert.equal((await api.fetch(request(), { principal: { kind: 'guest' } })).status, 403)
  const response = await api.fetch(request(), { principal: { kind: 'owner' } })
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.rpcId, 'installed-runtime')
  assert.equal(result.result.ok, true)
  assert.equal(result.result.value.active, false)
  await fiber.dispose()
  assert.equal((await api.fetch(request(), { principal: { kind: 'owner' } })).status, 404)
})
