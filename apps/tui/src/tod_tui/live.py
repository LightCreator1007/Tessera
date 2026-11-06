"""Live source: polls the node and the coordinator, maps both into the view model.

The node is read one of two ways. Today it is `tod-node status --json` (apps/node, #37), run every 2 s;
that works the same natively and through the Docker wrapper, whose data sits in a volume the TUI cannot
read. The local HTTP API on :7777 is deferred until after M1 (#1 6619039472); pass `--node http://...` once
it exists. The CLI has no event log, so activity lines are derived from changes between two status reads.

The mappers are pure functions of the JSON they get, so tests feed them recorded responses. The poller only
keeps the latest JSON per route and when each upstream last answered; staleness is derived from those times.
Coordinator responses per services/coordinator/api/models.py.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
import tomllib
from pathlib import Path
from typing import Any

import httpx

from .model import (PHASES, Event, Health, NodeInfo, PoolNode, Problem, Rail, RoundInfo, Seat, Settlement,
                    Snapshot, Source, Verdict)

TOD = 10**6
NODE_EVERY, NODE_CMD_EVERY, COORD_EVERY = 1.0, 2.0, 2.0
NODE_CMD_TIMEOUT = 10.0  # s; `docker exec` on a cold container can take a few seconds
LOOP_STALE = 30  # s; the node API itself calls its loop stalled after this long without a tick
ERROR_RECENT = 300  # s; an error event older than this is history, not something to act on now
DEFAULT_NODE = "http://127.0.0.1:7777"
NETWORKS = {84532: "BASE SEPOLIA", 8453: "BASE", 31337: "LOCAL ANVIL"}
NETWORK_FLAG = {84532: "base-sepolia", 31337: "anvil"}  # networks/<name>.toml

NODE_STATES = {"assigned": "assigned", "fetched": "fetching", "training": "training", "trained": "trained",
               "committing": "committing", "committed": "committed", "revealing": "revealing",
               "revealed": "revealed", "retaining": "settled", "closed": "settled", "done": "settled",
               "skipped": "skipped"}
ROUND_PHASE = {"open": 1, "committing": 2, "revealing": 3, "verifying": 4, "finalized": 5, "reverted": 5,
               "voided": 5, "fallback": 5}
DEADLINE_LABEL = {0: "result due", 1: "result due", 2: "result due", 3: "reveal due", 4: "checks end",
                  5: "next round"}
VERDICT = {"pass": "match", "ReplayMismatch": "mismatch", "ReplayDrift": "drift", "DataUnavailable": "unavailable"}
OUTCOME = {"mismatch": "MISMATCH", "drift": "DRIFT", "unavailable": "UNAVAILABLE"}
RAIL_WEIGHTS = (1.0, 4.0, 2.0, 2.0, 3.0, 1.0)


def tod(units: int | str | None) -> str:
    return f"{int(units or 0) / TOD:.2f}"


def short(addr: str | None) -> str:
    return f"{addr[:6]}...{addr[-4:]}" if addr and len(addr) > 12 else (addr or "?")


def ago(seconds: float) -> str:
    if seconds < 90:
        return f"{seconds:.0f} s ago"
    return f"{seconds / 60:.0f} min ago" if seconds < 5400 else f"{seconds / 3600:.0f} h ago"


class NodeLog:
    """What the event log says about the node, folded one event at a time. The status JSON can't say any of it."""

    def __init__(self) -> None:
        self.started: dict = {}
        self.stopping = False
        self.draining: list[str] = []
        self.at_risk: dict[tuple, dict] = {}  # rounds whose reveal is running late, cleared once it lands
        self.rounds: dict[tuple[int, int], str] = {}  # (job, round) -> committed, revealed, skipped
        self.counts = {"committed": 0, "revealed": 0, "skipped": 0, "reverted": 0}
        self.errors: list[dict] = []  # recent error and tx.reverted events, newest last
        self.gas: str | None = None
        self.last_seq = 0

    def fold(self, e: dict) -> None:
        t, d = e.get("type", ""), e.get("data") or {}
        self.last_seq = max(self.last_seq, int(e.get("seq") or 0))
        key = (e.get("job"), e.get("round"))
        if t == "node.started":
            self.started, self.stopping, self.draining = d, False, []
        elif t == "node.stopping":
            self.stopping = True
        elif t == "node.draining":
            self.draining = [str(p) for p in d.get("pending") or []]
        elif t == "node.stopped":
            self.stopping, self.draining = False, []
        elif t in ("round.committed", "round.revealed", "round.skipped"):
            step = t.split(".")[1]
            self.rounds[key] = step
            self.counts[step] += 1
            if step != "committed":
                self.at_risk.pop(key, None)
        elif t == "reveal.at_risk":
            self.at_risk[key] = e
        elif t == "tx.reverted":
            self.counts["reverted"] += 1
            self.errors.append(e)
        elif t == "error":
            self.errors.append(e)
            if d.get("what") == "gas":
                self.gas = "low"
        elif t == "gas.topup":
            self.gas = "topped up"
        self.errors = self.errors[-20:]
        if len(self.rounds) > 50:  # only the newest rounds matter on screen
            for k in sorted(self.rounds)[:-50]:
                self.rounds.pop(k)

    def current(self) -> tuple[tuple[int, int] | None, str | None]:
        if not self.rounds:
            return None, None
        key = max(self.rounds)
        return key, self.rounds[key]


