"""World ID 4.0: the RP signature against World's published test vectors, and proof checks with the verify API stubbed."""
import pytest
from eth_account import Account
from eth_account.messages import encode_defunct

from identity import worldid as w

NONCE = bytes.fromhex("008ae1aa597fa146ebd3aa2ceddf360668dea5e526567e92b0321816a4e895bd")
KEY = "0x" + "ab" * 32
OWNER = "0x6dA648638205177ee2138c0654cf72AE884f7B05"


@pytest.mark.parametrize("data,out", [
    (b"", "00c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a4"),
    (b"test_signal", "00c1636e0a961a3045054c4d61374422c31a95846b8442f0927ad2ff1d6112ed"),
    (bytes([1, 2, 3]), "00f1885eda54b7a053318cd41e2093220dab15d65381b1157a3633a83bfd5c92"),
    (b"hello", "001c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36dea"),
])
def test_hash_to_field_vectors(data, out):
    assert w.hash_to_field(data).hex() == out


def test_rp_message_vectors():
    base = "01008ae1aa597fa146ebd3aa2ceddf360668dea5e526567e92b0321816a4e895bd000000006553f100000000006553f22c"
    assert w.rp_message(NONCE, 1700000000, 1700000300, None).hex() == base
    action = "00aa0ce59768ae5b1c52f07a9387f14f09f277422c0d2f8a268c7bad0c60a46a"
    assert w.rp_message(NONCE, 1700000000, 1700000300, "test-action").hex() == base + action


@pytest.mark.parametrize("action,sig", [
    (None, "0x14f693175773aed912852a601e9c0fd30f2afe2738d31388316232ce6f64ae9e"
           "4edbfb19d81c4229ba9c9fca78ede4b28956b7ba4415f08d957cbc1b3bdaa4021b"),
    ("test-action", "0x05594adb6c1495768a38d523d7d6ee6356b2c31231919198794ed022ade7d08f"
                    "73753f83bd167067d99c9b969d28e9222315837c66af25867b041273a6d5056f1b"),
])
def test_sign_request_vectors(action, sig):
    out = w.sign_request(KEY, action, now=1700000000, rand=bytes(range(32)))
    assert out == {"sig": sig, "nonce": "0x" + NONCE.hex(), "created_at": 1700000000, "expires_at": 1700000300}


def result(owner=OWNER, identifier="proof_of_human", env=None, action=None):
    return {"protocol_version": "4.0", "nonce": "0x01", "action": action or w.ACTION,
            "environment": env or w.ENVIRONMENT,
            "responses": [{"identifier": identifier, "issuer_schema_id": 1, "nullifier": "0x2a", "expires_at_min": 0,
                           "proof": ["0x0"] * 5, "signal_hash": "0x" + w.hash_to_field(w.signal_for(owner).encode()).hex()}]}


def ok(_):
    return 200, {"success": True, "environment": w.ENVIRONMENT}


def test_verify_returns_bytes32_nullifier_and_credential():
    assert w.verify(result(), OWNER, post=ok) == ("0x" + "00" * 31 + "2a", "orb")
    v4 = result()
    v4["responses"][0]["nullifier"] = "42"  # 4.0 nullifiers are decimal strings
    assert w.verify(v4, OWNER, post=ok)[0] == "0x" + "00" * 31 + "2a"
    assert w.verify(result(identifier="selfie"), OWNER, post=ok)[1] == "selfie"


@pytest.mark.parametrize("res,post", [
    (result(owner=Account.create().address), ok),  # proof bound to another wallet
    (result(env="production"), ok),  # wrong environment
    (result(action="other"), ok),  # wrong action
    (result(identifier="passport"), ok),  # not a credential we accept
    (result(), lambda _: (400, {"success": False, "code": "all_verifications_failed", "detail": "x"})),
    (result(), lambda _: (403, {})),  # non-JSON edge error, parsed to {}
])
def test_verify_rejects(res, post):
    with pytest.raises(w.Rejected):
        w.verify(res, OWNER, post=post)


def test_signature_recovers_to_signing_key():
    out = w.sign_request(KEY, w.ACTION)
    msg = w.rp_message(bytes.fromhex(out["nonce"][2:]), out["created_at"], out["expires_at"], w.ACTION)
    assert Account.recover_message(encode_defunct(primitive=msg), signature=out["sig"]) == Account.from_key(KEY).address


def test_non_json_error_body_is_not_a_crash():
    assert w._json(b"error code: 1010\n") == {} and w._json(b'{"a": 1}') == {"a": 1}


def test_verify_forwards_the_idkit_result_unchanged():
    sent = []
    res = result(identifier="selfie")
    res["responses"][0]["sybil_score"] = 2
    res["integrity_bundle"] = {"v": 2, "sig": "0xab"}
    w.verify(res, OWNER, post=lambda body: sent.append(body) or ok(body))
    assert sent == [res]


def test_sybil_score_only_from_a_selfie_response():
    res = result(identifier="selfie")
    res["responses"][0]["sybil_score"] = -1
    assert w.sybil_score(res) == -1
    assert w.sybil_score(result()) is None
