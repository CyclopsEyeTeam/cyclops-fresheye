// CyclopsFreshEye V0 — a fresh active context in the same terminal, without touching the original conversation.
//
//   /fresheye "prompt"   open a FreshEye conversation (verified /clear), then send the prompt as your message there
//   /fresheye            offer to switch between the FreshEye conversation and its recorded original (verified /resume)
//
// What a FreshEye conversation withholds: the CLAUDE.md / auto-memory context block, the auto-memory system section,
// settings-hook additionalContext (Remember-style hooks) and instruction/memory attachments. Settings hooks still RUN.
// FreshEye never hooks tool.call / tool.check, never edits settings, never deletes or rewrites a conversation.
//
// Claude Code mods API (early access, v2.1.287+). Built and accepted against Claude Code 2.1.296.

import {
  MODE_LABEL, addPair, freshContextBlocks, normaliseMode, normaliseTimeoutSeconds, originFor, parsePrompt,
  pickTarget, projectDirName, short, withholdAttachment, withholdSection,
} from './core.js'

const STORE_PAIRS = 'pairs'
const STORE_PENDING = 'pending'
const HELD_PREFIX = '⟨fresheye-held:' // ⟨fresheye-held:<nonce>⟩
const HELD_RE = /^⟨fresheye-held:([a-z0-9]+)⟩$/
const INTERRUPTED_AFTER_MS = 120_000

let mode = 'ask'
let timeoutMs = 60_000

// ---- module state (a process restart rebuilds it from $.store) -------------------------------------------
let pairs = {}            // { [freshId]: { originId, originRoot, model, createdAt } }
let opening = null        // { originId } while /clear is in flight
let switching = false     // a /resume is in flight
let confirm = null        // { fromId, toId, direction, timer }
let active = false        // is the current conversation a FreshEye conversation (drives the indicator)
const held = new Map()    // nonce -> prompt text, so the prompt never lands in the original's records

const debug = ($, msg, data) => { try { $.ui.log(`cyclops-fresheye ${msg}${data ? ' ' + JSON.stringify(data) : ''}`, { to: 'debug' }) } catch {} }
const sid = async ($) => { try { return await $.session.id() } catch { return null } }
const later = ($, ms, fn) => $.clock.after(ms, () => Promise.resolve().then(fn).catch((err) => debug($, 'error', { error: String(err) })))

async function loadPairs($) {
  try { pairs = (await $.store.get(STORE_PAIRS)) || {} } catch (err) { debug($, 'store.get failed', { error: String(err) }) }
  return pairs
}
async function savePairs($, next) {
  pairs = next
  await $.store.set(STORE_PAIRS, next)
}

async function isFresh($) {
  const s = await sid($)
  if (!s) return false
  if (opening && s !== opening.originId) return true
  return Boolean(pairs[s])
}

async function refreshIndicator($) {
  const now = await isFresh($)
  if (now !== active) { active = now; $.ui.invalidate('ui.render') }
}

function invalidateContext($) {
  for (const ev of ['prompt.section', 'prompt.context', 'prompt.attachment']) { try { $.ui.invalidate(ev) } catch {} }
}

async function configDir($) {
  const explicit = await $.env.get('CLAUDE_CONFIG_DIR')
  if (explicit) return explicit
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
  return home ? `${home}/.claude` : null
}

/** true / false when it could check; null when it could not (then /resume itself is the check). */
async function transcriptExists($, id, root) {
  try {
    const cfg = await configDir($)
    if (!cfg) return null
    if (root && (await $.fs.exists(`${cfg}/projects/${projectDirName(root)}/${id}.jsonl`))) return true
    const dirs = await $.fs.list(`${cfg}/projects`)
    for (const d of dirs.slice(0, 500)) {
      if (d.kind === 'dir' && (await $.fs.exists(`${cfg}/projects/${d.name}/${id}.jsonl`))) return true
    }
    return false
  } catch (err) {
    debug($, 'transcript check unavailable', { error: String(err) })
    return null
  }
}

