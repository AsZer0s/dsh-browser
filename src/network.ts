/** Native request/response checks; the Host gates first requests until ready. */
import type { Browser } from 'playwright'

export async function guardNetwork(browser: Browser, admit: (url: string) => void): Promise<() => Promise<void>> {
  const root = await browser.newBrowserCDPSession()
  let nextId = 0
  const attached = new Map<string, Promise<void>>()
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; session: string }>()
  const send = (session: string, method: string, params: object = {}): Promise<unknown> => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject, session })
    void root.send('Target.sendMessageToTarget', { sessionId: session, message: JSON.stringify({ id, method, params }) }).catch(error => { pending.delete(id); reject(error) })
  })
  root.on('Target.receivedMessageFromTarget', event => {
    const message = JSON.parse(event.message)
    if (message.id) {
      const call = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) call?.reject(new Error(message.error.message))
      else call?.resolve(message.result)
    } else if (message.method === 'Fetch.requestPaused') {
      const { requestId, request, responseStatusCode, responseHeaders } = message.params
      let allowed = true
      try {
        admit(request.url)
        if (responseStatusCode >= 300 && responseStatusCode < 400) {
          const location = responseHeaders?.find((header: { name: string }) => header.name.toLowerCase() === 'location')?.value
          if (location) admit(new URL(location, request.url).href)
        }
      } catch { allowed = false }
      void send(event.sessionId, allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', allowed ? { requestId } : { requestId, errorReason: 'BlockedByClient' }).catch(() => {})
    }
  })
  const attach = (id: string): Promise<void> => {
    const existing = attached.get(id)
    if (existing) return existing
    const ready = (async () => {
      try {
        const target = await root.send('Target.attachToTarget', { targetId: id, flatten: false })
        await send(target.sessionId, 'Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }, { urlPattern: '*', requestStage: 'Response' }] })
      } catch (error) { await root.send('Target.closeTarget', { targetId: id }).catch(() => {}); throw error }
    })()
    attached.set(id, ready)
    return ready
  }
  root.on('Target.targetCreated', event => {
    if (['page', 'iframe'].includes(event.targetInfo.type)) void attach(event.targetInfo.targetId).catch(() => {})
  })
  root.on('Target.targetDestroyed', event => attached.delete(event.targetId))
  root.on('Target.detachedFromTarget', event => {
    for (const [id, call] of pending) if (call.session === event.sessionId) { pending.delete(id); call.reject(new Error('Network target closed.')) }
  })
  root.on('close', () => { for (const call of pending.values()) call.reject(new Error('Browser closed.')); pending.clear() })
  await root.send('Target.setDiscoverTargets', { discover: true })
  return async () => {
    const { targetInfos } = await root.send('Target.getTargets')
    await Promise.all(targetInfos.filter(info => ['page', 'iframe'].includes(info.type)).map(info => attach(info.targetId)))
  }
}
