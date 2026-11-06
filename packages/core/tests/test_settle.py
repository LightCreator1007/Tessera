"""settle: chain state in, the same Settlement finalize would give, with the contract's graduation, drip and activity rules."""
from types import SimpleNamespace

import numpy as np
import pytest

from tod_core import payout
from tod_core.finalize import ACCEPTED, finalize
from tod_core.ledger import Kind
from tod_core.settle import graduated, pool_for, settle

OPS = ["0x" + f"{i:02x}" * 20 for i in range(1, 5)]
OWNERS = {op: "0x" + f"{i + 16:02x}" * 20 for i, op in enumerate(OPS)}
SPEC = {"gate": {"relTol": "0.1", "absTol": "0.01"}}
SPEC_HASH = b"\7" * 32
G = np.zeros(6, dtype=np.float32)
HONEST = np.array([.5, .5, .5, 0, 0, 0], dtype=np.float32)
OPENED, STAKE, BUDGET, DRIP = 1_000, 20_000_000, 1_000_000, 50_000


def val(w):
    return float(np.sum((w[:3] - 1) ** 2) + w[3] ** 2)


def chain(confirmed=None, stakes=None, revealed=OPS):
    nrs = {op: {"revealed": op in revealed, "confirmed": (confirmed or {}).get(op, Kind.NONE),
                "updateHash": bytes([i + 1]) * 32} for i, op in enumerate(OPS)}
    return SimpleNamespace(
        jobs={7: {"params": SimpleNamespace(stakePerNode=STAKE)}},
        rounds={(7, 3): {"nodes": OPS, "shards": [0, 1, 2, 3], "nodeRounds": nrs, "budget": BUDGET, "drip": DRIP,
                         "openedAt": OPENED}},
        nodes={op: {"owner": OWNERS[op], "stake": (stakes or {}).get(op, STAKE)} for op in OPS})


GRAD_AT = {OWNERS[OPS[0]]: OPENED - 1, OWNERS[OPS[1]]: OPENED}  # the second graduated in the same second: not yet


def run(state, **kw):
    weights = {op: G + HONEST for op in OPS}
    return settle(state, 7, 3, SPEC, SPEC_HASH, G, weights, val, lambda o: GRAD_AT.get(o, 0), 3600, 1000, **kw)


def test_graduation_follows_the_contract_rule():
    assert graduated(chain(), 7, 3, lambda o: GRAD_AT.get(o, 0), 3600) == {OPS[0]: True, OPS[1]: False,
                                                                           OPS[2]: False, OPS[3]: False}
    assert all(graduated(chain(), 7, 3, lambda o: 0, 0).values())  # no probation configured


@pytest.mark.parametrize("drip", [0, 1, 7, 99_999, 123_456_789])
def test_pool_reproduces_the_locked_drip(drip):
    assert payout.equal(BUDGET + drip, OPS, dict.fromkeys(OPS, True), pool_for(drip, 1000), 1000)["drip"] == drip


def test_settle_matches_a_direct_finalize_call():
    f = run(chain(confirmed={OPS[3]: Kind.REPLAY_MISMATCH}), matcher_inputs={"seed": "x"})
    hs = {op: "0x" + bytes([i + 1]).hex() * 32 for i, op in enumerate(OPS)}
    direct = finalize(7, 3, SPEC_HASH, G, list(zip(OPS, range(4))), {op: (hs[op], G + HONEST) for op in OPS},
                      {OPS[3]: "ReplayMismatch"}, val, BUDGET, {OPS[0]: True, OPS[1]: False, OPS[2]: False,
                      OPS[3]: False}, pool=500_000, drip=DRIP, drip_bps=1000, matcher_inputs={"seed": "x"})
    assert f.settlement == direct.settlement and f.agg_evidence == direct.agg_evidence
    s = f.settlement
    assert s["outcome"] == ACCEPTED and [op for op, _ in s["payouts"]] == OPS[:3]
    assert sum(a for _, a in s["payouts"]) == BUDGET + DRIP  # forfeits sit inside payouts, as the contract wants


def test_inactive_and_unrevealed_nodes_are_not_paid():
    s = run(chain(stakes={OPS[1]: STAKE // 2 - 1}, revealed=OPS[:3])).settlement
    assert [op for op, _ in s["payouts"]] == [OPS[0], OPS[2]]


def test_missing_weights_refuse_to_settle():
    with pytest.raises(ValueError, match="no final weights"):
        settle(chain(), 7, 3, SPEC, SPEC_HASH, G, {OPS[0]: G}, val, lambda o: 0, 0, 1000)


def test_a_confirmed_node_needs_no_weights():
    """A cheat's claimed final hash may name no blob at all; it is excluded, so settling must not need it."""
    from tod_core.settle import needs_weights
    state = chain(confirmed={OPS[3]: Kind.REPLAY_MISMATCH})
    assert needs_weights(state, 7, 3) == OPS[:3]
    f = settle(state, 7, 3, SPEC, SPEC_HASH, G, {op: G + HONEST for op in OPS[:3]}, val, lambda o: 0, 0, 1000)
    assert [op for op, _ in f.settlement["payouts"]] == OPS[:3]
