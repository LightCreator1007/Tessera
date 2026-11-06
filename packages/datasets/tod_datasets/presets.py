"""Preset datasets (MNIST, CIFAR-10): pinned sources, byte-level parsers, and canonicalisation."""
import gzip
import hashlib
import io
import os
import shutil
import tarfile
import threading
import urllib.request
from pathlib import Path

import numpy as np

from .canonical import Canonical, DatasetError, from_arrays

MNIST_URL = "https://storage.googleapis.com/cvdf-datasets/mnist/"
CIFAR_URL = "https://www.cs.toronto.edu/~kriz/"

SOURCES = {
    "mnist": {
        MNIST_URL + "train-images-idx3-ubyte.gz": "440fcabf73cc546fa21475e81ea370265605f56be210a4024d2ca8f203523609",
        MNIST_URL + "train-labels-idx1-ubyte.gz": "3552534a0a558bbed6aed32b30c495cca23d567ec52cac8be1a0730e8010255c",
        MNIST_URL + "t10k-images-idx3-ubyte.gz": "8d422c7b0a1c1c79245a5bcf07fe86e33eeafee792b84584aec276f5a2dbc4e6",
        MNIST_URL + "t10k-labels-idx1-ubyte.gz": "f7ae60f92e00ec6debd23a6088c31dbd2371eca3ffa0defaefb259924204aec6",
    },
    # The binary release, not the python one: unpickling a downloaded file can run code.
    "cifar10": {CIFAR_URL + "cifar-10-binary.tar.gz": "c4a38c50a1bc5f3a1c5537f2155ab9d68f9f25eb1ed8d9ddda3db29a59bca1dd"},
}


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(name: str, cache: Path) -> dict[str, Path]:
    """Download each source file once into cache and check its pinned sha256."""
    cache.mkdir(parents=True, exist_ok=True)
    out = {}
    for url, want in SOURCES[name].items():
        p = cache / url.rsplit("/", 1)[1]
        if not p.exists():
            # A stalled mirror must fail rather than hang a node, and a cut-off download must not stay cached.
            # Each download writes its own part file, so processes sharing a cache can't corrupt each other's.
            part = p.with_name(f"{p.name}.{os.getpid()}.{threading.get_ident()}.part")
            try:
                with urllib.request.urlopen(url, timeout=60) as r, open(part, "wb") as f:
                    shutil.copyfileobj(r, f)
                os.replace(part, p)
            finally:
                part.unlink(missing_ok=True)
        if want is not None and _sha256(p) != want:
            raise DatasetError(f"{p.name}: sha256 mismatch, refusing to use it")
        out[p.name] = p
    return out


def parse_idx(raw: bytes) -> np.ndarray:
    """IDX format: two zero bytes, a type byte (0x08 = uint8), a rank byte, big-endian uint32 dims, then data."""
    if raw[:2] != b"\x00\x00" or raw[2] != 0x08:
        raise DatasetError("not a uint8 IDX file")
    rank = raw[3]
    dims = [int.from_bytes(raw[4 + 4 * i:8 + 4 * i], "big") for i in range(rank)]
    data = np.frombuffer(raw, dtype=np.uint8, offset=4 + 4 * rank)
    if data.size != int(np.prod(dims)):
        raise DatasetError("IDX size does not match its header")
    return data.reshape(dims)


def parse_cifar_bin(raw: bytes) -> tuple[np.ndarray, np.ndarray]:
    """One CIFAR-10 binary batch: records of 1 label byte + 3072 bytes in CHW order."""
    rec = np.frombuffer(raw, dtype=np.uint8)
    if rec.size % 3073:
        raise DatasetError("CIFAR batch is not a whole number of records")
    rec = rec.reshape(-1, 3073)
    return rec[:, 1:].reshape(-1, 3, 32, 32).transpose(0, 2, 3, 1), rec[:, 0].astype(np.int64)


def mnist(files: dict[str, Path]) -> Canonical:
    read = lambda n: parse_idx(gzip.decompress(files[n].read_bytes()))
    X = np.concatenate([read("train-images-idx3-ubyte.gz"), read("t10k-images-idx3-ubyte.gz")])
    y = np.concatenate([read("train-labels-idx1-ubyte.gz"), read("t10k-labels-idx1-ubyte.gz")]).astype(np.int64)
    return from_arrays(X, y, task="classification")


def cifar10(files: dict[str, Path]) -> Canonical:
    batches = [f"data_batch_{i}.bin" for i in range(1, 6)] + ["test_batch.bin"]
    parts = {}
    # Members are read into memory by name, never extracted, so archive paths can't write outside the cache.
    with tarfile.open(files["cifar-10-binary.tar.gz"], "r:gz") as tar:
        for m in tar.getmembers():
            base = m.name.rsplit("/", 1)[-1]
            if m.isfile() and base in batches:
                parts[base] = parse_cifar_bin(tar.extractfile(m).read())
    if set(parts) != set(batches):
        raise DatasetError("CIFAR archive is missing batches")
    X = np.concatenate([parts[b][0] for b in batches])
    y = np.concatenate([parts[b][1] for b in batches])
    return from_arrays(np.ascontiguousarray(X), y, task="classification")


LOADERS = {"mnist": mnist, "cifar10": cifar10}


def load(name: str, cache: Path) -> Canonical:
    return LOADERS[name](fetch(name, cache))


def npz_bytes(c: Canonical) -> bytes:
    buf = io.BytesIO()
    np.savez(buf, X=c.X, y=c.y)
    return buf.getvalue()


if __name__ == "__main__":
    import json
    import sys
    from dataclasses import asdict

    from .canonical import split

    cache, out = Path(sys.argv[1]), Path(sys.argv[2])
    vec = {}
    for name in SOURCES:
        c = load(name, cache)
        vec[name] = {"sources": {u.rsplit("/", 1)[1]: h for u, h in SOURCES[name].items()},
                     "card": asdict(c.card), "split": split(c.card.rows, 8, "0.05", "0.1")}
    out.write_text(json.dumps(vec, indent=1) + "\n")
