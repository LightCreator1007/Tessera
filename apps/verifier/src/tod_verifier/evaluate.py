"""RL competitions on the verifier: run each queued policy on the host's seeds, sandboxed, and sign its mean return."""
import hashlib
import json
import logging
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

from eth_account import Account
from tod_core import encodings as enc
from tod_node.sandbox import rl_serve
from tod_workloads import rl

log = logging.getLogger(__name__)
RETRY_SECONDS = 300  # a run that failed (a package that crashes, a file not up yet) is tried again this much later
ZERO = b"\x00" * 32


class Evaluator:
    def __init__(self, ledger, coordinator: str, key: bytes, cache: Path, emit=lambda *a, **k: None):
        self.w3, self.contract, self.chain_id = ledger.w3, ledger.rl_competitions, ledger.net.chain_id
        self.url, self.key, self.cache, self.emit = coordinator.rstrip("/"), key, cache, emit
        self.verifier = Account.from_key(key).address
        self.tried: dict[tuple[int, str], float] = {}

    def _get(self, path: str) -> bytes:
        with urllib.request.urlopen(self.url + path, timeout=60) as r:
            return r.read()

    def _post(self, path: str, body: dict) -> dict:
        req = urllib.request.Request(self.url + path, json.dumps(body).encode(), {"content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())

    def _file(self, path: str, want: bytes) -> bytes:
        data = self._get(path)
        if hashlib.sha256(data).digest() != bytes(want):
            raise ValueError(f"{path} doesn't hash to what the contract has")
        return data

    def tick(self) -> None:
        for t in json.loads(self._get("/v1/rl/evaluations")):
            k = (int(t["competition"]), t["entrant"].lower())
            if time.time() - self.tried.get(k, 0) < RETRY_SECONDS:
                continue
            self.tried[k] = time.time()
            try:
                self.evaluate(*k)
            except Exception as e:
                log.warning("rl evaluation %s failed: %s", k, e)
                self.emit("rl.failed", competition=k[0], entrant=k[1], error=str(e)[:300])

    def evaluate(self, cid: int, entrant: str) -> dict | None:
        """Every input comes from the chain, never the queue, so a wrong queue can't make this sign a wrong score."""
        c = self.contract.competition(cid)
        e = self.contract.entry(cid, self.w3.to_checksum_address(entrant))
        if bytes(e.policy) == ZERO or e.scored or not c.seedsRevealedAt:
            return None
        seeds = [int(s) for s in self.contract.seedsOf(cid)]
        env = self._file(f"/v1/rl/competitions/{cid}/env", c.env)
        policy = self._file(f"/v1/rl/competitions/{cid}/policies/{entrant}", e.policy)
        self.cache.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=self.cache, prefix="rl-") as work:
            w = Path(work)
            env_dir, policy_dir = rl.unpack(env, w / "env", "env.py"), rl.unpack(policy, w / "policy", "policy.py")
            r = rl.run(rl_serve(self.cache, "env", env_dir, "env:Env"), rl_serve(self.cache, "policy", policy_dir),
                       seeds, int(c.episodes), int(c.maxSteps))
        msg = {"competition": cid, "entrant": entrant, "policy": "0x" + bytes(e.policy).hex(), "score": r.score}
        sig = enc.sign(self.key, "EvalResult", self.chain_id, self.contract.address, msg)
        out = self._post(f"/v1/rl/competitions/{cid}/evaluations/{entrant}",
                         {"verifier": self.verifier, "score": r.score, "returns": r.returns, "signature": "0x" + sig.hex()})
        self.emit("rl.scored", competition=cid, entrant=entrant, score=r.score)
        return out

    def loop(self, stop: threading.Event, poll: float = 10.0) -> None:
        while not stop.is_set():
            try:
                self.tick()
            except Exception as e:  # the coordinator being down shouldn't stop the round verifier beside this
                log.warning("rl queue read failed: %s", e)
            stop.wait(poll)
