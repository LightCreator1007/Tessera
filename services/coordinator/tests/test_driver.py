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
from tod_core.ledger import ChainState, JobStatus, Kind, Phase, RoundStatus
from tod_core.settle import settle
from tod_datasets.canonical import split

OPS = ["0x" + f"{i:02x}" * 20 for i in range(1, 5)]
DATA = "0x" + "dd" * 32
SPEC = {"workload": {"id": "mlp-exact/1"}, "train": {"lr": "0.05"}, "gate": {"relTol": "0.1", "absTol": "0.01"},
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
    for t in ("JOBS", "ROUNDS", "SPECS", "MODELS", "EVIDENCE", "SETTLEMENTS", "STATES", "CONTROL", "MISSED", "REARMED"):
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
    s.rounds[(1, 1)] = {"status": RoundStatus.OPEN, "fallback_": False, "openedAt": 10, "nodes": OPS[:3],
                        "shards": [0, 1, 2], "nodeRounds": nrs, "revealedCount": 3, "budget": 300, "drip": 0,
                        "seed": b"\5" * 32, "aggregateHash": b"\0" * 32, "startWeightsHash": put(start)}
    market = Market({(1, 1): Phase.FINALIZE})
    registry = NS(graduatedAt=lambda owner: 1, PROBATION_SECONDS=lambda: 0)
    d = D.Driver(NS(market=market, registry=registry), store, {DATA: (X, Y)}.__getitem__,
                 fleet=lambda: {}, credentials=lambda: {}, now=lambda: 1000)
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


def test_voids_a_round_below_quorum(world):
    world.s.rounds[(1, 1)]["revealedCount"] = 1
    world.market.phases[(1, 1)] = Phase.VERIFY
    world.d.tick()
    assert world.market.calls == [("voidRound", 1, 1)] and (1, 1) not in tables.SETTLEMENTS


def test_opens_the_next_round_on_idle_nodes(world):
    world.s.rounds[(1, 1)]["status"] = RoundStatus.SETTLED
    world.s.nodes = {op: {**n, "busyJob": 0} for op, n in world.s.nodes.items()}
    world.d.fleet = lambda: {op: {"seen": 1000, "busy": False, "selftest": {"mlp-exact/1": {"ok": True}}} for op in OPS}
    world.d.credentials = lambda: dict.fromkeys(OPS, "orb")
    world.d.tick()
    (name, job, ops, shards), = world.market.calls
    assert (name, job, len(ops)) == ("openRound", 1, 3) and OPS[3] in ops  # the node that sat out goes first
    assert tables.ROUNDS[1][1].status == "finalized" and tables.JOBS[1].workload == "mlp-exact/1"


def test_a_broken_round_does_not_stop_the_tick(world):
    def offline(_):
        raise OSError("dataset download failed")

    world.d.datasets = offline
    world.d.tick()  # logged, and the rest of the tick still runs
    assert (1, 1) not in tables.SETTLEMENTS and tables.ROUNDS[1][1].status == "verifying"


def test_reports_no_reveals_before_voiding(world):
    nrs = world.s.rounds[(1, 1)]["nodeRounds"]
    for op in OPS[1:3]:
        nrs[op]["revealed"] = False
    nrs[OPS[2]]["noRevealReported"] = True  # already reported, by us or anyone else
    world.s.rounds[(1, 1)]["revealedCount"] = 1
    world.market.phases[(1, 1)] = Phase.VERIFY
    world.d.tick()
    assert world.market.calls == [("reportNoReveal", 1, 1, OPS[1]), ("voidRound", 1, 1)]
