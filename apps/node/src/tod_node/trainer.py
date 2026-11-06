"""Real training for a round: fetch the spec, start weights and data, run the workload, and upload the result."""
import json
import logging
import math
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path

import numpy as np
from tod_core import encodings as enc
from tod_core.blob import from_blob, k256, to_blob
from tod_core.ledger import RoundStatus
from tod_workloads import base, mlp_exact  # noqa: F401  importing mlp_exact registers it
from tod_workloads.runner import run_round, sampler

log = logging.getLogger(__name__)
BLOB_TTL = 240  # s; the coordinator accepts BlobAccess expiries up to five minutes ahead
# (datasetHash) -> (X with one row per example, y)
Datasets = Callable[[str], tuple[np.ndarray, np.ndarray]]


def rounds_done(state, job: int, rnd: int, shard: int) -> int:
    """Earlier rounds of this job whose aggregate was kept and that trained this shard.

    Reverted, void and fallback rounds don't advance the shard's place in the epoch shuffle. The node and
    both verifiers must count exactly the same way, so verifiers import this function.
    """
    return sum(1 for (j, r), v in state.rounds.items()
               if j == job and r < rnd and v["status"] == RoundStatus.SETTLED and not v["fallback_"]
               and shard in v["shards"])


def workload(spec: dict):
    model, train = spec["model"], spec["train"]
    return base.get(spec["workload"]["id"], d_in=math.prod(model["inputShape"]), n_out=model["outputs"],
                    hidden=model.get("hidden", 128), loss="mse" if model["task"] == "regression" else "ce",
                    lr=train["lr"])


class Coordinator:
    """Blob reads and writes, each signed with a short-lived EIP-712 BlobAccess from the operator key."""

    def __init__(self, url: str, key: bytes, chain_id: int, market: str):
        self.url, self.key, self.chain_id, self.market = url.rstrip("/"), key, chain_id, market

    def _headers(self, h: str, method: str, job: int, rnd: int) -> dict:
        expiry = int(time.time()) + BLOB_TTL
        msg = {"jobId": job, "roundId": rnd, "blobHash": bytes.fromhex(h[2:]), "method": method, "expiry": expiry}
        sig = enc.sign(self.key, "BlobAccess", self.chain_id, self.market, msg)
        return {"X-Job": str(job), "X-Round": str(rnd), "X-Expiry": str(expiry), "X-Signature": "0x" + sig.hex()}

    def get(self, h: str, job: int, rnd: int) -> bytes:
        req = urllib.request.Request(f"{self.url}/v1/blobs/{h}", headers=self._headers(h, "GET", job, rnd))
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        # Content addressing is the whole trust model for blobs, so never use bytes that don't hash right.
        if "0x" + k256(data).hex() != h:
            raise ValueError(f"blob {h} came back with the wrong hash")
        return data

    def put(self, data: bytes, job: int, rnd: int) -> str:
        h = "0x" + k256(data).hex()
        req = urllib.request.Request(f"{self.url}/v1/blobs/{h}", data=data, method="PUT",
                                     headers={**self._headers(h, "PUT", job, rnd),
                                              "Content-Type": "application/octet-stream"})
        urllib.request.urlopen(req, timeout=60).close()
        return h


def preset_datasets(cache: Path) -> Datasets:
    """Loads a preset dataset by its card hash, downloading and checking it once."""
    def load(dataset_hash: str):
        from tod_datasets import presets  # needs the preset downloads, so only imported when training

        table = json.loads((Path(presets.__file__).resolve().parents[3] / "vectors/kernel/presets.json").read_text())
        name = next((n for n, v in table.items() if v["card"]["hash"] == dataset_hash), None)
        if name is None:
            raise ValueError(f"unknown dataset {dataset_hash}")
        c = presets.load(name, cache)
        if c.card.hash != dataset_hash:
            raise ValueError(f"dataset {name} hashed to {c.card.hash}, expected {dataset_hash}")
        return c.X.reshape(len(c.X), -1), c.y
    return load


