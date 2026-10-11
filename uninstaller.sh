#!/usr/bin/env bash
# Cyclops FreshEye — uninstaller
#
# Removes the cyclops-fresheye mod the supported way:
#   claude plugin uninstall cyclops-fresheye@cyclops-fresheye
#   claude plugin marketplace remove cyclops-fresheye
#
# Never touches conversations: every FreshEye and original conversation stays in /resume.
# Keeps this folder and FreshEye's pairing records unless you pass --purge-records.
#
# Usage: ./uninstaller.sh [--purge-records] [--dry-run] [--yes]
set -euo pipefail

PLUGIN=cyclops-fresheye
MARKET=cyclops-fresheye
ID="$PLUGIN@$MARKET"
PURGE=0 DRY=0 YES=0

say()  { printf '\033[1;36m◎ FreshEye\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m! \033[0m%s\n' "$*" >&2; }
die()  { printf '\033[1;31m✘ \033[0m%s\n' "$*" >&2; exit 1; }
run()  { if [ "$DRY" = 1 ]; then printf '  [dry-run] %s\n' "$*"; else "$@"; fi; }
usage(){ sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --purge-records) PURGE=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -y|--yes)  YES=1; shift ;;
    -h|--help) usage 0 ;;
    *) warn "unknown option: $1"; usage 1 ;;
  esac
done

command -v claude >/dev/null 2>&1 || die "Claude Code ('claude') is not on your PATH."
command -v python3 >/dev/null 2>&1 || die "python3 is needed to read JSON."

has() { python3 - "$1" "$2" <<'PY'
import json, sys
try: d = json.loads(sys.argv[1])
except Exception: sys.exit(1)
key = sys.argv[2]
items = d if isinstance(d, list) else d.get("marketplaces") or d.get("plugins") or d.get("installed") or []
for it in items if isinstance(items, list) else []:
    if isinstance(it, dict) and key in (it.get("name"), it.get("id"), f'{it.get("name")}@{it.get("marketplace")}'):
        sys.exit(0)
sys.exit(1)
PY
}

if has "$(claude plugin list --json 2>/dev/null || echo '[]')" "$ID"; then
  say "uninstalling $ID"
  run claude plugin uninstall "$ID" --scope user
else
  say "$ID is not installed (user scope) — skipping"
fi

if has "$(claude plugin marketplace list --json 2>/dev/null || echo '[]')" "$MARKET"; then
  say "removing marketplace '$MARKET' (your folder itself is kept)"
  run claude plugin marketplace remove "$MARKET"
else
  say "marketplace '$MARKET' not added — skipping"
fi

# FreshEye's pairing records (FreshEye id → original id). Conversations are never touched.
CFGDIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
shopt -s nullglob
RECORDS=("$CFGDIR"/plugins/store/cyclops-fresheye*.json)
if [ ${#RECORDS[@]} -gt 0 ]; then
  if [ "$PURGE" = 1 ]; then
    if [ "$YES" != 1 ] && [ "$DRY" != 1 ]; then
      printf '%s\n' "${RECORDS[@]}"
      read -r -p "Delete these FreshEye pairing records? Conversations are not affected. [y/N] " a
      [[ "$a" =~ ^[Yy] ]] || { say "records kept"; RECORDS=(); }
    fi
    for f in ${RECORDS[@]+"${RECORDS[@]}"}; do run rm -f -- "$f"; done
    [ ${#RECORDS[@]} -gt 0 ] && say "pairing records removed"
  else
    say "pairing records kept (${#RECORDS[@]} file(s) in $CFGDIR/plugins/store) — reinstalling picks them up; --purge-records removes them"
  fi
fi

cat <<EOF

  Done. In a Claude Code session that is still open, run:  /reload-plugins
  Your conversations are all still in /resume. Note: a FreshEye conversation resumed without the mod
  gets the normal context (CLAUDE.md, memory, hooks) again.
  Reinstall any time with:  ./installer.sh
EOF
