"""keccak256, the one hash function."""
from Crypto.Hash import keccak


def k256(b: bytes) -> bytes:
    return keccak.new(digest_bits=256, data=b).digest()


# hashlib.sha3_256 is NIST SHA-3, not Ethereum's keccak256; fail at import if the wrong one is wired in.
assert k256(b"").hex() == "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470", "not keccak256"
