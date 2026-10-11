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

## Indicator

When the active conversation is a FreshEye one, the prompt footer shows `◎ FreshEye · Fresh Context`. A short note appears when FreshEye opens and when the original context is restored. Nothing polls or animates: the mod redraws only when its state changes.

## Requirements

- Claude Code with mods (v2.1.287 or later). Built and accepted on **Claude Code 2.1.296**.
- An interactive terminal or the Desktop app's Code tab. In `claude -p`, VS Code and other places with nothing to draw on, FreshEye refuses to open or switch rather than guess.
- The mods API is documented as liable to change between releases. Re-run the acceptance suite after a Claude Code update (see [Testing](docs/TESTING.md)).

## Docs

[Install, configure, uninstall](docs/INSTALL.md) · [Limitations](docs/LIMITATIONS.md) · [Testing and evidence](docs/TESTING.md) · [Changelog](CHANGELOG.md)
