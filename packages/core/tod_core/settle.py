"""Builds finalize's inputs from chain state, so the coordinator and every verifier settle a round from the same facts."""
from collections.abc import Callable

import numpy as np

from .finalize import Finalized, finalize
from .ledger import Kind

# The evidence schema spells failure kinds the way the contract's enum does.
KIND_NAMES = {Kind.REPLAY_DRIFT: "ReplayDrift", Kind.DATA_UNAVAILABLE: "DataUnavailable",
              Kind.REPLAY_MISMATCH: "ReplayMismatch"}


def graduated(state, job: int, rnd: int, graduated_at: Callable[[str], int], probation_seconds: int) -> dict:
    """{op: bool} by JobMarket._route: an owner counts only if it graduated strictly before the round opened.

    graduatedAt never changes once set, so reading it at any later block gives the same answer.
    """
    r = state.rounds[(job, rnd)]
    if probation_seconds == 0:
        return dict.fromkeys(r["nodes"], True)
    out = {}
    for op in r["nodes"]:
        at = graduated_at(state.nodes[op]["owner"])
        out[op] = at != 0 and at < r["openedAt"]
    return out


def pool_for(drip: int, drip_bps: int) -> int:
    """A pool balance that makes payout.equal reproduce the drip the contract locked when the round opened.

    The pay evidence records only the drip, so any pool giving the same drip gives the same Settlement.
    """
    return -(-drip * 10_000 // drip_bps) if drip else 0


def settle(state, job: int, rnd: int, spec: dict, spec_hash: bytes, g_r: np.ndarray, weights: dict,
           val_loss: Callable, graduated_at: Callable[[str], int], probation_seconds: int, drip_bps: int,
           matcher_inputs: dict | None = None) -> Finalized:
    """Settle round `rnd` from chain state.

    weights:  {op: final weights} for every node that revealed, from the blob named by its last checkpoint hash
    val_loss: the workload's loss on the job's validation rows
    """
    r = state.rounds[(job, rnd)]
    nrs = r["nodeRounds"]
    missing = [op for op, nr in nrs.items() if nr["revealed"] and op not in weights]
    if missing:
        raise ValueError(f"no final weights for revealed node(s) {missing}")
    # JobMarket.eligibleBitmap also needs the node still active, so one that lost half its stake since can't be paid.
    floor = state.jobs[job]["params"].stakePerNode // 2
    revealed = {op: ("0x" + bytes(nr["updateHash"]).hex(), weights[op]) for op, nr in nrs.items()
                if nr["revealed"] and state.nodes[op]["stake"] >= floor}
    confirmed = {op: KIND_NAMES[nr["confirmed"]] for op, nr in nrs.items() if nr["confirmed"] != Kind.NONE}
    gate = spec["gate"]
    return finalize(job, rnd, spec_hash, g_r, list(zip(r["nodes"], r["shards"])), revealed, confirmed, val_loss,
                    r["budget"], graduated(state, job, rnd, graduated_at, probation_seconds),
                    pool=pool_for(r["drip"], drip_bps), drip=r["drip"], drip_bps=drip_bps,
                    rel_tol=float(gate["relTol"]), abs_tol=float(gate["absTol"]), matcher_inputs=matcher_inputs)
