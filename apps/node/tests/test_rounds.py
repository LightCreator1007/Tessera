"""Round loop against a fake market that applies the contract's commit and reveal checks."""
import threading
from types import SimpleNamespace

import pytest
from tod_core import encodings as enc
from tod_core.hashing import k256
from tod_core.ledger import Phase, Reverted, RoundStatus

from tod_node import daemon
from tod_node.rounds import RoundLoop, RoundStore, check_hashes

ME = "0x" + "aa" * 20
OTHER = "0x" + "bb" * 20
MARKET = "0x" + "cc" * 20
START = k256(b"start")
HS = [START] + [k256(bytes([i])) for i in range(1, 5)]  # K = 4


class FakeMarket:
    """Keeps commits and checks reveals the way JobMarket._reveal does."""

    def __init__(self, store=None):
        self.address, self.phases, self.commits, self.reveals, self.store = MARKET, {}, {}, [], store

    def phase(self, job, rnd):
        return self.phases.get((job, rnd), Phase.COMMIT)

    def commit(self, job, rnd, h):
        if self.store is not None:
            assert self.store.get(job, rnd) is not None, "salt must be on disk before the commit is sent"
        self.commits[(job, rnd)] = h

    def reveal(self, job, rnd, hs, salt):
        dom = enc.domain(31337, MARKET)
        if enc.commit_hash(dom, job, rnd, ME, enc.checkpoint_root(hs), salt) != self.commits[(job, rnd)]:
            raise Reverted("BadInput")
        self.reveals.append((job, rnd))


def state(committed=False, revealed=False, nodes=(ME,), status=RoundStatus.OPEN):
    nrs = {op: {"committed": committed, "revealed": revealed} for op in nodes}
    rnd = {"status": status, "startWeightsHash": START, "nodeRounds": nrs, "shards": [0], "fallback_": False}
    return SimpleNamespace(rounds={(1, 1): rnd}, jobs={1: {"params": SimpleNamespace(segments=4)}})


@pytest.fixture
def store(tmp_path):
    return RoundStore(tmp_path / "rounds.json")


def loop(market, store, trained=None):
    def train(st, job, rnd):
        if trained is None:
            raise AssertionError("must not retrain")
        trained.append((job, rnd))
        return list(HS)
    return RoundLoop(market, ME, 31337, store, train)


def test_commit_then_reveal_matches_the_commit(store):
    market, trained = FakeMarket(store), []
    node = loop(market, store, trained)
    node.tick(state())
    assert trained == [(1, 1)] and (1, 1) in market.commits
    market.phases[(1, 1)] = Phase.REVEAL
    node.tick(state(committed=True))
    assert market.reveals == [(1, 1)]


def test_restart_reveals_from_disk_without_retraining(store):
    market = FakeMarket(store)
    loop(market, store, []).tick(state())
    market.phases[(1, 1)] = Phase.REVEAL
    loop(market, store).tick(state(committed=True))  # a fresh process: trainer would fail if called
    assert market.reveals == [(1, 1)]


def test_crash_after_saving_reuses_the_same_commit(store):
    market = FakeMarket(store)
    loop(market, store, []).tick(state())
    first = market.commits.pop((1, 1))
    loop(market, store).tick(state())  # commit tx never landed; resend with the saved salt
    assert market.commits[(1, 1)] == first


def test_store_file_is_private(store):
    loop(FakeMarket(store), store, []).tick(state())
    assert store.path.stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize("st", [state(nodes=(OTHER,)), state(status=RoundStatus.SETTLED), state(revealed=True)])
def test_ignores_rounds_that_are_not_ours_to_act_on(store, st):
    market = FakeMarket(store)
    loop(market, store).tick(st)
    assert market.commits == {} and market.reveals == []


def test_bad_training_result_is_not_committed(store):
    market = FakeMarket(store)
    RoundLoop(market, ME, 31337, store, lambda *a: [k256(b"wrong")] + HS[1:]).tick(state())
    assert market.commits == {} and store.get(1, 1) is None


def test_revert_is_logged_not_raised(store, caplog):
    market = FakeMarket(store)
    market.commit = lambda *a: (_ for _ in ()).throw(Reverted("NodeNotEligible"))
    loop(market, store, []).tick(state())
    assert "NodeNotEligible" in caplog.text


def test_check_hashes_mirrors_reveal_rules():
    assert check_hashes(HS, START, 4) is None
    assert "expected 5" in check_hashes(HS[:-1], START, 4)
    assert "identical" in check_hashes([START, HS[1], HS[1], HS[3], HS[4]], START, 4)


def test_daemon_rebuilds_state_after_a_failed_sync(monkeypatch):
    made, stop = [], threading.Event()

    class FlakyState:
        def __init__(self):
            made.append(self)

        def sync(self, ledger):
            if len(made) == 1:
                raise ConnectionError("rpc blip")
            stop.set()

    monkeypatch.setattr(daemon, "ChainState", FlakyState)
    daemon.run(None, SimpleNamespace(tick=lambda s: None, pending_reveal=lambda s: [], accepting=True), stop, poll=0)
    assert len(made) == 2


def test_stop_drains_reveals_before_returning(monkeypatch):
    """A stop between commit and reveal keeps ticking until the reveal is done, and takes no new round."""
    stop, ticks, pending = threading.Event(), [], [[(1, 1)], [(1, 1)], []]
    stop.set()

    class State:
        def sync(self, ledger):
            pass

    loop = SimpleNamespace(accepting=True, tick=lambda s: ticks.append(loop.accepting),
                           pending_reveal=lambda s: pending.pop(0))
    monkeypatch.setattr(daemon, "ChainState", State)
    events = []
    daemon.run(None, loop, stop, poll=0, emit=lambda t, **k: events.append(t))
    assert ticks == [False, False] and events == ["node.draining"]


