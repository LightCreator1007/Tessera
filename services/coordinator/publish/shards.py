"""Publishes each job's data shards: uploads every piece to Swarm, then lists them in one Arkiv record per job."""
import json
import logging
import os
import threading
import time
from pathlib import Path

from eth_utils import keccak

from api import config
from tod_datasets import shards as S

from . import MAX_ATTEMPTS, STUCK_TX, _broadcast, _lock, _scrub, db

log = logging.getLogger("tod.publish.shards")
CACHE = Path(os.environ.get("TOD_DATASETS", Path.home() / ".cache" / "tod" / "datasets"))

db.execute("""CREATE TABLE IF NOT EXISTS shard_sets (
    job INTEGER PRIMARY KEY, data TEXT, refs TEXT DEFAULT '{}', state TEXT, arkiv_key TEXT, tx TEXT,
    tx_checks INTEGER DEFAULT 0, error TEXT, attempts INTEGER DEFAULT 0, next_try REAL DEFAULT 0, updated INTEGER)""")
db.commit()


def enabled() -> bool:
    # Without Swarm there is nothing for a node to download, so the record would only point at nothing.
    return config.ARKIV_ENABLED and config.SWARM_ENABLED


def enqueue(job: int, spec: dict):
    if not enabled():
        return
    d = spec["data"]
    data = json.dumps({k: d[k] for k in ("datasetHash", "shards", "valFrac", "testFrac")}, sort_keys=True)
    with _lock:
        db.execute("INSERT OR IGNORE INTO shard_sets (job, data, state, updated) VALUES (?, ?, 'pending', ?)",
                   (job, data, int(time.time())))
        db.commit()


def status(job: int) -> dict | None:
    row = db.execute("SELECT state, arkiv_key, tx, refs, error FROM shard_sets WHERE job = ?", (job,)).fetchone()
    if not row:
        return None
    return {"state": row[0], "arkivKey": row[1], "arkivTx": row[2], "uploaded": len(json.loads(row[3])),
            "error": row[4]}


def _set(job, **fields):
    cols = ", ".join(f"{k} = ?" for k in fields)
    with _lock:
        db.execute(f"UPDATE shard_sets SET {cols}, updated = ? WHERE job = ?", (*fields.values(), int(time.time()), job))
        db.commit()


def record(job: int, m: dict) -> dict:
    payload = json.dumps(m, sort_keys=True, separators=(",", ":")).encode()
    return {"kind": S.SCHEMA, "chainId": config.CHAIN_ID, "jobMarket": config.JOB_MARKET.lower(), "job": job,
            "datasetHash": m["datasetHash"], "keccak": "0x" + keccak(payload).hex(), "size": len(payload),
            "payload": payload}


def attributes(rec: dict) -> dict:
    return {"arkiv.schema": rec["kind"], **{k: v for k, v in rec.items() if k != "kind"}}


def step(job: int, client, swarm, datasets) -> str:
    """Moves one job as far as it can go. Safe to call again after a crash at any line, like the model publisher."""
    row = db.execute("SELECT data, refs, state, attempts, tx, tx_checks FROM shard_sets WHERE job = ?",
                     (job,)).fetchone()
    if not row or row[2] != "pending":
        return row[2] if row else "absent"
    d, refs, _, attempts, tx, tx_checks = json.loads(row[0]), json.loads(row[1]), *row[2:]
    try:
        if tx:  # signed before, maybe before a crash: follow that transaction, never sign a second one
            return _settle(job, tx, tx_checks, client)
        pieces = S.partition(datasets(d["datasetHash"]), len(d["shards"]), d["valFrac"], d["testFrac"])
        cut = {}
        for p in pieces:  # pieces of a shard are contiguous, so the shard is its first start and the summed length
            if p.part == "train":
                cut.setdefault(p.shard, {"start": p.start, "len": 0})["len"] += p.len
        cut = [cut[i] for i in sorted(cut)]
        if cut != d["shards"]:
            # Row-list shards, or a spec cut differently: nodes train on the spec's table, so never list other rows.
            _set(job, state="failed", error="spec shard table is not the canonical contiguous split")
            return "failed"
        for p in pieces:
            if p.keccak not in refs:
                refs[p.keccak] = swarm.put(p.data, p.keccak)
                _set(job, refs=json.dumps(refs))  # saved per piece, so a crash mid-way never uploads one twice
        rec = record(job, S.manifest(d["datasetHash"], pieces, refs))
        key = client.find(rec)  # a record from an earlier run that crashed after it was mined
        if key:
            _set(job, state="indexed", arkiv_key=key, error=None)
            return "indexed"
        tx, raw = client.sign_create(attributes(rec), config.ARKIV_LIFETIME_BLOCKS)
        _set(job, tx=tx, tx_checks=0, next_try=time.time() + 4)  # the hash is saved before anything is sent
        _broadcast(job, raw, client)
        return "pending"
    except Exception as e:  # nothing was signed yet, so retrying is safe
        attempts += 1
        error = _scrub(f"{type(e).__name__}: {str(e)[:200]}")
        failed = attempts >= MAX_ATTEMPTS
        _set(job, error=error, attempts=attempts, next_try=time.time() + min(600, 5 * 2 ** attempts),
             **({"state": "failed"} if failed else {}))
        log.warning("shards for job %s: %s (try %s)", job, error, attempts)
        return "failed" if failed else "pending"


def _settle(job, tx, tx_checks, client):
    # Same rule as the model publisher: a revert or a tx that never confirms waits for a human, never a re-sign.
    outcome, key = client.confirm(tx)
    if outcome == "ok":
        _set(job, state="indexed", arkiv_key=key, error=None)
        log.info("listed shards of job %s on Arkiv as %s", job, key)
        return "indexed"
    if outcome == "reverted" or tx_checks + 1 >= STUCK_TX:
        _set(job, state="failed", error=f"Arkiv create {tx} {outcome}; check the explorer before retrying")
        return "failed"
    _set(job, tx_checks=tx_checks + 1, next_try=time.time() + 5)
    return "pending"


def preset_datasets(dataset_hash: str):
    """The coordinator only drafts preset datasets, so a shard set is always cut from one of those."""
    from tod_datasets import presets
    table = json.loads((Path(presets.__file__).resolve().parents[3] / "vectors/kernel/presets.json").read_text())
    name = next((n for n, v in table.items() if v["card"]["hash"] == dataset_hash), None)
    if name is None:
        raise ValueError(f"unknown dataset {dataset_hash}")
    return presets.load(name, CACHE)


def worker(client, swarm, specs: dict, stop: threading.Event, every=5.0, datasets=preset_datasets):
    """Picks up every job whose spec the driver has loaded, and publishes its shards once."""
    while not stop.wait(every):
        for job, raw in list(specs.items()):
            enqueue(job, json.loads(raw))
        now = time.time()
        for (job,) in db.execute("SELECT job FROM shard_sets WHERE state = 'pending' AND next_try <= ?", (now,)).fetchall():
            try:
                step(job, client, swarm, datasets)
            except Exception:  # one broken job must not stop the others
                log.exception("shards for job %s crashed", job)
