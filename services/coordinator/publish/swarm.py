"""Swarm storage for published models over the Bee HTTP API: upload the bytes, read them back, check the keccak."""
import json
import re
import urllib.request

from eth_utils import keccak

REF = re.compile(r"[0-9a-f]{64}")  # an unencrypted Swarm reference; it is a chunk-tree hash, never the keccak


class Swarm:
    def __init__(self, api_url: str, batch_id: str = "", timeout: float = 60):
        self.api = api_url.rstrip("/")
        self.batch = batch_id
        self.timeout = timeout

    def _call(self, req):
        with urllib.request.urlopen(req, timeout=self.timeout) as r:  # raises HTTPError on any non-2xx answer
            return r.read()

    def upload(self, data: bytes) -> str:
        headers = {"Content-Type": "application/octet-stream", "Swarm-Encrypt": "false"}
        if self.batch:
            # Our own Bee node: stamp with our batch and push to the network before answering, so a 201 means
            # the chunks left this node. The public gateway takes neither header and stamps with its own batch.
            headers |= {"Swarm-Postage-Batch-Id": self.batch, "Swarm-Deferred-Upload": "false"}
        body = self._call(urllib.request.Request(f"{self.api}/bytes", data=data, headers=headers, method="POST"))
        ref = json.loads(body)["reference"].lower()
        if not REF.fullmatch(ref):
            raise ValueError("Swarm returned a malformed reference")
        return ref

    def download(self, ref: str) -> bytes:
        if not REF.fullmatch(ref):
            raise ValueError("not a Swarm reference")
        return self._call(urllib.request.Request(f"{self.api}/bytes/{ref}"))

    def put(self, data: bytes, h: str) -> str:
        """Uploads and reads back by reference before trusting it: an upload's 201 alone does not prove the bytes
        can be served. Uploading the same bytes again gives the same reference, so a retry is always safe."""
        ref = self.upload(data)
        if "0x" + keccak(self.download(ref)).hex() != h:
            raise RuntimeError(f"Swarm {ref} did not read back as {h}")
        return ref
