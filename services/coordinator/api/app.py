"""The coordinator's REST API v1: system, workload, job, round, dispute and settlement routes.

After changing a route, regenerate the schema with `uv run python -m api.export`.
"""
import time
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI, HTTPException
from fastapi.responses import RedirectResponse, Response

from finalize import message
from identity import router as identity
from tod_core import encodings

from . import admin, auth, blobs, config, nodes
from .draft import build as build_draft
from .models import (Collected, Config, Dispute, DisputeIn, Draft, DraftRequest, Evidence, Health, Job, JobState, Payout,
                     Round, RoundSummary, Selftest, SettlementOut, SignatureIn, Workload)
from .tables import DISPUTES, EVIDENCE, JOBS, MODELS, ROUNDS, SELFTESTS, SETTLEMENTS, SPECS, STATES, WORKLOADS

if config.COORDINATOR_KEY is None:
    raise RuntimeError("COORDINATOR_PRIVATE_KEY is required on any chain other than the local one")


@asynccontextmanager
async def lifespan(_):
    blobs.store.self_test()  # never serve from a store that cannot read back what it wrote
    yield


app = FastAPI(title="ToD coordinator", version=config.VERSION, lifespan=lifespan)
v1 = APIRouter(prefix="/v1")


def _hex(b: bytes) -> str:
    return "0x" + b.hex()


def _found(table, key, what):
    if key not in table:
        raise HTTPException(404, f"{what} not found")
    return table[key]


def _round(job, r):
    return _found(_found(ROUNDS, job, "job"), r, "round")


def _verifiers():
    return {v.lower() for v in config.VERIFIERS}


@v1.get("/health", response_model=Health)
def health():
    return Health(ok=True, chainId=config.CHAIN_ID, block=None, storeOk=blobs.store.has_root(), version=config.VERSION)


@v1.get("/config", response_model=Config)
def get_config():
    return Config(chainId=config.CHAIN_ID, jobMarket=config.JOB_MARKET, nodeRegistry=config.NODE_REGISTRY,
                  token=config.TOKEN, coordinator=config.COORDINATOR, verifiers=config.VERIFIERS,
                  threshold=config.THRESHOLD)


@v1.get("/workloads", response_model=list[Workload])
def workloads():
    return list(WORKLOADS.values())


# Workload ids contain a slash (mlp-exact/1), so the selftest route is declared before the catch-all.
@v1.get("/workloads/{wid:path}/selftest", response_model=Selftest)
def selftest(wid: str):
    return _found(SELFTESTS, wid, "workload")


@v1.get("/workloads/{wid:path}", response_model=Workload)
def workload(wid: str):
    return _found(WORKLOADS, wid, "workload")


@v1.post("/jobs/draft", response_model=Draft)
def draft(req: DraftRequest):
    return build_draft(req, blobs.store)


@v1.get("/jobs", response_model=list[Job])
def jobs():
    return list(JOBS.values())


@v1.get("/jobs/{job}", response_model=Job)
def job(job: int):
    return _found(JOBS, job, "job")


@v1.get("/jobs/{job}/spec")
def spec(job: int):
    """The exact spec.json bytes; clients check their keccak against modelSpecHash."""
    return Response(_found(SPECS, job, "job"), media_type="application/json")


@v1.get("/jobs/{job}/state", response_model=JobState)
def state(job: int):
    return _found(STATES, job, "job")


@v1.get("/jobs/{job}/model", status_code=307)
def model(job: int):
    return RedirectResponse(f"/v1/blobs/{_found(MODELS, job, 'model')}", status_code=307)


@v1.get("/jobs/{job}/rounds", response_model=list[RoundSummary])
def rounds(job: int):
    return [RoundSummary(**r.model_dump()) for _, r in sorted(_found(ROUNDS, job, "job").items())]


@v1.get("/jobs/{job}/rounds/{r}", response_model=Round)
def round_(job: int, r: int):
    return _round(job, r)


@v1.get("/jobs/{job}/rounds/{r}/evidence", response_model=Evidence)
def evidence(job: int, r: int):
    return _found(EVIDENCE, (job, r), "evidence")


@v1.post("/jobs/{job}/rounds/{r}/disputes", response_model=Dispute)
def open_dispute(job: int, r: int, body: DisputeIn, op: str = Depends(auth.node)):
    """A verifier asks one node of the round to upload the checkpoints of some segments."""
    if op.lower() not in _verifiers():
        raise HTTPException(403, "signer is not a verifier of this deployment")
    rnd = _round(job, r)
    if body.operator.lower() not in {s.op.lower() for s in rnd.roster}:
        raise HTTPException(422, "operator is not in this round's roster")
    if not body.segments or body.deadline <= time.time():
        raise HTTPException(422, "need at least one segment and a deadline in the future")
    d = {"job": job, "round": r, "verifier": op, **body.model_dump()}
    DISPUTES.append(d)
    return Dispute(**d)


@v1.get("/jobs/{job}/rounds/{r}/settlement", response_model=SettlementOut)
def settlement(job: int, r: int):
    """The Settlement the coordinator built. A verifier recomputes it and signs only if every field matches."""
    pending = _found(SETTLEMENTS, (job, r), "settlement")
    s = pending["settlement"]
    msg = message(job, r, s)
    return SettlementOut(
        jobId=job, roundId=r, outcome=s["outcome"], aggregateHash=_hex(s["aggregateHash"]),
        flaggedBitmap=s["flaggedBitmap"], aggEvidenceHash=_hex(s["aggEvidenceHash"]),
        payEvidenceHash=_hex(s["payEvidenceHash"]), payoutsHash=_hex(msg["payoutsHash"]),
        payouts=[Payout(op=op, amount=amount) for op, amount in s["payouts"]],
        digest=_hex(encodings.digest("FinalizeRound", config.CHAIN_ID, config.JOB_MARKET, msg)),
        collected=len(pending["sigs"]))


@v1.post("/jobs/{job}/rounds/{r}/signatures", response_model=Collected)
def signatures(job: int, r: int, body: SignatureIn, op: str = Depends(auth.node)):
    """A verifier hands in its FinalizeRound signature. finalizeRound goes out once `threshold` are in."""
    if op.lower() != body.verifier.lower() or op.lower() not in _verifiers():
        raise HTTPException(403, "signer is not a verifier of this deployment")
    pending = _found(SETTLEMENTS, (job, r), "settlement")
    try:
        signer = encodings.recover("FinalizeRound", config.CHAIN_ID, config.JOB_MARKET,
                                   message(job, r, pending["settlement"]),
                                   bytes.fromhex(body.signature.removeprefix("0x")))
    except Exception:
        raise HTTPException(422, "malformed signature")
    if signer.lower() != op.lower():
        raise HTTPException(422, "signature is not over this Settlement")
    pending["sigs"][op.lower()] = body.signature  # a repeat from the same verifier replaces its earlier one
    return Collected(collected=len(pending["sigs"]), threshold=config.THRESHOLD)


for router in (v1, blobs.router, nodes.router, admin.router, identity.router):
    app.include_router(router)