class RoundRunner:
    """Fetches a round's inputs and runs one shard's training. The node trains with it and verifiers replay with it,
    so both sides compute the same bytes by construction."""

    def __init__(self, coordinator: Coordinator, datasets: Datasets, chain_id: int, market: str):
        self.c, self.datasets = coordinator, datasets
        self.dom = enc.domain(chain_id, market)
        self._data: dict[str, tuple] = {}  # one dataset stays in memory across rounds
        self._inputs: dict[tuple[int, int], tuple] = {}  # a verifier replays many shards of one round

    def inputs(self, state, job: int, rnd: int):
        if (job, rnd) not in self._inputs:
            params, r = state.jobs[job]["params"], state.rounds[(job, rnd)]
            spec_hash = bytes(params.modelSpecHash)
            spec_bytes = self.c.get(params.specURI.rsplit("/", 1)[-1], job, rnd)
            if k256(spec_bytes) != spec_hash:
                raise ValueError("spec does not match modelSpecHash")
            spec = json.loads(spec_bytes)
            wl = workload(spec)
            start = from_blob(spec_hash, self.c.get("0x" + bytes(r["startWeightsHash"]).hex(), job, rnd), wl.n_params())
            data_hash = "0x" + bytes(params.datasetHash).hex()
            if data_hash not in self._data:
                self._data = {data_hash: self.datasets(data_hash)}
            self._inputs = {(job, rnd): (spec_hash, spec, wl, start, *self._data[data_hash])}
        return self._inputs[(job, rnd)]

    def run(self, state, job: int, rnd: int, shard: int) -> tuple[list[bytes], np.ndarray, bytes]:
        """(checkpoint hashes h_0..h_K, final weights, spec hash) for one shard of one round."""
        spec_hash, spec, wl, start, X, y = self.inputs(state, job, rnd)
        train = spec["train"]
        rows = sampler(self.dom, job, shard, spec["data"]["shards"][shard], rounds_done(state, job, rnd, shard),
                       train["H"], train["B"])
        final = {}
        hs = run_round(wl, start, X, y, rows, train["H"], state.jobs[job]["params"].segments, spec_hash,
                       on_checkpoint=lambda k, w: final.update(w=w))
        return hs, final["w"], spec_hash


class Trainer:
    def __init__(self, coordinator: Coordinator, datasets: Datasets, operator: str, chain_id: int, market: str):
        self.runner, self.operator = RoundRunner(coordinator, datasets, chain_id, market), operator.lower()

    def __call__(self, state, job: int, rnd: int) -> list[bytes]:
        r = state.rounds[(job, rnd)]
        shard = next(v["shard"] for op, v in r["nodeRounds"].items() if op.lower() == self.operator)
        hs, final, spec_hash = self.runner.run(state, job, rnd, shard)
        try:
            # The merge needs our final weights; a failed upload only makes them unavailable, it doesn't cost stake.
            self.runner.c.put(to_blob(spec_hash, final), job, rnd)
        except (urllib.error.URLError, OSError) as e:
            log.warning("job %s round %s: final weights upload failed: %s", job, rnd, e)
        return hs


class LazyTrainer(Trainer):
    """fake:lazy, for demos and tests: skips training and claims checkpoints made by nudging the start weights.

    Its commit and reveal are well formed, so only a verifier's replay can catch it.
    """

    def __call__(self, state, job: int, rnd: int) -> list[bytes]:
        spec_hash, _, _, start, _, _ = self.runner.inputs(state, job, rnd)
        K = state.jobs[job]["params"].segments
        ws = [start + np.float32(j * 1e-3) for j in range(K + 1)]
        try:
            self.runner.c.put(to_blob(spec_hash, ws[-1]), job, rnd)
        except (urllib.error.URLError, OSError) as e:
            log.warning("job %s round %s: final weights upload failed: %s", job, rnd, e)
        return [k256(to_blob(spec_hash, w)) for w in ws]
