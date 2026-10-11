# Known limitations (0.2.1)

**What FreshEye withholds, and what it doesn't**

1. **Settings hooks still execute.** Their `additionalContext` is withheld from the model in FreshEye conversations, but their side effects (files written, logs, network calls) still happen. FreshEye does not disable memory-related execution. Their output is also still saved as hook records in the FreshEye transcript; withholding happens each time a request is built.
2. **Hook blocking-error notes are not withheld,** on purpose, so the model can see why a safety hook stopped something.
3. **The repository is readable.** If FreshEye's tools permit it, it can read CLAUDE.md, notes and summaries from disk. Use a clean worktree or read-deny rules when that matters.
4. **AGENTS.md** is loaded through the same instruction-file block, so it is withheld with CLAUDE.md. This wasn't separately tested.
5. **Not covered:** subagents started inside a FreshEye conversation, `/compact` inside FreshEye, and nested CLAUDE.md files read during tool use (withheld by rule, not acceptance-tested).

**Where the FreshEye prompt still appears**

6. **The original's transcript file still holds the FreshEye prompt text as metadata.** The `/fresheye` command row the model reads is stored with the prompt withheld. Claude Code also keeps the raw arguments in that row's `commandRun` metadata and, for queued commands, in a `queue-operation` record. Neither is sent to the model (acceptance G7), but a model with file tools could read the transcript file.

**When protection depends on the mod**

7. **Protection needs the mod.** Resuming a FreshEye conversation without the mod loaded, or after its pairing record is lost (store unreadable, or more than 500 pairs ago), gives it the normal context. FreshEye logs a warning when it cannot read its records.
8. **Mods API stability.** Mods are documented as possibly changing between releases. V0 targets Claude Code 2.1.296; re-run `acceptance/suite.sh` after updates.

**Switching**

9. **Interactive only.** `claude -p`, the VS Code panel and other places with nothing to draw on refuse to open or switch (they never guess).
10. **The confirmation band.** It is drawn above the prompt with **Stay here** focused, so Enter stays and **Switch** needs a deliberate move. The acceptance suite proved that a timeout or no answer stays put, and kit tests cover pressing the buttons. A real person pressing **Switch** in a live terminal was not automated, because that would need keystroke injection. The switch itself was proven in real sessions in `toggle` mode.
11. **Opening from a FreshEye conversation** creates a new FreshEye conversation linked to the same true original. The earlier FreshEye conversation stays in `/resume`. Bare `/fresheye` from the original goes to the newest one.
12. **A failed open after `/clear`** (for example, the pairing record can't be saved) leaves you in a new empty conversation. The prompt is not sent, and the message names `/resume <original>` to go back.

**Not tested**

13. **Desktop app Code tab.** Expected to work (same render sites) but only the terminal was accepted. The indicator's look was checked by kit tests, not by reading a live terminal.
14. **Session-granted approvals.** Permission decisions were identical in every conversation, but approvals granted interactively during a session (which need a person to answer prompts) were not exercised across `/clear` and `/resume`.

**Naming**

15. **Glyph.** `◎` was chosen as suggested, but it is also Keeper's text mark. Change `MODE_LABEL` in `hooks/core.js` if the two need to stay distinct.
16. **The account stores the first 80 characters of each FreshEye prompt, as plain text,** in FreshEye's store file. It is never sent to the model, but a model with file tools could read it. `./uninstaller.sh --purge-records` removes it.
17. **The strip was checked by kit tests and drawn in real terminal sessions,** with no validation errors in the debug log. Its exact look in your terminal, and next to Spark, is best judged live.