// ---- /fresheye "prompt" ----------------------------------------------------------------------------------
async function openFresh($, prompt) {
  const startId = await sid($)
  if (!startId) { $.ui.log('FreshEye: could not read this conversation’s id. Nothing was sent.'); return }
  await loadPairs($)
  const originId = originFor(pairs, startId)                      // never chain FreshEye → FreshEye
  const originRoot = pairs[startId]?.originRoot ?? (await $.session.root())
  const model = await $.session.model()
  const t0 = await $.clock.now()

  opening = { originId: startId }
  try { await $.store.set(STORE_PENDING, { originId, startedAt: t0 }) } catch {}
  debug($, 'open.begin', { startId, originId })

  let failure = null
  try {
    await $.command.run({ command: 'clear' })                     // verified: new empty conversation, same model
  } catch (err) { failure = `the /clear step was refused (${String(err)})` }

  const freshId = await sid($)
  if (!failure && (!freshId || freshId === startId)) failure = 'the conversation did not change'
  if (!failure && (await $.session.model()) !== model) failure = `the model changed (${model} → ${await $.session.model()})`

  if (failure) {
    opening = null
    try { await $.store.delete(STORE_PENDING) } catch {}
    debug($, 'open.failed', { failure, startId, freshId })
    $.ui.log(`FreshEye: could not open a fresh context — ${failure}. Your prompt was NOT sent anywhere.`)
    $.ui.toast('FreshEye did not open — prompt not sent')
    await refreshIndicator($)
    return
  }

  await loadPairs($)
  await savePairs($, addPair(pairs, freshId, { originId, originRoot, model, createdAt: t0 }))
  opening = null
  try { await $.store.delete(STORE_PENDING) } catch {}
  invalidateContext($)
  await refreshIndicator($)

  // Last guard before sending: we must be in the conversation we just created.
  if ((await sid($)) !== freshId) {
    $.ui.log('FreshEye: the active conversation changed before the prompt could be sent. Your prompt was NOT sent.')
    return
  }
  await $.prompt.submit({ text: prompt, asUser: true })
  const t1 = await $.clock.now()
  debug($, 'open.done', { originId, freshId, ms: t1 - t0 })
  $.ui.toast(`FreshEye opened · original ${short(originId)} kept`)
}

// ---- bare /fresheye --------------------------------------------------------------------------------------
async function offerSwitch($) {
  const here = await sid($)
  await loadPairs($)
  const target = pickTarget(pairs, here)
  if (!target) {
    $.ui.log('FreshEye: this conversation has no FreshEye pair. Use /fresheye "prompt" to open one. Nothing was switched.')
    return
  }
  const what = target.direction === 'return' ? 'original' : 'FreshEye'
  const exists = await transcriptExists($, target.targetId, target.root)
  if (exists === false) {
    debug($, 'stale', { here, target })
    $.ui.log(`FreshEye: the ${what} conversation ${short(target.targetId)} can’t be found any more. Nothing was switched or deleted; use /resume to choose one yourself.`)
    return
  }
  if (mode === 'off') {
    $.ui.log(`FreshEye: switching is off. You are in ${active ? 'FreshEye' : 'the original'} ${short(here)}; its ${what} conversation is ${short(target.targetId)} (/resume ${target.targetId}).`)
    return
  }
  if (mode === 'toggle') return doSwitch($, here, target)

  // mode 'ask' (default): needs a surface that can draw the question; otherwise stay.
  let surfaces = []
  try { surfaces = await $.session.surfaces() } catch {}
  if (!surfaces.some((s) => s === 'terminal' || s === 'desktop')) {
    $.ui.log('FreshEye: can’t ask for confirmation here, so nothing was switched.')
    return
  }
  const timer = $.clock.after(timeoutMs, () => {
    if (!confirm) return
    confirm = null
    $.ui.invalidate('ui.render')
    $.ui.toast('FreshEye: no answer — stayed here')
    debug($, 'confirm.timeout', { here })
  })
  confirm = { fromId: here, toId: target.targetId, direction: target.direction, root: target.root, timer }
  $.ui.invalidate('ui.render')
  debug($, 'confirm.shown', { here, target })
}

