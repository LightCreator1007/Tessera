"""A job's data as shard files: cut from the canonical order, hashed, listed on Arkiv, and fetched from Swarm by job id."""
import json
import urllib.request
from dataclasses import dataclass

import numpy as np
from eth_utils import to_checksum_address

from tod_core.blob import k256

from .canonical import Canonical, DatasetError, split

MAGIC = b"tod-shard/1\n"
SCHEMA = "tod.shards"  # the Arkiv arkiv.schema tag of a job's shard list
# Rows per file are capped so no single upload or download gets unmanageable as datasets grow.
PIECE_BYTES = 500_000_000


@dataclass(frozen=True)
class Piece:
    part: str  # "train" or "val"
    shard: int | None  # train shard index; None for val
    piece: int  # index of this file within its shard; a shard over PIECE_BYTES spans several
    start: int
    len: int
    data: bytes
    keccak: str


def _encode(datasetHash: str, start: int, X: np.ndarray, y: np.ndarray) -> bytes:
    # Hand-rolled instead of .npz, whose zip timestamps would give the same rows different bytes on every run.
    head = json.dumps({"datasetHash": datasetHash, "start": start, "x": [X.dtype.str, list(X.shape)],
                       "y": [y.dtype.str, list(y.shape)]}, sort_keys=True, separators=(",", ":")).encode()
    return MAGIC + len(head).to_bytes(4, "big") + head + X.tobytes() + y.tobytes()


def parse(data: bytes, keccak: str) -> tuple[np.ndarray, np.ndarray]:
    """Rows of a shard file, after checking the bytes are the ones the manifest lists."""
    if "0x" + k256(data).hex() != keccak:
        raise DatasetError("shard bytes do not match their keccak")
    if not data.startswith(MAGIC):
        raise DatasetError("not a shard file")
    n = int.from_bytes(data[len(MAGIC):len(MAGIC) + 4], "big")
    body = len(MAGIC) + 4 + n
    head = json.loads(data[len(MAGIC) + 4:body])
    (xd, xs), (yd, ys) = head["x"], head["y"]
    xn = int(np.dtype(xd).itemsize * np.prod(xs))
    X = np.frombuffer(data, xd, offset=body, count=int(np.prod(xs))).reshape(xs)
    y = np.frombuffer(data, yd, offset=body + xn, count=int(np.prod(ys))).reshape(ys)
    return X, y


def partition(c: Canonical, n_shards: int, val_frac, test_frac, max_bytes: int = PIECE_BYTES) -> list[Piece]:
    """Train shards plus the validation slice, exactly as canonical.split cuts them, each cut into files of at most
    max_bytes of rows. Test rows aren't needed by any node or verifier, so they stay out."""
    s = split(c.card.rows, n_shards, val_frac, test_frac)
    cuts = [("train", i, e["start"], e["len"]) for i, e in enumerate(s["shards"])] + [("val", None, *s["val"])]
    row_bytes = c.X[:1].nbytes + c.y[:1].nbytes
    per = max(1, max_bytes // row_bytes)  # depends only on the dataset's row size, so every party cuts the same way
    out = []
    for part, shard, start, n in cuts:
        for k, lo in enumerate(range(start, start + n, per)):
            hi = min(lo + per, start + n)
            data = _encode(c.card.hash, lo, c.X[lo:hi], c.y[lo:hi])
            out.append(Piece(part, shard, k, lo, hi - lo, data, "0x" + k256(data).hex()))
    return out


def manifest(datasetHash: str, pieces: list[Piece], refs: dict[str, str]) -> dict:
    """The job's shard list as it goes in the Arkiv payload; refs maps each piece's keccak to its Swarm reference."""
    return {"version": 1, "kind": SCHEMA, "datasetHash": datasetHash,
            "pieces": [{"part": p.part, "shard": p.shard, "piece": p.piece, "start": p.start, "len": p.len, "keccak": p.keccak,
                        "size": len(p.data), "swarmRef": refs[p.keccak]} for p in pieces]}


class Rows:
    """One shard's rows, indexed by dataset row number, so the trainer's X[rows] works on a shard alone."""

    def __init__(self, a: np.ndarray, start: int):
        self.a, self.start = a, start

    def __len__(self):
        return len(self.a)

    def __getitem__(self, rows):
        i = np.asarray(rows) - self.start
        if i.size and (i.min() < 0 or i.max() >= len(self.a)):
            raise IndexError("row is outside this shard")
        return self.a[i]


def _rpc(url: str, method: str, params: list, access_key: str = ""):
    headers = {"Content-Type": "application/json", **({"X-API-KEY": access_key} if access_key else {})}
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    with urllib.request.urlopen(urllib.request.Request(url, body, headers), timeout=30) as r:
        res = json.loads(r.read())
    if res.get("error"):
        raise RuntimeError(f"{method}: {res['error'].get('message', res['error'])}")
    return res["result"]


def _get(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read()


def lookup(arkiv_rpc: str, writer: str, chain_id: int, market: str, job: int, access_key: str = "") -> dict | None:
    """A job's shard list from Arkiv. Filtered on the writer's address, since anyone can write any tag."""
    q = (f"arkiv.schema = str('{SCHEMA}') AND $owner = addr({to_checksum_address(writer)}) "
         f"AND chainId = u64({chain_id}) AND jobMarket = addr({to_checksum_address(market)}) AND job = u64({job})")
    rows = (_rpc(arkiv_rpc, "arkiv_query", [q, {"select": {"key": True, "attributes": True}, "limit": "0x1"}],
                 access_key) or {}).get("data") or []
    if not rows:
        return None
    value = next(a["value"] for a in rows[0]["attributes"] if a["name"] == "payload")
    return json.loads(bytes.fromhex(value[2:]) if value.startswith("0x") else value)


def fetch(m: dict, part: str, shard: int | None, swarm_api: str) -> tuple[np.ndarray, np.ndarray]:
    """Downloads a shard's pieces from any Bee node or gateway, checks each against its keccak, and joins them."""
    ps = sorted((p for p in m["pieces"] if p["part"] == part and p["shard"] == shard), key=lambda p: p["piece"])
    if not ps:
        raise DatasetError(f"no {part} shard {shard} in this job's shard list")
    got = [parse(_get(f"{swarm_api.rstrip('/')}/bytes/{p['swarmRef']}"), p["keccak"]) for p in ps]
    return np.concatenate([X for X, _ in got]), np.concatenate([y for _, y in got])
