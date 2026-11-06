"""Admin routes for operating the coordinator: job mode and pause, node re-arm, Arkiv publishing, transaction queue."""
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import publish

from . import auth, config, tables

router = APIRouter(prefix="/v1/admin", dependencies=[Depends(auth.admin)])


class Mode(BaseModel):
    auto: bool


def _control(job):
    return tables.CONTROL.setdefault(job, {"auto": True, "paused": False})


@router.post("/jobs/{job}/mode")
def mode(job: int, m: Mode):
    _control(job)["auto"] = m.auto
    return tables.CONTROL[job]


@router.post("/jobs/{job}/pause")
def pause(job: int):
    _control(job)["paused"] = True
    return tables.CONTROL[job]


@router.post("/nodes/{op}/rearm")
def rearm(op: str):
    """Clear a node's missed-commit streak so the matcher seats it again."""
    tables.MISSED.pop(op.lower(), None)
    tables.REARMED[op.lower()] = int(time.time())
    return {"op": op, "missedCommitsInARow": 0}


@router.post("/jobs/{job}/publish")
def publish_model(job: int):
    """Queue the job's latest aggregate for Arkiv by hand, or put a failed one back in the queue.

    The round driver does the same through publish.enqueue once a job's last round is final.
    """
    if not config.ARKIV_ENABLED:
        raise HTTPException(503, "Arkiv publishing is off on this coordinator")
    if job not in tables.MODELS:
        raise HTTPException(404, "job has no model yet")
    rounds = tables.ROUNDS.get(job) or {}
    publish.enqueue(job, max(rounds) if rounds else 0, tables.MODELS[job])
    publish.retry(job)
    return publish.status(job)


@router.get("/txs")
def txs():
    return []  # ponytail: always empty until the transaction manager's queue is exposed here