def test_training_failure_skips_the_round_once(store):
    calls, events = [], []

    def broken(*a):
        calls.append(a)
        raise RuntimeError("no trainer for this job yet")

    node = RoundLoop(FakeMarket(store), ME, 31337, store, broken, emit=lambda t, **k: events.append((t, k)))
    node.tick(state())
    node.tick(state())
    assert len(calls) == 1 and events[0][0] == "round.skipped" and "no trainer" in events[0][1]["reason"]


def test_rounds_done_counts_only_kept_rounds_that_trained_the_shard():
    from tod_node.trainer import rounds_done

    def rnd(status, shards, fallback=False):
        return {"status": status, "shards": shards, "fallback_": fallback}

    st = SimpleNamespace(rounds={
        (1, 1): rnd(RoundStatus.SETTLED, [0, 1]),
        (1, 2): rnd(RoundStatus.SETTLED, [1, 2]),
        (1, 3): rnd(RoundStatus.REVERTED, [0, 1]),
        (1, 4): rnd(RoundStatus.SETTLED, [0], fallback=True),
        (1, 5): rnd(RoundStatus.VOID, [0]),
        (2, 1): rnd(RoundStatus.SETTLED, [0]),  # another job
        (1, 7): rnd(RoundStatus.SETTLED, [0]),  # later than the round being trained
    })
    assert [rounds_done(st, 1, 6, s) for s in (0, 1, 2, 3)] == [1, 2, 1, 0]


def test_final_weights_upload_is_retried(monkeypatch):
    import numpy as np
    from tod_node import trainer

    monkeypatch.setattr(trainer.time, "sleep", lambda s: None)
    puts = []

    def put(data, job, rnd):
        puts.append(data)
        if len(puts) < 3:
            raise OSError("coordinator briefly down")

    t = trainer.Trainer(SimpleNamespace(put=put), None, "0xA", 1, "0x" + "00" * 20)
    t.runner.run = lambda *a: ([b"\1" * 32], np.zeros(2, np.float32), b"\2" * 32)
    st = SimpleNamespace(rounds={(1, 1): {"nodeRounds": {"0xa": {"shard": 0}}}})
    assert t(st, 1, 1) == [b"\1" * 32] and len(puts) == 3 and puts[0] == puts[2]


def test_inputs_refused_for_now_are_retried_not_skipped(store):
    """Right after openRound the coordinator may not list the roster yet, so its blob routes answer 403."""
    import urllib.error

    calls, events = [], []

    def flaky(*a):
        calls.append(a)
        if len(calls) == 1:
            raise urllib.error.HTTPError("http://c/v1/blobs/0x1", 403, "Forbidden", {}, None)
        return list(HS)

    market = FakeMarket(store)
    node = RoundLoop(market, ME, 31337, store, flaky, emit=lambda t, **k: events.append(t))
    node.tick(state())
    assert market.commits == {} and events == ["round.waiting"]
    node.tick(state())
    assert (1, 1) in market.commits and events == ["round.waiting", "round.committed"]
    assert (1, 1) not in node.skipped


def owed_state(missed_before=0, revealed=False):
    st = state(committed=True, revealed=revealed)
    st.rounds[(1, 1)].update(commitDeadline=1000, revealDeadline=1100)
    st.jobs[1]["params"] = SimpleNamespace(segments=4, stakePerNode=10_000_000)
    for i in range(missed_before):
        st.rounds[(1, 10 + i)] = {"status": RoundStatus.SETTLED, "nodeRounds": {ME: {"noRevealReported": True}}}
    return st


@pytest.mark.parametrize("missed,penalty", [(0, 100_000), (1, 1_000_000), (2, 5_000_000), (5, 5_000_000)])
def test_owed_reveal_prices_the_next_miss_on_the_contract_ladder(store, missed, penalty):
    node = RoundLoop(FakeMarket(store), ME, 31337, store, lambda *a: list(HS))
    [o] = node.owed_reveals(owed_state(missed))
    assert (o["job"], o["round"], o["missed"], o["penalty"], o["revealDeadline"]) == (1, 1, missed, penalty, 1100)


def test_reveal_at_risk_fires_once_late_in_the_window(store):
    market, events, now = FakeMarket(store), [], [1050.0]
    market.phases[(1, 1)] = Phase.VERIFY  # the reveal isn't being sent, so it stays owed
    node = RoundLoop(market, ME, 31337, store, lambda *a: list(HS), emit=lambda t, **k: events.append((t, k)),
                     clock=lambda: now[0])
    node.tick(owed_state())
    assert events == [] and len(node.owed) == 1  # half the window left: no warning yet
    now[0] = 1085.0
    node.tick(owed_state())
    node.tick(owed_state())
    assert [(t, k["secondsLeft"], k["penalty"]) for t, k in events] == [("reveal.at_risk", 15, 100_000)]


def test_a_reveal_sent_this_tick_is_not_owed_or_at_risk(store):
    market, events = FakeMarket(store), []
    node = RoundLoop(market, ME, 31337, store, lambda *a: list(HS), emit=lambda t, **k: events.append((t, k)),
                     clock=lambda: 1095.0)
    node.tick(state())  # commit first
    market.phases[(1, 1)] = Phase.REVEAL
    node.tick(owed_state())
    assert market.reveals == [(1, 1)] and node.owed == [] and "reveal.at_risk" not in [t for t, _ in events]
