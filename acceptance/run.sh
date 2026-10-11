#!/bin/bash
# Real-session acceptance run. Usage: run.sh <sandbox> <plan-name> <switchMode> <timeoutSec> <initial-prompt> [extra claude args...]
#  - real interactive TTY via `script`; stdin held open, NOTHING is ever written to it (no keystrokes)
#  - the only outside input is Claude Code's documented initial-prompt argument
#  - cyclops-fresheye and the test-only driver are loaded with --plugin-dir; nothing is installed
set -u
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(dirname "$HERE")
X=$1; PLAN=$2; MODE=$3; TMO=$4; INIT=$5; shift 5
OUT="$X/runs/$PLAN"; mkdir -p "$OUT"; rm -f "$OUT/DONE"
python3 - "$X" "$HERE/plans/$PLAN.json" "$MODE" "$TMO" <<'PY'
import json, sys
x, plan, mode, tmo = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
json.dump(json.load(open(plan)), open(f"{x}/plan.json", "w"))
cfg = {"pluginConfigs": {k: {"options": {"switchMode": mode, "confirmTimeoutSeconds": tmo}} for k in ("cyclops-fresheye", "cyclops-fresheye@inline")}}
json.dump(cfg, open(f"{x}/cfg/settings.json", "w"), indent=2)
PY
CMD=( claude --model haiku --permission-mode acceptEdits --tools Bash,Edit --plugin-dir "$REPO" --plugin-dir "$HERE/driver" --debug-file "$OUT/debug.log" "$@" )
[ -n "$INIT" ] && CMD+=( "$INIT" )
printf -v Q '%q ' "${CMD[@]}"
T0=$(date +%s%3N)
cd "$X/repo"
( sleep 900 | timeout 400 script -q -f -c "$HERE/env.sh $X $Q" "$OUT/pty.raw" > /dev/null 2>&1 ) > /dev/null 2>&1 < /dev/null &
for n in $(seq 1 75); do sleep 5; [ -f "$OUT/DONE" ] && break; done
sleep 3
ps -eo pid,args | grep -F -- "--debug-file $OUT/debug.log" | grep -v grep | awk '{print $1}' | xargs -r kill 2>/dev/null
sleep 2
ps -eo pid,args | grep -E "^ *[0-9]+ sleep 900$" | awk '{print $1}' | xargs -r kill 2>/dev/null
echo "{\"plan\":\"$PLAN\",\"mode\":\"$MODE\",\"wallMs\":$(( $(date +%s%3N) - T0 )),\"done\":$([ -f "$OUT/DONE" ] && echo true || echo false)}" > "$OUT/run.json"
grep -a "cyclops-fresheye" "$OUT/debug.log" > "$OUT/fresheye-debug.log" 2>/dev/null
cat "$OUT/run.json"
