# Install, configure, roll back

> **Status: awaiting review.** Nothing below has been run on your machine. Global installation waits for your go-ahead.

## 1. Try it for one session (nothing installed)

```bash
claude --plugin-dir /path/to/cyclops-fresheye            # or the packaged zip: --plugin-dir cyclops-fresheye-0.1.0.zip
```

Run `/plugin` and the dim line under the tabs should say `1 mod active · cyclops-fresheye`. Leaving the session unloads it.

## 2. Install (user scope)

From a local folder (it reads the folder you keep):

```bash
claude plugin marketplace add /path/to/cyclops-fresheye
claude plugin install cyclops-fresheye@cyclops-fresheye
```

From GitHub, once the repository is published (inside a Claude Code session):

```
/plugin install cyclops-fresheye --marketplace CyclopsEyeTeam/cyclops-fresheye
```

If a session is already open, run `/reload-plugins` there.

## 3. Configure

```bash
claude plugin configure cyclops-fresheye@cyclops-fresheye      # shows options
```

You can also use `/config` in a session, or add this to `~/.claude/settings.json`:

```json
{ "pluginConfigs": { "cyclops-fresheye@cyclops-fresheye": { "options": { "switchMode": "ask", "confirmTimeoutSeconds": 60 } } } }
```

## 4. Roll back / uninstall

| Goal | Command |
| --- | --- |
| Turn it off, keep it installed | `claude plugin disable cyclops-fresheye@cyclops-fresheye` (or `/plugin` → Installed) |
| Remove it | `claude plugin uninstall cyclops-fresheye@cyclops-fresheye`, then `claude plugin marketplace remove cyclops-fresheye` |
| One session without any mods | `claude --safe-mode` |
| Emergency: stop every installed mod | `"disableAllHooks": true` in `~/.claude/settings.json` (this also stops your settings hooks) |

What stays after uninstalling:

- **Conversations.** Every FreshEye and original conversation is an ordinary Claude Code conversation and stays in `/resume`. Nothing is deleted. Without the mod, a resumed FreshEye conversation is no longer protected and gets the normal context.
- **FreshEye's pairing records.** These live in `~/.claude/plugins/store/cyclops-fresheye*.json` (`pairs`: FreshEye id → original id). Deleting that file only forgets the pairings; it does not touch any conversation.

Restoring the previous version means reinstalling the earlier tag (`git checkout v0.1.0`, then the commands above).
