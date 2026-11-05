"""Evidence documents: the canonical JSON encoding and the pay evidence for a round.

Readers hash the exact bytes they receive and never re-serialise, so the same content must
always give the same bytes: sorted keys, no whitespace, and no floats.
"""
import json
import struct


def f64hex(x):
    """A float64 written as its IEEE-754 bit pattern, 16 big-endian hex digits."""
    return struct.pack(">d", x).hex()


def _reject_floats(value):
    if isinstance(value, float):
        raise TypeError("write floats with f64hex; JSON floats do not round-trip byte for byte")
    children = value.values() if isinstance(value, dict) else value if isinstance(value, (list, tuple)) else ()
    for child in children:
        _reject_floats(child)


def canonical(doc):
    _reject_floats(doc)
    return json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def pay_evidence(job, round_, budget, eligible, graduated, result):
    """The document hashed into finalizeRound's payEvidenceHash. `result` comes from payout.equal.

    The Shapley fields (players, vTable, phi, slice) are reserved for contribution-based pay and
    stay null under equal pay.
    """
    nodes = sorted(eligible, key=lambda a: int(a, 16))
    paid, forfeits = result["payouts"], result["forfeits"]
    return {
        "job": job,
        "round": round_,
        "mode": "equal",
        "budget": budget,
        "eligible": nodes,
        "graduated": [a for a in nodes if graduated[a]],
        "payouts": [{"op": a, "amount": paid[a]} for a in nodes if a in paid],
        "forfeits": [{"op": a, "amount": forfeits[a]} for a in nodes if a in forfeits],
        "toPool": result["toPool"],
        "drip": result["drip"],
        "players": None,
        "vTable": None,
        "phi": None,
        "slice": None,
    }
