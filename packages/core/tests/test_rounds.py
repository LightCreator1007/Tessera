"""rounds_done counts only earlier, kept (Settled, not fallback) rounds of the same job that trained the shard."""
from types import SimpleNamespace

from tod_core.ledger import RoundStatus
from tod_core.rounds import rounds_done


def rnd(status, shards, fallback=False):
    return {"status": status, "shards": shards, "fallback_": fallback}


def test_rounds_done_counts_only_kept_rounds_that_trained_the_shard():
    st = SimpleNamespace(rounds={
        (1, 1): rnd(RoundStatus.SETTLED, [0, 1]),
        (1, 2): rnd(RoundStatus.SETTLED, [1, 2]),
        (1, 3): rnd(RoundStatus.REVERTED, [0, 1]),
        (1, 4): rnd(RoundStatus.SETTLED, [0], fallback=True),
        (1, 5): rnd(RoundStatus.VOID, [0]),
        (2, 1): rnd(RoundStatus.SETTLED, [0]),  # another job
        (1, 6): rnd(RoundStatus.OPEN, [0, 1, 2, 3]),  # the round being trained
        (1, 7): rnd(RoundStatus.SETTLED, [0]),  # later than the round being trained
    })
    assert [rounds_done(st, 1, 6, s) for s in (0, 1, 2, 3)] == [1, 2, 1, 0]
