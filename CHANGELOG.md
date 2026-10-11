# Changelog

## 0.2.0 — 2026-10-11

- **On-screen strip above the prompt** while FreshEye is active: `◎ FreshEye · Fresh Context`, when it opened, which original it keeps, and what is withheld. It draws alongside other mods' bands, such as Spark's, instead of replacing them.
- **"Original context restored" line** for 8 seconds after returning.
- **Account (ledger)** of every open, switch, return, question outcome, stale reference and failure, with times and both conversation ids. **`/fresheye-log [count]`** shows it as dim lines that are never sent to the model.
- The confirmation band also draws alongside other mods' bands now.
- **Acceptance:** 32 unit/kit tests, plus 17/17 real-session gates (new G16: the account matches every event in order). Accepted on Claude Code 2.1.296.

## 0.1.0 — 2026-10-11 (proposed)

First release of CyclopsFreshEye V0 as a Claude Code mod. Accepted on Claude Code 2.1.296.

**Commands**

- `/fresheye "prompt"`:
  - records the original conversation and opens a FreshEye conversation through the built-in `/clear`, on the same model;
  - sends the prompt there, and only after the new conversation is confirmed;
  - sends nothing if anything fails.
- `/fresheye` (no prompt) offers to switch between FreshEye and its recorded original through the built-in `/resume`:
  - `ask` (default): confirm first, with **Stay here** focused; a timeout or no answer stays put;
  - `toggle`: switch at once;
  - `off`: never switch.

**What FreshEye withholds** (in FreshEye conversations only)

- the CLAUDE.md / instruction-file block (including the auto-memory index);
- the auto-memory section of the system prompt;
- settings-hook `additionalContext`;
- instruction/memory attachments.

**Original conversation**

- The `/fresheye` command row in the original is stored with its prompt withheld.

**Interface**

- Footer indicator `◎ FreshEye · Fresh Context`, plus notes when FreshEye opens and when the original is restored.

**Recovery**

- Pairings live in the plugin store, so they survive restarts.
- Stale references are reported, not guessed.
- An interrupted open is reported on the next start.
- Double invocation is refused.
- Store failures fail closed.
