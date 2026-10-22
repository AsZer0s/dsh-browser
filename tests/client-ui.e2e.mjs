import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { readFile, mkdir } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { BrowserOwner } from '../src/browser.ts'
import { configSchema } from '../src/config.ts'

test('real React sidebar shows the same page that user gestures and AI commands modify', { timeout: 30000 }, async t => {
  const owner = new BrowserOwner(configSchema.parse({ frameIntervalMs: 10000 }), 'http://127.0.0.1:3080')
  const signal = new AbortController().signal
  const client = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const react = await build({
    stdin: { contents: `import * as React from 'react'; import {createRoot} from 'react-dom/client'; window.React = React; window.createRoot = createRoot;`, resolveDir: process.cwd() },
    bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' },
  })
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/react.js') { res.setHeader('content-type', 'text/javascript'); res.end(react.outputFiles[0].text); return }
      if (req.url === '/client.js') { res.setHeader('content-type', 'text/javascript'); res.end(client); return }
      if (req.url === '/rpc') {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const { endpoint, payload } = JSON.parse(Buffer.concat(chunks).toString())
        const value = endpoint === 'frame' ? await owner.frame(payload.sessionId, signal, payload.clientId, payload.after, payload.streamId) : endpoint === 'input' ? await owner.input(payload.sessionId, payload.clientId, payload.input, signal) : endpoint === 'control' ? await owner.control(payload.sessionId, payload.clientId, payload.take, signal) : await owner.command(payload.sessionId, payload.command, signal, { kind: 'human', clientId: payload.clientId })
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, value })); return
      }
      if (req.url === '/target') {
        res.setHeader('content-type', 'text/html')
        res.end(`<title>Shared browser</title><input id="name" aria-label="Name"><button onclick="document.querySelector('#out').textContent='Hello '+document.querySelector('#name').value">Submit</button><p id="out">Ready</p>
          <div id="slider" style="position:absolute;top:120px;left:20px;width:40px;height:40px;background:blue;touch-action:none"></div>
          <script>
          window.dragState = { down: false, moves: 0, up: 0 };
          document.querySelector('#slider').addEventListener('pointerdown', event => { dragState.down = true; event.target.setPointerCapture(event.pointerId) });
          document.addEventListener('pointermove', event => { if (dragState.down) { dragState.moves++; document.querySelector('#slider').style.left = event.clientX + 'px' } });
          document.addEventListener('pointerup', () => { dragState.down = false; dragState.up++ });
          </script>`)
        return
      }
      res.setHeader('content-type', 'text/html'); res.end('<!doctype html><div id="root" style="width:700px;height:900px"></div><script src="/react.js"></script>')
    } catch (error) {
      res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: { message: String(error) } }))
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const browser = await chromium.launch()
  t.after(async () => { await browser.close(); await owner.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const page = await browser.newPage({ viewport: { width: 760, height: 1000 } })
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  await page.evaluate(() => {
    window.__ModuleLoader__ = { load(row) { window.browserPlugin = row.factory(() => window.React) } }
  })
  await page.addScriptTag({ url: '/client.js' })
  await page.evaluate(() => {
    const cleanups = []
    let Body, provider, injected, dictionary
    const ctx = {
      effect(setup) { cleanups.push(setup()) },
      locale: {
        bind: () => (key, values) => Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{${name}}`, value), dictionary?.[key] ?? key),
        register(_ns, data) { dictionary = data.en; return () => {} },
      },
      sidebarRightTabs: { register() { return () => {} } },
      slots: {
        inject(_name, register) { return register() },
        register(spec, Component) { Body = Component; injected = spec.inject('ui-session'); return () => {} },
      },
      resources: { register(value) { provider = value; return () => {} } },
      connection: { rpc: { async call(_channel, endpoint, payload) {
        return (await fetch('/rpc', { method: 'POST', body: JSON.stringify({ endpoint: endpoint.split('/').pop(), payload }) })).json()
      } } },
    }
    window.browserPlugin.apply(ctx)
    let snapshot = { status: 'loading' }
    const listeners = new Set()
    const controller = new AbortController()
    let started = false
    function useResource(address) {
      if (!started) {
        started = true
        const stream = provider.open(address, { signal: controller.signal })
        void (async () => {
      for await (const frame of stream) {
        snapshot = frame.ok ? { status: 'live', value: frame.value } : { status: 'failed', failure: frame.error }
        for (const listener of listeners) listener()
      }
        })()
      }
      return window.React.useSyncExternalStore(callback => { listeners.add(callback); return () => listeners.delete(callback) }, () => snapshot)
    }
    window.createRoot(document.getElementById('root')).render(window.React.createElement(Body, { sessionId: 'ui-session', useResource, t: ctx.locale.bind(), ...injected }))
  })
  const addressInput = page.getByRole('textbox', { name: 'Enter a website, e.g. baidu.com' })
  assert.equal(await addressInput.isDisabled(), true)
  const aligned = await page.getByRole('button', { name: 'New tab', exact: true }).evaluate(button => {
    const address = document.querySelector('.dsb-address').getBoundingClientRect()
    const plus = button.getBoundingClientRect()
    return Math.abs((address.top + address.height / 2) - (plus.top + plus.height / 2)) < 2
  })
  assert.equal(aligned, true, 'new-tab button shares the address row')
  assert.equal(await page.locator('.dsb-tabs').count(), 0, 'no empty tab row')
  await mkdir('test-results', { recursive: true })
  await page.screenshot({ path: 'test-results/sidebar-readonly.png' })
  await page.getByRole('button', { name: 'Take control', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.dsb-address input').disabled, null, { timeout: 2000 })
  await addressInput.fill(`127.0.0.1:${server.address().port}/target`)
  const focusAppearance = await addressInput.evaluate(input => ({
    outline: getComputedStyle(input).outlineStyle,
    containerShadow: getComputedStyle(input.closest('.dsb-address')).boxShadow,
    radius: getComputedStyle(input.closest('.dsb-address')).borderRadius,
  }))
  assert.equal(focusAppearance.outline, 'none', 'input has no inner rectangular focus ring')
  assert.notEqual(focusAppearance.containerShadow, 'none', 'rounded address container retains visible focus')
  assert.notEqual(focusAppearance.radius, '0px')
  await page.getByRole('button', { name: 'Go', exact: true }).click()
  const image = page.getByRole('img', { name: 'Browser preview' })
  await image.waitFor()
  await page.screenshot({ path: 'test-results/sidebar-takeover.png' })
  await assert.rejects(owner.command('ui-session', { action: 'click', selector: '#name' }, signal), /taken control/)
  const imageRect = await image.boundingBox()
  await image.click({ position: { x: 60 * imageRect.width / 1280, y: 15 * imageRect.width / 1280 } })
  // No artificial wait after clicking: typing must queue behind immediate focus,
  // not race a delayed single-click timer.
  await image.press('a')
  const target = owner.sessions.get('ui-session').page
  await target.waitForFunction(() => document.querySelector('#name').value === 'a')
  await target.locator('#name').fill('')
  // Hold and move without releasing: both the remote page and the visible
  // compositor frame must change before pointerup (unlike endpoint-only drag).
  const rect = await image.boundingBox()
  const point = (x, y) => ({ x: rect.x + x * rect.width / 1280, y: rect.y + y * rect.height / 800 })
  const start = point(40, 140)
  const end = point(220, 140)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await target.waitForFunction(() => dragState.down)
  const beforeDrag = await image.getAttribute('src')
  await page.mouse.move(end.x, end.y, { steps: 12 })
  await target.waitForFunction(() => dragState.moves > 0 && parseInt(document.querySelector('#slider').style.left) > 180)
  await page.waitForFunction(before => document.querySelector('.dsb-image').src !== before, beforeDrag)
  assert.equal(await target.evaluate(() => dragState.down), true, 'movement and frames arrive before release')
  await page.mouse.up()
  await target.waitForFunction(() => !dragState.down && dragState.up > 0)
  // Lost capture/blur must release the remote button, not leave a stuck drag.
  const next = point(230, 140)
  await page.mouse.move(next.x, next.y)
  await page.mouse.down()
  await target.waitForFunction(() => dragState.down)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await target.waitForFunction(() => !dragState.down)
  await page.mouse.up()
  await image.click({ position: { x: 60 * imageRect.width / 1280, y: 15 * imageRect.width / 1280 } })
  await page.getByRole('textbox', { name: 'Type into the focused page element' }).fill('Sidebar user')
  await page.getByRole('button', { name: 'Type', exact: true }).click()
  await page.getByRole('button', { name: 'Type', exact: true }).waitFor({ state: 'visible' })
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent === 'Type')?.disabled)
  await page.getByRole('button', { name: 'New tab', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.dsb-address input').value === 'about:blank')
  assert.equal((await owner.frame('ui-session', signal)).url, 'about:blank')
  await page.getByRole('button', { name: 'Shared browser', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.dsb-address input').value.endsWith('/target'))
  await page.getByRole('button', { name: 'Return to AI', exact: true }).click()
  await page.getByRole('button', { name: 'Take control', exact: true }).waitFor()
  assert.equal(await addressInput.isDisabled(), true)
  const result = await owner.command('ui-session', { action: 'click', selector: 'text=Submit' }, signal)
  assert.match(result.text, /Hello Sidebar user/)
  assert.match(await image.getAttribute('src'), /^data:image\/jpeg;base64,/)
  await page.getByRole('button', { name: 'Take control', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.dsb-address input').disabled)
  await page.getByRole('button', { name: 'Close browser', exact: true }).click()
  await page.getByText('Let AI open a page for you', { exact: true }).waitFor()
  assert.equal((await owner.frame('ui-session', signal)).active, false)
})
