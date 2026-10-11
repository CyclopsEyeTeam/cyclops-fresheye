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
  MODE_LABEL, addPair, formatLedgerLine, freshContextBlocks, hhmm, ledgerAppend, normaliseMode, normaliseTimeoutSeconds,
  originFor, parsePrompt, pickTarget, projectDirName, short, topicOf, withholdAttachment, withholdSection,
} from './core.js'

const STORE_PAIRS = 'pairs'
const STORE_PENDING = 'pending'
const STORE_LEDGER = 'ledger'
const RESTORED_SHOW_MS = 8_000
const ACCENT = 'cyan'
const INTERRUPTED_AFTER_MS = 120_000

let mode = 'ask'
let timeoutMs = 60_000

// ---- module state (a process restart rebuilds it from $.store) -------------------------------------------
let pairs = {}            // { [freshId]: { originId, originRoot, model, createdAt } }
let opening = null        // { originId } while /clear is in flight
let switching = false     // a /resume is in flight
let confirm = null        // { fromId, toId, direction, timer }
let active = false        // is the current conversation a FreshEye conversation (drives the indicator)
let busy = false          // a /fresheye run is between its command and its first state change
let storeOk = true        // could the pairs table be read
let activePair = null     // the pair record of the current FreshEye conversation (drives the strip)
let restored = null       // { originId, freshId, timer } for a few seconds after returning to the original

const debug = ($, msg, data) => { try { $.ui.log(`cyclops-fresheye ${msg}${data ? ' ' + JSON.stringify(data) : ''}`, { to: 'debug' }) } catch {} }
const sid = async ($) => { try { return await $.session.id() } catch { return null } }
const later = ($, ms, fn) => $.clock.after(ms, () => Promise.resolve().then(fn).catch((err) => debug($, 'error', { error: String(err) })))

async function loadPairs($) {
  try { pairs = (await $.store.get(STORE_PAIRS)) || {}; storeOk = true } catch (err) { storeOk = false; debug($, 'store.get failed', { error: String(err) }) }
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
  const pair = now ? pairs[await sid($)] ?? null : null
  if (now !== active || pair !== activePair) { active = now; activePair = pair; $.ui.invalidate('ui.render') }
}

/** Append one entry to FreshEye's account (kept in its store; never sent to the model). Never throws. */
async function account($, event, data = {}) {
  try {
    const at = new Date(await $.clock.now()).toISOString()
    await $.store.set(STORE_LEDGER, ledgerAppend(await $.store.get(STORE_LEDGER), { at, event, ...data }))
  } catch (err) { debug($, 'account write failed', { error: String(err) }) }
}

function showRestored($, originId, freshId) {
  if (restored) { try { restored.timer.cancel() } catch {} }
  const mark = { originId, freshId, timer: null }
  mark.timer = $.clock.after(RESTORED_SHOW_MS, () => { if (restored === mark) { restored = null; $.ui.invalidate('ui.render') } })
  restored = mark
  $.ui.invalidate('ui.render')
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
    const back = freshId && freshId !== startId ? ` You are in a new empty conversation; /resume ${startId} returns to where you were.` : ''
    $.ui.log(`FreshEye: could not open a fresh context — ${failure}. Your prompt was NOT sent anywhere.${back}`)
    $.ui.toast('FreshEye did not open — prompt not sent')
    await account($, 'open-failed', { origin: startId, reason: failure })
    await refreshIndicator($)
    return
  }

  let saved = true
  try {
    await loadPairs($)
    await savePairs($, addPair(pairs, freshId, { originId, originRoot, model, createdAt: t0 }))
  } catch (err) { saved = false; debug($, 'store.set failed', { error: String(err) }) }
  opening = null
  try { await $.store.delete(STORE_PENDING) } catch {}
  if (!saved) {
    // Without a stored pair this conversation could not stay fresh after a restart, so don't send the prompt.
    await refreshIndicator($)
    await account($, 'open-failed', { origin: startId, fresh: freshId, reason: 'pair not recorded' })
    $.ui.log(`FreshEye: could not record the FreshEye pair, so your prompt was NOT sent. You are in a new empty conversation; /resume ${startId} returns to where you were.`)
    return
  }
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
  await account($, 'open', { origin: originId, fresh: freshId, from: startId !== originId ? startId : undefined, topic: topicOf(prompt), ms: t1 - t0 })
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
    await account($, 'stale', { from: here, to: target.targetId })
    $.ui.log(`FreshEye: the ${what} conversation ${short(target.targetId)} can’t be found any more. Nothing was switched or deleted; use /resume to choose one yourself.`)
    return
  }
  if (mode === 'off') {
    $.ui.log(`FreshEye: switching is off. You are in ${active ? 'FreshEye' : 'the original'} ${short(here)}; its ${what} conversation is ${short(target.targetId)} (/resume ${target.targetId}).`)
    return
  }
  let surfaces = []
  try { surfaces = await $.session.surfaces() } catch {}
  if (mode === 'toggle') {
    if (surfaces.length === 0) { $.ui.log('FreshEye: switching needs an interactive session. Nothing was switched.'); return }
    return doSwitch($, here, target)
  }

  // mode 'ask' (default): needs a surface that can draw the question; otherwise stay.
  if (!surfaces.some((s) => s === 'terminal' || s === 'desktop')) {
    $.ui.log('FreshEye: can’t ask for confirmation here, so nothing was switched.')
    return
  }
  const question = { fromId: here, toId: target.targetId, direction: target.direction, root: target.root, timer: null }
  question.timer = $.clock.after(timeoutMs, () => {
    if (confirm !== question) return
    confirm = null
    $.ui.invalidate('ui.render')
    $.ui.toast('FreshEye: no answer — stayed here')
    debug($, 'confirm.timeout', { here })
    account($, 'confirm-timeout', { from: here, to: question.toId })
  })
  confirm = question
  $.ui.invalidate('ui.render')
  debug($, 'confirm.shown', { here, target })
}

