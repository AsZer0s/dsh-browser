/** Chromium-generated frames, independent of the browser action queue. */
import type { CDPSession, Page } from 'playwright'

export class RealtimeFrames {
  readonly id = crypto.randomUUID()
  private latest?: { image: string; sequence: number }
  private sequence = 0
  private stopped = false
  cursor = 'default'
  private readonly listeners = new Set<() => void>()
  private readonly onPageClose = (): void => this.finish()

  readonly page: Page
  private readonly cdp: CDPSession

  private constructor(page: Page, cdp: CDPSession) { this.page = page; this.cdp = cdp }

  static async start(page: Page, quality: number): Promise<RealtimeFrames> {
    const cdp = await page.context().newCDPSession(page)
    const stream = new RealtimeFrames(page, cdp)
    cdp.on('Page.screencastFrame', event => {
      if (stream.stopped) return
      stream.latest = { image: `data:image/jpeg;base64,${event.data}`, sequence: ++stream.sequence }
      for (const notify of stream.listeners) notify()
      // Chromium must never wait for a slow UI. Keep only the newest frame.
      void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {})
    })
    cdp.on('close', () => stream.finish())
    page.once('close', stream.onPageClose)
    try {
      await page.bringToFront()
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality, everyNthFrame: 1 })
      return stream
    } catch (error) {
      await stream.stop()
      throw error
    }
  }

  /** Long-poll transport: no screenshot timer, and no queue of stale frames. */
  async next(after: number, signal: AbortSignal): Promise<{ image: string; sequence: number } | undefined> {
    signal.throwIfAborted()
    if (!this.stopped && (!this.latest || this.latest.sequence <= after)) {
      await new Promise<void>(resolve => {
        const done = (): void => {
          clearTimeout(timer)
          this.listeners.delete(done)
          signal.removeEventListener('abort', done)
          resolve()
        }
        const timer = setTimeout(done, 1000) // Metadata/control heartbeat on static pages.
        this.listeners.add(done)
        signal.addEventListener('abort', done, { once: true })
        if (signal.aborted || this.stopped) done()
      })
    }
    signal.throwIfAborted()
    return this.stopped ? undefined : this.latest
  }

  private finish(): void {
    this.stopped = true
    for (const notify of this.listeners) notify()
  }

  async updateCursor(x: number, y: number): Promise<void> {
    try {
      const node = await this.cdp.send('DOM.getNodeForLocation', { x, y, includeUserAgentShadowDOM: true })
      await this.cdp.send('DOM.enable')
      await this.cdp.send('CSS.enable')
      await this.cdp.send('DOM.getDocument')
      const { nodeIds } = await this.cdp.send('DOM.pushNodesByBackendIdsToFrontend', { backendNodeIds: [node.backendNodeId] })
      if (!nodeIds[0]) return
      const style = await this.cdp.send('CSS.getComputedStyleForNode', { nodeId: nodeIds[0] })
      const cursor = style.computedStyle.find(row => row.name === 'cursor')?.value ?? 'default'
      const next = /^(default|pointer|text|vertical-text|grab|grabbing|crosshair|move|not-allowed|wait|progress|help|[nesw-]+resize|col-resize|row-resize|zoom-in|zoom-out|none)$/.test(cursor) ? cursor : 'default'
      if (next !== this.cursor) { this.cursor = next; for (const notify of this.listeners) notify() }
    } catch { this.cursor = 'default' }
  }

  async stop(): Promise<void> {
    this.finish()
    this.page.off('close', this.onPageClose)
    await this.cdp.send('Page.stopScreencast').catch(() => {})
    await this.cdp.detach().catch(() => {})
  }
}
