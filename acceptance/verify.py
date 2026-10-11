#!/usr/bin/env python3
"""Re-derive every acceptance gate from raw evidence: driver logs, cyclops-fresheye debug lines, transcripts on disk.
Usage: verify.py <sandbox-dir> > report.json      (exit 1 if any gate fails)"""
import glob, hashlib, json, os, re, sys

X = sys.argv[1]
CAN = re.compile(r"[A-Z]+-CANARY-\d+")
MARK = re.compile(r"(?:FRESHONLY|SHOULDNOTSEND|NONINT)-[A-Z0-9]+")
ALL4 = {"ZEBRA-CANARY-41", "MAGENTA-CANARY-77", "WOMBAT-CANARY-93", "OTTER-CANARY-58"}
PROJ = glob.glob(f"{X}/cfg/projects/*/")[0]


def driver(run):
    files = sorted(glob.glob(f"{X}/runs/{run}/driver-*.jsonl"))
    return [json.loads(l) for f in files for l in open(f)]


def fe_debug(run):
    out = []
    for l in open(f"{X}/runs/{run}/debug.log", errors="replace"):
        m = re.search(r"cyclops-fresheye (open\.\w+|switch\.\w+|confirm\.\w+|stale|session\.start|recovered\.\w+|error)( (\{.*\}))?\s*$", l)
        if m:
            out.append((m.group(1), json.loads(m.group(3)) if m.group(3) else {}))
    return out


def transcript(sid):
    p = f"{PROJ}{sid}.jsonl"
    return open(p, encoding="utf-8").read() if os.path.exists(p) else None


def model_visible_markers(sid):
    """Markers inside rows the model is sent (user/assistant message content). Metadata is counted separately."""
    body = transcript(sid) or ""
    visible, meta = set(), set()
    for l in body.splitlines():
        r = json.loads(l)
        found = set(MARK.findall(l))
        if not found:
            continue
        if r.get("type") in ("user", "assistant") and MARK.search(json.dumps(r.get("message", {}))):
            visible |= set(MARK.findall(json.dumps(r.get("message", {}))))
        else:
            meta |= {f"{m} ({r.get('type')}{'/commandRun' if 'commandRun' in r else ''})" for m in found}
    return sorted(visible), sorted(meta)


gates, facts = {}, {}
def gate(name, ok, detail):
    gates[name] = {"pass": bool(ok), "detail": detail}

# ---------- S1 round trip ----------
s1 = driver("S1-roundtrip")
snaps = {r["tag"]: r for r in s1 if r["ev"] == "snap"}
answers = [r for r in s1 if r["ev"] == "answer"]
origin = snaps["origin-before"]["sid"]
fresh1 = snaps["fresh1"]["sid"]
fresh2 = snaps["fresh2-from-fresh"]["sid"]
facts["S1"] = {"origin": origin, "fresh1": fresh1, "fresh2": fresh2}
fresh_snaps = [snaps[t] for t in ("fresh1", "fresh1-again", "fresh2-from-fresh")]
origin_snaps = [snaps[t] for t in ("origin-before", "origin-back", "origin-after-turn", "origin-final")]
fresh_answers = [a for a in answers if a["sid"] in (fresh1, fresh2)]
origin_answers = [a for a in answers if a["sid"] == origin]

gate("G1 fresh context created (new id, same model)", fresh1 != origin and fresh2 not in (origin, fresh1)
     and len({s["model"] for s in snaps.values()}) == 1, {"origin": origin, "fresh1": fresh1, "fresh2": fresh2, "models": sorted({s["model"] for s in snaps.values()})})
gate("G2 prompt delivered only to FreshEye", "FRESHONLY-K7Q2" in (fresh_answers[0]["markers"] if fresh_answers else [])
     and all("FRESHONLY-K7Q2" not in a["markers"] for a in origin_answers), {"freshAnswer": fresh_answers[0]["text"] if fresh_answers else None})
gate("G3 CLAUDE.md excluded from FreshEye", all("ZEBRA-CANARY-41" not in s["apiCanaries"] for s in fresh_snaps) and all("ZEBRA-CANARY-41" not in a["canaries"] for a in fresh_answers),
     {"freshApiCanaries": [s["apiCanaries"] for s in fresh_snaps]})
gate("G4 auto-memory excluded from FreshEye", all("MAGENTA-CANARY-77" not in s["apiCanaries"] for s in fresh_snaps) and all("MAGENTA-CANARY-77" not in a["canaries"] for a in fresh_answers), {})
gate("G5 Remember-hook context excluded from FreshEye", all(not ({"WOMBAT-CANARY-93", "OTTER-CANARY-58"} & set(s["apiCanaries"])) for s in fresh_snaps)
     and all(not ({"WOMBAT-CANARY-93", "OTTER-CANARY-58"} & set(a["canaries"])) for a in fresh_answers),
     {"freshAnswers": [a["text"] for a in fresh_answers]})

# original restored: same id, full context, transcript append-only across every visit
prefix_ok, chain = True, []
final_body = transcript(origin)
for s in origin_snaps:
    t = s["transcript"]
    # the driver measures in JS string units (UTF-16), so slice the same way
    u16 = final_body.encode("utf-16-le", "surrogatepass") if final_body is not None else b""
    pre = u16[: t["bytes"] * 2].decode("utf-16-le", "surrogatepass")
    ok = final_body is not None and hashlib.sha256(pre.encode("utf-8", "surrogatepass")).hexdigest() == t["sha256"]
    chain.append({"tag": s["tag"], "bytes": t["bytes"], "prefixOfFinal": ok})
    prefix_ok &= ok