async function answerConfirm($, accepted) {
  const c = confirm
  if (!c) return
  confirm = null
  try { c.timer.cancel() } catch {}
  $.ui.invalidate('ui.render')
  if (!accepted) { $.ui.toast('FreshEye: stayed here'); debug($, 'confirm.cancelled', { here: c.fromId }); await account($, 'confirm-cancelled', { from: c.fromId, to: c.toId }); return }
  if ((await sid($)) !== c.fromId) { $.ui.log('FreshEye: the conversation changed while asking. Nothing was switched.'); return }
  await doSwitch($, c.fromId, { direction: c.direction, targetId: c.toId, root: c.root })
}

async function doSwitch($, here, target) {
  if (switching || opening) { $.ui.log('FreshEye: another switch is in progress. Nothing was switched.'); return }
  switching = true
  const t0 = await $.clock.now()
  try {
    try {
      await $.command.run({ command: 'resume', args: target.targetId })   // verified: append-only, original intact
    } catch (err) {
      $.ui.log(`FreshEye: the switch was refused (${String(err)}). You are still in ${short(here)}.`)
      await account($, 'switch-failed', { from: here, to: target.targetId, reason: 'refused' })
      return
    }
    const now = await sid($)
    invalidateContext($)
    await refreshIndicator($)
    if (now !== target.targetId) {
      debug($, 'switch.mismatch', { here, wanted: target.targetId, now })
      await account($, 'switch-failed', { from: here, to: target.targetId, reason: `landed in ${short(now)}` })
      $.ui.log(`FreshEye: the switch did not complete — you are in ${short(now)}, not ${short(target.targetId)}. Nothing was deleted.`)
      return
    }
    const ms = (await $.clock.now()) - t0
    debug($, 'switch.done', { from: here, to: now, direction: target.direction, ms })
    if (target.direction === 'return') {
      await account($, 'return', { origin: now, fresh: here, ms })
      showRestored($, now, here)
    } else {
      await account($, 'enter', { origin: here, fresh: now, ms })
    }
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
    const t0 = await $.clock.now()
    await loadPairs($)
    try {
      const pending = await $.store.get(STORE_PENDING)
      if (pending && (await $.clock.now()) - (pending.startedAt ?? 0) > INTERRUPTED_AFTER_MS) {
        await $.store.delete(STORE_PENDING)
        $.ui.log(`FreshEye: an earlier /fresheye was interrupted before its prompt was sent. The original conversation ${short(pending.originId)} was not changed.`)
        debug($, 'recovered.interrupted', pending)
        await account($, 'interrupted', { origin: pending.originId })
      }
    } catch {}
    if (!storeOk) $.ui.log('FreshEye: could not read its records. A FreshEye conversation resumed now is NOT protected from inherited context.')
    await refreshIndicator($)
    try {
      await $.command.register({ name: 'fresheye', description: 'Open a fresh context (/fresheye "prompt"), or switch back to the original (/fresheye)', argumentHint: '["prompt"]' })
      await $.command.register({ name: 'fresheye-log', description: 'Show FreshEye\u2019s account: when it opened, switched and returned', argumentHint: '[count]', immediate: true })
    } catch (err) { debug($, 'command.register failed', { error: String(err) }) }
    debug($, 'session.start', { ms: (await $.clock.now()) - t0, pairs: Object.keys(pairs).length, active, mode, timeoutMs })
    return r
  })

  on('command.run', { command: 'fresheye' }, async ($, e) => {
    const prompt = parsePrompt(e.args)
    if (busy || switching || opening) return { text: 'FreshEye: a switch is already in progress. Nothing was sent or switched.' }
    if (confirm) return { text: 'FreshEye: answer the switch question above the prompt first. Nothing was sent or switched.' }
    let surfaces = []
    try { surfaces = await $.session.surfaces() } catch {}
    if (prompt && surfaces.length === 0) return { text: 'FreshEye needs an interactive session. Nothing was sent.' }
    busy = true
    later($, 0, async () => { try { await (prompt ? openFresh($, prompt) : offerSwitch($)) } finally { busy = false } })
    return prompt ? { text: 'FreshEye: opening a fresh context. The prompt goes only to the new conversation.' } : {}
  })

  // /fresheye-log: the account, shown as dim lines Claude does not read (never sent to the model).
  on('command.run', { command: 'fresheye-log' }, async ($, e) => {
    const n = Math.min(100, Math.max(1, parseInt(String(e.args ?? '').trim(), 10) || 12))
    let ledger = []
    try { ledger = (await $.store.get(STORE_LEDGER)) || [] } catch {}
    if (ledger.length === 0) { $.ui.log('FreshEye account: nothing recorded yet.'); return {} }
    $.ui.log(`FreshEye account \u00b7 last ${Math.min(n, ledger.length)} of ${ledger.length}:\n` + ledger.slice(-n).map(formatLedgerLine).join('\n'))
    return {}
  })

  // The original conversation must never be sent the FreshEye prompt: store its /fresheye command row with the
  // arguments withheld. (Claude Code itself still keeps the raw arguments in that row's `commandRun` metadata and,
  // for queued commands, in a queue-operation record; neither is sent to the model. See docs/LIMITATIONS.md.)
  on('session.append', async ($, e, next) => {
    if (e.door !== 'command') return next(e)
    const redact = (t) => t.replace(/(<command-name>\/(?:[\w-]+:)?fresheye<\/command-name>[\s\S]*?<command-args>)([\s\S]*?)(<\/command-args>)/g,
      (all, a, args, b) => (args.trim() === '' ? all : `${a}[FreshEye prompt withheld from this conversation]${b}`))
    const c = e.message?.content
    if (typeof c === 'string') return next({ ...e, message: { ...e.message, content: redact(c) } })
    if (Array.isArray(c)) return next({ ...e, message: { ...e.message, content: c.map((b) => (b && b.type === 'text' ? { ...b, text: redact(b.text) } : b)) } })
    return next(e)
  }).catch(($, e, next) => {
    // the redaction itself failed: withhold the whole text of a /fresheye command row rather than store it raw
    const c = e.message?.content
    const isOurs = (t) => typeof t === 'string' && /<command-name>\/(?:[\w-]+:)?fresheye<\/command-name>/.test(t)
    if (e.door === 'command' && typeof c === 'string' && isOurs(c)) return next({ ...e, message: { ...e.message, content: '<command-name>/fresheye</command-name>' } })
    if (e.door === 'command' && Array.isArray(c) && c.some((b) => b && b.type === 'text' && isOurs(b.text))) return next({ ...e, message: { ...e.message, content: [{ type: 'text', text: '<command-name>/fresheye</command-name>' }] } })
    return next(e)
  })

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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)                                 // keep whatever else draws here (e.g. Spark)
    if (e.props.hasSurvey || !(confirm || active || restored)) return below
    const { Box, Text, Button } = $.ui.resolve(e)
    let ours
    if (confirm) {
      const leaving = confirm.direction === 'return' ? 'FreshEye' : 'original'
      const going = confirm.direction === 'return' ? 'original' : 'FreshEye'
      ours = h(Box, { flexDirection: 'column' },
        h(Text, { bold: true, color: ACCENT }, `\u25ce FreshEye \u00b7 switch conversations?`),
        h(Text, {}, `Leave ${leaving} ${short(confirm.fromId)} and resume ${going} ${short(confirm.toId)}. Nothing is deleted.`),
        h(Box, { gap: 2 },
          h(Button, { key: 'fresheye-stay', label: 'Stay here', autoFocus: true, onPress: () => answerConfirm($, false) }),
          h(Button, { key: 'fresheye-switch', label: 'Switch', onPress: () => answerConfirm($, true) }),
          h(Text, { dimColor: true }, `(stays here after ${Math.round(timeoutMs / 1000)}s)`)))
    } else if (active) {
      const p = activePair
      ours = h(Box, { flexDirection: 'column', key: 'fresheye-strip' },
        h(Text, { wrap: 'truncate-end' },
          h(Text, { bold: true, color: ACCENT }, MODE_LABEL),
          h(Text, { dimColor: true }, p ? `  \u00b7 opened ${hhmm(p.createdAt)} \u00b7 original ${short(p.originId)} kept` : '  \u00b7 opening\u2026')),
        h(Text, { dimColor: true, wrap: 'truncate-end' }, 'withheld: CLAUDE.md \u00b7 memory \u00b7 hook context   \u00b7   /fresheye to switch back'))
    } else {
      ours = h(Text, { dimColor: true, wrap: 'truncate-end', key: 'fresheye-restored' },
        `\u25ce Original context restored \u00b7 ${short(restored.originId)} \u00b7 FreshEye ${short(restored.freshId)} kept in /resume`)
    }
    return below ? h(Box, { flexDirection: 'column' }, ours, below) : ours
  })
}
