"""Round driver: opens rounds through the matcher, settles them with tod_core.settle, and sends finalizeRound."""
import json
import logging
import os
import threading
import time
from pathlib import Path

from tod_core.blob import from_blob, k256
from tod_core.ledger import ChainState, JobStatus, Kind, Phase, Reverted, RoundStatus
from tod_core.settle import KIND_NAMES, needs_weights, settle
from tod_datasets.canonical import split

import scheduler
from api import config, nodes, tables
from api.draft import mlp
from api.models import Evidence, EvidenceRef, Job, JobState, Payout, Round, RoundState, Seat
from identity import router as identity

log = logging.getLogger(__name__)
ZERO32 = b"\0" * 32
TICK_SECONDS = 3
JOB_STATUS = {JobStatus.ACTIVE: "running", JobStatus.COMPLETED: "completed", JobStatus.CANCELLED: "abandoned"}
OPEN_STATUS = {Phase.COMMIT: "committing", Phase.REVEAL: "revealing", Phase.VERIFY: "verifying",
               Phase.FINALIZE: "verifying"}
CLOSED_STATUS = {RoundStatus.SETTLED: "finalized", RoundStatus.REVERTED: "reverted", RoundStatus.VOID: "voided"}


def _hex(b) -> str:
    return "0x" + bytes(b).hex()


def preset_datasets(cache: Path):
    """datasetHash -> (X with one row per example, y), the same arrays the nodes train on."""
    def load(dataset_hash: str):
        from tod_datasets import presets  # downloads on first use, so only imported when a round settles

        table = json.loads((Path(presets.__file__).resolve().parents[3] / "vectors/kernel/presets.json").read_text())
        name = next((n for n, v in table.items() if v["card"]["hash"] == dataset_hash), None)
        if name is None:
            raise ValueError(f"unknown dataset {dataset_hash}")
        c = presets.load(name, cache)
        if c.card.hash != dataset_hash:
            raise ValueError(f"dataset {name} hashed to {c.card.hash}, expected {dataset_hash}")
        return c.X.reshape(len(c.X), -1), c.y
    return load


