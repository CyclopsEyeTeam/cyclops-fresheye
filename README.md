# Cyclops FreshEye

`◎ FreshEye · Fresh Context`: open a fresh active context in the same Claude Code terminal, and come back to the untouched original when you choose.

FreshEye is a context tool. It is not a new identity or a different model. The entity keeps its continuity, FreshEye gives it a temporary active context, and the library stays available without always being attached.

```
/fresheye "Review src/parser.ts as if you had never seen this project."
/fresheye
```

- **`/fresheye "prompt"`** records the current conversation as the original, starts a new conversation with Claude Code's own `/clear`, then sends your prompt there as your message. It uses the same provider and model.
- **`/fresheye`** (no prompt) offers to switch between the FreshEye conversation and its recorded original, using Claude Code's own `/resume`. By default it asks first.

## What a FreshEye conversation leaves out

| Withheld in FreshEye | Kept |
| --- | --- |
| The CLAUDE.md / instruction-file context block (includes the auto-memory index) | Your permissions, permission mode and safety settings: unchanged, never intercepted |
| The auto-memory section of the system prompt | The model and provider |
| `additionalContext` from settings hooks, e.g. Remember-style SessionStart / UserPromptSubmit hooks | Hook blocking-error notes (they explain safety stops) |
| Instruction/memory attachments (nested CLAUDE.md, memory files) | Everything else Claude Code normally provides |

**Settings hooks still run.** FreshEye withholds what they add to the context, but their side effects still happen. A hook that writes a summary file still writes it, and a hook that logs still logs.

**FreshEye can still read the repository** when its tools allow it. Notes or summaries kept in the working tree are visible to it. For a clean review, run it from a clean worktree (`claude -w`) or add read-deny rules for those paths.

The original conversation is never deleted or rewritten. Returning to it restores its full context: CLAUDE.md, memory, hooks and history. The FreshEye prompt is never sent to the original's model (see [Limitations](docs/LIMITATIONS.md) for what Claude Code still records as metadata).

## Settings

| Option | Values | Default |
| --- | --- | --- |
| `switchMode` | `ask`: show "switch conversations?" with **Stay here** (focused) and **Switch**; anything but Switch stays. `toggle`: switch at once. `off`: never switch, only show where the other conversation is | `ask` |
| `confirmTimeoutSeconds` | 5–600. With no answer by then, FreshEye stays where it is | 60 |

Set them in `/config`, with `/plugin configure cyclops-fresheye@cyclops-fresheye`, or under `pluginConfigs` in `~/.claude/settings.json`.

## On screen

While a FreshEye conversation is active, a small strip sits above the prompt:

```
◎ FreshEye · Fresh Context  · opened 14:32 · original 27662d61 kept
withheld: CLAUDE.md · memory · hook context   ·   /fresheye to switch back
```

- **The footer** also shows the same `◎ FreshEye · Fresh Context` label.
- **When you return**, a line reads `◎ Original context restored · … · FreshEye … kept in /resume` for 8 seconds, then clears itself.
- **Other mods drawing above the prompt** (Spark, for example) stay in place. FreshEye's strip is placed alongside them.
- **No polling or animation.** It redraws only when its state changes.

## Account

FreshEye records what it does: each open, switch, return, cancelled or timed-out question, stale reference and failure. Each entry has a time, both conversation ids and, for an open, the first 80 characters of the prompt. Run **`/fresheye-log [count]`** to see the last entries as dim lines that Claude does not read. The account lives in FreshEye's store (`~/.claude/plugins/store/cyclops-fresheye*.json`, key `ledger`), keeps the newest 1,000 entries, and survives reinstalling.

## Requirements

- Claude Code with mods (v2.1.287 or later). Built and accepted on **Claude Code 2.1.296**.
- An interactive terminal or the Desktop app's Code tab. In `claude -p`, VS Code and other places with nothing to draw on, FreshEye refuses to open or switch rather than guess.
- The mods API is documented as liable to change between releases. Re-run the acceptance suite after a Claude Code update (see [Testing](docs/TESTING.md)).

## Docs

`./installer.sh` / `./uninstaller.sh` · [Install, configure, uninstall](docs/INSTALL.md) · [Limitations](docs/LIMITATIONS.md) · [Testing and evidence](docs/TESTING.md) · [Changelog](CHANGELOG.md)
