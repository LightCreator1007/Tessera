"""Co-signing helpers: the validation rows and the field-by-field comparison with the coordinator's Settlement."""
from tod_verifier.cosign import differences, val_rows, wire

S = {"outcome": 0, "aggregateHash": b"\1" * 32, "flaggedBitmap": 0, "aggEvidenceHash": b"\2" * 32,
     "payEvidenceHash": b"\3" * 32, "payouts": [("0xAbC" + "0" * 37, 5)]}


def test_validation_rows_follow_the_spec_split():
    spec = {"data": {"shards": [{"start": 0, "len": 400}, {"start": 400, "len": 400}], "valFrac": "0.1",
                     "testFrac": "0.1"}}
    rows = val_rows(spec, 1000)
    assert rows[0] == 800 and len(rows) == 100


def test_differences_ignore_case_but_not_amounts():
    theirs = {**wire(S), "aggregateHash": "0x" + "01" * 32, "payouts": [{"op": "0xabc" + "0" * 37, "amount": 5}],
              "digest": "0x00", "collected": 1}
    assert differences(wire(S), theirs) == []
    theirs["payouts"][0]["amount"] = 6
    theirs["flaggedBitmap"] = 1
    assert differences(wire(S), theirs) == ["flaggedBitmap", "payouts"]


def test_a_kept_signature_is_offered_again_after_the_coordinator_loses_it(monkeypatch):
    import json as _json
    from types import SimpleNamespace

    from eth_account import Account
    from tod_core import encodings as enc
    from tod_core.finalize import message
    from tod_core.ledger import Phase, RoundStatus
    from tod_verifier import cosign

    market = SimpleNamespace(address="0x" + "33" * 20, phase=lambda j, r: int(Phase.FINALIZE), threshold=lambda: 2)
    digest = "0x" + enc.digest("FinalizeRound", 31337, market.address, message(1, 1, S)).hex()
    doc = _json.dumps({"matcher": {"inputs": {}}}).encode()
    coordinator = {"collected": 0, "payouts": wire(S)["payouts"]}
    posts = []

    class Api:
        def get_json(self, path):
            if path.endswith("/evidence"):
                return {"aggregate": {"hash": "0x" + "02" * 32}}
            return {**wire(S), "payouts": coordinator["payouts"], "digest": digest, "collected": coordinator["collected"]}

        def post_signed(self, path, body):
            posts.append(body["signature"])
            return {"collected": coordinator["collected"] + 1}

    monkeypatch.setattr(cosign, "recompute", lambda *a: SimpleNamespace(settlement=S))
    clock = [0.0]
    c = cosign.CoSigner(market, None, SimpleNamespace(c=SimpleNamespace(get=lambda *a: doc)), Api(),
                        Account.create().key, 31337, now=lambda: clock[0])
    state = SimpleNamespace(rounds={(1, 1): {"status": RoundStatus.OPEN}})

    c.tick(state)
    assert len(posts) == 1
    coordinator["collected"] = 1
    clock[0] += 5
    c.tick(state)
    assert len(posts) == 1  # the coordinator has it

    coordinator["collected"] = 0  # restarted before finalizing: same Settlement rebuilt, signatures gone
    c.tick(state)
    assert len(posts) == 1  # not before RESEND_SECONDS
    clock[0] += cosign.RESEND_SECONDS
    c.tick(state)
    assert posts == [posts[0], posts[0]]  # the same signature, not a new decision

    coordinator["collected"] = 2
    clock[0] += cosign.RESEND_SECONDS
    c.tick(state)
    assert len(posts) == 2  # threshold met, nothing more to send


def test_a_refused_settlement_is_never_signed_on_later_ticks(monkeypatch):
    from types import SimpleNamespace

    from eth_account import Account
    from tod_core.ledger import Phase, RoundStatus
    from tod_verifier import cosign

    market = SimpleNamespace(address="0x" + "33" * 20, phase=lambda j, r: int(Phase.FINALIZE), threshold=lambda: 2)
    posts = []

    class Api:
        def get_json(self, path):
            if path.endswith("/evidence"):
                return {"aggregate": {"hash": "0x" + "02" * 32}}
            doctored = [{"op": p["op"], "amount": p["amount"] + 1} for p in wire(S)["payouts"]]
            return {**wire(S), "payouts": doctored, "digest": "0x" + "ee" * 32, "collected": 0}

        def post_signed(self, path, body):
            posts.append(body)

    monkeypatch.setattr(cosign, "recompute", lambda *a: SimpleNamespace(settlement=S))
    clock = [0.0]
    c = cosign.CoSigner(market, None, SimpleNamespace(c=SimpleNamespace(get=lambda *a: b'{"matcher":{"inputs":{}}}')),
                        Api(), Account.create().key, 31337, now=lambda: clock[0])
    for _ in range(3):
        c.tick(SimpleNamespace(rounds={(1, 1): {"status": RoundStatus.OPEN}}))
        clock[0] += cosign.RESEND_SECONDS
    assert posts == [] and len(c.refused) == 1
