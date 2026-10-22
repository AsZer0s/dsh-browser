/** Sidebar browser: host-authoritative takeover and resource-owned preview refresh. */
import stylesheet from './client.css'

window.__ModuleLoader__.load({ id: 'dsh-browser', factory: require => {
  const { createElement: h, useState, useRef, useEffect } = require('react')
  const NS = 'dshBrowser'
  const dictionaries = {
    zh: {
      title: 'AI 浏览器', description: '观察 AI 浏览，随时接管操作', address: '输入网址，如 baidu.com', go: '前往',
      back: '后退', forward: '前进', reload: '刷新', close: '关闭浏览器', newTab: '新建标签', closeTab: '关闭标签',
      idle: '让 AI 为你打开网页', idleDetail: '对 AI 说「使用 sidebar_browser 打开网页」，或接管后输入网址。',
      loading: '正在连接浏览器…', stale: '连接已中断，已禁用操作。重连后请检查接管状态。',
      text: '输入文字到页面当前焦点', send: '输入', key: '组合键，如 Control+A', press: '发送',
      view: '浏览器画面', failed: '操作失败：{message}',
      take: '接管浏览器', release: '交还 AI', readonly: '只读观察', human: '你正在控制', other: '其他窗口控制中',
      readonlyHint: 'AI 正在掌舵。', humanHint: 'AI 操作已暂停。',
      working: '正在执行…', live: '实时预览', input: '文字与按键', tabs: '浏览器标签', emptyTab: '空白标签',
      fit: '适应宽度', actual: '原始尺寸', captureTab: '捕获 Tab 键', captureTabHint: '开启后，画面获焦时 Tab 发送到远程网页；Escape 退出。',
    },
    en: {
      title: 'AI Browser', description: 'Watch AI browse. Take over whenever you need.', address: 'Enter a website, e.g. baidu.com', go: 'Go',
      back: 'Back', forward: 'Forward', reload: 'Reload', close: 'Close browser', newTab: 'New tab', closeTab: 'Close tab',
      idle: 'Let AI open a page for you', idleDetail: 'Ask AI to use sidebar_browser, or take control and enter a URL.',
      loading: 'Connecting to browser…', stale: 'Connection lost. Interaction is disabled. Check control ownership after reconnecting.',
      text: 'Type into the focused page element', send: 'Type', key: 'Key combination, e.g. Control+A', press: 'Send',
      view: 'Browser preview', failed: 'Operation failed: {message}',
      take: 'Take control', release: 'Return to AI', readonly: 'Read-only', human: 'You are in control', other: 'Another view is in control',
      readonlyHint: 'AI has control.', humanHint: 'AI actions are paused.',
      working: 'Working…', live: 'Live preview', input: 'Text & keyboard', tabs: 'Browser tabs', emptyTab: 'Untitled tab',
      fit: 'Fit to width', actual: 'Actual size', captureTab: 'Capture Tab key', captureTabHint: 'When enabled, Tab goes to the remote page while the preview is focused. Escape exits capture.',
    },
  }

  function Icon({ name, size = 16 }) {
    const paths = {
      globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z',
      back: 'm14 6-6 6 6 6', forward: 'm10 6 6 6-6 6', reload: 'M20 7v5h-5M20 12a8 8 0 1 0-2 6',
      arrow: 'M5 12h14m-6-6 6 6-6 6', plus: 'M12 5v14M5 12h14', close: 'm6 6 12 12M6 18 18 6',
      hand: 'M8 13V6a2 2 0 0 1 4 0v6-8a2 2 0 0 1 4 0v8-5a2 2 0 0 1 4 0v9c0 5-3 7-7 7-3 0-5-2-7-5l-3-4a2 2 0 0 1 3-2l2 2',
      eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
      lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5Z', keyboard: 'M3 5h18v14H3ZM7 9h1m3 0h1m3 0h1M7 13h1m3 0h1m3 0h1M8 16h8',
    }
    return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: paths[name] || paths.globe }))
  }

  function BrowserBody({ sessionId, useResource, t, send, control, input }) {
    const [clientId] = useState(() => crypto.randomUUID())
    const resource = useResource(`dsh-resource://dsh-browser/${encodeURIComponent(sessionId)}/${clientId}`)
    const frame = resource.value
    const healthy = resource.status === 'live'
    const mine = healthy && frame?.controlledBy === clientId
    const other = Boolean(frame?.controlledBy && frame.controlledBy !== clientId)
    const [draft, setDraft] = useState(null)
    const [text, setText] = useState('')
    const [key, setKey] = useState('Enter')
    const [pending, setPending] = useState(0)
    const [handoff, setHandoff] = useState(false)
    const [error, setError] = useState('')
    const [fit, setFit] = useState(true)
    const [captureTab, setCaptureTab] = useState(false)
    const queue = useRef(Promise.resolve())
    const gesture = useRef(null)
    const lastClick = useRef(null)
    const movement = useRef({ latest: null, busy: false, timer: null })
    const wheel = useRef({ x: 0, y: 0, timer: null })
    const alive = useRef(true)
    const ownsControl = useRef(false)
    ownsControl.current = mine
    const canAct = mine && !handoff
    useEffect(() => {
      alive.current = true
      return () => {
        alive.current = false
        clearTimeout(wheel.current.timer)
        clearTimeout(movement.current.timer)
        movement.current.latest = null
        // The lease also expires if this best-effort release cannot reach the Host.
        if (ownsControl.current) void queue.current.finally(() => control(clientId, false)).catch(failure => console.warn('dsh-browser: control release failed', failure))
      }
    }, [clientId, control])
    const run = command => {
      if (!canAct) return Promise.resolve(false)
      setPending(value => value + 1)
      setError('')
      const task = queue.current.then(() => send(command, clientId))
      queue.current = task.catch(() => {})
      return task.then(() => true, failure => {
        if (alive.current) setError(t('failed', { message: failure instanceof Error ? failure.message : String(failure) }))
        return false
      }).finally(() => { if (alive.current) setPending(value => value - 1) })
    }
    const physical = event => {
      const task = queue.current.then(() => input(event, clientId))
      queue.current = task.catch(() => {})
      void task.catch(failure => {
        if (alive.current) setError(t('failed', { message: failure instanceof Error ? failure.message : String(failure) }))
      })
      return task
    }
    // At most one mouse move in flight and one latest position retained. Never
    // accumulate a long trail of stale moves behind a slow transport.
    const pumpMove = () => {
      const move = movement.current
      move.timer = null
      if (move.busy || !move.latest || !ownsControl.current) return
      const point = move.latest
      move.latest = null
      move.busy = true
      void physical({ type: 'move', ...point }).catch(() => {}).finally(() => {
        move.busy = false
        if (alive.current && move.latest && ownsControl.current) move.timer = setTimeout(pumpMove, 16)
      })
    }
    const stopMoves = () => {
      clearTimeout(movement.current.timer)
      movement.current.timer = null
      movement.current.latest = null
    }
    const cancelGesture = () => {
      stopMoves()
      if (gesture.current) { gesture.current = null; void physical({ type: 'cancel' }) }
    }
    useEffect(() => {
      const cancel = () => { if (document.hidden) cancelGesture() }
      window.addEventListener('blur', cancelGesture)
      document.addEventListener('visibilitychange', cancel)
      return () => { window.removeEventListener('blur', cancelGesture); document.removeEventListener('visibilitychange', cancel) }
    }, [clientId, input])
    useEffect(() => { if (!mine) { stopMoves(); gesture.current = null } }, [mine])
    const handOver = async () => {
      setHandoff(true)
      setError('')
      lastClick.current = null
      clearTimeout(wheel.current.timer)
      wheel.current = { x: 0, y: 0, timer: null }
      cancelGesture()
      try { await queue.current; await control(clientId, !mine) }
      catch (failure) { setError(t('failed', { message: failure instanceof Error ? failure.message : String(failure) })) }
      finally { if (alive.current) setHandoff(false) }
    }
    const position = event => {
      const rect = event.currentTarget.getBoundingClientRect()
      return { x: Math.min(frame.width - 1, Math.max(0, Math.floor((event.clientX - rect.left) * frame.width / rect.width))), y: Math.min(frame.height - 1, Math.max(0, Math.floor((event.clientY - rect.top) * frame.height / rect.height))) }
    }
    const mods = event => [['altKey', 'Alt'], ['ctrlKey', 'Control'], ['metaKey', 'Meta'], ['shiftKey', 'Shift']].filter(([key]) => event[key]).map(([, name]) => name)
    const iconButton = (label, icon, command) => h('button', { type: 'button', className: 'dsb-icon', title: t(label), 'aria-label': t(label), disabled: !canAct || !frame?.active, onClick: () => { void run(command) } }, h(Icon, { name: icon }))
    return h('section', { className: 'dsb-root', 'data-control': mine ? 'human' : 'ai' },
      h('header', { className: 'dsb-header' },
        h('span', { className: 'dsb-brand' }, h('span', { className: 'dsb-logo' }, h(Icon, { name: 'globe', size: 20 })), h('span', null, t('title'), h('small', null, t('live')))),
        h('button', { type: 'button', className: `dsb-take ${mine ? 'is-human' : ''}`, onClick: () => { void handOver() }, disabled: !healthy || other || handoff || pending > 0 }, h(Icon, { name: mine ? 'arrow' : 'hand' }), t(mine ? 'release' : 'take'))),
      h('div', { className: 'dsb-chrome' },
        h('form', { className: 'dsb-addressbar', onSubmit: event => { event.preventDefault(); void run({ action: 'navigate', url: draft ?? frame?.url ?? '' }).then(ok => { if (ok) setDraft(null) }) } },
          iconButton('back', 'back', { action: 'back' }), iconButton('forward', 'forward', { action: 'forward' }), iconButton('reload', 'reload', { action: 'reload' }),
          h('div', { className: 'dsb-address' }, h(Icon, { name: 'lock', size: 13 }), h('input', { value: draft ?? frame?.url ?? '', disabled: !canAct, placeholder: t('address'), 'aria-label': t('address'), onChange: event => setDraft(event.target.value), required: true }),
            h('button', { type: 'submit', className: 'dsb-icon', disabled: !canAct, title: t('go'), 'aria-label': t('go') }, h(Icon, { name: 'arrow' }))),
          h('button', { type: 'button', className: 'dsb-icon', disabled: !canAct, title: t('newTab'), 'aria-label': t('newTab'), onClick: () => { setDraft(null); void run({ action: 'new_tab' }) } }, h(Icon, { name: 'plus', size: 14 }))),
        frame?.tabs?.length > 0 && h('nav', { className: 'dsb-tabs', 'aria-label': t('tabs') }, frame.tabs.map(tab => h('div', { key: tab.index, className: `dsb-tab ${tab.selected ? 'selected' : ''}` },
          h('button', { type: 'button', title: tab.url, disabled: !canAct, onClick: () => { void run({ action: 'select_tab', index: tab.index }) } }, h(Icon, { name: 'globe', size: 12 }), tab.title || t('emptyTab')),
          h('button', { type: 'button', className: 'dsb-tabclose', disabled: !canAct, title: t('closeTab'), 'aria-label': t('closeTab'), onClick: () => { void run({ action: 'close_tab', index: tab.index }) } }, h(Icon, { name: 'close', size: 11 })))))),
      h('div', { className: `dsb-status ${mine ? 'human' : ''}`, role: 'status' }, h('span', { className: 'dsb-dot' }), h('strong', null, t(mine ? 'human' : other ? 'other' : 'readonly')), h('span', { className: 'dsb-status-detail' }, t(mine ? 'humanHint' : 'readonlyHint')), pending > 0 && h('span', { className: 'dsb-working' }, t('working'))),
      error && h('div', { className: 'dsb-error', role: 'alert' }, error),
      resource.status === 'failed' && h('div', { className: 'dsb-error', role: 'alert' }, t('stale'), ' ', resource.failure?.message),
      h('div', { className: 'dsb-viewport' }, frame?.active ? h('img', {
        src: frame.image, alt: t('view'), draggable: false, tabIndex: mine ? 0 : -1, 'aria-disabled': !canAct,
        className: `dsb-image ${fit ? 'fit' : ''} ${canAct ? 'interactive' : ''} ${healthy ? '' : 'stale'}`,
        style: { width: fit ? '100%' : frame.width },
        onContextMenu: event => { if (canAct) event.preventDefault() },
        onPointerDown: event => {
          if (!canAct || event.button > 2 || gesture.current) return
          event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
          stopMoves()
          const point = position(event)
          const previous = lastClick.current
          const button = ['left', 'middle', 'right'][event.button]
          const double = button === 'left' && previous && Date.now() - previous.time < 400 && Math.hypot(point.x - previous.x, point.y - previous.y) < 5
          gesture.current = { ...point, button, clickCount: double ? 2 : 1, pointerId: event.pointerId }
          void physical({ type: 'down', ...point, button, clickCount: double ? 2 : 1, modifiers: mods(event) })
        },
        onPointerUp: event => {
          const start = gesture.current
          gesture.current = null
          if (!canAct || !start || start.pointerId !== event.pointerId) return
          stopMoves()
          const end = position(event)
          lastClick.current = start.button === 'left' && start.clickCount === 1 && Math.hypot(end.x - start.x, end.y - start.y) < 5 ? { ...end, time: Date.now() } : null
          void physical({ type: 'up', ...end, button: start.button, clickCount: start.clickCount })
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        },
        onPointerCancel: cancelGesture,
        onLostPointerCapture: cancelGesture,
        onPointerMove: event => {
          if (!canAct) return
          movement.current.latest = position(event)
          if (!movement.current.busy && !movement.current.timer) movement.current.timer = setTimeout(pumpMove, 16)
        },
        onKeyDown: event => {
          if (!canAct || event.isComposing) return
          if (event.key === 'Escape' && captureTab) { event.preventDefault(); setCaptureTab(false); return }
          if (event.key === 'Tab' && !captureTab) return
          if (['Control', 'Shift', 'Alt', 'Meta', 'Dead', 'Process'].includes(event.key)) return
          event.preventDefault(); event.stopPropagation()
          const modifiers = mods(event)
          if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) void run({ action: 'type', text: event.key })
          else void run({ action: 'press', key: [...modifiers, event.key === ' ' ? 'Space' : event.key].join('+') })
        },
        onWheel: event => {
          if (!canAct) return
          wheel.current.x += event.deltaX; wheel.current.y += event.deltaY
          if (!wheel.current.timer) wheel.current.timer = setTimeout(() => {
            const { x, y } = wheel.current
            wheel.current = { x: 0, y: 0, timer: null }
            if (alive.current) void run({ action: 'scroll', deltaY: Math.max(-10000, Math.min(10000, Math.round(y))), deltaX: Math.max(-10000, Math.min(10000, Math.round(x))) })
          }, 40)
        },
      }) : h('div', { className: 'dsb-empty' }, h('div', { className: 'dsb-empty-icon' }, h(Icon, { name: 'globe', size: 38 })), h('h3', null, t(resource.status === 'loading' ? 'loading' : 'idle')), h('p', null, t('idleDetail')))),
      mine && h('details', { className: 'dsb-inputs', open: true }, h('summary', null, h(Icon, { name: 'keyboard' }), t('input')),
        h('div', { className: 'dsb-inputrow' },
          h('form', { onSubmit: event => { event.preventDefault(); void run({ action: 'type', text }).then(ok => { if (ok) setText('') }) } }, h('input', { value: text, placeholder: t('text'), 'aria-label': t('text'), onChange: event => setText(event.target.value) }), h('button', { type: 'submit', disabled: !canAct }, t('send'))),
          h('form', { onSubmit: event => { event.preventDefault(); void run({ action: 'press', key }) } }, h('input', { value: key, 'aria-label': t('key'), onChange: event => setKey(event.target.value) }), h('button', { type: 'submit', disabled: !canAct }, t('press')))),
        h('label', { className: 'dsb-check', title: t('captureTabHint') }, h('input', { type: 'checkbox', checked: captureTab, onChange: event => setCaptureTab(event.target.checked) }), t('captureTab'))),
      h('footer', { className: 'dsb-footer' }, h('div', null,
        h('button', { type: 'button', onClick: () => setFit(value => !value) }, t(fit ? 'actual' : 'fit')),
        iconButton('close', 'close', { action: 'close' }))),
    )
  }

  const frameWakeups = new Map()
  const refreshFrames = sessionId => {
    for (const wake of frameWakeups.get(sessionId) ?? []) wake()
  }
  function delay(ms, signal, sessionId) {
    return new Promise(resolve => {
      let wakeups = frameWakeups.get(sessionId)
      if (!wakeups) frameWakeups.set(sessionId, wakeups = new Set())
      const finish = () => {
        clearTimeout(timer); signal.removeEventListener('abort', finish)
        wakeups.delete(finish)
        if (!wakeups.size) frameWakeups.delete(sessionId)
        resolve()
      }
      const timer = setTimeout(finish, ms)
      wakeups.add(finish)
      signal.addEventListener('abort', finish, { once: true })
      if (signal.aborted) finish()
    })
  }

  return {
    inject: ['slots', 'locale', 'sidebarRightTabs', 'connection', 'resources'],
    apply(ctx) {
      const t = ctx.locale.bind(NS)
      const call = async (endpoint, payload, signal) => {
        const result = await ctx.connection.rpc.call('/api', `dsh-browser/${endpoint}`, payload, signal)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      }
      ctx.effect(() => { const style = document.createElement('style'); style.textContent = stylesheet; document.head.append(style); return () => style.remove() }, 'dsh-browser: stylesheet')
      ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-browser: copy')
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: 'dsh-browser', kind: 'dsh-browser', priority: 'extension', title: () => t('title'),
        guide: [{ id: 'open', order: 31, title: () => t('title'), description: () => t('description') }],
      }), 'dsh-browser: tab')
      ctx.effect(() => ctx.resources.register({
        protocol: 'dsh-browser',
        async *open(address, { signal }) {
          const [encodedSession, clientId] = new URL(address).pathname.slice(1).split('/')
          const sessionId = decodeURIComponent(encodedSession)
          let interval = 1200
          let after = 0, streamId
          let previous
          while (!signal.aborted) {
            try {
              const frame = await call('frame', { sessionId, ...(clientId ? { clientId } : {}), after, ...(streamId ? { streamId } : {}) }, signal)
              if (!frame.image && frame.active && previous?.active && previous.streamId === frame.streamId) frame.image = previous.image
              previous = frame
              after = frame.sequence ?? 0
              streamId = frame.streamId
              interval = frame.intervalMs
              if (!signal.aborted) yield { ok: true, value: frame }
            } catch (error) {
              if (signal.aborted) return
              interval = 1200
              yield { ok: false, error: { code: 'dsh-browser/frame', message: error instanceof Error ? error.message : String(error), details: {} } }
            }
            await delay(interval, signal, sessionId)
          }
        },
      }), 'dsh-browser: frames')
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab', key: 'dsh-browser', locale: NS,
        inject: sessionId => ({
          send: async (command, clientId) => { try { return await call('command', { sessionId, command, clientId }) } finally { refreshFrames(sessionId) } },
          control: async (clientId, take) => { try { return await call('control', { sessionId, clientId, take }) } finally { refreshFrames(sessionId) } },
          input: (input, clientId) => call('input', { sessionId, clientId, input }),
        }),
      }, BrowserBody)), 'dsh-browser: body')
    },
  }
} })
