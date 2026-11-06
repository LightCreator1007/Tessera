"""Watches JobMarket for jobs whose last round is final and queues each one's final model for Arkiv."""
import logging
import re
import threading

from tod_core.ledger import JobStatus, RoundStatus

from api import config

from . import _lock, db, enqueue, q1

log = logging.getLogger("tod.publish.chain")
# Full URLs, and the bare path requests prints in "Max retries exceeded with url: /v2/<key>"
URL = re.compile(r"[a-z][a-z0-9+.-]*://\S+|(?<=url: )/\S+", re.I)
PAGES_PER_PASS = 20  # log pages per pass, so a long backfill saves its place as it goes

db.execute("CREATE TABLE IF NOT EXISTS chain_cursor (market TEXT PRIMARY KEY, next_block INTEGER)")
db.commit()


class Misconfigured(Exception):
    """A setting that will not fix itself by retrying, so the watcher stops instead of looping on it."""


class Inconsistent(Exception):
    """The chain's rounds disagree about a job's final model. Never expected; that one job is skipped, not guessed."""


def final_model(market, job: int) -> tuple[int, str] | None:
    """(round, hash) of a completed job's final model, read from the chain, which is the protocol's record of it.

    That is the last round verifiers accepted. A fallback round is skipped because nothing in it was verified, and
    reverted and void rounds leave the model as it was. None when the job did not complete, or when no round was
    accepted, since the model is then the requester's starting weights and nothing was trained.
    """
    _, state = market.getJob(job)
    if state.status != JobStatus.COMPLETED:
        return None
    final = None
    for r in range(state.roundsOpened, 0, -1):
        rnd = market.getRound(job, r)
        h = "0x" + bytes(rnd.aggregateHash).hex()
        final = final or h  # every later round starts from and ends on this model, so the last round holds it too
        if rnd.status == RoundStatus.SETTLED and not rnd.fallback_:
            if h != final:
                raise Inconsistent(f"job {job}: round {r} accepted {h} but the last round ends on {final}")
            return r, h
    return None


def _key(net) -> str:
    return f"{net.chain_id}:{net.market.lower()}"  # a redeployed market starts from its own deploy block


def cursor(net) -> int:
    row = q1("SELECT next_block FROM chain_cursor WHERE market = ?", (_key(net),))
    return row[0] if row else net.deploy_block


def _save(net, next_block: int):
    with _lock:
        db.execute("INSERT OR REPLACE INTO chain_cursor (market, next_block) VALUES (?, ?)", (_key(net), next_block))
        db.commit()


def scan(ledger, confirmations: int) -> bool:
    """One pass over confirmed blocks not seen yet. True once it has caught up with the confirmed head.

    The cursor moves only after the whole pass is handled, and enqueue ignores a repeat, so a crash halfway
    just redoes the pass. Blocks newer than `confirmations` wait, so a reorg cannot publish a job that never closed.
    """
    net = ledger.net
    start, head = cursor(net), ledger.w3.eth.block_number - confirmations
    if head < start:
        return True
    end = min(head, start + net.log_span * PAGES_PER_PASS - 1)
    for ev in ledger.events(start, end, names=["JobClosed"]):
        job, status = ev.args["jobId"], JobStatus(ev.args["status"])
        if status != JobStatus.COMPLETED:
            log.info("job %s closed as %s; its model is not published", job, status.name.lower())
            continue
        try:
            found = final_model(ledger.market, job)
        except Inconsistent as e:
            log.error("%s; not publishing it", e)
            continue
        if found is None:
            log.info("job %s completed without an accepted round; nothing was trained, so nothing is published", job)
            continue
        enqueue(job, *found)
        log.info("job %s completed; queued round %s model %s for Arkiv", job, *found)
    _save(net, end + 1)
    return end == head


def open_ledger():
    """The read-only ledger for TOD_NETWORK, checked against the chain and JobMarket this coordinator serves."""
    from tod_core.ledger import Ledger, Network

    try:  # no such profile, no [contracts] or no RPC URL; the error text never holds the URL itself
        net = Network.load(config.TOD_NETWORK)
    except (OSError, KeyError, ValueError, RuntimeError) as e:
        raise Misconfigured(f"cannot load network {config.TOD_NETWORK}: {e}") from e
    if net.chain_id != config.CHAIN_ID or net.market.lower() != config.JOB_MARKET.lower():
        raise Misconfigured(f"TOD_NETWORK {net.name} is not the chain and JobMarket this coordinator serves")
    try:
        return Ledger(net)
    except FileNotFoundError as e:  # a connection error is retried instead; this one is the ABI not being built
        raise Misconfigured(f"contract ABI missing ({e.filename}); run the ABI build") from e
    except RuntimeError as e:  # the RPC answers for a different chain
        raise Misconfigured(str(e)) from e


def _scrub(text: str) -> str:
    """An RPC URL can carry a provider key and web3 puts it in its HTTP errors, so no URL reaches the log."""
    return URL.sub("<url>", text)


def watch(stop: threading.Event, opener=open_ledger, every: float = 15.0):
    """Background loop the app starts when Arkiv publishing is on. Retries RPC failures; stops on a bad setting."""
    if not config.TOD_NETWORK:
        log.warning("TOD_NETWORK is unset, so finished jobs reach Arkiv only through POST /v1/admin/jobs/{job}/publish")
        return
    ledger = None
    while not stop.wait(every):
        try:
            ledger = ledger or opener()
            while not scan(ledger, config.CHAIN_CONFIRMATIONS) and not stop.is_set():
                pass  # backfilling: keep going without waiting a tick per pass
        except Misconfigured as e:
            log.error("not watching the chain for finished jobs: %s", _scrub(str(e)))
            return
        except Exception as e:  # RPC down or rate limited: the cursor did not move, so the next tick redoes it
            log.warning("chain watch for finished jobs: %s: %s", type(e).__name__, _scrub(str(e))[:200])
