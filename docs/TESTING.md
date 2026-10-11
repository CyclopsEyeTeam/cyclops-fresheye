# Testing and evidence

Two layers. Only the second proves native session switching.

## 1. Unit and kit tests (synthetic)

```bash
claude plugin test            # from the repo root: 26 tests
```

- `tests/core.test.ts` covers pure decisions: argument parsing, target choice (never guesses), the pair table and the withholding rules.
- `tests/mod.test.ts` drives the mod's hooks through the `claude-code/testing` kit, with stubs standing in for Claude Code:
  - opening with `/clear`;
  - refusals: a failed `/clear` sends nothing, no surface, no pair;
  - the confirm band: Stay, Switch, timeout, a timeout scoped to its own question, no drawable surface;
  - `toggle` and `off` modes;
  - stale references and recovery from an interrupted open;
  - the double-invocation race and store failure;
  - the footer indicator.

These prove the mod's logic, not Claude Code's behaviour.

## 2. Real-session acceptance (actual Claude Code sessions)

```bash
acceptance/suite.sh /tmp/fresheye-sandbox      # ~2 minutes, ~12 small model turns (Haiku)
```

**How it is set up**

- `sandbox.sh` creates a disposable `HOME`, a `CLAUDE_CONFIG_DIR` and a git repo. It plants four canaries:
  - `ZEBRA` in CLAUDE.md;
  - `MAGENTA` in auto memory;
  - `WOMBAT` in a SessionStart hook;
  - `OTTER` in a UserPromptSubmit hook, which also writes a file, to show side effects still run.
- Permission fixtures: an allow rule for `git status`, and the session runs in `acceptEdits` mode.
- `run.sh` starts real interactive `claude` sessions in a pseudo-terminal. Nothing is ever written to its input (no keystrokes), and nothing reads the screen. The only outside input is Claude Code's documented initial-prompt argument.
- `cyclops-fresheye` and a **test-only driver mod** (`acceptance/driver/`, never shipped) are loaded with `--plugin-dir`.
- The driver plays your part through documented APIs: `$.command.run('fresheye', …)`, which runs FreshEye's real command hook, and `$.prompt.submit`. It records read-only probes: session id, model, the messages exactly as sent to the API, `$.tool.check` decisions, and transcript size and hash.
- `verify.py` re-derives every gate from the raw driver logs, FreshEye's debug lines and the transcripts on disk.

**Scenarios**

| Scenario | What happens |
| --- | --- |
| S1 round trip (`toggle`) | Original → `/fresheye "…"` → back to the original (answers again) → into FreshEye again → `/fresheye "…"` *from* FreshEye → back to the true original |
| S2 ask (default) | `/fresheye "…"` given as the session's initial prompt. Bare `/fresheye` shows the question; nobody answers; it times out and stays. A `/fresheye "…"` while the question is open is refused |
| S3 restart | A new process resumes S2's FreshEye conversation (still fresh), then returns to its recorded original |
| S4 stale | S1's original transcript is moved aside, not deleted. Bare `/fresheye` reports it and stays. The file is put back |
| S5 non-interactive | `claude -p '/fresheye "…"'` is refused with no model turn |

**Gates**: all 16 pass on the release commit. See `evidence/v0-acceptance/report.json`.

- G1 the fresh context is created on the same model;
- G2 / G2b the prompt is delivered only to FreshEye;
- G3, G4, G5 CLAUDE.md, auto memory and Remember context are withheld;
- G5b hooks still run;
- G6 the original is restored with its full context, and its transcript is append-only across every visit;
- G7 the FreshEye prompt is never sent to the original's model;
- G8 confirm-first holds: timeout or no answer stays, and a prompt is refused while the question is open;
- G9 restart;
- G10 stale reference;
- G11 repeated switching;
- G12 no transcript deleted;
- G13 identical permission decisions everywhere;
- G15 non-interactive refusal.

**Performance**, measured in the suite on Claude Code 2.1.296:

| What | Time |
| --- | --- |
| `session.start` hook's own work | 14–76 ms |
| Open (`/clear` → prompt sent) | 0.30–0.53 s |
| Switch (`/resume`) | 0.12–0.29 s |

**Idle cost.** The mod makes no `$.clock.every` calls, no model calls and no background processes (see the `calls:` line in `evidence/v0-acceptance/plugin-validate.txt`). The only timers are one-shot: deferring the command's work by 0 ms, a 400 ms indicator refresh after a conversation change, and the confirmation timeout. Render hooks return immediately unless FreshEye is active or a question is open.

## Evidence

- `evidence/spike-2026-10-11/` is the capability spike that this V0 builds on. It is preserved read-only and has its own SHA256SUMS.
- `evidence/v0-acceptance/` holds the final suite: `report.json`, driver logs, FreshEye debug lines, every transcript, the Remember hook's side-effect file, the store after the suite, unit/kit output and validate output.
