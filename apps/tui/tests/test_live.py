"""Live mapping: recorded tod-node and coordinator JSON in, view model out. No network."""
import asyncio
import json
import time

import httpx

from tod_tui.live import (LiveSource, NodeLog, coordinator_from, map_event, map_node, map_problems, map_round,
                          read_token)

A, B, C = "0x" + "a" * 40, "0x" + "b" * 40, "0x" + "c" * 40
V1, V2 = "0x" + "1" * 40, "0x" + "2" * 40
H = "0x" + "3f" * 32
BAD = "0x" + "77" * 32
JOB = {"id": 7, "status": "running", "workload": "mlp-exact/1", "currentRound": 12}
CONFIG = {"verifiers": [V1, V2], "threshold": 2}
ROUND = {"round": 12, "job": 7, "status": "finalized", "startHash": H, "aggregateHash": H,
         "roster": [{"op": A, "shard": 0}, {"op": B, "shard": 1}, {"op": C, "shard": 2}],
         "committed": [A, B, C], "revealed": [A, B], "seed": H, "confirmed": [], "outcome": "Accepted",
         "payouts": [{"op": A, "amount": 1_670_000}]}
SETTLE = {"outcome": 0, "aggregateHash": H, "flaggedBitmap": 0b010, "payouts": [{"op": A, "amount": 1_670_000}],
          "collected": 2}
# apps/node/src/tod_node/cli.py status_fields: GET /v1/status and `tod-node status --json` print the same object.
STATUS = {"dataDir": "/data", "initialized": True, "operator": A, "daemon": {"state": "running", "pid": 41},
          "lastEvent": None}


def report(v, kind_b="ReplayMismatch"):
    """A verifier report as apps/verifier writes it: results keyed by operator, kind None for a match."""
    return {"job": 7, "round": 12, "verifier": v, "results": {
        A: {"kind": None, "replayRoot": H, "claimedRoot": H},
        B: {"kind": kind_b, "replayRoot": H, "claimedRoot": BAD}}}


def ev(seq, type_, job=None, rnd=None, ts=None, **data):
    return {"seq": seq, "ts": ts if ts is not None else time.time(), "type": type_, "job": job, "round": rnd, "data": data}


def test_finalized_round_marks_slash_no_reveal_and_pay():
    r = map_round(JOB, ROUND, CONFIG, SETTLE, [report(V1), report(V2)], "", "", 0.5)
    a, b, c = r.roster
    assert (a.state, a.outcome, a.paid) == ("accepted", "ACCEPTED", "1.67")
    assert (b.state, b.outcome) == ("slashed", "MISMATCH")
    assert [v.state for v in b.verdicts] == ["mismatch", "mismatch"]
    assert b.committed_hash == BAD
    assert (c.state, c.outcome) == ("missed", "NO REVEAL")
    assert r.settlement.done and r.settlement.outcome == "ACCEPTED"
    assert r.verifier_online == [True, True]


def test_without_reports_a_reverted_round_still_names_the_cheat():
    # Reports are signed blobs a screen can't fetch; the round's confirmed list says who failed replay.
    rnd = dict(ROUND, status="reverted", outcome="Reverted", payouts=[], confirmed=[{"op": B, "kind": "ReplayMismatch"}])
    r = map_round(JOB, rnd, CONFIG, None, [], "", "", 0.5)
    a, b, _ = r.roster
    assert [v.state for v in b.verdicts] == ["mismatch", "mismatch"] and b.state == "slashed"
    assert [v.state for v in a.verdicts] == ["match", "match"]
    assert r.settlement.done and r.settlement.outcome == "REVERTED"


def test_a_fallback_round_shows_the_second_verifier_silent():
    rnd = dict(ROUND, status="fallback")
    r = map_round(JOB, rnd, CONFIG, None, [], "", "", 0.5)
    assert r.verifier_online == [True, False]
    assert r.roster[0].verdicts[1].state == "offline"


def test_verifying_round_shows_replaying_not_offline():
    rnd = dict(ROUND, status="verifying", payouts=[], outcome=None)
    r = map_round(JOB, rnd, CONFIG, {"collected": 1}, [report(V1)], "", "", 0.5)
    assert r.verifier_online == [True, True]
    assert r.roster[0].verdicts[1].state == "replaying"
    assert r.settlement.signed == 1 and r.rail.current == 4


def test_a_cheating_node_is_labelled_on_its_own_seat():
    r = map_round(JOB, ROUND, CONFIG, SETTLE, [], B, "fake:lazy", 0.5)
    assert r.roster[1].note == "Mode on this node: fake:lazy" and r.roster[0].note == ""