gate("G6 original restored with its full context", all(s["sid"] == origin for s in origin_snaps)
     and all(ALL4 <= set(s["apiCanaries"]) for s in origin_snaps) and all(ALL4 <= set(a["canaries"]) for a in origin_answers) and prefix_ok,
     {"transcriptChain": chain, "originAnswers": [a["text"] for a in origin_answers]})
vis, meta = model_visible_markers(origin)
gate("G7 FreshEye prompt never sent to the original", not vis and all(not s["apiMarkers"] for s in origin_snaps),
     {"modelVisibleMarkersInOriginal": vis, "metadataOnly(not sent)": meta})
gate("G11 repeated switching returns to the true original", snaps["origin-final"]["sid"] == origin and snaps["fresh1-again"]["sid"] == fresh1,
     {"sequence": [(r["from"][:8], (r["to"] or "none")[:8]) for r in s1 if r["ev"] == "switch.observed"]})

# ---------- S2 ask (default) ----------
s2 = driver("S2-ask-default")
s2snap = {r["tag"]: r for r in s2 if r["ev"] == "snap"}
s2dbg = fe_debug("S2-ask-default")
s2_origin = next(r["sid"] for r in s2 if r["ev"] == "driver.start")
s2_fresh = s2snap["fresh"]["sid"]
facts["S2"] = {"origin": s2_origin, "fresh": s2_fresh}
refused = [r for r in s2 if r["ev"] == "cmd.result" and "answer the switch question" in json.dumps(r.get("res"))]
gate("G8 ask: timeout/no answer stays; prompt during question refused",
     [e for e, _ in s2dbg if e.startswith("confirm.")] == ["confirm.shown", "confirm.timeout"]
     and s2snap["fresh-after-timeout"]["sid"] == s2_fresh and refused
     and not any("SHOULDNOTSEND" in m for sid in (s2_origin, s2_fresh) for m in model_visible_markers(sid)[0]),
     {"confirmEvents": [e for e, _ in s2dbg if e.startswith("confirm.")], "refusedText": refused[0]["res"]["text"] if refused else None})
gate("G2b typed /fresheye path delivers to FreshEye only", "FRESHONLY-K7Q2" in s2snap["fresh"]["apiMarkers"] and not model_visible_markers(s2_origin)[0],
     {"originMetadataOnly": model_visible_markers(s2_origin)[1]})

# ---------- S3 restart ----------
s3 = driver("S3-restart")
s3snap = {r["tag"]: r for r in s3 if r["ev"] == "snap"}
s3dbg = dict((e, d) for e, d in fe_debug("S3-restart"))
s3ans = [r for r in s3 if r["ev"] == "answer"]
gate("G9 restart: FreshEye stays fresh and returns to its recorded original",
     s3dbg.get("session.start", {}).get("active") is True and s3snap["fresh-after-restart"]["sid"] == s2_fresh
     and not s3snap["fresh-after-restart"]["apiCanaries"] and not s3ans[0]["canaries"] and s3snap["origin-after-restart"]["sid"] == s2_origin,
     {"answerAfterRestart": s3ans[0]["text"], "returnedTo": s3snap["origin-after-restart"]["sid"]})

# ---------- S4 stale ----------
s4 = driver("S4-stale")
s4snap = {r["tag"]: r for r in s4 if r["ev"] == "snap"}
s4dbg = [e for e, _ in fe_debug("S4-stale")]
gate("G10 stale original: reported, nothing switched or deleted", "stale" in s4dbg and s4snap["before"]["sid"] == s4snap["after"]["sid"] == fresh2
     and transcript(origin) is not None, {"debugEvents": s4dbg})

# ---------- S5 non-interactive ----------
out = json.load(open(f"{X}/runs/S5-noninteractive/output.json"))
gate("G15 non-interactive: refused, no model turn, nothing sent", "needs an interactive session" in out["result"] and out["num_turns"] == 0
     and not model_visible_markers(out["session_id"])[0], {"result": out["result"], "num_turns": out["num_turns"]})

# ---------- cross-run ----------
all_snaps = [r for run in ("S1-roundtrip", "S2-ask-default", "S3-restart", "S4-stale") for r in driver(run) if r["ev"] == "snap"]
perms = {json.dumps(s["permissions"], sort_keys=True) for s in all_snaps}
gate("G13 permissions identical everywhere (no escalation)", len(perms) == 1 and "ask" in next(iter(perms)), {"decisions": json.loads(next(iter(perms))) if len(perms) == 1 else sorted(perms)})
ids = {r["sid"] for run in ("S1-roundtrip", "S2-ask-default", "S3-restart", "S4-stale") for r in driver(run) if r.get("sid")}
missing = sorted(i for i in ids if transcript(i) is None)
gate("G12 no transcript deleted", not missing, {"sessionsSeen": len(ids), "missing": missing})
hook_runs = sum(1 for _ in open(f"{X}/repo/.remember-hook-ran")) if os.path.exists(f"{X}/repo/.remember-hook-ran") else 0
gate("G5b Remember hooks still RUN (side effects not disabled)", hook_runs > 0, {"userPromptSubmitHookRuns": hook_runs})

perf = {"session.start ms": [d.get("ms") for run in ("S1-roundtrip", "S2-ask-default", "S3-restart", "S4-stale") for e, d in fe_debug(run) if e == "session.start"],
        "open ms (clear→prompt sent)": [d.get("ms") for run in ("S1-roundtrip", "S2-ask-default") for e, d in fe_debug(run) if e == "open.done"],
        "switch ms (/resume)": [d.get("ms") for run in ("S1-roundtrip", "S3-restart") for e, d in fe_debug(run) if e == "switch.done"]}

report = {"sandbox": X, "facts": facts, "gates": gates, "performance": perf, "allPass": all(g["pass"] for g in gates.values())}
print(json.dumps(report, indent=1))
sys.exit(0 if report["allPass"] else 1)
