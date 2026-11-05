"""Settlement signatures: verifiers only, each for itself, and only over the Settlement the coordinator built."""
import pytest
from eth_account import Account
from fastapi.testclient import TestClient

import finalize as F
from api import app as A, config, tables as T
from tod_core import encodings

c = TestClient(A.app)
V1, V2, OTHER = Account.create(), Account.create(), Account.create()
S = {"outcome": 0, "aggregateHash": b"\1" * 32, "flaggedBitmap": 0, "aggEvidenceHash": b"\2" * 32,
     "payEvidenceHash": b"\3" * 32, "payouts": [("0x" + "aa" * 20, 100)]}
PATH = "/v1/jobs/1/rounds/1/signatures"


@pytest.fixture(autouse=True)
def pending(monkeypatch):
    monkeypatch.setattr(config, "VERIFIERS", [V1.address, V2.address])
    monkeypatch.setitem(T.SETTLEMENTS, (1, 1), {"settlement": S, "sigs": {}})


def settle_sig(acct, s=S):
    msg = F.message(1, 1, s)
    return "0x" + encodings.sign(bytes(acct.key), "FinalizeRound", config.CHAIN_ID, config.JOB_MARKET, msg).hex()


def hand_in(post, acct, sig=None, verifier=None, path=PATH):
    return post(acct, path, {"verifier": (verifier or acct).address, "signature": sig or settle_sig(acct)})


def test_two_verifiers_are_collected_and_a_repeat_replaces(node_post):
    assert hand_in(node_post, V1).json() == {"collected": 1, "threshold": 2}
    assert hand_in(node_post, V1).json()["collected"] == 1
    assert hand_in(node_post, V2).json() == {"collected": 2, "threshold": 2}


def test_only_verifiers_and_only_for_themselves(node_post):
    assert hand_in(node_post, OTHER).status_code == 403
    assert hand_in(node_post, V1, sig=settle_sig(V2), verifier=V2).status_code == 403  # V1 posting for V2


def test_signature_over_anything_else_is_refused(node_post):
    other = {**S, "aggregateHash": b"\x09" * 32}
    for sig in (settle_sig(V1, other), settle_sig(V2), "0xzz"):
        assert hand_in(node_post, V1, sig=sig).status_code == 422
    assert T.SETTLEMENTS[(1, 1)]["sigs"] == {}


def test_no_settlement_yet_is_404(node_post):
    assert hand_in(node_post, V1, path="/v1/jobs/1/rounds/2/signatures").status_code == 404


def test_settlement_route_shows_the_fields_digest_and_count(node_post):
    got = c.get("/v1/jobs/1/rounds/1/settlement").json()
    assert got["aggregateHash"] == "0x" + "01" * 32 and got["outcome"] == 0 and got["collected"] == 0
    assert got["payouts"] == [{"op": "0x" + "aa" * 20, "amount": 100}]
    msg = F.message(1, 1, S)
    assert got["payoutsHash"] == "0x" + msg["payoutsHash"].hex()
    assert got["digest"] == "0x" + encodings.digest("FinalizeRound", config.CHAIN_ID, config.JOB_MARKET, msg).hex()
    hand_in(node_post, V1)
    assert c.get("/v1/jobs/1/rounds/1/settlement").json()["collected"] == 1
    assert c.get("/v1/jobs/1/rounds/2/settlement").status_code == 404