def map_node(st: dict, log: NodeLog, loop_age: float | None, coord_ok: bool | None, now: float) -> NodeInfo:
    """The node panel from its status, its folded event log, its loop age and whether the coordinator answers."""
    started = log.started
    key, step = log.current()
    running = (st.get("daemon") or {}).get("state") == "running"
    state = "offline" if not running else {"committed": "committed", "revealed": "revealed",
                                           "skipped": "skipped"}.get(step or "", "idle")
    health = [Health("node loop", "unknown" if loop_age is None else ("ok" if loop_age < LOOP_STALE else "bad"),
                     "no tick yet" if loop_age is None else f"ticked {ago(loop_age)}"),
              Health("coordinator", "unknown" if coord_ok is None else ("ok" if coord_ok else "bad"),
                     "unknown" if coord_ok is None else ("answering" if coord_ok else "not answering"))]
    if log.gas:
        health.append(Health("gas", "warn" if log.gas == "low" else "ok", log.gas))
    return NodeInfo(
        op=st.get("operator") or "?", owner="", mode=str(started.get("mode") or "?"),
        version=str(started.get("version") or "?"), state=state, job=key[0] if key else None,
        round=key[1] if key else None, shard=None, workload="", segment=0, segments=0,
        committed=step in ("committed", "revealed"), revealed=step == "revealed", earned="",
        record=[("committed", str(log.counts["committed"])), ("revealed", str(log.counts["revealed"])),
                ("skipped", str(log.counts["skipped"])), ("reverted txs", str(log.counts["reverted"]))],
        health=health, disk_used=0, disk_cap=1)


