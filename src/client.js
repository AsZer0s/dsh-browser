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
      more: '更多操作', closeConfirm: '关闭当前会话的所有浏览器标签，并清除 Cookie 和登录状态？此操作无法撤销。',
      connected: '已连接', connecting: '连接中', disconnected: '已断开', paused: '已暂停', resume: '确认接管', keyboard: '网页键盘输入',
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
      more: 'More actions', closeConfirm: 'Close all browser tabs for this conversation and clear cookies and login state? This cannot be undone.',
      connected: 'Connected', connecting: 'Connecting', disconnected: 'Disconnected', paused: 'Paused', resume: 'Confirm control', keyboard: 'Page keyboard input',
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

  function BrowserBody({ sessionId, useResource, t, send, control, input, setViewVisible }) {
    const [clientId] = useState(() => crypto.randomUUID())
    const resource = useResource(`dsh-resource://dsh-browser/${encodeURIComponent(sessionId)}/${clientId}`)
    const previousFrame = useRef(null)
    if (resource.value) previousFrame.current = resource.value
    const frame = resource.value ?? previousFrame.current
    const [now, setNow] = useState(Date.now())
    const [visible, setVisible] = useState(true)
    const [needsConfirm, setNeedsConfirm] = useState(false)
    const healthy = visible && resource.status === 'live' && frame?.receivedAt && now - frame.receivedAt < Math.max(frame.controlledBy ? 5000 : (frame.intervalMs ?? 1200) + 5000, 5000)
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
    const root = useRef(null)
    const keyboard = useRef(null)
    const composing = useRef(false)
    const typing = useRef({ text: '', timer: null })
    const queue = useRef(Promise.resolve())
    const gesture = useRef(null)
    const lastClick = useRef(null)
    const movement = useRef({ latest: null, busy: false, timer: null })
    const wheel = useRef({ x: 0, y: 0, timer: null })
    const alive = useRef(true)
    const ownsControl = useRef(false)
    ownsControl.current = mine
    const canAct = mine && !handoff && !needsConfirm
    const actionable = useRef(false)
    const inputEpoch = useRef(0)
    if (actionable.current && !canAct) inputEpoch.current++
    actionable.current = canAct
    useEffect(() => {
      const timer = setInterval(() => setNow(Date.now()), 500)
      return () => clearInterval(timer)
    }, [])
    useEffect(() => { if (!healthy && frame?.controlledBy === clientId) setNeedsConfirm(true) }, [healthy, frame?.controlledBy, clientId])
    useEffect(() => {
      let intersecting = true
      const update = () => {
        const shown = intersecting && !document.hidden
        setVisible(shown)
        setViewVisible?.(clientId, shown)
      }
      const observer = new IntersectionObserver(entries => { intersecting = entries[0]?.isIntersecting ?? false; update() })
      if (root.current) observer.observe(root.current)
      document.addEventListener('visibilitychange', update)
      update()
      return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); setViewVisible?.(clientId, false) }
    }, [clientId, setViewVisible])
    useEffect(() => {
      alive.current = true
      return () => {
        alive.current = false
        clearTimeout(wheel.current.timer)
        clearTimeout(typing.current.timer)
        clearTimeout(movement.current.timer)
        movement.current.latest = null
        // The lease also expires if this best-effort release cannot reach the Host.
        if (ownsControl.current) void queue.current.finally(() => control(clientId, false)).catch(failure => console.warn('dsh-browser: control release failed', failure))
      }
    }, [clientId, control])
    const runRaw = command => {
      if (!canAct) return Promise.resolve(false)
      setPending(value => value + 1)
      setError('')
      const epoch = inputEpoch.current
      const task = queue.current.then(() => {
        if (!actionable.current || epoch !== inputEpoch.current) throw new Error(t('stale'))
        return send(command, clientId)
      })
      queue.current = task.catch(() => {})
      return task.then(() => true, failure => {
        if (alive.current) setError(t('failed', { message: failure instanceof Error ? failure.message : String(failure) }))
        return false
      }).finally(() => { if (alive.current) setPending(value => value - 1) })
    }
    const flushText = () => {
      clearTimeout(typing.current.timer)
      const text = typing.current.text
      typing.current = { text: '', timer: null }
      if (text && actionable.current) void runRaw({ action: 'type', text })
    }
    const bufferText = text => {
      if (!actionable.current || !text) return
      while (text.length) {
        const room = 20000 - typing.current.text.length
        typing.current.text += text.slice(0, room)
        text = text.slice(room)
        if (typing.current.text.length >= 20000) flushText()
      }
      clearTimeout(typing.current.timer)
      if (typing.current.text.length >= 1000) flushText()
      else typing.current.timer = setTimeout(flushText, 40)
    }
    const run = command => { flushText(); return runRaw(command) }
    const physical = event => {
      flushText()
      const epoch = inputEpoch.current
      const task = queue.current.then(() => {
        if (event.type !== 'cancel' && (!actionable.current || epoch !== inputEpoch.current)) return
        return input(event, clientId)
      })
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
    useEffect(() => {
      if (!canAct) {
        cancelGesture()
        clearTimeout(typing.current.timer)
        typing.current = { text: '', timer: null }
        composing.current = false
        if (keyboard.current) keyboard.current.value = ''
      }
    }, [canAct])
    const handOver = async () => {
      setHandoff(true)
      setError('')
      lastClick.current = null
      clearTimeout(wheel.current.timer)
      wheel.current = { x: 0, y: 0, timer: null }
      cancelGesture()
      flushText()
      try { await queue.current; await control(clientId, !mine || needsConfirm); setNeedsConfirm(false) }
      catch (failure) { setError(t('failed', { message: failure instanceof Error ? failure.message : String(failure) })) }
      finally { if (alive.current) setHandoff(false) }
    }
    const position = event => {
      const rect = event.currentTarget.getBoundingClientRect()
      return { x: Math.min(frame.width - 1, Math.max(0, Math.floor((event.clientX - rect.left) * frame.width / rect.width))), y: Math.min(frame.height - 1, Math.max(0, Math.floor((event.clientY - rect.top) * frame.height / rect.height))) }
    }
    const mods = event => [['altKey', 'Alt'], ['ctrlKey', 'Control'], ['metaKey', 'Meta'], ['shiftKey', 'Shift']].filter(([key]) => event[key]).map(([, name]) => name)
    const iconButton = (label, icon, command) => h('button', { type: 'button', className: 'dsb-icon', title: t(label), 'aria-label': t(label), disabled: !canAct || !frame?.active, onClick: () => { void run(command) } }, h(Icon, { name: icon }))
    const keyDown = event => {
      if (!canAct || composing.current || event.nativeEvent?.isComposing || event.keyCode === 229) return
      if (event.key === 'Escape' && captureTab) { event.preventDefault(); setCaptureTab(false); return }
      if (event.key === 'Tab' && !captureTab) { flushText(); return }
      if (['Control', 'Shift', 'Alt', 'Meta', 'Dead', 'Process'].includes(event.key)) return
      // Native input/composition/paste events carry the committed text.
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.target.tagName !== 'TEXTAREA') { event.preventDefault(); bufferText(event.key) }
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') return
      event.preventDefault(); event.stopPropagation()
      void run({ action: 'press', key: [...mods(event), event.key === ' ' ? 'Space' : event.key].join('+') })
    }
    const connection = !visible ? 'paused' : healthy ? 'connected' : resource.status === 'loading' ? 'connecting' : 'disconnected'
    return h('section', { ref: root, className: 'dsb-root', 'data-control': mine ? 'human' : 'ai' },
      h('header', { className: 'dsb-header' },
        h('span', { className: 'dsb-brand' }, h('span', { className: 'dsb-logo' }, h(Icon, { name: 'globe', size: 20 })), h('span', null, t('title'), h('small', null, t('live')))),
        h('button', { type: 'button', className: `dsb-take ${mine ? 'is-human' : ''}`, onClick: () => { void handOver() }, disabled: !healthy || other || handoff || pending > 0 }, h(Icon, { name: mine ? 'arrow' : 'hand' }), t(needsConfirm && mine ? 'resume' : mine ? 'release' : 'take'))),
      h('div', { className: 'dsb-chrome' },
        h('form', { className: 'dsb-addressbar', onSubmit: event => { event.preventDefault(); void run({ action: 'navigate', url: draft ?? frame?.url ?? '' }).then(ok => { if (ok) setDraft(null) }) } },
          iconButton('back', 'back', { action: 'back' }), iconButton('forward', 'forward', { action: 'forward' }), iconButton('reload', 'reload', { action: 'reload' }),
          h('div', { className: 'dsb-address' }, h(Icon, { name: 'lock', size: 13 }), h('input', { value: draft ?? frame?.url ?? '', disabled: !canAct, placeholder: t('address'), 'aria-label': t('address'), onChange: event => setDraft(event.target.value), required: true }),
            h('button', { type: 'submit', className: 'dsb-icon', disabled: !canAct, title: t('go'), 'aria-label': t('go') }, h(Icon, { name: 'arrow' }))),
          h('button', { type: 'button', className: 'dsb-icon', disabled: !canAct, title: t('newTab'), 'aria-label': t('newTab'), onClick: () => { setDraft(null); void run({ action: 'new_tab' }) } }, h(Icon, { name: 'plus', size: 14 }))),
        frame?.tabs?.length > 0 && h('nav', { className: 'dsb-tabs', 'aria-label': t('tabs') }, frame.tabs.map(tab => h('div', { key: tab.index, className: `dsb-tab ${tab.selected ? 'selected' : ''}` },
          h('button', { type: 'button', title: tab.url, disabled: !canAct, onClick: () => { void run({ action: 'select_tab', index: tab.index }) } }, h(Icon, { name: 'globe', size: 12 }), tab.title || t('emptyTab')),
          h('button', { type: 'button', className: 'dsb-tabclose', disabled: !canAct, title: t('closeTab'), 'aria-label': t('closeTab'), onClick: () => { void run({ action: 'close_tab', index: tab.index }) } }, h(Icon, { name: 'close', size: 11 })))))),
      h('div', { className: `dsb-status ${mine ? 'human' : ''}`, role: 'status' }, h('span', { className: 'dsb-dot' }), h('strong', null, t(mine ? 'human' : other ? 'other' : 'readonly')), h('span', { className: `dsb-connection ${connection}` }, t(connection)), pending > 0 && h('span', { className: 'dsb-working' }, t('working'))),
      error && h('div', { className: 'dsb-error', role: 'alert' }, error),
      resource.status === 'failed' && h('div', { className: 'dsb-error', role: 'alert' }, t('stale'), ' ', resource.failure?.message),
      h('div', { className: 'dsb-viewport', onKeyDown: keyDown }, frame?.active ? h('div', { className: 'dsb-surface' }, h('img', {
        src: frame.image, alt: t('view'), draggable: false, tabIndex: mine ? 0 : -1, 'aria-disabled': !canAct,
        className: `dsb-image ${fit ? 'fit' : ''} ${canAct ? 'interactive' : ''} ${healthy ? '' : 'stale'}`,
        style: { width: fit ? '100%' : frame.width, cursor: canAct ? (frame.cursor ?? 'default') : 'default' },
        onContextMenu: event => { if (canAct) event.preventDefault() },
        onPointerDown: event => {
          if (!canAct || event.button > 2 || gesture.current) return
          event.preventDefault(); keyboard.current?.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId)
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
        onWheel: event => {
          if (!canAct) return
          wheel.current.x += event.deltaX; wheel.current.y += event.deltaY
          if (!wheel.current.timer) wheel.current.timer = setTimeout(() => {
            const { x, y } = wheel.current
            wheel.current = { x: 0, y: 0, timer: null }
            if (alive.current) void run({ action: 'scroll', deltaY: Math.max(-10000, Math.min(10000, Math.round(y))), deltaX: Math.max(-10000, Math.min(10000, Math.round(x))) })
          }, 40)
        },
      }), h('textarea', {
        ref: keyboard, className: 'dsb-keyboard-sink', 'aria-label': t('keyboard'), tabIndex: -1, disabled: !canAct,
        autoComplete: 'off', autoCapitalize: 'off', spellCheck: false,
        onCompositionStart: () => { composing.current = true },
        onCompositionEnd: event => { composing.current = false; bufferText(event.currentTarget.value); event.currentTarget.value = '' },
        onInput: event => {
          if (composing.current || event.nativeEvent?.isComposing) return
          bufferText(event.currentTarget.value); event.currentTarget.value = ''
        },
        onPaste: event => { event.preventDefault(); bufferText(event.clipboardData.getData('text/plain').slice(0, 100000)) },
        onBlur: flushText,
      })) : h('div', { className: 'dsb-empty' }, h('div', { className: 'dsb-empty-icon' }, h(Icon, { name: 'globe', size: 38 })), h('h3', null, t(resource.status === 'loading' ? 'loading' : 'idle')), h('p', null, t('idleDetail')))),
      mine && h('details', { className: 'dsb-inputs', open: true }, h('summary', null, h(Icon, { name: 'keyboard' }), t('input')),
        h('div', { className: 'dsb-inputrow' },
          h('form', { onSubmit: event => { event.preventDefault(); void run({ action: 'type', text }).then(ok => { if (ok) setText('') }) } }, h('input', { value: text, placeholder: t('text'), 'aria-label': t('text'), onChange: event => setText(event.target.value) }), h('button', { type: 'submit', disabled: !canAct }, t('send'))),
          h('form', { onSubmit: event => { event.preventDefault(); void run({ action: 'press', key }) } }, h('input', { value: key, 'aria-label': t('key'), onChange: event => setKey(event.target.value) }), h('button', { type: 'submit', disabled: !canAct }, t('press')))),
        h('label', { className: 'dsb-check', title: t('captureTabHint') }, h('input', { type: 'checkbox', checked: captureTab, onChange: event => setCaptureTab(event.target.checked) }), t('captureTab'))),
      h('footer', { className: 'dsb-footer' }, h('div', null,
        h('button', { type: 'button', onClick: () => setFit(value => !value) }, t(fit ? 'actual' : 'fit')),
        h('details', { className: 'dsb-more' }, h('summary', { 'aria-label': t('more'), title: t('more') }, '⋯'),
          h('button', { type: 'button', className: 'dsb-danger', disabled: !canAct || !frame?.active, onClick: event => {
            event.currentTarget.closest('details').open = false
            if (window.confirm(t('closeConfirm'))) void run({ action: 'close' })
          } }, t('close'))))),
    )
  }

  const frameWakeups = new Map()
  const hiddenViews = new Set()
  const viewKey = (sessionId, clientId) => `${sessionId}/${clientId}`
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
            if (hiddenViews.has(viewKey(sessionId, clientId))) { await delay(1000, signal, sessionId); continue }
            const request = new AbortController()
            const cancel = () => request.abort(signal.reason)
            signal.addEventListener('abort', cancel, { once: true })
            const timeout = setTimeout(() => request.abort(new Error('Browser preview timed out.')), 5000)
            try {
              const frame = await call('frame', { sessionId, ...(clientId ? { clientId } : {}), after, ...(streamId ? { streamId } : {}) }, request.signal)
              if (hiddenViews.has(viewKey(sessionId, clientId))) continue
              if (!frame.image && frame.active && previous?.active && previous.streamId === frame.streamId) frame.image = previous.image
              previous = frame
              after = frame.sequence ?? 0
              streamId = frame.streamId
              frame.receivedAt = Date.now()
              interval = frame.intervalMs
              if (!signal.aborted) yield { ok: true, value: frame }
            } catch (error) {
              if (signal.aborted) return
              interval = 1200
              yield { ok: false, error: { code: 'dsh-browser/frame', message: error instanceof Error ? error.message : String(error), details: {} } }
            } finally {
              clearTimeout(timeout)
              signal.removeEventListener('abort', cancel)
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
          setViewVisible: (clientId, shown) => {
            const key = viewKey(sessionId, clientId)
            if (shown) hiddenViews.delete(key)
            else {
              hiddenViews.add(key)
              void call('pause', { sessionId, clientId }).catch(() => {})
            }
            refreshFrames(sessionId)
          },
        }),
      }, BrowserBody)), 'dsh-browser: body')
    },
  }
} })
