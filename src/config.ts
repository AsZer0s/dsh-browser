/** Validated deployment settings and model/wire commands. */
import { z } from 'zod'

/** Defaults are resolved once when the plugin loads. */
export const configSchema = z.object({
  headless: z.boolean().default(true),
  executablePath: z.string().min(1).optional(),
  channel: z.enum(['chrome', 'msedge']).optional(),
  viewportWidth: z.number().int().min(320).max(3840).default(1280),
  viewportHeight: z.number().int().min(240).max(2160).default(800),
  actionTimeoutMs: z.number().int().min(100).max(120000).default(15000),
  navigationTimeoutMs: z.number().int().min(100).max(120000).default(30000),
  maxSessions: z.number().int().min(1).max(32).default(8),
  maxPagesPerSession: z.number().int().min(1).max(32).default(8),
  maxSnapshotChars: z.number().int().min(128).max(100000).default(24000),
  frameIntervalMs: z.number().int().min(500).max(30000).default(1200),
  // Retained for old profiles; active takeover now uses compositor frames.
  humanFrameIntervalMs: z.number().int().min(50).max(2000).default(150),
  jpegQuality: z.number().int().min(20).max(90).default(65),
  humanControlLeaseMs: z.number().int().min(10000).max(120000).default(30000),
}).strict()

/** Resolved settings passed to the browser owner. */
export type BrowserConfig = z.infer<typeof configSchema>

/** Human-only physical events; never included in the model tool schema. */
export const humanInputSchema = z.object({
  type: z.enum(['down', 'move', 'up', 'cancel']),
  x: z.number().int().min(0).max(3839).optional(),
  y: z.number().int().min(0).max(2159).optional(),
  button: z.enum(['left', 'right', 'middle']).optional(),
  clickCount: z.number().int().min(1).max(3).optional(),
  modifiers: z.array(z.enum(['Alt', 'Control', 'Meta', 'Shift'])).max(4).optional(),
}).strict().refine(value => value.type === 'cancel' || (value.x !== undefined && value.y !== undefined), 'Pointer events require x/y.')
export type HumanInput = z.infer<typeof humanInputSchema>

/** Shared validation for AI calls and user gestures; no arbitrary JavaScript execution. */
const selector = z.string().min(1).max(2048)
const point = z.number().int().min(0).max(3839)
const modifiers = z.array(z.enum(['Alt', 'Control', 'Meta', 'Shift'])).max(4)
const target = { selector: selector.optional(), x: point.optional(), y: point.optional() }
export const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('navigate'), url: z.string().min(1).max(8192) }).strict(),
  z.object({ action: z.literal('snapshot') }).strict(),
  z.object({ action: z.literal('inspect'), selector }).strict(),
  z.object({ action: z.literal('click'), ...target, button: z.enum(['left', 'right', 'middle']).optional(), clickCount: z.number().int().min(1).max(3).optional(), modifiers: modifiers.optional() }).strict(),
  z.object({ action: z.literal('hover'), ...target }).strict(),
  z.object({ action: z.literal('drag'), selector: selector.optional(), targetSelector: selector.optional(), x: point.optional(), y: point.optional(), toX: point.optional(), toY: point.optional() }).strict(),
  z.object({ action: z.literal('fill'), selector: z.string().min(1).max(2048), text: z.string().max(20000) }).strict(),
  z.object({ action: z.literal('press'), key: z.string().min(1).max(80), selector: selector.optional() }).strict(),
  z.object({ action: z.literal('scroll'), deltaY: z.number().int().min(-10000).max(10000), deltaX: z.number().int().min(-10000).max(10000).optional(), selector: selector.optional() }).strict(),
  z.object({ action: z.literal('check'), selector, checked: z.boolean() }).strict(),
  z.object({ action: z.literal('select_option'), selector, values: z.array(z.string().max(2048)).min(1).max(100) }).strict(),
  z.object({ action: z.literal('wait_for'), selector, state: z.enum(['visible', 'hidden', 'attached', 'detached']).optional(), timeoutMs: z.number().int().min(1).max(30000).optional() }).strict(),
  z.object({ action: z.literal('back') }).strict(),
  z.object({ action: z.literal('forward') }).strict(),
  z.object({ action: z.literal('reload') }).strict(),
  z.object({ action: z.literal('tabs') }).strict(),
  z.object({ action: z.literal('select_tab'), index: z.number().int().min(0).max(31) }).strict(),
  z.object({ action: z.literal('new_tab'), url: z.string().min(1).max(8192).optional() }).strict(),
  z.object({ action: z.literal('close_tab'), index: z.number().int().min(0).max(31).optional() }).strict(),
  z.object({ action: z.literal('close') }).strict(),
  z.object({ action: z.literal('pointer'), x: z.number().int().min(0), y: z.number().int().min(0) }).strict(),
  z.object({ action: z.literal('type'), text: z.string().max(20000), selector: selector.optional() }).strict(),
])

/** Validated browser operation. */
export type BrowserCommand = z.infer<typeof commandSchema>
