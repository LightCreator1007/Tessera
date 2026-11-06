"""Output without a screen: NDJSON for pipes and agents (no TTY or --plain), or one text summary with --once.

Words and glyphs carry every state, so this loses nothing but layout. One JSON object per line, newest state.
"""
from __future__ import annotations

import asyncio
import json
import sys
import time

from .model import Snapshot


def summary(s: Snapshot) -> dict:
    n, r = s.node, s.round
    return {
        "ts": round(time.time(), 1), "mode": s.mode, "network": s.network, "chainId": s.chain_id, "block": s.block,
        "sources": {k: {"state": v.state, "ageSeconds": round(v.age, 1)} for k, v in s.sources.items()},
        "problems": [{"code": p.code, "message": p.message, "hint": p.command} for p in s.problems],
        "node": None if n is None else {
            "operator": n.op, "state": n.state, "job": n.job, "round": n.round, "segment": n.segment,
            "segments": n.segments, "committed": n.committed, "revealed": n.revealed, "earned24h": n.earned,
            "health": {h.key: h.status for h in n.health}},
        "round": None if r is None else {
            "job": r.job, "round": r.round, "status": r.status, "secondsLeft": r.rail.secs_left,
            "settled": r.settlement.done, "outcome": r.settlement.outcome or None,
            "signed": r.settlement.signed, "threshold": r.settlement.threshold,
            "roster": [{"op": x.op, "shard": x.shard, "state": x.state, "verdicts": [v.state for v in x.verdicts],
                        "outcome": x.outcome or None} for x in r.roster]},
        "pool": {st: sum(1 for p in s.pool if p.state == st) for st in sorted({p.state for p in s.pool})},
    }


def text(s: Snapshot) -> str:
    d = summary(s)
    lines = [f"tod-tui · {s.network} · {s.mode} · block {s.block or '?'}"]
    lines.append("sources   " + "  ".join(f"{k} {v['state']}" for k, v in d["sources"].items()))
    for p in d["problems"]:
        lines.append(f"!         {p['code']}: {p['message']}  ({p['hint']})")
    if d["node"]:
        n = d["node"]
        lines.append(f"node      {n['operator']} · {n['state']} · job {n['job']} round {n['round']}")
    if d["round"]:
        r = d["round"]
        lines.append(f"round     job {r['job']} round {r['round']} · {r['status']} · {r['signed']}/{r['threshold']} signed")
        for x in r["roster"]:
            lines.append(f"          {x['op']}  shard {x['shard']}  {x['state']:<10} {' '.join(x['verdicts'])}  {x['outcome'] or ''}")
    lines.append("pool      " + ("  ".join(f"{k} {v}" for k, v in d["pool"].items()) or "no nodes registered"))
    return "\n".join(lines)


async def stream(source, once: bool, every: float = 2.0) -> None:
    task = asyncio.create_task(source.run()) if hasattr(source, "run") else None
    try:
        if task:
            # Wait for each source to answer or fail, so the first line is not all "connecting". A refused
            # localhost connection takes about 2 s on Windows, so a fixed sleep printed too early there.
            for _ in range(int(3 * every / 0.25)):
                await asyncio.sleep(0.25)
                s = source.snapshot()
                if all(x.state != "connecting" for k, x in s.sources.items() if k != "chain"):
                    break
        while True:
            s = source.snapshot()
            if once:
                print(text(s))
                return
            print(json.dumps(summary(s)), flush=True)
            await asyncio.sleep(every)
            if hasattr(source, "advance"):
                source.advance(every)
    finally:
        if task:
            task.cancel()


def run(source, once: bool) -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # Windows pipes default to cp1252, which has no glyphs
    try:
        asyncio.run(stream(source, once))
    except (KeyboardInterrupt, BrokenPipeError):
        sys.stdout = None  # stdout is gone; stop Python from flushing it again at exit
