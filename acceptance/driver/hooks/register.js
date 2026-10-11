// fresheye-accept-driver — TEST-ONLY mod for real-session acceptance of cyclops-fresheye. Never shipped.
// It plays the person's part through documented mods APIs only: $.command.run (as a different plugin, so
// cyclops-fresheye's own command hook answers), $.prompt.submit, and read-only probes ($.session.*, $.tool.check).
// No keystrokes, no terminal reading. It never hooks tool.call/tool.check and never touches FreshEye's store.

const CANARY = /[A-Z]+-CANARY-\d+/g
const MARKER = /(?:FRESHONLY|SHOULDNOTSEND|NONINT)-[A-Z0-9]+/g
const uniq = (s) => [...new Set(String(s ?? '').match(CANARY) || [])]
const marks = (s) => [...new Set(String(s ?? '').match(MARKER) || [])]

let dir = null
let plan = null
let i = 0
let waitingTurn = false
let started = false
let logPath = null
const entries = []

async function sid($) { try { return await $.session.id() } catch { return null } }

async function log($, ev, data = {}) {
  const rec = { n: entries.length, t: await $.clock.now(), ev, sid: await sid($), ...data }
  entries.push(rec)
  if (!logPath) logPath = `${dir}/runs/${plan?.run ?? 'unknown'}/driver-${rec.t}.jsonl`
  await $.fs.write(logPath, entries.map((r) => JSON.stringify(r)).join('\n') + '\n')
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function transcriptInfo($) {
  try {
    const cfg = await $.env.get('CLAUDE_CONFIG_DIR')
    const root = await $.session.root()
    const path = `${cfg}/projects/${root.replace(/[^A-Za-z0-9]/g, '-')}/${await sid($)}.jsonl`
    const body = await $.fs.read(path)
    return { path, bytes: body.length, sha256: await sha256(body), canaries: uniq(body), markers: marks(body) }
  } catch (err) { return { error: String(err) } }
}

async function permissionProbe($) {
  const root = await $.session.root()
  const probes = {
    'Bash(git status)': { tool: 'Bash', input: { command: 'git status' } },
    'Bash(rm -rf build)': { tool: 'Bash', input: { command: 'rm -rf build' } },
    'Edit(notes.txt)': { tool: 'Edit', input: { file_path: `${root}/notes.txt`, old_string: 'a', new_string: 'b' } },
    'Bash(curl https://example.com)': { tool: 'Bash', input: { command: 'curl https://example.com' } },
    'Edit(/etc/hosts)': { tool: 'Edit', input: { file_path: '/etc/hosts', old_string: 'a', new_string: 'b' } },
  }
  const out = {}
  for (const [k, v] of Object.entries(probes)) {
    try { out[k] = (await $.tool.check(v)).decision } catch (err) { out[k] = 'error: ' + String(err) }
  }
  return out
}

async function snapshot($, tag) {
  const msgs = await $.session.messages()
  const api = await $.session.messages({ as: 'api' })
  const apiText = JSON.stringify(api)
  await log($, 'snap', {
    tag,
    model: await $.session.model(),
    messageCount: msgs.length,
    messagesSha256: await sha256(msgs.map((m) => m.role + ':' + (m.text || '')).join('\u0000')),
    apiCanaries: uniq(apiText),
    apiMarkers: marks(apiText),
    permissions: await permissionProbe($),
    transcript: await transcriptInfo($),
  })
}

async function waitForSwitch($, from, timeoutMs) {
  const until = (await $.clock.now()) + timeoutMs
  while ((await $.clock.now()) < until) {
    const s = await sid($)
    if (s && s !== from) return s
    await $.clock.sleep(250)
  }
  return null
}

async function advance($) {
  while (plan && i < plan.steps.length) {
    const step = plan.steps[i++]
    await log($, 'step', { index: i - 1, step })
    if (step.do === 'snap') { await snapshot($, step.tag); continue }
    if (step.do === 'sleep') { await $.clock.sleep(step.ms); continue }
    if (step.do === 'done') { await log($, 'done'); await $.fs.write(`${dir}/runs/${plan.run}/DONE`, 'done\n'); return }
    if (step.do === 'submit') { waitingTurn = true; await $.prompt.submit({ text: step.text, asUser: true }); return }
    if (step.do === 'cmd') {
      const from = await sid($)
      if (step.wait === 'turn') waitingTurn = true
      let res
      try { res = await $.command.run({ command: step.command, args: step.args ?? '' }) } catch (err) { res = { error: String(err) } }
      await log($, 'cmd.result', { command: step.command, res })
      if (step.wait === 'turn') return
      if (step.wait === 'switch') { const to = await waitForSwitch($, from, step.timeoutMs ?? 20000); await log($, 'switch.observed', { from, to }) }
      if (typeof step.wait === 'number') await $.clock.sleep(step.wait)
      continue
    }
  }
}

function go($) { $.clock.after(300, () => advance($).catch((err) => log($, 'driver.ERROR', { error: String(err) }))) }

export const register = (on) => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    dir = await $.env.get('FRESHEYE_ACCEPT_DIR')
    plan = JSON.parse(await $.fs.read(`${dir}/plan.json`))
    await log($, 'driver.start', { plan: plan.run, model: await $.session.model() })
    if (plan.startOn === 'start' && !started) { started = true; $.clock.after(plan.startDelayMs ?? 2000, () => advance($).catch((err) => log($, 'driver.ERROR', { error: String(err) }))) }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || !plan) return r
    const last = (await $.session.messages()).at(-1)
    await log($, 'answer', { text: last?.text, canaries: uniq(last?.text), markers: marks(last?.text) })
    if (!started && plan.startOn === 'turn') { started = true; go($); return r }
    if (waitingTurn) { waitingTurn = false; go($) }
    return r
  })
}
