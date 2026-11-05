"""Admin routes for operating the coordinator: job mode and pause, node re-arm, transaction queue."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from . import auth, tables

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
    return {"op": op, "missedCommitsInARow": 0}


@router.get("/txs")
def txs():
    return []  # ponytail: always empty until the transaction manager's queue is exposed here
