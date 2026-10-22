import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { BrowserOwner } from '../src/browser.ts'
import { configSchema } from '../src/config.ts'

async function fixture(t, overrides = {}) {
  const server = createServer((req, res) => {
    if (req.url === '/redirect-to-dsh') { res.writeHead(302, { location: 'http://127.0.0.1:3080/' }); res.end(); return }
    if (req.url === '/redirect-chain') { res.writeHead(302, { location: '/redirect-to-dsh' }); res.end(); return }
    res.setHeader('content-type', 'text/html')
    res.end(`<!doctype html><title>Browser fixture</title><label>Name<input id="name" aria-label="Name"></label><button id="submit" onclick="document.querySelector('#result').textContent='Hello '+document.querySelector('#name').value">Submit</button><p id="result">Ready</p><label>Accept<input type="checkbox" id="accept"></label><label>Color<select id="color"><option value="red">Red</option><option value="blue">Blue</option></select></label><a href="/second" target="_blank">Popup</a><div style="height:2000px">Long page</div>`)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  const owner = new BrowserOwner(configSchema.parse({ actionTimeoutMs: 15000, navigationTimeoutMs: 15000, ...overrides }), 'http://127.0.0.1:3080')
  t.after(async () => { await owner.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  return { owner, url: `http://127.0.0.1:${address.port}/`, signal: new AbortController().signal }
}

test('real Chromium navigation, AI actions, sidebar frames, and Session isolation', async t => {
  const { owner, url, signal } = await fixture(t)
  assert.equal((await owner.frame('a', signal)).active, false)
  assert.match((await owner.command('a', { action: 'navigate', url }, signal)).text, /Browser fixture/)
  await owner.command('a', { action: 'fill', selector: '#name', text: 'DSH' }, signal)
  const clicked = await owner.command('a', { action: 'click', selector: '#submit' }, signal)
  assert.match(clicked.text, /Hello DSH/)
  assert.match(clicked.text, /UNTRUSTED WEB CONTENT/)
  const frame = await owner.frame('a', signal)
  assert.equal(frame.active, true)
  assert.match(frame.image, /^data:image\/jpeg;base64,/)
  assert.equal(frame.width, 1280)
  await owner.command('b', { action: 'navigate', url }, signal)
  assert.doesNotMatch((await owner.command('b', { action: 'snapshot' }, signal)).text, /Hello DSH/)
  assert.match((await owner.command('a', { action: 'snapshot' }, signal)).text, /Hello DSH/)
  await owner.command('a', { action: 'close' }, signal)
  assert.equal((await owner.frame('a', signal)).active, false)
  assert.equal((await owner.frame('b', signal)).active, true)
})

test('bounded model results, serialization, cancellation, and teardown', async t => {
  const { owner, url, signal } = await fixture(t, { maxSnapshotChars: 128, maxSessions: 1 })
  const result = await owner.command('a', { action: 'navigate', url }, signal)
  assert.ok(result.text.length <= 128)
  await assert.rejects(owner.command('b', { action: 'navigate', url }, signal), /Session limit/)
  await Promise.all([
    owner.command('a', { action: 'fill', selector: '#name', text: 'Queued' }, signal),
    owner.command('a', { action: 'click', selector: '#submit' }, signal),
  ])
  const controller = new AbortController()
  const pending = owner.command('a', { action: 'click', selector: '#never-exists' }, controller.signal)
  const abort = setTimeout(() => controller.abort(), 50)
  t.after(() => clearTimeout(abort))
  await assert.rejects(pending)
  assert.equal((await owner.frame('a', signal)).active, false)
  await owner.release('a')
  await owner.command('b', { action: 'navigate', url }, signal)
  await owner.dispose()
  await assert.rejects(owner.command('c', { action: 'tabs' }, signal), /unloading/)
})

test('redirects to the DSH origin are blocked in the network executor', async t => {
  const { owner, url, signal } = await fixture(t)
  await assert.rejects(owner.command('a', { action: 'navigate', url: `${url}redirect-to-dsh` }, signal), /Browser policy blocked.*DSH application/)
  await assert.rejects(owner.command('a', { action: 'navigate', url: `${url}redirect-chain` }, signal), /Browser policy blocked.*DSH application/)
  assert.match((await owner.command('a', { action: 'navigate', url }, signal)).text, /Browser fixture/)
})

test('native redirects retain final URL, relative resources, cookies, POST semantics and popup restrictions', async t => {
  const hits = []
  let forbidden = 0
  const blocked = createServer((req, res) => { forbidden++; res.end('MUST NOT REACH') })
  blocked.listen(0, '127.0.0.1')
  await once(blocked, 'listening')
  const denied = `http://127.0.0.1:${blocked.address().port}`
  const server = createServer((req, res) => {
    hits.push({ method: req.method, url: req.url, cookie: req.headers.cookie })
    if (req.url === '/start') { res.writeHead(302, { location: '/nested/final', 'set-cookie': 'redirected=yes; Path=/' }); res.end(); return }
    if (req.url === '/post') { res.writeHead(307, { location: '/nested/final' }); res.end(); return }
    if (req.url === '/deny') { res.writeHead(302, { location: '/deny-again' }); res.end(); return }
    if (req.url === '/deny-again') { res.writeHead(302, { location: denied }); res.end(); return }
    if (req.url === '/nested/relative.js') { res.setHeader('content-type', 'text/javascript'); res.end('document.querySelector("#relative").textContent="Relative loaded"'); return }
    res.setHeader('content-type', 'text/html')
    res.end('<title>Native redirect</title><p id="relative">Waiting</p><script src="relative.js"></script><form action="/post" method="POST"><input name="value" value="keep"><button>Post</button></form><a href="/deny" target="_blank">Popup denied</a><a href="/start" target="_blank">Popup allowed</a><iframe src="/deny"></iframe>')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const owner = new BrowserOwner(configSchema.parse({}), denied)
  const url = `http://127.0.0.1:${server.address().port}`
  const signal = new AbortController().signal
  t.after(async () => { await owner.dispose(); for (const s of [server, blocked]) { s.closeAllConnections(); await new Promise(resolve => s.close(resolve)) } })
  const result = await owner.command('a', { action: 'navigate', url: `${url}/start` }, signal)
  assert.match(result.text, /URL: .*\/nested\/final/)
  assert.match(result.text, /Relative loaded/)
  assert.ok(hits.some(hit => hit.url === '/nested/final' && hit.cookie?.includes('redirected=yes')))
  const page = owner.sessions.get('a').page
  const allowedReady = page.waitForEvent('popup')
  await page.getByRole('link', { name: 'Popup allowed' }).click()
  const allowed = await allowedReady
  await allowed.waitForLoadState('domcontentloaded')
  // Early popup requests have a documented fail-closed proxy fallback until
  // Chromium exposes their target. Normal tab navigation is native above.
  assert.ok([`${url}/start`, `${url}/nested/final`].includes(allowed.url()))
  await allowed.close()
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  assert.ok(hits.some(hit => hit.url === '/nested/final' && hit.method === 'POST'))
  const popupReady = page.waitForEvent('popup')
  await page.getByRole('link', { name: 'Popup denied' }).click()
  const popup = await popupReady
  await popup.waitForLoadState('domcontentloaded').catch(() => {})
  assert.equal(forbidden, 0, 'neither popup nor iframe redirect reaches the protected listener')
})

test('native network failures retain their cause and never replay form submissions', async t => {
  const counts = new Map()
  const server = createServer((req, res) => {
    const key = `${req.method} ${req.url}`
    const count = (counts.get(key) ?? 0) + 1
    counts.set(key, count)
    if (req.url === '/post') { res.writeHead(200, { 'content-length': '1000' }); res.write('partial'); setTimeout(() => res.destroy(), 20); return }
    if ((req.url === '/once' && count === 1) || (req.url === '/twice' && count <= 2)) {
      req.socket.destroy()
      return
    }
    if (req.url === '/redirect') { res.writeHead(302, { location: '/once' }); res.end(); return }
    res.setHeader('content-type', 'text/html')
    res.end('<!doctype html><title>Recovered</title><p>Connection recovered</p><form method="post" action="/post"><button>Submit once</button></form>')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const owner = new BrowserOwner(configSchema.parse({ navigationTimeoutMs: 5000 }), 'http://127.0.0.1:3080')
  const url = `http://127.0.0.1:${server.address().port}`
  const signal = new AbortController().signal
  t.after(async () => { await owner.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  assert.match((await owner.command('a', { action: 'navigate', url: `${url}/redirect` }, signal)).text, /Connection recovered/)
  assert.equal(counts.get('GET /once'), 2, 'redirect hop retries a single connection reset')
  await assert.rejects(owner.command('a', { action: 'navigate', url: `${url}/twice` }, signal), error => {
    assert.match(error.message, /Browser request failed:.*net::ERR_/)
    assert.doesNotMatch(error.message, /BLOCKED_BY_CLIENT|policy|Call log|cookie:/i)
    return true
  })
  assert.equal(counts.get('GET /twice'), 2, 'at most one transport retry')
  assert.match((await owner.command('a', { action: 'navigate', url: `${url}/twice` }, signal)).text, /Connection recovered/)
  // Observe the real browser's failed POST; its form action must never be replayed.
  const page = owner.sessions.get('a').page
  const failedPost = page.waitForEvent('requestfailed', request => request.method() === 'POST')
  await page.getByRole('button', { name: 'Submit once' }).click({ noWaitAfter: true })
  await failedPost
  assert.equal(counts.get('POST /post'), 1)
})

test('takeover is enforced for AI and every human view, including queued operations', async t => {
  const { owner, url, signal } = await fixture(t)
  const first = { kind: 'human', clientId: crypto.randomUUID() }
  const second = { kind: 'human', clientId: crypto.randomUUID() }
  await assert.rejects(owner.command('a', { action: 'navigate', url }, signal, first), /Read-only/)
  await owner.command('a', { action: 'navigate', url }, signal)
  const handoff = owner.control('a', first.clientId, true, signal)
  const queuedAI = owner.command('a', { action: 'fill', selector: '#name', text: 'blocked' }, signal)
  await handoff
  await assert.rejects(queuedAI, /taken control/)
  await assert.rejects(owner.command('a', { action: 'close' }, signal), /taken control/)
  await assert.rejects(owner.command('a', { action: 'reload' }, signal, second), /Read-only/)
  await assert.rejects(owner.control('a', second.clientId, true, signal), /Another browser view/)
  await assert.rejects(owner.control('a', second.clientId, false, signal), /Another browser view/)
  await owner.command('a', { action: 'fill', selector: '#name', text: 'Human' }, signal, first)
  assert.match((await owner.command('a', { action: 'snapshot' }, signal)).text, /Human/)
  assert.equal((await owner.frame('a', signal, first.clientId)).controlledBy, first.clientId)
  await owner.control('a', first.clientId, false, signal)
  await owner.command('a', { action: 'fill', selector: '#name', text: 'AI resumed' }, signal)
  assert.equal((await owner.frame('a', signal)).controlledBy, null)
})

test('human input skips model snapshots, uses fast frames, and does not replay double clicks', async t => {
  const { owner, url, signal } = await fixture(t)
  await owner.command('a', { action: 'navigate', url }, signal)
  const actor = { kind: 'human', clientId: crypto.randomUUID() }
  assert.equal((await owner.frame('a', signal)).intervalMs, 1200)
  await owner.control('a', actor.clientId, true, signal)
  const realtime = await owner.frame('a', signal, actor.clientId)
  assert.equal(realtime.intervalMs, 0)
  assert.ok(realtime.streamId)
  assert.match(realtime.image, /^data:image\/jpeg;base64,/)
  const page = owner.sessions.get('a').page
  await page.locator('#name').focus()
  const locator = t.mock.method(page, 'locator', () => { throw new Error('Human input must not build a model snapshot') })
  assert.deepEqual(await owner.command('a', { action: 'type', text: 'Fast human input' }, signal, actor), { text: 'Browser action completed.' })
  locator.mock.restore()
  assert.equal(await page.locator('#name').inputValue(), 'Fast human input')
  assert.match((await owner.command('a', { action: 'snapshot' }, signal)).text, /Fast human input/)
  await page.evaluate(() => {
    window.gestures = { clicks: 0, doubles: 0 }
    document.body.addEventListener('click', () => window.gestures.clicks++)
    document.body.addEventListener('dblclick', () => window.gestures.doubles++)
  })
  const bounds = await page.locator('#submit').boundingBox()
  const position = { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }
  await owner.command('a', { action: 'click', ...position, clickCount: 1 }, signal, actor)
  await owner.command('a', { action: 'click', ...position, clickCount: 2 }, signal, actor)
  assert.deepEqual(await page.evaluate(() => window.gestures), { clicks: 2, doubles: 1 })
  await owner.control('a', actor.clientId, false, signal)
  assert.equal((await owner.frame('a', signal)).intervalMs, 1200)
})

test('expanded browser actions support keyboard, coordinates, forms, tabs, and waiting', async t => {
  const { owner, url, signal } = await fixture(t)
  await owner.command('a', { action: 'navigate', url }, signal)
  await owner.command('a', { action: 'hover', selector: '#name' }, signal)
  await owner.command('a', { action: 'type', selector: '#name', text: 'Keyboard' }, signal)
  await owner.command('a', { action: 'press', selector: '#name', key: 'Control+A' }, signal)
  await owner.command('a', { action: 'type', text: 'Replaced' }, signal)
  assert.match((await owner.command('a', { action: 'click', selector: '#submit', clickCount: 2, modifiers: ['Shift'] }, signal)).text, /Hello Replaced/)
  await owner.command('a', { action: 'wait_for', selector: '#result', state: 'visible', timeoutMs: 1000 }, signal)
  assert.match((await owner.command('a', { action: 'check', selector: '#accept', checked: true }, signal)).text, /checked/)
  assert.match((await owner.command('a', { action: 'select_option', selector: '#color', values: ['blue'] }, signal)).text, /Blue.*selected/)
  const inspection = await owner.command('a', { action: 'inspect', selector: '#submit' }, signal)
  assert.match(inspection.text, /"bounds":\{"x":/)
  await owner.command('a', { action: 'hover', x: 20, y: 20 }, signal)
  await owner.command('a', { action: 'click', x: 20, y: 20, button: 'right' }, signal)
  await owner.command('a', { action: 'drag', x: 20, y: 20, toX: 100, toY: 20 }, signal)
  await assert.rejects(owner.command('a', { action: 'click' }, signal), /Provide x\/y/)
  await owner.command('a', { action: 'new_tab', url }, signal)
  assert.equal((await owner.frame('a', signal)).tabs.length, 2)
  await owner.command('a', { action: 'select_tab', index: 0 }, signal)
  assert.match((await owner.command('a', { action: 'snapshot' }, signal)).text, /Hello Replaced/)
  await owner.command('a', { action: 'close_tab', index: 1 }, signal)
  assert.equal((await owner.frame('a', signal)).tabs.length, 1)
  assert.match((await owner.command('a', { action: 'new_tab' }, signal)).text, /Blank page/)
  assert.equal((await owner.frame('a', signal)).url, 'about:blank')
})

test('realtime frames do not take screenshots or block input and ownership release frees held buttons', async t => {
  const { owner, url, signal } = await fixture(t)
  await owner.command('a', { action: 'navigate', url }, signal)
  const clientId = crypto.randomUUID()
  await assert.rejects(owner.input('a', clientId, { type: 'down', x: 20, y: 20 }, signal), /Read-only/)
  await owner.control('a', clientId, true, signal)
  const page = owner.sessions.get('a').page
  const screenshot = t.mock.method(page, 'screenshot', () => { throw new Error('Realtime must not poll screenshots') })
  const first = await owner.frame('a', signal, clientId)
  assert.ok(first.sequence > 0)
  const controller = new AbortController()
  const pending = owner.frame('a', controller.signal, clientId, Number.MAX_SAFE_INTEGER, first.streamId)
  const interrupted = assert.rejects(pending, /abort/i)
  await owner.input('a', clientId, { type: 'down', x: 20, y: 20, modifiers: ['Shift'] }, signal)
  assert.ok(owner.sessions.get('a').pressed, 'input is not blocked by waiting for the next compositor frame')
  await assert.rejects(owner.input('a', crypto.randomUUID(), { type: 'up', x: 20, y: 20 }, signal), /Read-only/)
  controller.abort()
  await interrupted
  assert.equal(page.isClosed(), false, 'cancelling a preview must not close the shared context')
  await owner.control('a', clientId, false, signal)
  assert.equal(owner.sessions.get('a').pressed, undefined)
  assert.equal(owner.sessions.get('a').stream, undefined)
  screenshot.mock.restore()
  await owner.control('a', clientId, true, signal)
  await owner.input('a', clientId, { type: 'down', x: 20, y: 20 }, signal)
  owner.sessions.get('a').controlledUntil = 0
  await assert.rejects(owner.input('a', clientId, { type: 'move', x: 30, y: 20 }, signal), /Read-only/)
  assert.equal(owner.sessions.get('a').pressed, undefined, 'expired owner cannot leave a held button')
})

test('human control expires without its view heartbeat and remains Session-local', async t => {
  const { owner, signal } = await fixture(t, { humanControlLeaseMs: 10000 })
  t.mock.timers.enable({ apis: ['Date'] })
  const id = crypto.randomUUID()
  await owner.control('a', id, true, signal)
  assert.equal((await owner.frame('b', signal)).controlledBy, null)
  t.mock.timers.tick(8000)
  assert.equal((await owner.frame('a', signal, id)).controlledBy, id)
  t.mock.timers.tick(8000)
  assert.equal((await owner.frame('a', signal)).controlledBy, id)
  t.mock.timers.tick(3000)
  assert.equal((await owner.frame('a', signal)).controlledBy, null)
})
