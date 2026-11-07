"""The round driver against a fake market: report no-reveals, void, settle and publish, finalize, open rounds."""
import json
from types import SimpleNamespace as NS

import numpy as np
import pytest

import driver as D
from api import blobs, tables
from api.draft import mlp
from store import DiskStore
from tod_core.blob import from_blob, k256, to_blob
from tod_core.evidence import canonical
from tod_core.ledger import ChainState, Event, JobStatus, Kind, Phase, RoundStatus
from tod_core.settle import settle
from tod_datasets.canonical import split
from tod_workloads import compute

OPS = ["0x" + f"{i:02x}" * 20 for i in range(1, 5)]
DATA = "0x" + "dd" * 32
SPEC = {"workload": {"id": "mlp-exact/1"}, "train": {"lr": "0.05", "H": 50, "B": 8},
        "gate": {"relTol": "0.1", "absTol": "0.01"},
        "model": {"inputShape": [4], "outputs": 3, "hidden": 8, "task": "classification"},
        "data": {"shards": split(200, 3, "0.05", "0.1")["shards"], "valFrac": "0.05", "testFrac": "0.1"}}
rng = np.random.default_rng(0)
X, Y = rng.random((200, 4), dtype=np.float32), rng.integers(0, 3, 200)


class Market:
    def __init__(self, phases):
        self.phases, self.calls = phases, []

    def phase(self, job, rnd):
        return self.phases[(job, rnd)]

    def DRIP_BPS(self):
        return 1000

    def __getattr__(self, name):  # voidRound, finalizeRound, openRound
        return lambda *args: self.calls.append((name, *args))


@pytest.fixture
def world(tmp_path, monkeypatch):
    for t in ("JOBS", "ROUNDS", "SPECS", "MODELS", "EVIDENCE", "SETTLEMENTS", "STATES", "CONTROL", "MISSED", "REARMED",
              "PROVIDERS", "SEATING", "STALLED", "PUBLIC"):
        monkeypatch.setattr(tables, t, {})
    store = DiskStore(tmp_path)
    spec_bytes = canonical(SPEC)
    spec_hash, spec_blob = k256(spec_bytes), store.put(spec_bytes)
    wl = mlp(SPEC["model"], "0.05")
    start = wl.init(1)
    s = ChainState()
    s.sync = lambda ledger: s
    s.jobs[1] = {"params": NS(budget=900, rounds=3, minQuorum=2, maxPerRound=3, shards=3, stakePerNode=15,
                              modelSpecHash=spec_hash, specURI=f"/v1/blobs/{spec_blob}",
                              datasetHash=bytes.fromhex(DATA[2:])),
                 "requester": OPS[3], "status": JobStatus.ACTIVE, "remaining": 600, "nextRound": 2, "roundsOpened": 1}
    s.nodes = {op: {"joined": True, "busyJob": 1, "stake": 15, "owner": op} for op in OPS}

    def put(w):
        blob = to_blob(spec_hash, w)
        store.put(blob)
        return k256(blob)

    nrs = {op: {"slot": i, "committed": True, "revealed": True, "noRevealReported": False, "confirmed": Kind.NONE,
                "updateHash": put(start + np.float32(0.001) * (i + 1))} for i, op in enumerate(OPS[:3])}
    s.rounds[(1, 1)] = {"status": RoundStatus.OPEN, "fallback_": False, "openedAt": 10, "finalizeBy": 2000, "nodes": OPS[:3],
                        "shards": [0, 1, 2], "nodeRounds": nrs, "revealedCount": 3, "budget": 300, "drip": 0,
                        "seed": b"\5" * 32, "aggregateHash": b"\0" * 32, "startWeightsHash": put(start)}
    market = Market({(1, 1): Phase.FINALIZE})
    registry = NS(graduatedAt=lambda owner: 1, PROBATION_SECONDS=lambda: 0)
    d = D.Driver(NS(market=market, registry=registry), store, {DATA: (X, Y)}.__getitem__,
                 fleet=lambda: {}, excluded=set, now=lambda: 1000)
    d.state = s
    return NS(d=d, s=s, market=market, store=store, spec_hash=spec_hash, start=start, wl=wl)