async function answerConfirm($, accepted) {
  const c = confirm
  if (!c) return
  confirm = null
  try { c.timer.cancel() } catch {}
  $.ui.invalidate('ui.render')
  if (!accepted) { $.ui.toast('FreshEye: stayed here'); debug($, 'confirm.cancelled', { here: c.fromId }); return }
  if ((await sid($)) !== c.fromId) { $.ui.log('FreshEye: the conversation changed while asking. Nothing was switched.'); return }
  await doSwitch($, c.fromId, { direction: c.direction, targetId: c.toId, root: c.root })
}

async function doSwitch($, here, target) {
  if (switching || opening) return
  switching = true
  const t0 = await $.clock.now()
  try {
    try {
      await $.command.run({ command: 'resume', args: target.targetId })   // verified: append-only, original intact
    } catch (err) {
      $.ui.log(`FreshEye: the switch was refused (${String(err)}). You are still in ${short(here)}.`)
      return
    }
    const now = await sid($)
    invalidateContext($)
    await refreshIndicator($)
    if (now !== target.targetId) {
      debug($, 'switch.mismatch', { here, wanted: target.targetId, now })
      $.ui.log(`FreshEye: the switch did not complete — you are in ${short(now)}, not ${short(target.targetId)}. Nothing was deleted.`)
      return
    }
    debug($, 'switch.done', { from: here, to: now, direction: target.direction, ms: (await $.clock.now()) - t0 })
    $.ui.toast(target.direction === 'return' ? `Original context restored · ${short(now)}` : `${MODE_LABEL} · ${short(now)}`)
  } finally {
    switching = false
  }
}

