"""Equal pay: dust, forfeits, the drip, empty rounds, tampering, and the money invariant on random rounds."""
import random

import pytest

from tod_core import payout

# Mixed checksum casing on purpose: ordering must go by numeric value.
A, B, C = "0x" + "0a" * 20, "0x" + "0B" * 20, "0x" + "0c" * 20
ALL = {A: True, B: True, C: True}


def test_dust_goes_to_the_lowest_address():
    r = payout.equal(10_000_001, [C, B, A], ALL)
    assert r["payouts"] == {A: 3_333_335, B: 3_333_333, C: 3_333_333}
    assert r["toPool"] == 0 and r["drip"] == 0


def test_single_node_takes_the_whole_budget():
    assert payout.equal(7, [A], {A: True})["payouts"] == {A: 7}


def test_probation_nodes_forfeit_and_the_drip_waits():
    r = payout.equal(9, [A, B, C], dict.fromkeys(ALL, False), pool=1_000)
    assert r["payouts"] == {} and r["toPool"] == 9 and r["drip"] == 0


def test_drip_is_shared_by_graduated_nodes_only():
    # 10% of a 200 pool is a drip of 20, split over B and C.
    r = payout.equal(30, [A, B, C], {A: False, B: True, C: True}, pool=200)
    assert r["forfeits"] == {A: 10} and r["toPool"] == 10
    assert r["drip"] == 20 and r["payouts"] == {B: 20, C: 20}


def test_drip_never_exceeds_the_budget():
    r = payout.equal(10, [A], {A: True}, pool=10**9)
    assert r["drip"] == 10 and r["payouts"] == {A: 20}


def test_empty_round_pays_nobody():
    assert payout.equal(100, [], {}, pool=500) == {"payouts": {}, "forfeits": {}, "toPool": 0, "drip": 0}


def test_duplicate_node_is_rejected():
    with pytest.raises(ValueError):
        payout.equal(10, [A, A], {A: True})


def test_check_catches_a_changed_amount_or_payee():
    r = payout.equal(30, [A, B, C], ALL)
    r["payouts"][A] += 1
    with pytest.raises(ValueError):
        payout.check(30, [A, B, C], r)
    with pytest.raises(ValueError):
        payout.check(30, [A, B], payout.equal(30, [A, B, C], ALL))


def test_invariant_holds_on_random_rounds():
    rng = random.Random(0)
    for _ in range(2_000):
        nodes = ["0x%040x" % rng.getrandbits(160) for _ in range(rng.randint(1, 8))]
        grad = {a: rng.random() < 0.5 for a in nodes}
        budget, pool = rng.randint(0, 10**9), rng.randint(0, 10**9)
        r = payout.equal(budget, nodes, grad, pool=pool)  # equal() runs check() itself
        if any(grad.values()):
            shares = [*r["payouts"].values(), *r["forfeits"].values()]
            assert max(shares) - min(shares) <= budget % len(nodes) + r["drip"]
