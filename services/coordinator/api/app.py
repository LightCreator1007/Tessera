"""The coordinator's REST API v1: system, workload, job, round, dispute and settlement routes.

After changing a route, regenerate the schema with `uv run python -m api.export`.
"""
import re
import threading
import time
from contextlib import asynccontextmanager

from eth_utils import keccak
from fastapi import APIRouter, Depends, FastAPI, HTTPException
from fastapi.responses import RedirectResponse, Response

import competitions
import driver
import history
import publish
from identity import router as identity
from publish import chain as publish_chain
from publish import listings as publish_listings
from publish import shards as publish_shards
from tod_core import encodings
from tod_core.finalize import message

from . import admin, auth, blobs, config, listing, nodes, notebooks, persist, rl
from .draft import build as build_draft
from .models import (OwnerHistory, OwnerRecord, Collected, Config, Dispute, DisputeIn, Draft, DraftRequest, Evidence, Health, Job, JobState,
                     ModelRecord, Payout, ProviderCompute, Published, Round, RoundSummary, Selftest, SettlementOut,
                     SignatureIn, Workload)
from .tables import DISPUTES, EVIDENCE, JOBS, MODELS, PROVIDERS, ROUNDS, SELFTESTS, SETTLEMENTS, SPECS, STATES, WORKLOADS

if config.COORDINATOR_KEY is None:
    raise RuntimeError("COORDINATOR_PRIVATE_KEY is required on any chain other than the local one")


@asynccontextmanager
async def lifespan(_):
    blobs.store.self_test()  # never serve from a store that cannot read back what it wrote
    persist.load()  # admin controls and re-arms, before the driver's first tick reads them
    driver.start(blobs.store)  # off unless TOD_NETWORK is set
    stop = threading.Event()
    if config.ARKIV_ENABLED:
        threading.Thread(target=publish.worker, args=(blobs.store, publish.client(), SPECS, stop),
                         name="arkiv-publish", daemon=True).start()
        threading.Thread(target=publish_chain.watch, args=(stop,), name="arkiv-chain-watch", daemon=True).start()
    threading.Thread(target=history.watch, args=(stop,), name="owner-history", daemon=True).start()
    if publish_shards.enabled():
        threading.Thread(target=publish_shards.worker, args=(publish.client(), publish.swarm_client(), SPECS, stop),
                         name="arkiv-shards", daemon=True).start()
    if publish_listings.enabled() and competitions.enabled():
        threading.Thread(target=publish_listings.worker, args=(publish.client(), competitions.listing, stop),
                         name="arkiv-competitions", daemon=True).start()
    yield
    stop.set()


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
                  threshold=config.THRESHOLD, competitions=config.COMPETITIONS or None)


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


def _with_published(j: Job) -> Job:
    p = publish.status(j.id)
    return j.model_copy(update={"published": Published(**p) if p else None})


@v1.get("/jobs", response_model=list[Job])
def jobs(requester: str | None = None):
    """Every job, or only the ones one address posted."""
    found = JOBS.values() if requester is None else [j for j in JOBS.values() if j.requester.lower() == requester.lower()]
    return [_with_published(j) for j in found]


@v1.get("/jobs/{job}", response_model=Job)
def job(job: int):
    return _with_published(_found(JOBS, job, "job"))


@v1.get("/providers/{owner}/compute", response_model=ProviderCompute)
def provider_compute(owner: str):
    """How much verified training an owner has done: exact, where NodeRegistry.verifiedWorkSeconds rounds each round up."""
    return PROVIDERS.get(owner.lower()) or ProviderCompute(owner=owner, rounds=0, ops=0)


_models_cache: dict = {"at": 0.0, "rows": []}
MODELS_TTL = 15  # s; every arkiv_query is billed against the access key's monthly quota
MODELS_STALE_OK = 600  # s a last good list is still served when Arkiv doesn't answer


@v1.get("/competitions")
def competition_list():
    """Every competition on the Competitions contract, newest first, with its status and leaderboard."""
    if not competitions.enabled():
        raise HTTPException(503, "this network has no Competitions contract")
    try:
        rows = competitions.listing()
    except Exception as e:
        raise HTTPException(502, f"chain read failed: {type(e).__name__}")
    keys = publish_listings.keys() if publish_listings.enabled() else {}
    return [listing.decorate({**c, "arkiv": keys.get(c["id"])}) for c in rows]  # each competition's Arkiv listing and result, once made


@v1.get("/competitions/listed")
def competitions_on_arkiv():
    """The competitions as Arkiv lists them, read from Arkiv rather than the chain or this coordinator's tables."""
    if not publish_listings.enabled():
        raise HTTPException(503, "Arkiv listings are off on this coordinator")
    try:
        return publish_listings.list_from_arkiv(publish.client())
    except Exception as e:
        raise HTTPException(502, f"Arkiv read failed: {type(e).__name__}")