export const register = (on, options = {}) => {
  mode = normaliseMode(options.switchMode)
  timeoutMs = normaliseTimeoutSeconds(options.confirmTimeoutSeconds) * 1000

  // ---- registration ---------------------------------------------------------------------------------------
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await loadPairs($)
    try {
      const pending = await $.store.get(STORE_PENDING)
      if (pending && (await $.clock.now()) - (pending.startedAt ?? 0) > INTERRUPTED_AFTER_MS) {
        await $.store.delete(STORE_PENDING)
        $.ui.log(`FreshEye: an earlier /fresheye was interrupted before its prompt was sent. The original conversation ${short(pending.originId)} was not changed.`)
        debug($, 'recovered.interrupted', pending)
      }
    } catch {}
    await refreshIndicator($)
    try {
      await $.command.register({ name: 'fresheye', description: 'Open a fresh context (/fresheye "prompt"), or switch back to the original (/fresheye)', argumentHint: '["prompt"]' })
    } catch (err) { debug($, 'command.register failed', { error: String(err) }) }
    return r
  })

  // Keep the FreshEye prompt out of the original conversation's records: hold it in memory and let the
  // command row carry only a reference. (Typed prompts are queued; the queue record would otherwise hold it.)
  on('prompt.submit', async ($, e, next) => {
    const m = typeof e.text === 'string' && e.text.match(/^\/fresheye\s+([\s\S]+)$/)
    if (!m || HELD_RE.test(m[1].trim())) return next(e)
    const prompt = parsePrompt(m[1])
    if (!prompt) return next(e)
    const nonce = Math.random().toString(36).slice(2, 10)
    held.set(nonce, prompt)
    return next({ ...e, text: `/fresheye ${HELD_PREFIX}${nonce}⟩` })
  }).catch(($, e, next) => next(e)) // on failure the text goes through unchanged; the session.append backstop still redacts

  on('command.run', { command: 'fresheye' }, async ($, e) => {
    const raw = String(e.args ?? '').trim()
    const h = raw.match(HELD_RE)
    const prompt = h ? held.get(h[1]) ?? '' : parsePrompt(raw)
    if (h) held.delete(h[1])
    if (h && !prompt) return { text: 'FreshEye: that prompt is no longer held (was Claude Code restarted?). Nothing was sent.' }
    if (switching || opening) return { text: 'FreshEye: a switch is already in progress. Nothing was sent or switched.' }
    if (confirm) return { text: 'FreshEye: answer the switch question above the prompt first. Nothing was sent or switched.' }
    let surfaces = []
    try { surfaces = await $.session.surfaces() } catch {}
    if (prompt && surfaces.length === 0) return { text: 'FreshEye needs an interactive session. Nothing was sent.' }
    later($, 0, () => (prompt ? openFresh($, prompt) : offerSwitch($)))
    return prompt ? { text: 'FreshEye: opening a fresh context. The prompt goes only to the new conversation.' } : {}
  })

  // Backstop: if a /fresheye command row still carries prompt text (e.g. run by another plugin), store it redacted.
  on('session.append', async ($, e, next) => {
    if (e.door !== 'command') return next(e)
    const redact = (t) => t.replace(/(<command-name>\/fresheye<\/command-name>[\s\S]*?<command-args>)([\s\S]*?)(<\/command-args>)/g,
      (all, a, args, b) => (args.trim() === '' ? all : `${a}[FreshEye prompt withheld from this conversation]${b}`))
    const c = e.message?.content
    if (typeof c === 'string') return next({ ...e, message: { ...e.message, content: redact(c) } })
    if (Array.isArray(c)) return next({ ...e, message: { ...e.message, content: c.map((b) => (b && b.type === 'text' ? { ...b, text: redact(b.text) } : b)) } })
    return next(e)
  }).catch(($, e, next) => next(e)) // never block a row; worst case it is stored as made

  // ---- what a FreshEye conversation withholds ---------------------------------------------------------------
  on('prompt.context', async ($, e, next) => {
    const r = await next(e)
    if (!(await isFresh($))) return r
    return { blocks: freshContextBlocks(r.blocks), instructionFiles: [] }
  })

  on('prompt.section', async ($, e, next) => {
    if (withholdSection(e.name) && (await isFresh($))) return { text: null }
    return next(e)
  })

  on('prompt.attachment', async ($, e, next) => {
    if (withholdAttachment(e.type, e.origin) && (await isFresh($))) return { text: null }
    return next(e)
  })

  // ---- indicator + confirmation (no polling: redraws only when state changes) ------------------------------
  on('session.end', ($, e, next) => {
    if (confirm) { try { confirm.timer.cancel() } catch {}; confirm = null }
    later($, 400, () => refreshIndicator($))                    // after /clear or /resume the new conversation is live
    return next(e)
  })

  on('ui.render', { component: 'SessionMode' }, ($, e, next) => {
    if (!active) return next(e)
    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, MODE_LABEL] } })
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (!confirm || e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const leaving = confirm.direction === 'return' ? 'FreshEye' : 'original'
    const going = confirm.direction === 'return' ? 'original' : 'FreshEye'
    return h(Box, { flexDirection: 'column' },
      h(Text, { bold: true }, `◎ FreshEye · switch conversations?`),
      h(Text, {}, `Leave ${leaving} ${short(confirm.fromId)} and resume ${going} ${short(confirm.toId)}. Nothing is deleted.`),
      h(Box, { gap: 2 },
        h(Button, { key: 'fresheye-switch', label: 'Switch', hotkey: '1', onPress: () => answerConfirm($, true) }),
        h(Button, { key: 'fresheye-stay', label: 'Stay here', hotkey: '2', onPress: () => answerConfirm($, false) }),
        h(Text, { dimColor: true }, `(stays here after ${Math.round(timeoutMs / 1000)}s)`)))
  })
}
