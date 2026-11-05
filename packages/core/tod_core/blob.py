"""Weight blob format: specHash | dtype 0x01 | 3 zero bytes | little-endian float32 weights."""
import numpy as np
from Crypto.Hash import keccak

DTYPE_F32 = b"\x01\x00\x00\x00"
HEADER = 36


class BlobError(ValueError):
    pass


def k256(b: bytes) -> bytes:
    return keccak.new(digest_bits=256, data=b).digest()


# hashlib.sha3_256 is NIST SHA-3, not Ethereum's keccak256; fail at import if the wrong one is wired in.
assert k256(b"").hex().startswith("c5d2"), "not keccak256"
# shortcut: local keccak helper; move it to a shared hashing module once one exists.


def to_blob(spec_hash: bytes, w: np.ndarray) -> bytes:
    if len(spec_hash) != 32:
        raise BlobError("spec hash must be 32 bytes")
    # +0.0 turns -0.0 into +0.0, so equal weights always give equal hashes.
    w = np.ascontiguousarray(w, dtype="<f4") + np.float32(0)
    if not np.isfinite(w).all():
        raise BlobError("non-finite weights")
    return spec_hash + DTYPE_F32 + w.tobytes()


def from_blob(spec_hash: bytes, blob: bytes, n_params: int) -> np.ndarray:
    if blob[:32] != spec_hash:
        raise BlobError("spec hash mismatch")
    if blob[32:HEADER] != DTYPE_F32 or len(blob) != HEADER + 4 * n_params:
        raise BlobError("dtype or length mismatch")
    w = np.frombuffer(blob, dtype="<f4", offset=HEADER).copy()
    if not np.isfinite(w).all():
        raise BlobError("non-finite weights")
    return w


def whash(spec_hash: bytes, w: np.ndarray) -> bytes:
    return k256(to_blob(spec_hash, w))
