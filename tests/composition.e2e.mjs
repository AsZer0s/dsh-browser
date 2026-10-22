import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'

test('cordis.yml loads the published plugin, drives a real browser, and removes contributions', { timeout: 30000 }, async t => {
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html')
    res.end('<title>Loader browser test</title><button>Hello from the loaded plugin</button>')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const ctx = new Context()
  ctx.baseUrl = new URL('./fixtures/', import.meta.url).href
  t.after(async () => { await ctx.fiber.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  await ctx.plugin(Loader)
  await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-include', config: { path: './cordis.yml' } })
  await ctx.loader.await()
  const fixture = ctx.get('browserTest')
  assert.ok(fixture, 'fixture services were loaded by YAML')
  const tool = fixture.tools.get('sidebar_browser')
  assert.ok(tool, 'published plugin registered its model tool')
  const execution = { signal: new AbortController().signal, agent: { session: { id: 'loader-session' } } }
  const url = `http://127.0.0.1:${server.address().port}/`
  const result = await tool.execute({ action: 'navigate', url }, execution)
  assert.match(tool.output.render({}, result)[0].text, /Hello from the loaded plugin/)
  const expected = await readFile(new URL('./fixtures/model-output.txt', import.meta.url), 'utf8')
  assert.equal(`${result.text.replace(url, '<fixture-url>')}\n`, expected)
  const route = fixture.channels.get('/api/dsh-browser/frame')
  const response = await route.fetch(new Request('http://127.0.0.1:3080/api/dsh-browser/frame', {
    method: 'POST', body: JSON.stringify({ type: 'client-request', rpcId: 'loader-test', method: 'dsh-browser/frame', payload: { sessionId: 'loader-session' } }),
  }))
  const frame = await response.json()
  assert.equal(frame.rpcId, 'loader-test')
  assert.equal(frame.result.ok, true)
  assert.equal(frame.result.value.active, true)
  assert.equal(frame.result.value.title, 'Loader browser test')
  await ctx.fiber.dispose()
  assert.equal(fixture.tools.size, 0)
  assert.equal(fixture.channels.size, 0)
})
