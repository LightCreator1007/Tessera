"""Node heartbeats and the fleet and pool views built from them. Heartbeats are local state, kept in SQLite."""
import json
import sqlite3
import time

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from . import auth, config, tables
from .models import Address, Dispute

router = APIRouter(prefix="/v1")
db = sqlite3.connect(config.DB_PATH, check_same_thread=False)
db.execute("CREATE TABLE IF NOT EXISTS nodes (op TEXT PRIMARY KEY, seen INTEGER, hb TEXT)")


class Prewarm(BaseModel):
    image: str | None = None  # digest of the pulled image
    datasets: list[str] = []  # hashes of datasets held and checked


class Heartbeat(BaseModel):
    version: str
    busy: bool
    job: int | None = None
    profile: dict | None = None  # os, arch, cores, ramGB, ...; sent with the first heartbeat
    selftest: dict | None = None  # {workloadId: {hash, seconds, ok}}; sent with the first heartbeat
    prewarm: Prewarm = Prewarm()
    retainedBytes: int = 0  # checkpoints kept for the dispute window


class Node(BaseModel):
    op: Address
    version: str
    arch: str | None
    workloads: list[str]
    online: bool
    idle: bool
    prewarm: Prewarm


class Pool(BaseModel):
    online: int
    idle: int
    busy: int


class HeartbeatReply(BaseModel):
    ok: bool
    disputes: list[Dispute]  # this node's open disputes: upload these segments' checkpoints


@router.post("/nodes/heartbeat", response_model=HeartbeatReply)
def heartbeat(hb: Heartbeat, op: str = Depends(auth.node)):
    row = db.execute("SELECT hb FROM nodes WHERE op = ?", (op,)).fetchone()
    if row:
        # Profile and self-test only come with the first heartbeat; keep them when later ones omit them.
        earlier = json.loads(row[0])
        hb.profile = hb.profile or earlier.get("profile")
        hb.selftest = hb.selftest or earlier.get("selftest")
    db.execute("INSERT OR REPLACE INTO nodes VALUES (?, ?, ?)", (op, int(time.time()), hb.model_dump_json()))
    db.commit()
    now = time.time()
    mine = [Dispute(**d) for d in tables.DISPUTES if d["operator"].lower() == op.lower() and d["deadline"] > now]
    return HeartbeatReply(ok=True, disputes=mine)


def fleet():
    now = int(time.time())
    out = []
    for op, seen, raw in db.execute("SELECT op, seen, hb FROM nodes ORDER BY op"):
        hb = Heartbeat.model_validate_json(raw)
        online = now - seen <= config.ONLINE_WITHIN
        passed = sorted(w for w, result in (hb.selftest or {}).items() if result.get("ok"))
        out.append(Node(op=op, version=hb.version, arch=(hb.profile or {}).get("arch"), workloads=passed,
                        online=online, idle=online and not hb.busy, prewarm=hb.prewarm))
    return out


def heartbeats() -> dict:
    """Lowercase operator -> {seen, busy, selftest}: the fleet as the matcher (scheduler.pick) reads it."""
    out = {}
    for op, seen, raw in db.execute("SELECT op, seen, hb FROM nodes"):
        hb = Heartbeat.model_validate_json(raw)
        out[op.lower()] = {"seen": seen, "busy": hb.busy, "selftest": hb.selftest or {}}
    return out


@router.get("/nodes", response_model=list[Node])
def nodes():
    return fleet()


@router.get("/pool", response_model=Pool)
def pool():
    online = [n for n in fleet() if n.online]
    idle = sum(n.idle for n in online)
    return Pool(online=len(online), idle=idle, busy=len(online) - idle)