@v1.get("/competitions/{cid}")
def competition_one(cid: int):
    found = [c for c in competition_list() if c["id"] == cid]
    if not found:
        raise HTTPException(404, "no such competition")
    return found[0]


def _address(a: str, what: str) -> str:
    if not re.fullmatch(r"0x[0-9a-fA-F]{40}", a):
        raise HTTPException(400, f"{what} must be 0x + 40 hex")
    return a


def _competitions_read(fn):
    if not competitions.enabled():
        raise HTTPException(503, "this network has no Competitions contract")
    try:
        return fn()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"chain read failed: {type(e).__name__}")


@v1.get("/competitions/{cid}/entries/{address}")
def competition_entry(cid: int, address: str):
    """One entrant's standing, and once scored, the predictions it was scored on and how they did per class."""
    _address(address, "address")
    found = _competitions_read(lambda: competitions.entry(cid, address))
    if found is None:
        raise HTTPException(404, "no such competition")
    return found


@v1.get("/owners/{owner}/competitions")
def owner_competitions(owner: str):
    """The competitions an address hosted or entered, with ranks, prizes won and shares claimed."""
    _address(owner, "owner")
    return _competitions_read(lambda: competitions.of_owner(owner))


@v1.get("/models", response_model=list[ModelRecord])
def models():
    """Finished models as Arkiv holds them, read from Arkiv rather than from this coordinator's tables."""
    if not config.ARKIV_ENABLED:
        raise HTTPException(503, "Arkiv publishing is off on this coordinator")
    if time.time() - _models_cache["at"] > MODELS_TTL:
        try:
            rows = publish.client().list_models(publish.SCHEMA, config.JOB_MARKET)
        except Exception as e:
            # One failed read (a 429, a dropped connection) shouldn't blank a list we read seconds ago.
            if _models_cache["rows"] and time.time() - _models_cache["at"] < MODELS_STALE_OK:
                return _models_cache["rows"]
            raise HTTPException(502, f"Arkiv read failed: {type(e).__name__}")
        _models_cache.update(at=time.time(), rows=[r for r in map(publish.from_arkiv, rows) if r])
    return _models_cache["rows"]


@v1.get("/models/{h}")
def model_bytes(h: str):
    """The bytes of a published final model, with no BlobAccess: these are public by design. Check their keccak."""
    if not publish.is_published(h):
        raise HTTPException(404, "not a published model")
    data = blobs.store.get(h)
    ref = publish.swarm_ref_of(h) if data is None and config.SWARM_ENABLED else None
    if ref:  # our copy is gone; fetch Swarm's and serve it only if it still hashes to the published keccak
        try:
            data = publish.swarm_client().download(ref)
        except Exception as e:
            raise HTTPException(502, f"Swarm read failed: {type(e).__name__}")
        if "0x" + keccak(data).hex() != h.lower():
            raise HTTPException(502, "Swarm returned bytes that do not match the published keccak")
    if data is None:
        raise HTTPException(404, "model bytes are not on this coordinator")
    return Response(data, media_type=publish.CONTENT_TYPE, headers={"X-Keccak": h.lower()})


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


@v1.get("/owners/{owner}", response_model=OwnerRecord)
def owner_record(owner: str):
    """What a profile page needs about any address, in one public read. Identity and exclusion stay on /identity/owners."""
    if not re.fullmatch(r"0x[0-9a-fA-F]{40}", owner):
        raise HTTPException(400, "owner must be 0x + 40 hex")
    done = PROVIDERS.get(owner.lower())
    t = history.tally(owner)
    return OwnerRecord(owner=owner.lower(), operators=history.operators(owner), rounds=done.rounds if done else 0,
                       ops=done.ops if done else 0, jobs=sorted(j.id for j in JOBS.values() if j.requester.lower() == owner.lower()),
                       kinds=t["kinds"], firstAt=t["firstAt"], indexedTo=history.indexed_to())


@v1.get("/owners/{owner}/history", response_model=OwnerHistory)
def owner_history(owner: str, limit: int = 50, before: str | None = None):
    """An owner's pay, claims, slashes with their reasons, stake moves and job budgets, newest first."""
    if not re.fullmatch(r"0x[0-9a-fA-F]{40}", owner):
        raise HTTPException(400, "owner must be 0x + 40 hex")
    if not 1 <= limit <= 200:
        raise HTTPException(400, "limit must be 1 to 200")
    cut = None
    if before is not None:
        try:
            b, li = (int(x) for x in before.split(":"))
            cut = (b, li)
        except ValueError:
            raise HTTPException(400, "before must be block:logIndex, as given in next")
    rows = history.events(owner, limit, cut)
    return OwnerHistory(owner=owner.lower(), operators=history.operators(owner), events=rows,
                        next=f"{rows[-1]['block']}:{rows[-1]['logIndex']}" if len(rows) == limit else None,
                        indexedTo=history.indexed_to())


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


for router in (v1, blobs.router, nodes.router, notebooks.router, listing.router, rl.router, admin.router, identity.router):
    app.include_router(router)