def map_problems(st: dict | None, log: NodeLog, loop_age: float | None, coord_chain: int | None,
                 now: float) -> list[Problem]:
    """The one thing to do next, most urgent first. Each comes with the command that fixes it."""
    if st is None:
        return []
    if not st.get("initialized"):
        return [Problem("not_initialized", "This machine has no node key yet. Create one:",
                        "tod-node init --network anvil")]
    if (st.get("daemon") or {}).get("state") != "running":
        return [Problem("not_running", "Your node is set up but not running. Start it:", "tod-node run")]
    out: list[Problem] = []
    for (job, rnd), e in log.at_risk.items():
        due = float((e.get("data") or {}).get("revealDeadline") or 0)
        left = f"due in {due - now:.0f} s" if due > now else "past its deadline"
        out.append(Problem("reveal_at_risk", f"The reveal for job {job} round {rnd} is {left} and isn't in yet. "
                           "Keep this machine awake and online, or it is slashed for a missed reveal. Check it:",
                           "tod-node logs"))
    if log.draining:
        out.append(Problem("draining", f"Stopping after the reveals it owes: {', '.join(log.draining)}.", ""))
    if loop_age is not None and loop_age >= LOOP_STALE:
        out.append(Problem("loop_stalled", f"The node's loop hasn't ticked for {loop_age:.0f} s. Check it:",
                           "tod-node doctor"))
    node_chain = log.started.get("chainId")
    if coord_chain and node_chain and node_chain != coord_chain:
        flag = NETWORK_FLAG.get(coord_chain)
        out.insert(0, Problem("chain_mismatch",
                              f"Your node is on the wrong network ({node_chain}, expected {coord_chain}). "
                              "Set it up for the right one:",
                              f"tod-node init --network {flag}" if flag else "tod-node status"))
    for e in reversed(log.errors):
        if now - float(e.get("ts") or 0) > ERROR_RECENT:
            break
        d = e.get("data") or {}
        if e.get("type") == "error" and d.get("code") == "salt_lost":
            out.append(Problem("salt_lost", f"The node lost its salt for job {e.get('job')} round {e.get('round')}, "
                               "so it can't reveal that round and will miss the reveal.", "tod-node logs"))
            break
        if e.get("type") == "error" and d.get("what") == "gas":
            out.append(Problem("gas_low", "The node is low on gas and the top-up didn't land.", "tod-node doctor"))
            break
    return out


STEP_WORDS = {"committed": "Result recorded", "revealed": "Result revealed", "skipped": "Skipped this round"}


def map_event(e: dict) -> Event:
    """One node event as a short sentence. Hashes and nonces stay in `tod-node logs`."""
    t, d = e.get("type", ""), e.get("data") or {}
    clock = time.strftime("%H:%M:%S", time.localtime(e.get("ts", 0)))
    kind, what, detail = "plain", t.replace(".", " ").capitalize(), ""
    if t in ("round.committed", "round.revealed", "round.skipped"):
        step = t.split(".")[1]
        what, detail = STEP_WORDS[step], str(d.get("reason") or "")
        kind = "warn" if step == "skipped" else "ok"
    elif t == "reveal.at_risk":
        what, kind = "Reveal running late", "danger"
        detail = f"{d.get('secondsLeft', '?')} s left, keep this machine awake and online"
    elif t == "round.waiting":
        what, detail, kind = "Waiting for this round's inputs", str(d.get("reason") or ""), "warn"
    elif t == "heartbeat.restored":
        what, kind = "Coordinator reachable again", "ok"
    elif t == "tx.reverted":
        what, kind = "Transaction failed", "danger"
        detail = f"{d.get('kind', '')} {d.get('revert') or ''}".strip()
    elif t == "gas.topup":
        what, kind = "Gas topped up by the coordinator", "ok"
    elif t == "error":
        what = {"gas": "Low on gas", "api": "Local API didn't start",
                "heartbeat": "Coordinator not taking heartbeats"}.get(str(d.get("what")), "Error")
        if d.get("code") == "salt_lost":
            what = "Lost a reveal salt"
        detail, kind = str(d.get("reason") or d.get("code") or ""), "danger"
    elif t == "node.started":
        mode = d.get("mode")
        cheat = bool(mode) and mode != "honest"
        what = "Node started"
        detail = f"{d.get('network', '')} v{d.get('version', '?')}" + (f"  ·  mode {mode}" if cheat else "")
        kind = "danger" if cheat else "active"
    elif t == "node.draining":
        what, kind = "Finishing owed reveals", "warn"
        detail = ", ".join(str(p) for p in d.get("pending") or [])
    elif t.startswith("node."):
        what = {"stopping": "Node stopping", "stopped": "Node stopped"}.get(t[5:], what)
        detail = "from the console" if d.get("source") == "api" else str(d.get("signal") or "")
    elif t == "api.listening":
        what, detail = "Local API listening", str(d.get("bind", ""))
    return Event(clock, e.get("job"), e.get("round"), what, detail, kind)


