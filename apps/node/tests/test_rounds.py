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
    rnd = {"status": status, "startWeightsHash": START, "nodeRounds": nrs}
    return SimpleNamespace(rounds={(1, 1): rnd}, jobs={1: {"params": SimpleNamespace(segments=4)}})


@pytest.fixture
def store(tmp_path):
    return RoundStore(tmp_path / "rounds.json")


def loop(market, store, trained=None):
    def train(job, rnd, r):
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
