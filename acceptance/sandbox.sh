#!/bin/bash
# Create a disposable acceptance sandbox: own HOME, CLAUDE_CONFIG_DIR, git repo with canaries. Never touches ~/.claude.
# Usage: sandbox.sh <dir>
set -eu
X=$1; rm -rf "$X"; mkdir -p "$X"/{home,cfg,repo/.claude,runs}
P=$(echo "$X/repo" | sed 's/[^A-Za-z0-9]/-/g')
mkdir -p "$X/cfg/projects/$P/memory"
cat > "$X/repo/CLAUDE.md" <<'M'
# Acceptance project
Project codename: ZEBRA-CANARY-41. (CLAUDE.md canary.)
M
echo "- The user's favourite test colour is MAGENTA-CANARY-77. (Auto-memory canary.)" > "$X/cfg/projects/$P/memory/MEMORY.md"
echo "a" > "$X/repo/notes.txt"
cat > "$X/repo/.claude/settings.json" <<'M'
{
  "permissions": { "allow": ["Bash(git status)"] },
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "echo '{\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":\"Remember hook: implementer summary key is WOMBAT-CANARY-93.\"}}'" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "echo '{\"hookSpecificOutput\":{\"hookEventName\":\"UserPromptSubmit\",\"additionalContext\":\"Remember hook (per prompt): handoff note key is OTTER-CANARY-58.\"}}' ; echo ran >> \"$CLAUDE_PROJECT_DIR/.remember-hook-ran\"" }] }]
  }
}
M
(cd "$X/repo" && git init -q && echo ".remember-hook-ran" > .gitignore && git add -A && git -c user.email=t@t -c user.name=t commit -qm fixtures)
python3 - "$X" <<'PY'
import json, sys
x = sys.argv[1]
json.dump({"hasCompletedOnboarding": True, "projects": {f"{x}/repo": {"hasTrustDialogAccepted": True}}}, open(f"{x}/cfg/.claude.json", "w"), indent=2)
PY
echo "sandbox ready: $X"