def _report_rows(r: dict) -> dict[str, dict]:
    """A verifier report's per-node rows by operator. ToD's verifier writes `results: {op: {kind, replayRoot,
    claimedRoot}}` with kind None for a match; the older `nodes: [{op, verdict}]` shape is still read."""
    if isinstance(r.get("results"), dict):
        return {op.lower(): {"verdict": v.get("kind") or "pass", "replayHash": v.get("replayRoot"),
                             "committed": v.get("claimedRoot")} for op, v in r["results"].items()}
    return {n["op"].lower(): n for n in r.get("nodes", [])}


def _derived(status: str, op: str, revealed: bool, k: int, confirmed: dict[str, str]) -> Verdict | None:
    """With no report to read, a settled round still says what its verifiers found: a confirmed cheat failed
    replay, an accepted or fallback round's revealed nodes matched (fallback: only the first verifier answered)."""
    if op in confirmed:
        return Verdict(VERDICT.get(confirmed[op], "mismatch"))
    if not revealed:
        return None
    if status == "finalized" or status == "reverted":
        return Verdict("match")
    if status == "fallback":
        return Verdict("match") if k == 0 else Verdict("offline")
    return None


def map_round(job: dict, rnd: dict, config: dict, settle: dict | None, reports: list[dict],
              me: str, mode: str, phase_frac: float) -> RoundInfo:
    verifiers = config.get("verifiers") or []
    by_verifier = {r.get("verifier", "").lower(): _report_rows(r) for r in reports}
    confirmed = {str(c.get("op", "")).lower(): str(c.get("kind") or "ReplayMismatch")
                 for c in rnd.get("confirmed") or [] if isinstance(c, dict) and c.get("op")}
    status = rnd.get("status", "open")
    idx = ROUND_PHASE.get(status, 1)
    terminal = idx == 5
    payouts = {p["op"].lower(): p["amount"] for p in rnd.get("payouts") or []}
    flagged = (settle or {}).get("flaggedBitmap", 0)
    committed = {a.lower() for a in rnd.get("committed") or []}
    revealed = {a.lower() for a in rnd.get("revealed") or []}
    me = (me or "").lower()
    seats = []
    for i, s in enumerate(rnd.get("roster") or []):
        op = s["op"].lower()
        seat = Seat(s["op"], s["shard"], "assigned", op in committed, op in revealed)
        seat.state = "revealed" if seat.revealed else ("committed" if seat.committed else (
            "training" if idx >= 1 else "assigned"))
        for k, v in enumerate(verifiers):
            got = by_verifier.get(v.lower(), {}).get(op)
            derived = _derived(status, op, seat.revealed, k, confirmed) if terminal and not got else None
            if got:
                seat.verdicts.append(Verdict(VERDICT.get(got.get("verdict"), "pending"), got.get("replayHash")))
                seat.committed_hash = seat.committed_hash or got.get("committed")
            elif derived:
                seat.verdicts.append(derived)
            elif status == "verifying":
                seat.verdicts.append(Verdict("replaying"))
            elif terminal and seat.revealed:
                seat.verdicts.append(Verdict("offline"))
            else:
                seat.verdicts.append(Verdict())
        bad = [v.state for v in seat.verdicts if v.state in OUTCOME]
        if idx >= 4 and seat.revealed:
            seat.state = "verifying"
        if terminal:
            if (flagged >> i) & 1 or bad:
                worst = "mismatch" if "mismatch" in bad else (bad[0] if bad else "mismatch")
                seat.state = "slashed" if worst == "mismatch" else "missed"
                seat.outcome = OUTCOME[worst]
            elif not seat.revealed:
                seat.state, seat.outcome = "missed", "NO REVEAL"
            elif status == "finalized":
                seat.state, seat.outcome = "accepted", "ACCEPTED"
            if op in payouts:
                seat.paid = tod(payouts[op])
        matched = [v for v in seat.verdicts if v.state == "match"]
        if seat.state == "slashed":
            seat.why = [f"{len(bad)} verifier(s) replayed this node's segment", "from the same start and got different",
                        f"weights. {seat.outcome.title()}: stake slashed."]
        elif matched and len(matched) == len(seat.verdicts):
            seat.why = ["Every verifier replayed this node's segment", "and got the exact bytes it committed."]
        elif matched:
            seat.why = [f"{len(matched)} of {len(seat.verdicts)} verifiers matched.", "Waiting on the rest."]
        else:
            seat.why = ["Verifiers replay after the seed is drawn.", "Nothing to compare yet."]
        if op == me and mode not in ("", "?", "honest"):
            seat.note = f"Mode on this node: {mode}"
        seats.append(seat)

    # Mid-verify a missing report just means "still replaying"; only a settled round proves a verifier was silent.
    online = [bool(by_verifier.get(v.lower())) or not terminal
              or any(len(x.verdicts) > k and x.verdicts[k].state not in ("offline", "pending") for x in seats)
              for k, v in enumerate(verifiers)]
    threshold = config.get("threshold", 2)
    if status in ("finalized", "reverted", "fallback") and (settle or rnd.get("outcome")):
        settle = settle or {"outcome": 0 if rnd.get("outcome") == "Accepted" else 1,
                            "aggregateHash": rnd.get("aggregateHash") or "", "payouts": rnd.get("payouts") or [],
                            "collected": threshold if status != "fallback" else 1}
        n_bad = sum(1 for s in seats if s.state == "slashed")
        merged = sum(1 for s in seats if s.state == "accepted")
        st = Settlement(True, "ACCEPTED" if settle.get("outcome") == 0 else "REVERTED",
                        f"{merged} paid  ·  {n_bad} slashed", settle.get("aggregateHash", ""),
                        f"{len(settle.get('payouts') or [])} payouts  ·  {tod(sum(p['amount'] for p in settle.get('payouts') or []))} TOD",
                        settle.get("collected", 0), threshold)
    else:
        st = Settlement(False, signed=(settle or {}).get("collected", 0), threshold=threshold)

    # The node reports no deadline, so the rail shows the phase without a countdown.
    rail = Rail(RAIL_WEIGHTS, _pos(idx, phase_frac), DEADLINE_LABEL[idx], None)
    return RoundInfo(job["id"], rnd["round"], status, job.get("workload", ""), rail, seats,
                     [f"VERIFIER {chr(65 + k)}" for k in range(len(verifiers))], online, st)


