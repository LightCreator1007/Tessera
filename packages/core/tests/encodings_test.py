"""vectors/encodings.json matches tod_core.encodings, and the shuffle and EIP-712 rules hold."""
import json

from eth_account import Account
from eth_account.messages import encode_typed_data

from tod_core import encodings as enc
from tod_core.encodings_vectors import PATH, build, dump
from tod_core.hashing import k256

V = json.loads(PATH.read_text())


def test_vectors_file_is_current():
    # Regenerate with `uv run python -m tod_core.encodings_vectors`; changing it is an INTERFACE change.
    assert PATH.read_text() == dump(build())


def test_each_epoch_visits_every_row_once():
    for b in V["batch"]:
        n = b["entry"]["len"]
        flat = [r for step in b["steps"] for r in step]
        start = b["cursor"] % n
        rows = set(enc.shard_rows(b["entry"]))
        # The first complete epoch inside this round's samples must be a permutation of the shard.
        first_full = (n - start) % n
        if first_full + n <= len(flat):
            assert set(flat[first_full:first_full + n]) == rows


def test_batches_cross_epoch_boundaries():
    b = V["batch"][0]
    assert b["cursor"] == 0 and b["steps"][2][:2] == [100 + p for p in V["permutation"][2]["perm"][8:10]]
    # Round 1 starts where round 0 stopped, so a reassigned shard needs no node state.
    assert V["batch"][1]["cursor"] == 3 * 4


def test_permutations_are_permutations():
    for p in V["permutation"]:
        assert sorted(p["perm"]) == list(range(p["n"]))


def test_row_list_entry_needs_its_rows():
    entry = {"rowsHash": "0x" + "11" * 32, "len": 2}
    assert list(enc.shard_rows(entry, [9, 4])) == [9, 4]
    for bad in (None, [1]):
        try:
            enc.shard_rows(entry, bad)
        except ValueError:
            continue
        raise AssertionError("accepted a missing or short row list")


def _msg(e):
    return {n: bytes.fromhex(e["message"][n][2:]) if t.startswith("bytes") else
            int(e["message"][n]) if t.startswith("uint") else e["message"][n] for n, t in enc.TYPES[e["primaryType"]]}


def test_eip712_digest_matches_eth_account_and_recovers():
    for e in V["eip712"]:
        td = enc.typed_data(e["primaryType"], e["chainId"], e["verifyingContract"], _msg(e))
        s = encode_typed_data(full_message=td)
        # Our hand-rolled struct hashing against eth_account's independent EIP-712 encoder.
        assert "0x" + k256(b"\x19" + s.version + s.header + s.body).hex() == e["digest"]
        assert Account.recover_message(s, signature=bytes.fromhex(e["signature"][2:])) == e["signer"]


def test_blob_access_vectors_cover_roles_and_expiry():
    blobs = [e for e in V["eip712"] if e["primaryType"] == "BlobAccess"]
    assert {e["signerRole"] for e in blobs} >= {"operator", "verifierA", "requester"}
    assert {e["message"]["method"] for e in blobs} == {"GET", "PUT"}
    for e in blobs:
        assert e["fresh"] == (e["now"] <= e["message"]["expiry"] <= e["now"] + 300)
    assert not all(e["fresh"] for e in blobs)


def test_full_replay_checks_every_segment():
    assert enc.segments_for(4) == [0, 1, 2, 3]


def test_signature_is_bound_to_chain_contract_and_payload():
    e = V["eip712"][0]
    primary, chain, contract = e["primaryType"], e["chainId"], e["verifyingContract"]
    msg, sig = _msg(e), bytes.fromhex(e["signature"][2:])
    assert enc.recover(primary, chain + 1, contract, msg, sig) != e["signer"]
    assert enc.recover(primary, chain, "0x" + "11" * 20, msg, sig) != e["signer"]
    assert enc.recover(primary, chain, contract, {**msg, "deadline": msg["deadline"] + 1}, sig) != e["signer"]


def test_signature_is_bound_to_the_application_name(monkeypatch):
    e = V["eip712"][0]
    monkeypatch.setattr(enc, "EIP712_NAME", "AnotherApp")
    assert enc.recover(e["primaryType"], e["chainId"], e["verifyingContract"],
                       _msg(e), bytes.fromhex(e["signature"][2:])) != e["signer"]
