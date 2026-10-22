import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, inject } from '../lib/index.js'

function fixture() {
  const cleanups = []
  let tool
  let handler
  const context = {
    effect(setup) { cleanups.push(setup()) },
    on() {},
    tools: { register(value) { tool = value; return () => { tool = undefined } } },
    sessions: { get(id) { return id === 'session-a' ? {} : undefined } },
    webServer: { getOrigin: () => 'http://127.0.0.1:3080' },
    connection: { fetch: { register(route) {
      const routes = handler ?? new Map()
      handler = routes
      routes.set(route.path, route)
      cleanups.push(() => { routes.delete(route.path); if (!routes.size) handler = undefined })
      return async () => {}
    } } },
  }
  apply(context, {})
  return {
    get tool() { return tool }, get handler() { return handler },
    async request(endpoint, payload, envelope = {}) {
      const method = `dsh-browser/${endpoint}`
      const route = handler.get(`/api/${method}`)
      return route.fetch(new Request(`http://127.0.0.1:3080/api/${method}`, {
        method: 'POST', body: JSON.stringify({ type: 'client-request', rpcId: 'test-rpc', method, payload, ...envelope }),
      }))
    },
    async dispose() { for (const cleanup of cleanups.reverse()) await cleanup() },
  }
}

test('tool output uses the normal canonical renderer and unregisters on unload', async () => {
  const app = fixture()
  assert.deepEqual(inject, ['tools', 'sessions', 'connection', 'webServer'])
  assert.equal(app.tool.name, 'sidebar_browser')
  const value = await app.tool.execute({ action: 'close' }, { agent: { session: { id: 'session-a' } }, signal: new AbortController().signal })
  assert.deepEqual(app.tool.output.render({}, value), [{ type: 'text', text: value.text }])
  assert.match(value.text, /discarded/)
  await app.dispose()
  assert.equal(app.tool, undefined)
  assert.equal(app.handler, undefined)
})

test('executor denies missing Agents, malformed commands, and user-only gestures', async t => {
  const app = fixture()
  t.after(() => app.dispose())
  const signal = new AbortController().signal
  await assert.rejects(app.tool.execute({ action: 'snapshot' }, { signal }), /live Agent/)
  const execution = { signal, agent: { session: { id: 'session-a' } } }
  await assert.rejects(app.tool.execute({ action: 'pointer', x: 1, y: 1 }, execution), /Use click/)
  await assert.rejects(app.tool.execute({ action: 'navigate' }, execution))
})

test('authenticated API dispatch requires a live Session, validates envelopes, and echoes correlation', async t => {
  const app = fixture()
  t.after(() => app.dispose())
  const call = async (endpoint, payload) => (await app.request(endpoint, payload)).json()
  assert.equal((await call('frame', { sessionId: 'missing' })).result.ok, false)
  assert.equal((await call('frame', { sessionId: 'session-a', command: { action: 'close' } })).result.ok, false)
  assert.equal((await call('command', { sessionId: 'session-a' })).result.ok, false)
  const frame = await call('frame', { sessionId: 'session-a' })
  assert.equal(frame.rpcId, 'test-rpc')
  assert.equal(frame.result.ok, true)
  assert.equal(frame.result.value.active, false)
  assert.equal((await app.request('frame', { sessionId: 'session-a' }, { method: 'wrong-method' })).status, 400)
  assert.equal((await app.request('frame', { sessionId: 'session-a' }, { type: 'wrong-type' })).status, 400)
  assert.equal((await call('command', { sessionId: 'session-a', command: { action: 'close' } })).result.ok, false)
  const clientId = crypto.randomUUID()
  assert.equal((await call('input', { sessionId: 'session-a', clientId, input: { type: 'down', x: 1, y: 1 } })).result.ok, false)
  assert.equal((await call('input', { sessionId: 'session-a', input: { type: 'cancel' } })).result.ok, false)
  assert.equal((await call('input', { sessionId: 'session-a', clientId, input: { type: 'move' } })).result.ok, false)
  assert.equal((await call('control', { sessionId: 'session-a', clientId, take: true })).result.ok, true)
  assert.equal((await call('input', { sessionId: 'session-a', clientId, input: { type: 'cancel' } })).result.ok, true)
  assert.equal((await call('command', { sessionId: 'session-a', clientId, command: { action: 'close' } })).result.ok, true)
  assert.equal((await call('control', { sessionId: 'session-a', clientId, take: false })).result.ok, true)
  const route = app.handler.get('/api/dsh-browser/frame')
  assert.equal((await route.fetch(new Request('http://127.0.0.1:3080/api/dsh-browser/frame', { method: 'POST', body: '{' }))).status, 400)
})
