"""Verifier co-signing: recompute the coordinator's Settlement from chain state and sign FinalizeRound only on a full match."""
import hashlib
import json
import logging
import time
import urllib.error
import urllib.request

import numpy as np
from eth_account import Account
from eth_account.messages import encode_defunct
from tod_core import encodings as enc
from tod_core.blob import from_blob
from tod_core.finalize import message
from tod_core.ledger import Phase, RoundStatus
from tod_core.settle import needs_weights, settle
from tod_datasets.canonical import split

log = logging.getLogger(__name__)
RESEND_SECONDS = 30  # how often a kept signature is offered again while the coordinator lacks the threshold


class CoordinatorApi:
    """The coordinator's JSON routes. Writes carry the node signature that api.auth.node checks."""

    def __init__(self, url: str, key: bytes):
        self.url, self.account = url.rstrip("/"), Account.from_key(key)

    def get_json(self, path: str) -> dict | None:
        try:
            with urllib.request.urlopen(self.url + path, timeout=30) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            raise

    def post_signed(self, path: str, body: dict) -> dict:
        data = json.dumps(body).encode()
        ts = int(time.time())
        msg = f"POST\n{path}\n{ts}\n{hashlib.sha256(data).hexdigest()}"
        sig = self.account.sign_message(encode_defunct(text=msg)).signature
        req = urllib.request.Request(self.url + path, data=data, method="POST", headers={
            "Content-Type": "application/json", "X-Operator": self.account.address, "X-Timestamp": str(ts),
            "X-Signature": "0x" + sig.hex().removeprefix("0x")})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())


def val_rows(spec: dict, n_rows: int) -> np.ndarray:
    """The job's validation rows, cut from the dataset the same way the draft cut its shards."""
    d = spec["data"]
    lo, n = split(n_rows, len(d["shards"]), d["valFrac"], d["testFrac"])["val"]
    return np.arange(lo, lo + n)


def recompute(runner, registry, market, state, job: int, rnd: int, matcher_inputs: dict | None):
    spec_hash, spec, wl, start, X, y = runner.inputs(state, job, rnd)
    nrs = state.rounds[(job, rnd)]["nodeRounds"]
    weights = {op: from_blob(spec_hash, runner.c.get("0x" + bytes(nrs[op]["updateHash"]).hex(), job, rnd), wl.n_params())
               for op in needs_weights(state, job, rnd)}
    val = val_rows(spec, len(X))
    return settle(state, job, rnd, spec, spec_hash, start, weights, lambda w: wl.evaluate(w, X[val], y[val])[0],
                  registry.graduatedAt, registry.PROBATION_SECONDS(), market.DRIP_BPS(), matcher_inputs)


def wire(s: dict) -> dict:
    """A Settlement in the coordinator's JSON shape, for a field-by-field comparison."""
    return {"outcome": int(s["outcome"]), "aggregateHash": "0x" + s["aggregateHash"].hex(),
            "flaggedBitmap": s["flaggedBitmap"], "aggEvidenceHash": "0x" + s["aggEvidenceHash"].hex(),
            "payEvidenceHash": "0x" + s["payEvidenceHash"].hex(),
            "payouts": [{"op": op.lower(), "amount": a} for op, a in s["payouts"]]}


def differences(mine: dict, theirs: dict) -> list[str]:
    """Fields where the coordinator's Settlement differs from ours; hex and addresses compare case-blind."""
    def norm(v):
        return json.loads(json.dumps(v).lower())
    return sorted(k for k in mine if norm(mine[k]) != norm(theirs.get(k)))


class CoSigner:
    def __init__(self, market, registry, runner, api: CoordinatorApi, key: bytes, chain_id: int,
                 emit=lambda *a, **k: None, now=time.monotonic):
        self.market, self.registry, self.runner, self.api = market, registry, runner, api
        self.key, self.chain_id, self.emit, self.now = key, chain_id, emit, now
        self.address = Account.from_key(key).address
        # One decision per (round, settlement digest): refused stays refused, and a signature is kept to post again.
        self.refused: set[tuple[int, int, str]] = set()
        self.signed: dict[tuple[int, int, str], list] = {}  # -> [signature hex, when last posted]

    def tick(self, state) -> None:
        for (job, rnd), r in sorted(state.rounds.items()):
            if r["status"] != RoundStatus.OPEN or Phase(self.market.phase(job, rnd)) != Phase.FINALIZE:
                continue
            try:
                self._consider(state, job, rnd)
            except (urllib.error.URLError, OSError, ValueError) as e:
                # A missing blob or a coordinator hiccup: nothing is signed, and the next tick tries again.
                log.warning("job %s round %s: cannot check the settlement yet: %s", job, rnd, e)

    def _consider(self, state, job: int, rnd: int) -> None:
        theirs = self.api.get_json(f"/v1/jobs/{job}/rounds/{rnd}/settlement")
        if theirs is None:
            return
        key = (job, rnd, theirs["digest"].lower())
        if key in self.refused:
            return
        if key in self.signed:
            # A coordinator that restarted rebuilds the same Settlement but has lost the signatures: hand ours in again.
            sig, last = self.signed[key]
            if theirs["collected"] < self.market.threshold() and self.now() - last >= RESEND_SECONDS:
                self._post(job, rnd, key, sig)
            return
        agg = (self.api.get_json(f"/v1/jobs/{job}/rounds/{rnd}/evidence") or {}).get("aggregate")
        if not agg or agg["hash"].lower() != theirs["aggEvidenceHash"].lower():
            raise ValueError("aggregate evidence is not listed yet")
        doc = json.loads(self.runner.c.get(agg["hash"], job, rnd))  # the client checks keccak(doc) == hash
        mine = recompute(self.runner, self.registry, self.market, state, job, rnd, doc["matcher"]["inputs"]).settlement
        digest = "0x" + enc.digest("FinalizeRound", self.chain_id, self.market.address, message(job, rnd, mine)).hex()
        diff = differences(wire(mine), theirs) + (["digest"] if digest.lower() != theirs["digest"].lower() else [])
        if diff:
            self.refused.add(key)
            self.emit("settlement.refused", job=job, round=rnd, fields=diff)
            log.error("job %s round %s: settlement differs from ours in %s, not signing", job, rnd, diff)
            return
        sig = "0x" + bytes(enc.sign(self.key, "FinalizeRound", self.chain_id, self.market.address,
                                    message(job, rnd, mine))).hex()
        self._post(job, rnd, key, sig)

    def _post(self, job: int, rnd: int, key: tuple, sig: str) -> None:
        # Kept before posting, so a failed POST is retried by the resend path rather than recomputed.
        resend = key in self.signed
        self.signed[key] = [sig, self.now()]
        got = self.api.post_signed(f"/v1/jobs/{job}/rounds/{rnd}/signatures", {"verifier": self.address, "signature": sig})
        self.emit("round.cosigned", job=job, round=rnd, collected=got.get("collected"), resent=resend)
        log.info("job %s round %s: %s the settlement signature (%s collected)", job, rnd,
                 "re-sent" if resend else "co-signed with", got.get("collected"))
