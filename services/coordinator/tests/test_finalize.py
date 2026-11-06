"""finalize: gate outcomes, pay invariants, evidence against the schema, and verifier signatures over the Settlement."""
import json
from pathlib import Path

import jsonschema
import numpy as np
import pytest
from eth_account import Account

from tod_core import encodings, finalize as F
from tod_core.hashing import k256

SCHEMA = json.loads((Path(__file__).resolve().parents[3] / "vectors/evidence.schema.json").read_text())
OPS = ["0x" + f"{i:02x}" * 20 for i in range(1, 6)]
SPEC = b"\7" * 32
G = np.zeros(6, dtype=np.float32)
H = "0x" + "aa" * 32
HONEST = np.array([.5, .5, .5, 0, 0, 0], dtype=np.float32)
POISON = np.array([0, 0, 0, 5, 0, 0], dtype=np.float32)
BUDGET = 1_000_000


def val(w):
    """Lowest when the first three weights are 1 and the fourth is 0, so HONEST helps and POISON hurts."""
    return float(np.sum((w[:3] - 1) ** 2) + w[3] ** 2)


def run(updates, loss=val, graduated=None, confirmed=None, **kw):
    roster = [(op, slot) for slot, op in enumerate(OPS)]
    revealed = {op: (H, G + d) for op, d in zip(OPS, updates)}
    f = F.finalize(7, 3, SPEC, G, roster, revealed, confirmed or {}, loss, BUDGET,
                   graduated or dict.fromkeys(OPS, False), **kw)
    for doc in (f.agg_evidence, f.pay_evidence):
        jsonschema.validate(json.loads(doc), SCHEMA)
    return f


def test_honest_round_is_accepted_and_pays_everyone():
    f = run([HONEST] * 5)
    s = f.settlement
    assert s["outcome"] == F.ACCEPTED and s["flaggedBitmap"] == 0
    assert [op for op, _ in s["payouts"]] == OPS and sum(a for _, a in s["payouts"]) == BUDGET
    assert s["aggregateHash"] == k256(f.weights_blob) and s["aggEvidenceHash"] == k256(f.agg_evidence)
    assert s["payEvidenceHash"] == k256(f.pay_evidence)


def test_gate_drops_one_poisoner_and_flags_its_slot():
    # A tight band, so the merge with both poisoners fails and leave-one-out drops one of them.
    f = run([HONEST] * 3 + [POISON] * 2, rel_tol=-0.6, abs_tol=0)
    ev = json.loads(f.agg_evidence)
    dropped = ev["gate"]["dropped"]
    assert ev["gate"]["result"] == "dropped" and len(ev["gate"]["leaveOneOut"]) == 5
    assert f.settlement["flaggedBitmap"] == 1 << OPS.index(dropped)
    assert len(f.settlement["payouts"]) == 4 and ev["merge"]["accepted"] == [o for o in OPS if o != dropped]


def test_failed_gate_reverts_to_the_start_weights_and_pays_nobody():
    f = run([HONEST] * 5, loss=lambda w: 0.0 if not w.any() else 100.0)
    s = f.settlement
    assert s["outcome"] == F.REVERTED and s["payouts"] == [] and s["flaggedBitmap"] == 0
    assert s["aggregateHash"] == k256(F.to_blob(SPEC, G)) and f.weights_blob == b""


def test_round_with_every_node_confirmed_failed_is_reverted():
    f = run([HONEST] * 5, confirmed=dict.fromkeys(OPS, "ReplayMismatch"))
    assert f.settlement["outcome"] == F.REVERTED


def test_confirmed_node_is_unpaid_and_graduates_get_the_locked_drip():
    grad = {op: op in OPS[:2] for op in OPS}
    f = run([HONEST] * 5, graduated=grad, confirmed={OPS[4]: "ReplayDrift"}, pool=500_000, drip=50_000)
    pay = dict(f.settlement["payouts"])
    # Forfeits stay in the list; the contract moves them to the pool.
    assert OPS[4] not in pay and sum(pay.values()) == BUDGET + 50_000
    with pytest.raises(ValueError):
        run([HONEST] * 5, graduated=grad, pool=500_000, drip=1)  # not the drip locked at open


def test_settlement_needs_threshold_distinct_verifiers():
    f = run([HONEST] * 5)
    a, b = Account.create(), Account.create()
    msg = F.message(7, 3, f.settlement)

    def sign(acct):
        return encodings.sign(bytes(acct.key), "FinalizeRound", 31337, OPS[0], msg)

    signers = F.check_sigs(7, 3, f.settlement, 31337, OPS[0], [sign(a), sign(b)], [a.address, b.address], 2)
    assert signers == [a.address.lower(), b.address.lower()]
    for bad in ([sign(a)], [sign(a), sign(a)]):
        with pytest.raises(ValueError):
            F.check_sigs(7, 3, f.settlement, 31337, OPS[0], bad, [a.address, b.address], 2)
