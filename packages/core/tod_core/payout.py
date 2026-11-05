"""Splits a round's budget equally across the nodes that earned it, plus the community drip.

Amounts are whole token units (6 decimals). Addresses are ordered by numeric value, so the
"lowest address gets the dust" rule gives the same answer whatever the checksum casing.
"""


def _ordered(addrs):
    return sorted(addrs, key=lambda a: int(a, 16))


def _even(amount, addrs):
    """Equal integer shares of `amount`; the remainder goes to the first (lowest) address."""
    if not addrs:
        return {}
    each, rest = divmod(amount, len(addrs))
    shares = dict.fromkeys(addrs, each)
    shares[addrs[0]] += rest
    return shares


def equal(budget, eligible, graduated, pool=0, drip_bps=1000):
    """Split one round's budget over the eligible nodes.

    eligible:  nodes that revealed, passed both verifiers and survived the validation gate
    graduated: {op: bool}, each owner's graduation status as read when the round opened
    pool:      community pool balance before this round

    Graduated nodes are paid their share plus an even cut of the drip. Nodes still on probation
    forfeit their share to the pool. Returns {"payouts", "forfeits", "toPool", "drip"}; a reverted
    round passes eligible=[] and pays nobody.
    """
    nodes = _ordered(eligible)
    if len(set(nodes)) != len(nodes):
        raise ValueError("duplicate address in the eligible set")
    shares = _even(budget, nodes)
    grads = [a for a in nodes if graduated[a]]
    # With no graduated node to receive it, the drip stays in the pool for a later round.
    drip = min(pool * drip_bps // 10_000, budget) if grads else 0
    bonus = _even(drip, grads)
    forfeits = {a: shares[a] for a in nodes if not graduated[a]}
    result = {
        "payouts": {a: shares[a] + bonus[a] for a in grads},
        "forfeits": forfeits,
        "toPool": sum(forfeits.values()),
        "drip": drip,
    }
    check(budget, eligible, result)
    return result


def check(budget, eligible, result):
    """The money invariant the contract enforces. Run it before submitting anything on chain."""
    paid, forfeits = result["payouts"], result["forfeits"]
    allowed = set(eligible)
    if not (set(paid) | set(forfeits)) <= allowed:
        raise ValueError("payee outside the eligible set")
    if any(v < 0 for v in paid.values()):
        raise ValueError("negative payout")
    if not eligible:
        if paid or result["toPool"] or result["drip"]:
            raise ValueError("an empty eligible set must pay nobody")
    elif sum(paid.values()) + result["toPool"] != budget + result["drip"]:
        raise ValueError("payouts + toPool must equal budget + drip")