class Driver:
    """One tick: read the chain, publish the read routes, then move every round and job one step on.

    market and registry are tod_core.ledger bindings that send from the coordinator key.
    """

    def __init__(self, ledger, store, datasets, fleet=nodes.heartbeats, credentials=identity.credentials,
                 now=time.time):
        self.l, self.store, self.datasets = ledger, store, datasets
        self.fleet, self.credentials, self.now = fleet, credentials, now
        self.state = ChainState()
        self._data: dict[str, tuple] = {}

    def tick(self):
        self.state.sync(self.l)
        phases = {k: Phase(self.l.market.phase(*k)) for k, r in self.state.rounds.items()
                  if r["status"] == RoundStatus.OPEN}
        self.publish(phases)
        for (job, rnd), ph in sorted(phases.items()):
            try:
                self.advance(job, rnd, ph)
            except (Reverted, ValueError) as e:
                # Lost a race with a verifier, or a blob isn't in yet; the next tick tries again.
                log.warning("job %s round %s: %s", job, rnd, e)
            except Exception:
                log.exception("job %s round %s failed", job, rnd)  # one broken job must not stall the others
        self.open_rounds()

    def spec(self, job: int) -> dict | None:
        if job not in tables.SPECS:
            p = self.state.jobs[job]["params"]
            raw = self.store.get(p.specURI.rsplit("/", 1)[-1])
            if raw is None or k256(raw) != bytes(p.modelSpecHash):
                return None  # not drafted here, so this coordinator can't serve or settle it
            tables.SPECS[job] = raw
        return json.loads(tables.SPECS[job])

    def publish(self, phases: dict):
        """Fill the read routes from chain state. Blob access checks rosters here, so nodes need this to fetch."""
        for job, j in self.state.jobs.items():
            p, spec = j["params"], self.spec(job)
            tables.JOBS[job] = Job(
                id=job, status=JOB_STATUS[j["status"]], workload=spec["workload"]["id"] if spec else "unknown",
                requester=j["requester"], budget=p.budget, remaining=j["remaining"], rounds=p.rounds,
                currentRound=j["nextRound"] - 1 or None, stakePerNode=p.stakePerNode,
                modelSpecHash=_hex(p.modelSpecHash))
        for (job, rnd), r in self.state.rounds.items():
            nrs, agg = r["nodeRounds"], r["aggregateHash"]
            settled = r["status"] == RoundStatus.SETTLED
            pending = tables.SETTLEMENTS.get((job, rnd), {}).get("settlement")
            status = CLOSED_STATUS.get(r["status"]) or OPEN_STATUS[phases[(job, rnd)]]
            tables.ROUNDS.setdefault(job, {})[rnd] = Round(
                job=job, round=rnd, status="fallback" if r["fallback_"] else status,
                startHash=_hex(r["startWeightsHash"]), aggregateHash=_hex(agg) if bytes(agg) != ZERO32 else None,
                roster=[Seat(op=op, shard=s) for op, s in zip(r["nodes"], r["shards"])],
                committed=[op for op, nr in nrs.items() if nr["committed"]],
                revealed=[op for op, nr in nrs.items() if nr["revealed"]],
                seed=_hex(r["seed"]) if bytes(r["seed"]) != ZERO32 else None,
                confirmed=[{"op": op, "kind": KIND_NAMES[nr["confirmed"]]} for op, nr in nrs.items()
                           if nr["confirmed"] != Kind.NONE],
                outcome="Accepted" if settled else "Reverted" if r["status"] == RoundStatus.REVERTED else None,
                payouts=[Payout(op=op, amount=a) for op, a in pending["payouts"]] if settled and pending else [])
            if settled:
                tables.MODELS[job] = _hex(agg)
                if not any(s.round == rnd for s in tables.STATES.get(job, JobState(job=job, rounds=[])).rounds):
                    # After a restart: the evidence is still in the store under the hash the chain recorded.
                    ev = bytes(r.get("aggEvidenceHash", ZERO32))
                    doc = self.store.get(_hex(ev)) if ev != ZERO32 else None
                    if doc is not None:
                        _loss(job, rnd, doc, None)

    def advance(self, job: int, rnd: int, ph: Phase):
        r, quorum = self.state.rounds[(job, rnd)], self.state.jobs[job]["params"].minQuorum
        if ph in (Phase.VERIFY, Phase.FINALIZE):
            self.report_no_reveals(job, rnd, r)  # before a void, which would close the round to reports
        if ph in (Phase.VERIFY, Phase.FINALIZE) and r["revealedCount"] < quorum:
            self.l.market.voidRound(job, rnd)
            log.info("job %s round %s: voided, %s of %s revealed", job, rnd, r["revealedCount"], quorum)
            return
        # ponytail: finalizeFallback is left to anyone who gains from it; add here if nobody does
        if ph != Phase.FINALIZE:
            return  # nodes commit and reveal, verifiers lock the seed and attest
        pending = tables.SETTLEMENTS.get((job, rnd))
        if pending is None:
            self.prepare(job, rnd)
        elif len(pending["sigs"]) >= config.THRESHOLD:
            s = pending["settlement"]
            self.l.market.finalizeRound(job, rnd, {
                "outcome": s["outcome"], "aggregateHash": s["aggregateHash"], "flaggedBitmap": s["flaggedBitmap"],
                "aggEvidenceHash": s["aggEvidenceHash"], "payEvidenceHash": s["payEvidenceHash"],
                "payouts": [{"operator": op, "amount": a} for op, a in s["payouts"]],
            }, [bytes.fromhex(sig.removeprefix("0x")) for sig in list(pending["sigs"].values())])  # API thread writes
            log.info("job %s round %s: finalized with %s signatures", job, rnd, len(pending["sigs"]))

    def report_no_reveals(self, job: int, rnd: int, r: dict):
        """Slash every seated node that didn't reveal; the contract escalates repeat misses in a job."""
        for op, nr in sorted(r["nodeRounds"].items()):
            if nr["revealed"] or nr["noRevealReported"]:
                continue
            try:
                self.l.market.reportNoReveal(job, rnd, op)
                log.info("job %s round %s: reported %s for not revealing", job, rnd, op)
            except Reverted as e:
                log.warning("job %s round %s: reportNoReveal %s: %s", job, rnd, op, e)

    def prepare(self, job: int, rnd: int):
        """Build the Settlement exactly as each verifier will, and publish everything they fetch to check it."""
        p, r, spec = self.state.jobs[job]["params"], self.state.rounds[(job, rnd)], self.spec(job)
        if spec is None:
            raise ValueError("spec is not in the blob store")
        spec_hash, wl = bytes(p.modelSpecHash), mlp(spec["model"], spec["train"]["lr"])

        def weights(h):
            blob = self.store.get(_hex(h))
            if blob is None:
                raise ValueError(f"blob {_hex(h)} is not uploaded yet")
            return from_blob(spec_hash, blob, wl.n_params())

        data_hash = _hex(p.datasetHash)
        if data_hash not in self._data:
            self._data = {data_hash: self.datasets(data_hash)}  # one dataset in memory at a time
        X, y = self._data[data_hash]
        d = spec["data"]
        lo, n = split(len(X), len(d["shards"]), d["valFrac"], d["testFrac"])["val"]
        val = slice(lo, lo + n)
        nrs = r["nodeRounds"]
        f = settle(self.state, job, rnd, spec, spec_hash, weights(r["startWeightsHash"]),
                   {op: weights(nrs[op]["updateHash"]) for op in needs_weights(self.state, job, rnd)},
                   lambda w: wl.evaluate(w, X[val], y[val])[0], self.l.registry.graduatedAt,
                   self.l.registry.PROBATION_SECONDS(), self.l.market.DRIP_BPS())
        if f.weights_blob:
            self.store.put(f.weights_blob)  # the next round's start weights
        def ref(doc: bytes) -> EvidenceRef:
            h = self.store.put(doc)
            return EvidenceRef(hash=h, url=f"/v1/blobs/{h}")

        tables.EVIDENCE[(job, rnd)] = Evidence(job=job, round=rnd, reports=[], aggregate=ref(f.agg_evidence),
                                               pay=ref(f.pay_evidence))
        tables.SETTLEMENTS[(job, rnd)] = {"settlement": f.settlement, "sigs": {}}
        _loss(job, rnd, f.agg_evidence, int(self.now()) - r["openedAt"])
        log.info("job %s round %s: settlement ready for the verifiers", job, rnd)

    def open_rounds(self):
        workloads = {job: spec["workload"]["id"] for job in self.state.jobs if (spec := self.spec(job))}
        for job, ops, shards in scheduler.queue(self.state, scheduler.rebuild(self.state), self.fleet(),
                                                int(self.now()), workloads, tables.CONTROL, self.credentials()):
            try:
                self.l.market.openRound(job, ops, shards)
                log.info("job %s: opened a round for %s on shards %s", job, ops, shards)
            except Reverted as e:
                log.warning("job %s: openRound reverted with %s", job, e)


