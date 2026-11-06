"""How many kept rounds trained a shard before this one, read from chain state. Node, verifiers and coordinator share it."""
from .ledger import RoundStatus


def rounds_done(state, job: int, rnd: int, shard: int) -> int:
    """Earlier rounds of this job whose aggregate was kept and that trained this shard.

    Reverted, void and fallback rounds don't advance the shard's place in the epoch shuffle. openRound reverts while
    the previous round is Open, so every lower round is final once `rnd` opens and the count can't change mid-round.
    Everyone who samples or replays a round must count exactly this way, which is why this is the only copy.
    """
    return sum(1 for (j, r), v in state.rounds.items()
               if j == job and r < rnd and v["status"] == RoundStatus.SETTLED and not v["fallback_"]
               and shard in v["shards"])
