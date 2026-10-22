import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

test('published client mounts reversible tab, copy, resource, and body contributions', async () => {
  let plugin
  const components = []
  const cleanup = []
  let provider
  let tabs = 0
  let slots = 0
  let locales = 0
  const sandbox = {
    window: { __ModuleLoader__: { load(row) {
      assert.equal(row.id, 'dsh-browser')
      plugin = row.factory(name => {
        assert.equal(name, 'react')
        return { createElement: (type, props, ...children) => ({ type, props, children }), useState: value => [typeof value === 'function' ? value() : value, () => {}], useRef: value => ({ current: value }), useEffect: () => {} }
      })
    } } },
    URL, setTimeout, clearTimeout, crypto, AbortController,
    document: { createElement: () => ({ remove() {} }), head: { append() {} } },
  }
  vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), sandbox)
  const context = {
    effect(setup) { cleanup.push(setup()) },
    locale: { bind: () => key => key, register() { locales++; return () => { locales-- } } },
    sidebarRightTabs: { register(definition) { assert.equal(definition.kind, 'dsh-browser'); tabs++; return () => { tabs-- } } },
    slots: {
      inject(name, register) { assert.equal(name, 'sidebar.right.pane.tab'); return register() },
      register(spec, component) { assert.equal(spec.key, 'dsh-browser'); components.push(component); slots++; return () => { slots-- } },
    },
    resources: { register(value) { provider = value; return () => { provider = undefined } } },
    connection: { rpc: { async call(channel, endpoint, payload) {
      assert.equal(channel, '/api'); assert.equal(endpoint, 'dsh-browser/frame'); assert.equal(payload.sessionId, 's1')
      return { ok: true, value: { active: false, intervalMs: 500 } }
    } } },
  }
  plugin.apply(context)
  assert.equal(tabs, 1)
  assert.equal(slots, 1)
  assert.equal(locales, 1)
  const controller = new AbortController()
  const stream = provider.open('dsh-resource://dsh-browser/s1', { signal: controller.signal })
  const first = await stream.next()
  assert.equal(first.value.ok, true)
  assert.equal(first.value.value.active, false)
  controller.abort()
  assert.equal((await stream.next()).done, true)
  const tree = components[0]({ sessionId: 's1', t: key => key, useResource: () => ({ status: 'live', value: { active: false } }), send: async () => {} })
  assert.equal(tree.type, 'section')
  for (const dispose of cleanup.reverse()) await dispose()
  assert.equal(tabs, 0)
  assert.equal(slots, 0)
  assert.equal(locales, 0)
  assert.equal(provider, undefined)
})