def test_settles_like_a_verifier_and_publishes_what_it_needs(world):
    world.d.tick()
    pending = tables.SETTLEMENTS[(1, 1)]
    lo, n = split(200, 3, "0.05", "0.1")["val"]
    val = slice(lo, lo + n)
    nrs = world.s.rounds[(1, 1)]["nodeRounds"]
    weights = {op: from_blob(world.spec_hash, world.store.get("0x" + nr["updateHash"].hex()), world.wl.n_params())
               for op, nr in nrs.items()}
    mine = settle(world.s, 1, 1, SPEC, world.spec_hash, world.start, weights,
                  lambda w: world.wl.evaluate(w, X[val], Y[val])[0], lambda o: 1, 0, 1000)
    assert pending["settlement"] == mine.settlement and pending["sigs"] == {}
    ev = tables.EVIDENCE[(1, 1)]
    assert k256(world.store.get(ev.aggregate.hash)) == mine.settlement["aggEvidenceHash"]
    assert k256(world.store.get(ev.pay.hash)) == mine.settlement["payEvidenceHash"]
    assert world.store.has("0x" + mine.settlement["aggregateHash"].hex())  # next round's start weights
    assert tables.ROUNDS[1][1].status == "verifying" and OPS[0] in blobs.allowed(1, 1)
    assert not world.market.calls  # nothing is sent before the verifiers sign
    gate = json.loads(world.store.get(ev.aggregate.hash))["gate"]
    assert tables.STATES[1].model_dump() == {"job": 1, "rounds": [{"round": 1, "metric": gate["valAfter"], "seconds": 990}],
                                             "trust": "untrusted"}


def credit(state, owner, job, rnd):
    state.apply(Event("WorkCredited", {"owner": owner, "jobId": job, "roundId": rnd, "seconds_": 1, "total": 1},
                      1, 0, "0x", None), None)


def test_a_provider_total_counts_each_credited_round(world):
    credit(world.s, OPS[0], 1, 1)
    credit(world.s, OPS[0], 1, 2)
    credit(world.s, OPS[1], 1, 1)
    world.d.publish({(1, 1): Phase.FINALIZE})
    one_round = compute.round_ops(SPEC)
    p = tables.PROVIDERS[OPS[0].lower()]
    assert (p.owner, p.rounds, p.ops) == (OPS[0], 2, 2 * one_round)
    assert tables.PROVIDERS[OPS[1].lower()].ops == one_round


def test_a_job_it_cannot_count_adds_nothing_and_stops_nothing(world):
    credit(world.s, OPS[0], 1, 1)
    credit(world.s, OPS[0], 99, 1)  # a job with no spec here
    world.d.publish({(1, 1): Phase.FINALIZE})
    p = tables.PROVIDERS[OPS[0].lower()]
    assert (p.rounds, p.ops) == (2, compute.round_ops(SPEC))


def test_finalizes_once_the_threshold_signed(world):
    world.d.tick()
    tables.SETTLEMENTS[(1, 1)]["sigs"]["0xa"] = "0x" + "01" * 65
    world.d.tick()
    assert not world.market.calls
    tables.SETTLEMENTS[(1, 1)]["sigs"]["0xb"] = "0x" + "02" * 65
    world.d.tick()
    (name, job, rnd, s, sigs), = world.market.calls
    want = tables.SETTLEMENTS[(1, 1)]["settlement"]
    assert (name, job, rnd) == ("finalizeRound", 1, 1) and sigs == [b"\1" * 65, b"\2" * 65]
    assert s["payouts"] == [{"operator": op, "amount": a} for op, a in want["payouts"]] and len(s["payouts"]) == 3


def test_state_comes_back_after_a_restart_from_the_stored_evidence(world):
    world.d.tick()
    doc = world.store.get(tables.EVIDENCE[(1, 1)].aggregate.hash)
    tables.STATES.clear()  # a restarted coordinator: the in-memory tables are empty, the store is not
    r = world.s.rounds[(1, 1)]
    r.update(status=RoundStatus.SETTLED, aggEvidenceHash=k256(doc), aggregateHash=b"\7" * 32)
    world.d.publish({})
    (st,) = tables.STATES[1].rounds
    assert (st.round, st.metric, st.seconds) == (1, json.loads(doc)["gate"]["valAfter"], None)


def test_a_round_past_its_finalize_window_settles_by_fallback(world):
    world.s.rounds[(1, 1)]["finalizeBy"] = 999  # the fixture's clock is 1000
    world.d.tick()
    assert world.market.calls == [("finalizeFallback", 1, 1)] and (1, 1) not in tables.SETTLEMENTS


def test_voids_a_round_below_quorum(world):
    world.s.rounds[(1, 1)]["revealedCount"] = 1
    world.market.phases[(1, 1)] = Phase.VERIFY
    world.d.tick()
    assert world.market.calls == [("voidRound", 1, 1)] and (1, 1) not in tables.SETTLEMENTS


