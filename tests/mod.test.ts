// Kit tests: the mod's hooks driven by the claude-code/testing kit with stubs standing in for Claude Code.
// SYNTHETIC: these prove the mod's decisions (refusals, confirm/cancel/timeout, redaction), NOT native
// session switching. Native switching is proven only by the real-session gates in acceptance/.
import { expect, mock, test } from 'claude-code/testing'

type Rec = { logs: string[]; toasts: string[]; commands: { command: string; args?: string }[]; submitted: string[]; store: Map<string, unknown> }

function stubs(on: any, opts: { current: { id: string }; pairs?: Record<string, unknown>; surfaces?: string[]; clearFails?: boolean; exists?: boolean; skipRegister?: boolean }) {
  const rec: Rec = { logs: [], toasts: [], commands: [], submitted: [], store: new Map() }
  if (opts.pairs) rec.store.set('pairs', opts.pairs)
  const clock = mock.clock(on)
  mock.env(on, { CLAUDE_CONFIG_DIR: '/cfg' })
  on('store.get', ($: any, e: any) => ({ value: rec.store.get(e.key) }))
  on('store.set', ($: any, e: any) => { rec.store.set(e.key, e.value); return { value: undefined } })
  on('store.delete', ($: any, e: any) => { rec.store.delete(e.key); return { value: undefined } })
  on('session.id', () => ({ value: opts.current.id }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.model', () => ({ value: 'claude-test' }))
  on('session.surfaces', () => ({ value: opts.surfaces ?? ['terminal'] }))
  on('fs.exists', () => ({ value: opts.exists ?? true }))
  on('fs.list', () => ({ value: [] }))
  if (!opts.skipRegister) on('command.register', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.log', ($: any, e: any) => { rec.logs.push(e.text); return { value: undefined } })
  on('ui.toast', ($: any, e: any) => { rec.toasts.push(e.text); return { value: undefined } })
  on('prompt.submit', ($: any, e: any) => { rec.submitted.push(e.text); return { text: e.text } })
  on('session.start', () => ({ cwd: '/repo' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  on('command.run', ($: any, e: any) => {
    rec.commands.push({ command: e.command, args: e.args })
    if (e.command === 'clear') {
      if (opts.clearFails) return { deny: 'clear unavailable' }
      opts.current.id = 'fresh-1'
    }
    if (e.command === 'resume') opts.current.id = e.args
    return { text: '' }
  })
  return { rec, clock }
}

const BAND = {
  plugin: 'cyclops-fresheye', component: 'AbovePrompt', requestId: 'above-prompt', surface: 'terminal',
  viewport: { columns: 100, rows: 30 },
  props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 90, scroll: { offset: 0, bodyRows: 8 }, view: {} },
} as const

const PAIRS = { 'fresh-1': { originId: 'orig-1', originRoot: '/repo', model: 'claude-test', createdAt: 1 } }

test('registers /fresheye at session start', async ($, on) => {
  const names: string[] = []
  on('command.register', ($: any, e: any) => { names.push(e.name); return { value: undefined } })
  stubs(on, { current: { id: 'orig-1' }, skipRegister: true })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' })
  expect(names).toContain('fresheye')
})

test('open: clears first, then sends the prompt only to the new conversation', async ($, on) => {
  const cur = { id: 'orig-1' }
  const { rec, clock } = stubs(on, { current: cur })
  const out = await $.command.run({ command: 'fresheye', args: '"look again"' })
  expect(out.text).toMatch(/opening a fresh context/)
  await clock.settle()
  expect(rec.commands.map((c) => c.command)).toEqual(['clear']) // the mod answers /fresheye itself
  expect(cur.id).toBe('fresh-1')
  expect(rec.submitted).toEqual(['look again'])
  expect((rec.store.get('pairs') as any)['fresh-1'].originId).toBe('orig-1')
  expect(rec.store.get('pending')).toBeUndefined()
})

test('open: if /clear fails the prompt is not sent anywhere', async ($, on) => {
  const cur = { id: 'orig-1' }
  const { rec, clock } = stubs(on, { current: cur, clearFails: true })
  await $.command.run({ command: 'fresheye', args: '"secret"' })
  await clock.settle()
  expect(rec.submitted).toEqual([])
  expect(cur.id).toBe('orig-1')
  expect(rec.logs.join('\n')).toMatch(/NOT sent/)
  expect(rec.store.get('pending')).toBeUndefined()
})

test('open: refused without an interactive surface, nothing sent', async ($, on) => {
  const { rec, clock } = stubs(on, { current: { id: 'orig-1' }, surfaces: [] })
  const out = await $.command.run({ command: 'fresheye', args: '"x"' })
  await clock.settle()
  expect(out.text).toMatch(/interactive/)
  expect(rec.commands).toEqual([])
  expect(rec.submitted).toEqual([])
})

test('bare /fresheye with no pair never guesses', async ($, on) => {
  const { rec, clock } = stubs(on, { current: { id: 'lonely' }, pairs: PAIRS })
  await $.command.run({ command: 'fresheye', args: '' })
  await clock.settle()
  expect(rec.commands).toEqual([])
  expect(rec.logs.join('\n')).toMatch(/no FreshEye pair/)
})

test('ask (default): band shows both conversations; Stay keeps you here', async ($, on) => {
  const cur = { id: 'fresh-1' }
  const { rec, clock } = stubs(on, { current: cur, pairs: PAIRS })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' })
  await $.command.run({ command: 'fresheye', args: '' })
  await clock.settle()
  const ui = await $.ui.mount(BAND as any)
  expect(await ui.find({ type: 'Text', text: /Leave FreshEye fresh-1 and resume original orig-1/ })).toBeDefined()
  await ui.press({ key: 'fresheye-stay' })
  await clock.settle()
  expect(rec.commands.some((c) => c.command === 'resume')).toBe(false)
  expect(cur.id).toBe('fresh-1')
})

test('ask (default): Switch resumes exactly the recorded original', async ($, on) => {
  const cur = { id: 'fresh-1' }
  const { rec, clock } = stubs(on, { current: cur, pairs: PAIRS })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' })
  await $.command.run({ command: 'fresheye', args: '' })
  await clock.settle()
  const ui = await $.ui.mount(BAND as any)
  await ui.press({ key: 'fresheye-switch' })
  await clock.settle()
  expect(rec.commands.filter((c) => c.command === 'resume')).toEqual([{ command: 'resume', args: 'orig-1' }])
  expect(cur.id).toBe('orig-1')
  expect(rec.toasts.join('\n')).toMatch(/Original context restored/)
})

test('ask (default): no answer before the timeout means stay', async ($, on) => {
  const cur = { id: 'fresh-1' }
  const { rec, clock } = stubs(on, { current: cur, pairs: PAIRS })
  await $.command.run({ command: 'fresheye', args: '' })
  await clock.settle()
  await clock.advance(61_000)
  const ui = await $.ui.mount(BAND as any)
  expect(await ui.find({ key: 'fresheye-switch' })).toBeUndefined()
  expect(rec.commands.some((c) => c.command === 'resume')).toBe(false)
  expect(cur.id).toBe('fresh-1')
})

test('ask: no drawable surface means stay', async ($, on) => {
  const { rec, clock } = stubs(on, { current: { id: 'fresh-1' }, pairs: PAIRS, surfaces: ['vscode'] })
  await $.command.run({ command: 'fresheye', args: '' })
  await clock.settle()
  expect(rec.commands.some((c) => c.command === 'resume')).toBe(false)
  expect(rec.logs.join('\n')).toMatch(/can’t ask for confirmation/)
})

test('a prompt while a switch question is open is refused, not sent', async ($, on) => {
  const { rec, clock } = stubs(on, { current: { id: 'fresh-1' }, pairs: PAIRS })
  await $.command.run({ command: 'fresheye', args: '' })
  await clock.settle()
  const out = await $.command.run({ command: 'fresheye', args: '"should not send"' })
  await clock.settle()
  expect(out.text).toMatch(/answer the switch question/)
  expect(rec.submitted).toEqual([])
})

test('toggle: switches at once', { options: { switchMode: 'toggle' } }, async ($, on) => {
  const cur = { id: 'fresh-1' }
  const { rec, clock } = stubs(on, { current: cur, pairs: PAIRS })
  await $.command.run({ command: 'fresheye', args: '' })
  await clock.settle()
  expect(cur.id).toBe('orig-1')
  expect(rec.commands.filter((c) => c.command === 'resume').length).toBe(1)
})

test('off: never switches', { options: { switchMode: 'off' } }, async ($, on) => {
  const cur = { id: 'fresh-1' }
  const { rec, clock } = stubs(on, { current: cur, pairs: PAIRS })
  await $.command.run({ command: 'fresheye', args: '' })
  await clock.settle()
  expect(cur.id).toBe('fresh-1')
  expect(rec.logs.join('\n')).toMatch(/switching is off/)
})

test('stale reference: missing original is reported, nothing switched or deleted', async ($, on) => {
  const cur = { id: 'fresh-1' }
  const { rec, clock } = stubs(on, { current: cur, pairs: PAIRS, exists: false })
  await $.command.run({ command: 'fresheye', args: '' })
  await clock.settle()
  expect(rec.commands.some((c) => c.command === 'resume')).toBe(false)
  expect(rec.logs.join('\n')).toMatch(/can’t be found/)
  expect((rec.store.get('pairs') as any)['fresh-1']).toBeDefined()
})

test('restart: an interrupted open is reported once and cleared', async ($, on) => {
  const { rec } = stubs(on, { current: { id: 'orig-1' } })
  rec.store.set('pending', { originId: 'orig-1', startedAt: -500_000 })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' })
  expect(rec.logs.join('\n')).toMatch(/interrupted before its prompt was sent/)
  expect(rec.store.get('pending')).toBeUndefined()
})