def _loss(job: int, rnd: int, agg_evidence: bytes, seconds: int | None) -> None:
    """/state feeds the web app's loss chart: the gate already measured the validation loss for the evidence."""
    earlier = [s for s in tables.STATES.get(job, JobState(job=job, rounds=[])).rounds if s.round != rnd]
    here = RoundState(round=rnd, metric=json.loads(agg_evidence)["gate"]["valAfter"], seconds=seconds)
    tables.STATES[job] = JobState(job=job, rounds=sorted([*earlier, here], key=lambda s: s.round))


def start(store) -> None:
    """Run the driver in the API process, which serves the tables it fills. Off unless TOD_NETWORK is set."""
    network = os.environ.get("TOD_NETWORK")
    if not network:
        return
    from tod_core.ledger import Ledger, Network
    from tod_core.txmgr import TxManager, signer_from_env

    net = Network.load(network)
    if net.chain_id != config.CHAIN_ID or net.market.lower() != config.JOB_MARKET.lower():
        raise RuntimeError(f"TOD_NETWORK {net.name} is not the chain and market this coordinator signs for")
    ledger = Ledger(net)
    signer = signer_from_env("COORDINATOR_PRIVATE_KEY", "coordinator", net.chain_id)
    ledger = ledger.using(TxManager(ledger.w3, signer, os.environ.get("DRIVER_JOURNAL_DIR", "txmgr-driver")))
    driver = Driver(ledger, store, preset_datasets(Path(os.environ.get("DATASET_CACHE", "datasets"))))

    def loop():
        while True:
            try:
                driver.tick()
            except Exception:
                log.exception("driver tick failed")  # an RPC hiccup must not stop the driver for good
            time.sleep(TICK_SECONDS)

    threading.Thread(target=loop, name="round-driver", daemon=True).start()