def test_the_log_folds_into_the_node_panel():
    log = NodeLog()
    for e in [ev(1, "node.started", version="0.1.0", network="anvil", chainId=31337, operator=A, mode="honest"),
              ev(2, "round.committed", 7, 12, commitHash=H), ev(3, "round.revealed", 7, 12, updateHash=H),
              ev(4, "round.skipped", 7, 13, reason="not in roster"), ev(5, "gas.topup", sent=1, balance=2)]:
        log.fold(e)
    n = map_node(STATUS, log, 1.2, True, time.time())
    assert (n.version, n.mode, n.job, n.round, n.state) == ("0.1.0", "honest", 7, 13, "skipped")
    assert dict(n.record)["revealed"] == "1" and dict(n.record)["skipped"] == "1"
    health = {h.key: h.status for h in n.health}
    assert health == {"node loop": "ok", "coordinator": "ok", "gas": "ok"}
    assert log.last_seq == 5
    stopped = map_node(dict(STATUS, daemon={"state": "stopped", "pid": None}), log, None, None, time.time())
    assert stopped.state == "offline" and {h.key: h.status for h in stopped.health}["node loop"] == "unknown"


def test_problems_say_what_to_run_in_order():
    log, now = NodeLog(), time.time()
    assert map_problems(dict(STATUS, initialized=False), log, None, None, now)[0].command == "tod-node init --network anvil"
    assert map_problems(dict(STATUS, daemon={"state": "stopped", "pid": None}), log, None, None, now)[0].command == "tod-node run"
    assert map_problems(STATUS, log, 45.0, None, now)[0].code == "loop_stalled"
    log.fold(ev(1, "node.started", chainId=31337, mode="honest"))
    assert map_problems(STATUS, log, 1.0, 84532, now)[0].command == "tod-node init --network base-sepolia"
    log.fold(ev(2, "error", 7, 12, code="salt_lost"))
    assert "salt_lost" in [p.code for p in map_problems(STATUS, log, 1.0, 31337, now)]
    old = NodeLog()
    old.fold(ev(1, "error", 7, 12, ts=now - 3600, code="salt_lost"))
    assert map_problems(STATUS, old, 1.0, None, now) == []  # an hour-old error is history, not a to-do
    log.fold(ev(3, "node.draining", pending=["7/12"]))
    assert any(p.code == "draining" for p in map_problems(STATUS, log, 1.0, 31337, now))


def test_events_map_to_words():
    assert map_event(ev(1, "round.revealed", 7, 12, updateHash=H)).what == "Result revealed"
    e = map_event(ev(2, "node.started", version="0.1.0", network="anvil", mode="fake:lazy"))
    assert e.kind == "danger" and "fake:lazy" in e.detail
    e = map_event(ev(3, "tx.reverted", 7, 12, kind="reveal", revert="RevealTooLate"))
    assert (e.what, e.kind, e.detail) == ("Transaction failed", "danger", "reveal RevealTooLate")
    assert map_event(ev(4, "node.stopping", source="api")).detail == "from the console"
    w = map_event(ev(5, "round.waiting", 7, 12, reason="inputs not available yet: 403"))
    assert (w.what, w.kind) == ("Waiting for this round's inputs", "warn")
    assert map_event(ev(6, "error", what="heartbeat", reason="refused")).what == "Coordinator not taking heartbeats"
    assert map_event(ev(7, "heartbeat.restored")).kind == "ok"
    assert map_event(ev(5, "something.new")).what == "Something new"  # a newer node never renders blank