def _pos(idx: int, frac: float) -> float:
    total = sum(RAIL_WEIGHTS)
    return (sum(RAIL_WEIGHTS[:idx]) + RAIL_WEIGHTS[idx] * max(0.0, min(0.999, frac))) / total


def map_pool(nodes: list[dict], seats: list[Seat], job: dict | None, now_round: int | None) -> list[PoolNode]:
    in_round = {s.op.lower(): s for s in seats}
    out = []
    for n in nodes:
        seat = in_round.get(n["op"].lower())
        if not n.get("online"):
            state = "offline"
        elif seat:
            state = seat.state
        else:
            state = "idle" if n.get("idle") else "training"
        busy = state not in ("idle", "offline")
        out.append(PoolNode(n["op"], state, n.get("arch") or "?", n.get("version", "?"),
                            "  ".join(n.get("workloads") or []), "online" if n.get("online") else "offline",
                            f"{job['id']:02d}  ·  round {now_round}" if busy and job and seat else (
                                "other job" if busy else "none")))
    return out


class LiveSource:
    """Keeps the newest JSON per route. Every network call runs on the app's event loop via httpx.AsyncClient."""

    def __init__(self, node: str, coordinator_url: str | None = None, job: int | None = None,
                 data_dir: str | None = None):
        self.http = node.startswith(("http://", "https://"))
        self.node_url = node.rstrip("/") if self.http else node
        self.coord_url = (coordinator_url or "").rstrip("/") or None
        self.want_job = job
        self.data_dir = data_dir
        self.node_every = NODE_EVERY if self.http else NODE_CMD_EVERY
        # A source is stale after missing two polls in a row.
        self.stale_after = {"node": 2 * self.node_every + 1, "coordinator": 2 * COORD_EVERY + 1}
        self.raw: dict[str, Any] = {}
        self.last_ok: dict[str, float] = {}
        self.errors: dict[str, str] = {}
        self.events: list[Event] = []
        self.log = NodeLog()
        self.loop_age: float | None = None
        self.phase_seen: tuple[str, float] | None = None  # (phase key, first seen)

    async def run(self) -> None:
        async with httpx.AsyncClient(timeout=5.0) as c:
            loops = [self._loop(self.poll_node, c, self.node_every), self._loop(self.poll_coord, c, COORD_EVERY)]
            await asyncio.gather(*loops, *([self._events(c)] if self.http else []))

    async def _loop(self, fn, c: httpx.AsyncClient, every: float) -> None:
        while True:
            await fn(c)
            await asyncio.sleep(every)

    async def _get(self, c: httpx.AsyncClient, src: str, url: str) -> Any:
        try:
            r = await c.get(url)
            r.raise_for_status()
            self.last_ok[src] = time.time()
            self.errors.pop(src, None)
            return r.json()
        except (httpx.HTTPError, ValueError) as e:
            self.errors[src] = type(e).__name__
            return None

    async def poll_node(self, c: httpx.AsyncClient) -> None:
        if not self.http:
            await self.poll_node_cmd()
            return
        st = await self._get(c, "node", f"{self.node_url}/v1/status")
        if st is None:
            return
        self.raw["status"] = st
        if self.coord_url is None:
            self.coord_url = coordinator_from(st.get("dataDir"))
        try:  # 503 means the loop has stalled, and its body still says for how long
            h = (await c.get(f"{self.node_url}/v1/health")).json()
            self.loop_age = h.get("loopAgeSeconds")
        except (httpx.HTTPError, ValueError):
            self.loop_age = None

    async def poll_node_cmd(self, run=None) -> None:
        """One `tod-node status --json`, for a node whose API is off. `run` is injectable so tests skip the subprocess."""
        try:
            code, out, err = await (run or _run)(self.node_url)
        except FileNotFoundError:
            code, out, err = 127, "", "not found"
        except (OSError, asyncio.TimeoutError) as e:
            self.errors["node"] = type(e).__name__
            return
        try:
            st = json.loads(out.strip().splitlines()[-1]) if out.strip() else None
        except ValueError:
            st = None
        if not isinstance(st, dict) or "error" in st:
            missing = code in (127, 9009) or "not recognized" in err or "not found" in err
            self.errors["node"] = "missing" if missing else ((st or {}).get("error") or err.strip()[:120] or f"exit {code}")
            return
        last = st.get("lastEvent")
        if isinstance(last, dict) and int(last.get("seq") or 0) > self.log.last_seq:
            self.take([last])
        self.raw["status"] = st
        if self.coord_url is None:
            self.coord_url = coordinator_from(st.get("dataDir"))
        self.last_ok["node"] = time.time()
        self.errors.pop("node", None)

    def take(self, batch: list[dict]) -> None:
        for e in batch:
            self.log.fold(e)
            self.events.append(map_event(e))
        self.events = self.events[-200:]

    async def poll_coord(self, c: httpx.AsyncClient) -> None:
        if not self.coord_url:
            return
        base = f"{self.coord_url}/v1"
        for key, path in (("health", "/health"), ("config", "/config"), ("jobs", "/jobs"), ("nodes", "/nodes")):
            got = await self._get(c, "coordinator", base + path)
            if got is None:
                return
            self.raw[key] = got
        job = self.pick_job()
        if not job or not job.get("currentRound"):
            self.raw.pop("round", None)
            return
        r = job["currentRound"]
        rnd = await self._get(c, "coordinator", f"{base}/jobs/{job['id']}/rounds/{r}")
        if rnd is None:
            return
        self.raw["round"], self.raw["job"] = rnd, job
        if rnd.get("status") in ("verifying", "finalized", "reverted", "fallback"):
            # 404 until the coordinator builds the settlement; that is not the coordinator being down.
            try:
                s = await c.get(f"{base}/jobs/{job['id']}/rounds/{r}/settlement")
                self.raw["settlement"] = s.json() if s.status_code == 200 else None
            except (httpx.HTTPError, ValueError):
                self.raw["settlement"] = None
        else:
            self.raw["settlement"] = None
        # Verifier reports are blobs behind signed BlobAccess, so a settled round's verdicts are derived instead.
        self.raw["reports"] = []

    async def _events(self, c: httpx.AsyncClient) -> None:
        while True:
            try:
                r = await c.get(f"{self.node_url}/v1/events", params={"since": self.log.last_seq, "wait": 25},
                                timeout=30)
                r.raise_for_status()
                batch = [json.loads(line) for line in r.text.splitlines() if line.strip()]
                self.take(batch)  # the node's since is exclusive: the cursor is the last seq seen
            except (httpx.HTTPError, ValueError):  # node down or mid-restart: retry, the status poll shows it
                await asyncio.sleep(NODE_EVERY * 2)

    def owed(self) -> list[dict]:
        """Reveals the running node owes, from GET /v1/status. Empty when unknown, such as a node without its API."""
        return list((self.raw.get("status") or {}).get("owed") or [])

    async def stop_node(self) -> str:
        """POST /v1/stop with the token from the node's data dir. Returns what happened, in words."""
        if not self.http:
            return "This screen reads the node through its CLI. Stop it with: tod-node stop"
        token = read_token(self.data_dir or (self.raw.get("status") or {}).get("dataDir"))
        if token is None:
            return "Can't read the node's api.token (a Docker node keeps it in its volume). Stop it with: tod-node stop"
        try:
            async with httpx.AsyncClient(timeout=5.0) as c:
                r = await c.post(f"{self.node_url}/v1/stop", headers={"Authorization": f"Bearer {token}"})
        except httpx.HTTPError:
            return "The node didn't answer. Stop it with: tod-node stop"
        if r.status_code == 200:
            return "Stopping. The node finishes the reveals it owes first."
        return "The node refused the stop token. Stop it with: tod-node stop"

    def pick_job(self) -> dict | None:
        jobs = self.raw.get("jobs") or []
        mine, _ = self.log.current()
        for want in (self.want_job, mine[0] if mine else None):
            for j in jobs:
                if want is not None and j["id"] == want:
                    return j
        running = [j for j in jobs if j.get("status") == "running"]
        return running[0] if running else (jobs[0] if jobs else None)

    def source(self, name: str, now: float) -> Source:
        detail = self.node_url if name == "node" else (self.coord_url or "not set")
        if name == "coordinator" and not self.coord_url:
            return Source(name, "down", 0, detail)
        if name not in self.last_ok:
            return Source(name, "down" if name in self.errors else "connecting", 0, detail)
        age = now - self.last_ok[name]
        return Source(name, "stale" if age > self.stale_after[name] else "ok", age, detail)

    def frac(self, phase_key: str, now: float) -> float:
        """No deadline comes with a round, so the rail eases through a phase over a minute from when it was seen."""
        if not self.phase_seen or self.phase_seen[0] != phase_key:
            self.phase_seen = (phase_key, now)
        return min(0.9, (now - self.phase_seen[1]) / 60)

    def snapshot(self) -> Snapshot:
        now = time.time()
        sources = {n: self.source(n, now) for n in ("node", "coordinator")}
        st = self.raw.get("status") if sources["node"].state != "down" else None
        health = self.raw.get("health") or {}
        chain = health.get("chainId") or self.log.started.get("chainId")
        # Health.block stays null until the ledger feeds the API, so the chain row reads the chain id instead.
        sources["chain"] = Source("chain", "ok" if chain else "connecting", 0, str(chain or "?"))
        coord_ok = None if not self.coord_url else sources["coordinator"].state == "ok"
        node = map_node(st, self.log, self.loop_age, coord_ok, now) if st else None
        rnd_info = None
        if self.raw.get("round") and self.raw.get("job"):
            rnd = self.raw["round"]
            key = f"{rnd['round']}:{rnd.get('status')}"
            rnd_info = map_round(self.raw["job"], rnd, self.raw.get("config") or {}, self.raw.get("settlement"),
                                 self.raw.get("reports") or [], (st or {}).get("operator") or "",
                                 node.mode if node else "", self.frac(key, now))
        pool = map_pool(self.raw.get("nodes") or [], rnd_info.roster if rnd_info else [], self.raw.get("job"),
                        rnd_info.round if rnd_info else None)
        if node and rnd_info:  # the coordinator's roster says where this node sits, which its log can't
            seat = next((x for x in rnd_info.roster if x.op.lower() == node.op.lower()), None)
            if seat and node.state != "offline":
                node.job, node.round, node.shard, node.workload = rnd_info.job, rnd_info.round, seat.shard, rnd_info.workload
                node.state = seat.state
        if node and node.state == "idle":
            idle = sum(1 for p in pool if p.state == "idle")
            node.pool_position = f"{max(0, idle - 1)} other nodes are also waiting."
        problems = map_problems(st, self.log, self.loop_age, health.get("chainId"), now)
        if self.errors.get("node") == "missing":
            problems.insert(0, Problem("node_missing", "Can't find tod-node on this machine. Install it, or point "
                                       "this screen at its API with --node http://127.0.0.1:7777.", ""))
        elif sources["node"].state == "down" and self.http:
            problems.insert(0, Problem("node_down", f"Nothing answers at {self.node_url}. Start the node:", "tod-node run"))
        if not self.coord_url:
            problems.append(Problem("no_coordinator", "No coordinator address yet. Set up the node, or pass one:",
                                    "tod-tui --coordinator http://127.0.0.1:8000"))
        return Snapshot("live", NETWORKS.get(chain or 0, f"CHAIN {chain}" if chain else "CHAIN ?"), chain,
                        health.get("block"), node, rnd_info, pool, list(self.events), sources, problems)


