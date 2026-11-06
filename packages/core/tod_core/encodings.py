"""Shared encodings: domain, commitment, seeds, epoch shuffle, cursor, EIP-712 types.

vectors/encodings.json pins every value; contracts/src/Encodings.sol computes the on-chain ones identically.
"""
from collections.abc import Sequence
from functools import lru_cache

from eth_abi import encode
from eth_account import Account
from eth_account.messages import encode_typed_data

from .hashing import k256

EIP712_NAME = "ToD"
EIP712_VERSION = "1"

# Invite and Consent are checked by NodeRegistry, FinalizeRound by JobMarket, EntryPass by Competitions.
# BlobAccess is checked by the coordinator off-chain and names JobMarket as verifyingContract, because job ids belong to it.
TYPES = {
    "Invite": [("operator", "address"), ("owner", "address"), ("nullifier", "bytes32"), ("deadline", "uint64")],
    "Consent": [("owner", "address"), ("operator", "address"), ("consentDeadline", "uint64")],
    "FinalizeRound": [
        ("jobId", "uint256"), ("roundId", "uint256"), ("outcome", "uint8"), ("aggregateHash", "bytes32"),
        ("flaggedBitmap", "uint32"), ("aggEvidenceHash", "bytes32"), ("payEvidenceHash", "bytes32"),
        ("payoutsHash", "bytes32"),
    ],
    "EntryPass": [("wallet", "address"), ("nullifier", "bytes32"), ("deadline", "uint64")],
    "BlobAccess": [
        ("jobId", "uint256"), ("roundId", "uint256"), ("blobHash", "bytes32"), ("method", "string"),
        ("expiry", "uint256"),
    ],
}
ACCEPTED, REVERTED = 0, 1


def domain(chain_id: int, market: str) -> bytes:
    return k256(encode(["uint256", "address"], [chain_id, market]))


def checkpoint_root(hs: Sequence[bytes]) -> bytes:
    return k256(b"".join(hs))


def commit_hash(dom: bytes, job: int, rnd: int, op: str, root: bytes, salt: bytes) -> bytes:
    return k256(encode(["bytes32", "uint256", "uint256", "address", "bytes32", "bytes32"],
                       [dom, job, rnd, op, root, salt]))


def task_seed(dom: bytes, job: int, rnd: int, shard: int, start_weights_hash: bytes) -> bytes:
    return k256(encode(["bytes32", "uint256", "uint256", "uint256", "bytes32"],
                       [dom, job, rnd, shard, start_weights_hash]))


def round_seed(blockhash: bytes, dom: bytes, job: int, rnd: int) -> bytes:
    return k256(encode(["bytes32", "bytes32", "uint256", "uint256"], [blockhash, dom, job, rnd]))


def segments_for(K: int) -> list[int]:
    # ponytail: full replay checks every segment; add a seeded draw when spec replay.coverage
    # "segments" is turned on.
    return list(range(K))


def epoch_seed(dom: bytes, job: int, shard: int, epoch: int) -> bytes:
    return k256(encode(["bytes32", "uint256", "uint256", "uint256"], [dom, job, shard, epoch]))


@lru_cache(maxsize=64)
def permutation(seed: bytes, n: int) -> tuple[int, ...]:
    """Fisher-Yates from the top: swap i with j = keccak(abi.encode(seed, i)) mod (i + 1)."""
    p = list(range(n))
    for i in range(n - 1, 0, -1):
        j = int.from_bytes(k256(seed + i.to_bytes(32, "big")), "big") % (i + 1)
        p[i], p[j] = p[j], p[i]
    return tuple(p)


def shard_rows(entry: dict, rows: Sequence[int] | None = None) -> Sequence[int]:
    """Dataset rows of one shard-table entry; a {rowsHash, len} entry needs its row list fetched by hash."""
    if "start" in entry:
        return range(entry["start"], entry["start"] + entry["len"])
    if rows is None or len(rows) != entry["len"]:
        raise ValueError("row list missing or wrong length")
    return rows


def cursor(rounds_done: int, H: int, B: int) -> int:
    """Samples already trained on a shard: rounds_done counts Accepted rounds that trained it."""
    return rounds_done * H * B


def batch(dom: bytes, job: int, shard: int, rows: Sequence[int], rounds_done: int, H: int, B: int, s: int) -> list[int]:
    """Rows of step s; an epoch is one pass over the shard without replacement, and batches run across epochs."""
    n, c = len(rows), cursor(rounds_done, H, B) + s * B
    return [rows[permutation(epoch_seed(dom, job, shard, i // n), n)[i % n]] for i in range(c, c + B)]


def shard_table_hash(shards: Sequence[dict]) -> bytes:
    """keccak(abi.encode((uint256 start, bytes32 rowsHash, uint256 len)[])); the unused field is zero."""
    t = [(s.get("start", 0), bytes.fromhex(s.get("rowsHash", "0x" + "00" * 32)[2:]), s["len"]) for s in shards]
    return k256(encode(["(uint256,bytes32,uint256)[]"], [t]))


def payouts_hash(payouts: Sequence[tuple[str, int]]) -> bytes:
    return k256(encode(["(address,uint256)[]"], [list(payouts)]))


def _type_string(primary: str) -> str:
    return primary + "(" + ",".join(f"{t} {n}" for n, t in TYPES[primary]) + ")"


def struct_hash(primary: str, msg: dict) -> bytes:
    vals = [k256(msg[n].encode()) if t == "string" else msg[n] for n, t in TYPES[primary]]
    kinds = ["bytes32" if t == "string" else t for _, t in TYPES[primary]]
    return k256(encode(["bytes32", *kinds], [k256(_type_string(primary).encode()), *vals]))


def domain_separator(chain_id: int, contract: str) -> bytes:
    th = k256(b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
    return k256(encode(["bytes32", "bytes32", "bytes32", "uint256", "address"],
                       [th, k256(EIP712_NAME.encode()), k256(EIP712_VERSION.encode()), chain_id, contract]))


def digest(primary: str, chain_id: int, contract: str, msg: dict) -> bytes:
    return k256(b"\x19\x01" + domain_separator(chain_id, contract) + struct_hash(primary, msg))


def typed_data(primary: str, chain_id: int, contract: str, msg: dict) -> dict:
    return {
        "types": {
            "EIP712Domain": [{"name": "name", "type": "string"}, {"name": "version", "type": "string"},
                             {"name": "chainId", "type": "uint256"}, {"name": "verifyingContract", "type": "address"}],
            primary: [{"name": n, "type": t} for n, t in TYPES[primary]],
        },
        "primaryType": primary,
        "domain": {"name": EIP712_NAME, "version": EIP712_VERSION, "chainId": chain_id, "verifyingContract": contract},
        "message": msg,
    }


def sign(key: bytes, primary: str, chain_id: int, contract: str, msg: dict) -> bytes:
    return bytes(Account.sign_typed_data(key, full_message=typed_data(primary, chain_id, contract, msg)).signature)


def recover(primary: str, chain_id: int, contract: str, msg: dict, sig: bytes) -> str:
    return Account.recover_message(encode_typed_data(full_message=typed_data(primary, chain_id, contract, msg)),
                                   signature=sig)
