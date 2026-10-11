// CyclopsFreshEye — pure decision logic (no `$`, no I/O). Unit-tested in tests/core.test.ts.

export const MODE_LABEL = '◎ FreshEye · Fresh Context'
export const SWITCH_MODES = ['ask', 'toggle', 'off']
export const MAX_PAIRS = 500 // older pairs drop off; their conversations remain, but are no longer protected if resumed

/** `/fresheye "prompt"` → prompt text; bare `/fresheye` → ''. Strips one pair of wrapping quotes. */
export function parsePrompt(args) {
  const s = String(args ?? '').trim()
  const m = s.match(/^(["'“”‘’])([\s\S]*)(["'“”‘’])$/)
  return (m ? m[2] : s).trim()
}

export function normaliseMode(value) {
  return SWITCH_MODES.includes(value) ? value : 'ask'
}

export function normaliseTimeoutSeconds(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 60
  return Math.min(600, Math.max(5, Math.round(n)))
}

/** Claude Code stores a project's transcripts under projects/<root with every non-alphanumeric as '-'>. */
export function projectDirName(root) {
  return String(root).replace(/[^A-Za-z0-9]/g, '-')
}

export const short = (id) => (id ? String(id).slice(0, 8) : '????????')

/**
 * The pairs table: { [freshId]: { originId, originRoot, model, createdAt } }.
 * A FreshEye conversation opened from another FreshEye conversation is linked to the same true original,
 * so the "original" never drifts to a FreshEye conversation.
 */
export function originFor(pairs, currentId) {
  const p = pairs[currentId]
  return p ? p.originId : currentId
}

export function addPair(pairs, freshId, record) {
  const next = { ...pairs, [freshId]: record }
  const ids = Object.keys(next).sort((a, b) => (next[b].createdAt ?? 0) - (next[a].createdAt ?? 0))
  for (const id of ids.slice(MAX_PAIRS)) delete next[id]
  return next
}

/**
 * Where bare `/fresheye` would go from `currentId`. Never guesses:
 *  - in a FreshEye conversation → its recorded original ('return')
 *  - in an original that has FreshEye conversations → the newest one ('enter')
 *  - anything else → null
 */
export function pickTarget(pairs, currentId) {
  if (!currentId) return null
  const own = pairs[currentId]
  if (own) return { direction: 'return', targetId: own.originId, root: own.originRoot }
  const children = Object.entries(pairs)
    .filter(([, p]) => p.originId === currentId)
    .sort(([, a], [, b]) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  if (children.length === 0) return null
  const [freshId, p] = children[0]
  return { direction: 'enter', targetId: freshId, root: p.originRoot }
}

/**
 * Which injected messages a FreshEye conversation withholds.
 * - settings-hook additionalContext (Remember-style hooks). Their side effects still happen.
 * - engine attachments that announce instruction files or memory (CLAUDE.md, nested CLAUDE.md, auto-memory).
 * Kept on purpose: blocking-error notes and stop continuations from hooks (safety-relevant), all other engine messages.
 */
export function withholdAttachment(type, origin) {
  const t = String(type ?? '')
  if (origin && origin.kind === 'hook') return /additional_context/i.test(t)
  if (origin && origin.kind === 'engine') return /instruction|memory/i.test(t)
  return false
}

/** Context blocks of a FreshEye conversation's first message: drop the instruction-file block (CLAUDE.md + auto-memory index). */
export function freshContextBlocks(blocks) {
  return blocks.filter((b) => b.name !== 'claudeMd')
}

/** System-prompt sections a FreshEye conversation withholds. */
export function withholdSection(name) {
  return name === 'memory'
}

// ---- account (an append-only record of what FreshEye did) ------------------------------------------------
export const MAX_LEDGER = 1000

/** Returns a new ledger with `entry` appended; the oldest entries drop off past MAX_LEDGER. */
export function ledgerAppend(ledger, entry) {
  const list = Array.isArray(ledger) ? ledger : []
  return [...list, entry].slice(-MAX_LEDGER)
}

/** The first words of a prompt, one line, for the account (not the whole prompt). */
export function topicOf(prompt, max = 80) {
  const one = String(prompt ?? '').replace(/\s+/g, ' ').trim()
  return one.length > max ? one.slice(0, max - 1) + '…' : one
}

/** HH:MM in the machine's local time. */
export function hhmm(ms) {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** "YYYY-MM-DD HH:MM" in the machine's local time (the account stores UTC ISO times). */
export function localStamp(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso ?? '')
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const VERB = {
  open: 'opened FreshEye', 'open-failed': 'could not open', return: 'returned to original', enter: 'entered FreshEye',
  stale: 'target not found', 'switch-failed': 'switch failed', 'confirm-cancelled': 'stayed (cancelled)',
  'confirm-timeout': 'stayed (no answer)', interrupted: 'earlier open interrupted',
}

/** One readable line per ledger entry, e.g. "2026-10-11 14:32  opened FreshEye  original 27662d61 → fresh a0e4a8b2  "Review the…"" */
export function formatLedgerLine(e) {
  const when = localStamp(e.at)
  const ids = e.fresh || e.origin || e.from || e.to
    ? [e.origin && `original ${short(e.origin)}`, e.fresh && `fresh ${short(e.fresh)}`, !e.origin && e.from && `from ${short(e.from)}`, !e.fresh && e.to && `to ${short(e.to)}`].filter(Boolean).join(' → ')
    : ''
  return [when, VERB[e.event] ?? e.event, ids, e.topic ? `“${e.topic}”` : '', e.reason ? `(${e.reason})` : ''].filter(Boolean).join('  ')
}
