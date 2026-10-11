#!/bin/bash
# Full real-session acceptance suite for cyclops-fresheye in a brand-new disposable sandbox.
# Usage: suite.sh <sandbox-dir>      → writes <sandbox>/report.json; exit 0 only if every gate passes.
set -u
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(dirname "$HERE"); X=$1
"$HERE/sandbox.sh" "$X"
Q=$(cat "$HERE/plans/Q.txt"); FP1=$(cat "$HERE/plans/FP1.txt")
first_sid() { python3 -c "import json,glob,sys; rs=[json.loads(l) for f in sorted(glob.glob(sys.argv[1]+'/driver-*.jsonl')) for l in open(f)]; print(next(r['sid'] for r in rs if r['ev']=='snap' and r['tag']==sys.argv[2]))" "$1" "$2"; }

"$HERE/run.sh" "$X" S1-roundtrip toggle 60 "$Q"
"$HERE/run.sh" "$X" S2-ask-default ask 10 "/fresheye \"$FP1\""
S2_FRESH=$(first_sid "$X/runs/S2-ask-default" fresh)
"$HERE/run.sh" "$X" S3-restart toggle 60 "$Q" --resume "$S2_FRESH"
# S4: move S1's original transcript ASIDE (never deleted) to make its reference stale, then put it back.
PD=$(ls -d "$X"/cfg/projects/*/); S1_ORIG=$(first_sid "$X/runs/S1-roundtrip" origin-before); S1_F2=$(first_sid "$X/runs/S1-roundtrip" fresh2-from-fresh)
mkdir -p "$X/aside"; mv "$PD$S1_ORIG.jsonl" "$X/aside/"
"$HERE/run.sh" "$X" S4-stale toggle 60 "" --resume "$S1_F2"
mv "$X/aside/$S1_ORIG.jsonl" "$PD"
# S5: non-interactive refusal
mkdir -p "$X/runs/S5-noninteractive"
(cd "$X/repo" && "$HERE/env.sh" "$X" claude -p --model haiku --plugin-dir "$REPO" --output-format json '/fresheye "NONINT-SECRET55 do not send"' < /dev/null > "$X/runs/S5-noninteractive/output.json" 2> "$X/runs/S5-noninteractive/stderr.txt")
python3 "$HERE/verify.py" "$X" > "$X/report.json"; RC=$?
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); [print(('PASS' if v['pass'] else 'FAIL'), k) for k,v in d['gates'].items()]; print('performance', d['performance']); print('ALL PASS' if d['allPass'] else 'SOME GATES FAILED')" "$X/report.json"
exit $RC
