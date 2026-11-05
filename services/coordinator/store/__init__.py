"""Content-addressed blob store on local disk: each blob is saved under its keccak hash."""
import os
import secrets

from eth_utils import keccak


class DiskStore:
    def __init__(self, root):
        self.root = root
        os.makedirs(root, exist_ok=True)

    def _path(self, h):
        return os.path.join(self.root, h.removeprefix("0x").lower() + ".bin")

    def has_root(self):
        return os.path.isdir(self.root) and os.access(self.root, os.W_OK)

    def has(self, h):
        return os.path.exists(self._path(h))

    def get(self, h):
        try:
            with open(self._path(h), "rb") as f:
                return f.read()
        except FileNotFoundError:
            return None

    def put(self, data):
        """Save bytes under their keccak and return the hash. Write-then-rename, so readers never see half a blob."""
        h = "0x" + keccak(data).hex()
        tmp = f"{self._path(h)}.{secrets.token_hex(4)}.tmp"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, self._path(h))
        return h

    def self_test(self):
        """Round-trip a random blob; raises if the store cannot be trusted."""
        data = secrets.token_bytes(64)
        h = self.put(data)
        if self.get(h) != data or not self.has(h):
            raise RuntimeError("blob store read-back failed")
        os.remove(self._path(h))
        if self.get("0x" + secrets.token_hex(32)) is not None:
            raise RuntimeError("blob store returned data for a hash it never stored")
