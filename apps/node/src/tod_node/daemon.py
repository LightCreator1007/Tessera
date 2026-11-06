"""Keeps the round loop going: tail the chain, act on this node's rounds, and on stop drain reveals before exiting."""
import logging
import threading
import time

from tod_core.ledger import ChainState

log = logging.getLogger(__name__)


def run(ledger, loop, stop: threading.Event, poll: float = 2.0, emit=lambda *a, **k: None,
        on_tick=lambda state: None) -> None:
    """Returns once `stop` is set and no committed round is waiting for its reveal."""
    state, draining = ChainState(), None
    while True:
        try:
            state.sync(ledger)
            if stop.is_set():
                loop.accepting = False
                pending = loop.pending_reveal(state)
                if not pending:
                    return
                if pending != draining:
                    emit("node.draining", pending=[f"{j}/{r}" for j, r in pending])
                    draining = pending
            loop.tick(state)
            on_tick(state)
        except Exception:
            # A sync that fails part way has applied some events without moving last_block, so start over.
            log.exception("tick failed; rebuilding chain state")
            state = ChainState()
        # Once stopping, stop.wait returns at once, so sleep to keep polling at the same pace.
        time.sleep(poll) if stop.is_set() else stop.wait(poll)