def data_dir_default() -> Path:
    return Path(os.environ.get("TOD_DATA") or Path.home() / ".tod")


def read_token(data_dir: str | None) -> str | None:
    for d in (data_dir, str(data_dir_default())):
        if not d:
            continue
        try:
            return (Path(d) / "api.token").read_text().strip() or None
        except OSError:
            continue
    return None


def coordinator_from(data_dir: str | None) -> str | None:
    """The coordinator the node itself uses, from its config.toml, so the two screens never disagree."""
    for d in (data_dir, str(data_dir_default())):
        if not d:
            continue
        try:
            cfg = tomllib.loads((Path(d) / "config.toml").read_text())
        except (OSError, tomllib.TOMLDecodeError):
            continue
        url = cfg.get("coordinator") or (cfg.get("node") or {}).get("coordinator")
        if isinstance(url, str) and url:
            return url.rstrip("/")
    return None


async def _run(cmd: str) -> tuple[int, str, str]:
    # The shell finds `tod-node` the way the operator's own terminal does (PATH, .cmd shims, the wrapper).
    p = await asyncio.create_subprocess_shell(cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        out, err = await asyncio.wait_for(p.communicate(), NODE_CMD_TIMEOUT)
    except BaseException:  # timeout, or the screen quit mid-read: reap the child so no pipe outlives the loop
        if p.returncode is None:
            p.kill()
        await p.wait()
        raise
    return p.returncode or 0, out.decode(errors="replace"), err.decode(errors="replace")