def test_source_goes_down_then_ok_then_stale():
    calls = {"n": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/v1/health":
            return httpx.Response(503, json={"ok": False, "loopAgeSeconds": 40.0})
        calls["n"] += 1
        if calls["n"] == 1:
            raise httpx.ConnectError("refused")
        return httpx.Response(200, json=STATUS)

    src = LiveSource("http://node", "http://coord")

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            await src.poll_node(c)
            assert src.source("node", time.time()).state == "down"
            assert src.snapshot().node is None and src.snapshot().problems[0].code == "node_down"
            await src.poll_node(c)
            assert src.source("node", time.time()).state == "ok"
            assert src.loop_age == 40.0 and src.snapshot().problems[0].code == "loop_stalled"
            assert src.source("node", time.time() + 10).state == "stale"

    asyncio.run(go())


def test_the_event_cursor_is_the_last_seq_seen():
    seen = []

    def handler(req):
        seen.append(int(req.url.params["since"]))
        if len(seen) > 2:
            raise httpx.ConnectError("done")
        body = "\n".join(json.dumps(ev(s, "round.committed", 7, s)) for s in (1, 2)) if len(seen) == 1 else ""
        return httpx.Response(200, text=body)

    src = LiveSource("http://node", "http://coord")

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            try:
                await asyncio.wait_for(src._events(c), 0.5)
            except asyncio.TimeoutError:
                pass

    asyncio.run(go())
    assert seen[:2] == [0, 2] and len(src.events) == 2


def test_coordinator_poll_builds_round_and_pool():
    routes = {"/v1/health": {"ok": True, "chainId": 84532, "block": None, "storeOk": True, "version": "x"},
              "/v1/config": CONFIG, "/v1/jobs": [JOB],
              "/v1/nodes": [{"op": A, "version": "0.2.0", "arch": "arm64", "workloads": ["mlp-exact/1"],
                             "online": True, "idle": False},
                            {"op": "0x" + "d" * 40, "version": "0.2.0", "arch": None, "workloads": [],
                             "online": False, "idle": True}],
              "/v1/jobs/7/rounds/12": ROUND, "/v1/jobs/7/rounds/12/settlement": SETTLE}

    def handler(req):
        return httpx.Response(200, json=routes[req.url.path]) if req.url.path in routes else httpx.Response(404)

    src = LiveSource("http://node", "http://coord")

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            await src.poll_coord(c)

    asyncio.run(go())
    s = src.snapshot()
    assert s.network == "BASE SEPOLIA" and s.sources["chain"].state == "ok"  # block is null on ToD; chain id is enough
    assert s.round.round == 12 and s.round.roster[1].state == "slashed"
    assert [p.state for p in s.pool] == ["accepted", "offline"]


def test_a_missing_settlement_is_not_the_coordinator_down():
    rnd = dict(ROUND, status="verifying", outcome=None, payouts=[])
    routes = {"/v1/health": {"ok": True, "chainId": 31337, "block": None, "storeOk": True, "version": "x"},
              "/v1/config": CONFIG, "/v1/jobs": [JOB], "/v1/nodes": [], "/v1/jobs/7/rounds/12": rnd}

    def handler(req):
        return httpx.Response(200, json=routes[req.url.path]) if req.url.path in routes else httpx.Response(404)

    src = LiveSource("http://node", "http://coord")

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            await src.poll_coord(c)

    asyncio.run(go())
    assert src.source("coordinator", time.time()).state == "ok" and src.raw["settlement"] is None


def test_the_cli_fallback_takes_the_last_event_once():
    out = json.dumps(dict(STATUS, lastEvent=ev(9, "round.committed", 7, 12, commitHash=H)))

    async def run(cmd):
        return 0, out, ""

    src = LiveSource("tod-node status --json", "http://coord")
    asyncio.run(src.poll_node_cmd(run))
    asyncio.run(src.poll_node_cmd(run))
    assert len(src.events) == 1 and src.snapshot().node.state == "committed"

    async def missing(cmd):
        return 127, "", "tod-node: not found"

    gone = LiveSource("tod-node status --json", "http://coord")
    asyncio.run(gone.poll_node_cmd(missing))
    assert gone.snapshot().problems[0].code == "node_missing"


def test_the_coordinator_and_token_come_from_the_data_dir(tmp_path):
    (tmp_path / "config.toml").write_text('coordinator = "http://127.0.0.1:8000/"\nnetwork = "anvil"\n')
    (tmp_path / "api.token").write_text("ab" * 32 + "\n")
    assert coordinator_from(str(tmp_path)) == "http://127.0.0.1:8000"
    assert read_token(str(tmp_path)) == "ab" * 32
    assert read_token(str(tmp_path / "nope")) in (None, read_token(None))


def test_stop_sends_the_bearer_token(tmp_path, monkeypatch):
    (tmp_path / "api.token").write_text("cd" * 32)
    got = {}

    def handler(req):
        got["auth"] = req.headers.get("authorization")
        return httpx.Response(200, json={"accepted": True})

    real = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    src = LiveSource("http://node", "http://coord", data_dir=str(tmp_path))
    assert asyncio.run(src.stop_node()).startswith("Stopping")
    assert got["auth"] == "Bearer " + "cd" * 32


def test_late_reveal_is_the_first_problem_until_it_lands():
    from tod_tui.live import NodeLog, map_event, map_problems
    log = NodeLog()
    late = {"seq": 2, "ts": 1085, "type": "reveal.at_risk", "job": 7, "round": 4,
            "data": {"secondsLeft": 15, "revealDeadline": 1100}}
    log.fold(late)
    st = {"initialized": True, "daemon": {"state": "running"}}
    [p, *_] = map_problems(st, log, None, None, 1085)
    assert p.code == "reveal_at_risk" and "job 7 round 4 is due in 15 s" in p.message
    assert map_event(late).kind == "danger"
    log.fold({"seq": 3, "ts": 1090, "type": "round.revealed", "job": 7, "round": 4, "data": {}})
    assert all(p.code != "reveal_at_risk" for p in map_problems(st, log, None, None, 1090))
