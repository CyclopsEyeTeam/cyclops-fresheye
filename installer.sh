#!/usr/bin/env bash
# Cyclops FreshEye — installer
#
# Installs the cyclops-fresheye mod for your user from THIS folder, the supported way:
#   claude plugin marketplace add <this folder>   (Claude Code reads the folder you keep; no copy)
#   claude plugin install cyclops-fresheye@cyclops-fresheye --scope user
#
# Touches nothing else: no settings edits by hand, no other plugins, no conversations.
#
# Usage: ./installer.sh [--mode ask|toggle|off] [--timeout SECONDS] [--dry-run] [--yes]
set -euo pipefail

PLUGIN=cyclops-fresheye
MARKET=cyclops-fresheye
ID="$PLUGIN@$MARKET"
MIN_VERSION=2.1.287      # first Claude Code release with mods on by default
TESTED_VERSION=2.1.296   # version FreshEye V0 was accepted on

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="" TIMEOUT="" DRY=0 YES=0

say()  { printf '\033[1;36m◎ FreshEye\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m! \033[0m%s\n' "$*" >&2; }
die()  { printf '\033[1;31m✘ \033[0m%s\n' "$*" >&2; exit 1; }
run()  { if [ "$DRY" = 1 ]; then printf '  [dry-run] %s\n' "$*"; else "$@"; fi; }
usage(){ sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --mode)    MODE="${2:-}"; shift 2 ;;
    --timeout) TIMEOUT="${2:-}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -y|--yes)  YES=1; shift ;;
    -h|--help) usage 0 ;;
    *) warn "unknown option: $1"; usage 1 ;;
  esac
done

case "$MODE" in ""|ask|toggle|off) ;; *) die "--mode must be ask, toggle or off" ;; esac
if [ -n "$TIMEOUT" ] && ! [[ "$TIMEOUT" =~ ^[0-9]+$ && "$TIMEOUT" -ge 5 && "$TIMEOUT" -le 600 ]]; then
  die "--timeout must be a whole number of seconds from 5 to 600"
fi

# ---- 1. preflight -----------------------------------------------------------------------------------
command -v claude >/dev/null 2>&1 || die "Claude Code ('claude') is not on your PATH."
command -v python3 >/dev/null 2>&1 || die "python3 is needed to read JSON (it is on almost every Linux)."

[ -f "$DIR/.claude-plugin/plugin.json" ] && [ -f "$DIR/hooks/register.js" ] \
  || die "Run this from the cyclops-fresheye folder (no .claude-plugin/plugin.json + hooks/register.js next to it)."
NAME=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["name"])' "$DIR/.claude-plugin/plugin.json")
VERSION=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("version","?"))' "$DIR/.claude-plugin/plugin.json")
[ "$NAME" = "$PLUGIN" ] || die "This folder holds plugin '$NAME', not '$PLUGIN'."

