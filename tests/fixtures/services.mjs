/** Test-owned stand-ins for application services; Cordis and Loader remain real. */
import { Service } from '@deepseek-ai/cordis'

class FixtureConnection extends Service {
  constructor(ctx, channels) { super(ctx, 'connection'); this.channels = channels }
  get fetch() {
    const owner = this.ctx
    return { register: route => owner.effect(() => {
      this.channels.set(route.path, route)
      return () => { this.channels.delete(route.path) }
    }) }
  }
}

export async function apply(ctx) {
  const tools = new Map()
  const channels = new Map()
  ctx.reflect.provide('tools', {
    register(tool) {
      tools.set(tool.name, tool)
      return () => { tools.delete(tool.name) }
    },
  })
  ctx.reflect.provide('sessions', { get: id => id === 'loader-session' ? { id } : undefined })
  // A separate provider fiber must not inherit the webServer declaration.
  await ctx.plugin({ name: 'fixture-connection', apply(scope) { new FixtureConnection(scope, channels) } })
  ctx.reflect.provide('webServer', { getOrigin: () => 'http://127.0.0.1:3080' })
  ctx.reflect.provide('browserTest', { tools, channels })
}