def test_opens_the_next_round_on_idle_nodes(world):
    world.s.rounds[(1, 1)]["status"] = RoundStatus.SETTLED
    world.s.nodes = {op: {**n, "busyJob": 0} for op, n in world.s.nodes.items()}
    world.d.fleet = lambda: {op: {"seen": 1000, "busy": False, "selftest": {"mlp-exact/1": {"ok": True}}} for op in OPS}
    world.d.tick()
    (name, job, ops, shards), = world.market.calls
    assert (name, job, len(ops)) == ("openRound", 1, 3) and OPS[3] in ops  # the node that sat out goes first
    assert set(ops) <= blobs.allowed(1, 2)  # seated nodes can fetch the spec before the next tick publishes round 2
    assert tables.ROUNDS[1][1].status == "finalized" and tables.JOBS[1].workload == "mlp-exact/1"


def test_a_job_that_cannot_seat_a_quorum_says_why_and_since_when(world):
    world.s.rounds[(1, 1)]["status"] = RoundStatus.SETTLED
    world.s.nodes = {op: {**n, "busyJob": 0} for op, n in world.s.nodes.items()}
    world.s.nodes[OPS[0]]["stake"] = 0  # the slashed cheater
    world.s.jobs[1].update(closedAt=900)
    world.s.jobs[1]["params"].windows = NS(stall=3600)
    online = {op: {"seen": 1000, "busy": False, "selftest": {"mlp-exact/1": {"ok": True}}} for op in OPS[:2]}
    world.d.fleet = lambda: online  # OPS[2] and OPS[3] are offline
    world.d.tick()
    world.d.now = lambda: 1030
    world.d.tick()  # publish runs before open_rounds, so the second tick shows the first tick's diagnosis
    assert not world.market.calls
    w = tables.JOBS[1].waiting
    assert (w.eligible, w.quorum, w.blocked) == (1, 2, {"stake": 1, "offline": 2})
    assert (w.since, w.abandonAfter) == (1000, 4500)  # the first tick it was seen stuck; closedAt + stall
    world.d.fleet = lambda: {op: online[OPS[1]] for op in OPS}
    world.d.tick()
    assert world.market.calls[0][0] == "openRound" and 1 not in tables.STALLED


def test_a_finalized_round_opens_its_blobs_and_rebuilds_its_evidence_after_a_restart(world):
    r = world.s.rounds[(1, 1)]
    agg_ev, pay_ev, agg = bytes([10]) * 32, bytes([11]) * 32, bytes([12]) * 32
    r.update(status=RoundStatus.SETTLED, aggEvidenceHash=agg_ev, payEvidenceHash=pay_ev, aggregateHash=agg)
    r["nodeRounds"][OPS[2]]["revealed"] = False  # a node that never revealed has no update to show
    world.d.tick()
    ev = tables.EVIDENCE[(1, 1)]
    assert (ev.aggregate.hash, ev.pay.hash) == ("0x" + agg_ev.hex(), "0x" + pay_ev.hex())
    assert ev.aggregate.url == "/v1/blobs/0x" + agg_ev.hex()
    want = {agg_ev, pay_ev, agg, r["startWeightsHash"], *(r["nodeRounds"][op]["updateHash"] for op in OPS[:2])}
    assert set(tables.PUBLIC) == {"0x" + bytes(h).hex() for h in want}
    assert "0x" + bytes(r["nodeRounds"][OPS[2]]["updateHash"]).hex() not in tables.PUBLIC


def test_an_open_round_publishes_nothing(world):
    world.d.tick()
    assert tables.PUBLIC == {}


def test_a_broken_round_does_not_stop_the_tick(world):
    def offline(_):
        raise OSError("dataset download failed")

    world.d.datasets = offline
    world.d.tick()  # logged, and the rest of the tick still runs
    assert (1, 1) not in tables.SETTLEMENTS and tables.ROUNDS[1][1].status == "verifying"


def test_a_sync_that_fails_part_way_starts_over(world):
    def flaky(ledger):
        world.s.nodes[OPS[0]]["stake"] += 15  # an event applied before the RPC error
        raise OSError("rpc dropped")

    world.s.sync = flaky
    with pytest.raises(OSError):
        world.d.tick()
    assert world.d.state is not world.s and not world.d.state.nodes  # the next tick rebuilds from the deploy block


def test_reports_no_reveals_before_voiding(world):
    nrs = world.s.rounds[(1, 1)]["nodeRounds"]
    for op in OPS[1:3]:
        nrs[op]["revealed"] = False
    nrs[OPS[2]]["noRevealReported"] = True  # already reported, by us or anyone else
    world.s.rounds[(1, 1)]["revealedCount"] = 1
    world.market.phases[(1, 1)] = Phase.VERIFY
    world.d.tick()
    assert world.market.calls == [("reportNoReveal", 1, 1, OPS[1]), ("voidRound", 1, 1)]