CC_VERSION=$(claude --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)
[ -n "$CC_VERSION" ] || die "Could not read the Claude Code version."
older() { [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" = "$1" ] && [ "$1" != "$2" ]; }
older "$CC_VERSION" "$MIN_VERSION" && die "Claude Code $CC_VERSION has no mods. Update to $MIN_VERSION or later (claude update)."
[ "$CC_VERSION" != "$TESTED_VERSION" ] && warn "Claude Code $CC_VERSION — FreshEye was accepted on $TESTED_VERSION. The mods API can change between releases; re-run acceptance/suite.sh if anything looks off."

say "installing $PLUGIN $VERSION from $DIR (Claude Code $CC_VERSION)"

# The marketplace file makes this folder installable. The packaged zip doesn't carry one, so write it if missing.
if [ ! -f "$DIR/.claude-plugin/marketplace.json" ]; then
  say "adding .claude-plugin/marketplace.json (lists this folder as the '$MARKET' marketplace)"
  [ "$DRY" = 1 ] || cat > "$DIR/.claude-plugin/marketplace.json" <<EOF
{
  "name": "$MARKET",
  "owner": { "name": "Cyclops Eye Team" },
  "plugins": [{ "name": "$PLUGIN", "source": "./" }]
}
EOF
fi

say "validating"
if [ "$DRY" = 1 ]; then printf '  [dry-run] claude plugin validate %s\n' "$DIR"
else
  OUT=$(claude plugin validate "$DIR" 2>&1) || { printf '%s\n' "$OUT" >&2; die "validation failed — nothing was installed."; }
  printf '%s\n' "$OUT" | grep -E '✔|✘' || true
fi

# ---- 2. marketplace (this folder) -------------------------------------------------------------------
json_has() { python3 - "$1" "$2" <<'PY'
import json, sys
data, key = sys.argv[1], sys.argv[2]
try: d = json.loads(data)
except Exception: sys.exit(1)
items = d if isinstance(d, list) else d.get("marketplaces") or d.get("plugins") or d.get("installed") or []
for it in items if isinstance(items, list) else []:
    if isinstance(it, dict) and key in (it.get("name"), it.get("id"), f'{it.get("name")}@{it.get("marketplace")}'):
        print(json.dumps(it)); sys.exit(0)
sys.exit(1)
PY
}

MKT_JSON=$(claude plugin marketplace list --json 2>/dev/null || echo '[]')
if MKT=$(json_has "$MKT_JSON" "$MARKET"); then
  SRC=$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(d.get("path") or d.get("source",{}).get("path") or d.get("installLocation") or "")' "$MKT" 2>/dev/null || true)
  if [ -n "$SRC" ] && [ "$(cd "$SRC" 2>/dev/null && pwd || echo "$SRC")" != "$DIR" ]; then
    warn "a marketplace named '$MARKET' already points at: $SRC"
    if [ "$YES" != 1 ]; then
      read -r -p "Point it at $DIR instead? [y/N] " a; [[ "$a" =~ ^[Yy] ]] || die "left as it was — nothing changed."
    fi
    run claude plugin marketplace remove "$MARKET"
    run claude plugin marketplace add "$DIR"
  else
    say "marketplace '$MARKET' already added"
  fi
else
  say "adding this folder as marketplace '$MARKET'"
  run claude plugin marketplace add "$DIR"
fi

# ---- 3. install (or refresh) -------------------------------------------------------------------------
CFG=()
[ -n "$MODE" ] && CFG+=(--config "switchMode=$MODE")
[ -n "$TIMEOUT" ] && CFG+=(--config "confirmTimeoutSeconds=$TIMEOUT")

LIST_JSON=$(claude plugin list --json 2>/dev/null || echo '[]')
if json_has "$LIST_JSON" "$ID" >/dev/null; then
  say "already installed — refreshing from the folder"
  run claude plugin update "$ID" --scope user || warn "update reported a problem (often just 'already up to date')."
  if [ ${#CFG[@]} -gt 0 ]; then
    VALUES=$(python3 -c 'import json,sys; v={}
m,t=sys.argv[1],sys.argv[2]
if m: v["switchMode"]=m
if t: v["confirmTimeoutSeconds"]=t
print(json.dumps(v))' "$MODE" "$TIMEOUT")
    if [ "$DRY" = 1 ]; then printf '  [dry-run] echo %s | claude plugin configure %s --values-stdin\n' "$VALUES" "$ID"
    else printf '%s' "$VALUES" | claude plugin configure "$ID" --values-stdin; fi
  fi
else
  say "installing $ID (user scope)"
  run claude plugin install "$ID" --scope user ${CFG[@]+"${CFG[@]}"}
fi

# ---- 4. done ----------------------------------------------------------------------------------------
if [ "$DRY" = 0 ]; then
  claude plugin list --json 2>/dev/null | python3 -c '
import json, sys
d = json.load(sys.stdin); items = d if isinstance(d, list) else d.get("plugins", [])
ok = [i for i in items if isinstance(i, dict) and str(i.get("id", i.get("name", ""))).startswith("cyclops-fresheye")]
sys.exit(0 if ok else 1)' && say "installed ✔" || warn "could not confirm the install in 'claude plugin list' — check it with: claude plugin list"
fi

cat <<EOF

  Next:
    • New Claude Code sessions load it automatically. In a session that is already open, run:  /reload-plugins
    • Check:   /plugin   →  the line under the tabs should name cyclops-fresheye
    • Use:     /fresheye "your question"     then   /fresheye   to offer the way back (asks first)
    • Settings: /config, or  ./installer.sh --mode ask|toggle|off --timeout 60
    • Remove:  ./uninstaller.sh
  Edits to this folder take effect after /reload-plugins — keep the folder where it is.
EOF
