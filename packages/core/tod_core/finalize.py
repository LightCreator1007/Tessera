"""Closes a round: gates and merges the updates, splits the pay, and builds both evidence documents and the Settlement.

The coordinator builds the Settlement with it and each verifier recomputes it, so both must import this one copy.
"""
from dataclasses import dataclass

import numpy as np

from tod_core import encodings, evidence, payout
from tod_core.aggregate import Outer, gate, merge, norm64
from tod_core.blob import to_blob
from tod_core.hashing import k256

ACCEPTED, REVERTED = encodings.ACCEPTED, encodings.REVERTED


@dataclass
class Finalized:
    w_new: np.ndarray
    settlement: dict  # outcome, aggregateHash, flaggedBitmap, aggEvidenceHash, payEvidenceHash, payouts
    agg_evidence: bytes
    pay_evidence: bytes
    weights_blob: bytes  # empty when the round reverts


def _hex(b: bytes) -> str:
    return "0x" + b.hex()


def _by_address(d: dict) -> list:
    return sorted(d.items(), key=lambda kv: int(kv[0], 16))


def finalize(job, rnd, spec_hash, g_r, roster, revealed, confirmed, val_loss, budget, graduated, pool=0, drip=0,
             drip_bps=1000, rel_tol=0.1, abs_tol=0.01, matcher_inputs=None) -> Finalized:
    """Settle round `rnd` of `job`, starting from weights g_r.

    roster:    [(op, shard)] in slot order; a slot's index is its bit in flaggedBitmap
    revealed:  {op: (final checkpoint hash "0x..", weights)}
    confirmed: {op: failure kind} for nodes both verifiers agreed failed
    drip:      the drip locked when the round opened. The split must reproduce it, or the contract reverts.
    """
    outer = Outer()
    start = k256(to_blob(spec_hash, g_r))
    slots = [op for op, _ in roster]
    kept = [(op, w) for op, (_, w) in _by_address(revealed) if op not in confirmed]

    g = gate(g_r, kept, outer, None, val_loss, rel_tol, abs_tol)
    eligible = g.accepted
    # The contract rejects an Accepted outcome with nobody eligible, so that case is a revert.
    accepted = bool(eligible) and not g.reverted
    if not accepted:
        eligible, g.w_new = [], g_r.copy()

    split = payout.equal(budget, eligible, graduated, pool, drip_bps)
    if eligible and split["drip"] not in (0, drip):
        raise ValueError("the pay split's drip differs from the drip locked when the round opened")
    new_blob = to_blob(spec_hash, g.w_new)
    agg_hash = k256(new_blob) if accepted else start

    used = [(op, w) for op, w in kept if op in eligible]
    m = merge(g_r, used, outer)
    base = g_r.astype(np.float64)
    clip = float(np.median([norm64(w.astype(np.float64) - base) for _, w in used])) if used else 0.0
    band = g.loss_prev * (1 + rel_tol) + abs_tol
    agg_ev = evidence.canonical({
        "kind": "aggregateEvidence",
        "job": job,
        "round": rnd,
        "start": _hex(start),
        "revealed": [{"op": op, "hash": h} for op, (h, _) in _by_address(revealed)],
        "confirmed": [{"op": op, "kind": k} for op, k in _by_address(confirmed)],
        "matcher": {"inputs": matcher_inputs or {}, "roster": [{"op": op, "shard": s} for op, s in roster]},
        "merge": {"accepted": eligible, "clipNorm": evidence.f64hex(clip), "trimPerSide": m.trim},
        "gate": {
            "valBefore": evidence.f64hex(g.loss_prev),
            "valAfter": evidence.f64hex(g.loss_new),
            "band": evidence.f64hex(band),
            "result": "reverted" if g.reverted else "dropped" if g.excluded else "pass",
            "leaveOneOut": [{"op": op, "valLoss": evidence.f64hex(x)} for op, x in g.loo],
            "dropped": g.excluded[0] if g.excluded else None,
        },
        "outer": {"kind": "avg"},
        "aggregate": _hex(agg_hash),
        "outcome": "Accepted" if accepted else "Reverted",
        "features": None,
        "handoffs": None,
        "detector": None,
    })
    pay_ev = evidence.canonical(evidence.pay_evidence(job, rnd, budget, eligible, graduated, split))

    # Forfeits are listed alongside payouts; the contract routes the forfeited amounts to the pool.
    owed = {**split["forfeits"], **split["payouts"]}
    settlement = {
        "outcome": ACCEPTED if accepted else REVERTED,
        "aggregateHash": agg_hash,
        "flaggedBitmap": sum(1 << slots.index(op) for op in g.excluded) if accepted else 0,
        "aggEvidenceHash": k256(agg_ev),
        "payEvidenceHash": k256(pay_ev),
        "payouts": _by_address(owed) if accepted else [],
    }
    return Finalized(g.w_new, settlement, agg_ev, pay_ev, new_blob if accepted else b"")


def message(job, rnd, s: dict) -> dict:
    """The EIP-712 FinalizeRound message each verifier signs for this Settlement."""
    return {
        "jobId": job,
        "roundId": rnd,
        "outcome": s["outcome"],
        "aggregateHash": s["aggregateHash"],
        "flaggedBitmap": s["flaggedBitmap"],
        "aggEvidenceHash": s["aggEvidenceHash"],
        "payEvidenceHash": s["payEvidenceHash"],
        "payoutsHash": encodings.payouts_hash(s["payouts"]),
    }


def check_sigs(job, rnd, s, chain_id, market, sigs, verifiers, threshold) -> list[str]:
    """Return the signers in order; raise unless `threshold` distinct known verifiers signed exactly this Settlement."""
    msg = message(job, rnd, s)
    signers = [encodings.recover("FinalizeRound", chain_id, market, msg, sig).lower() for sig in sigs]
    known = {v.lower() for v in verifiers}
    valid = {w for w in signers if w in known}
    if len(valid) < threshold or len(set(signers)) != len(signers):
        raise ValueError(f"need {threshold} distinct verifier signatures, got {len(valid)} valid of {len(signers)}")
    return signers
