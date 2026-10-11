# Install, configure, roll back

> **Status: awaiting review.** Nothing below has been run on your machine. Global installation waits for your go-ahead.

## 1. Try it for one session (nothing installed)

```bash
claude --plugin-dir /path/to/cyclops-fresheye            # or the packaged zip: --plugin-dir cyclops-fresheye-0.1.0.zip
```

Run `/plugin` and the dim line under the tabs should say `1 mod active · cyclops-fresheye`. Leaving the session unloads it.

## 2. Install (user scope)

The easy way is to run this from the cyclops-fresheye folder:

```bash
./installer.sh                         # options: --mode ask|toggle|off  --timeout 60  --dry-run  --yes
./uninstaller.sh                       # options: --purge-records (forget pairings)  --dry-run  --yes
```

The installer:

- checks Claude Code (2.1.287 or later; it warns if the version isn't the tested 2.1.296);
- validates the mod;
- adds this folder as the `cyclops-fresheye` marketplace (Claude Code reads the folder itself);
- installs `cyclops-fresheye@cyclops-fresheye` for your user.

Running it again refreshes the install and applies new `--mode` / `--timeout` values.

The uninstaller removes the plugin and the marketplace entry. It never touches conversations or this folder, and it keeps the pairing records unless you pass `--purge-records`.

What the scripts run, by hand:

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
