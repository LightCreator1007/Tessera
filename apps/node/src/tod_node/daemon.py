"""Keeps the round loop going: tail the chain, act on this node's rounds, stop cleanly when asked."""
import logging
import threading

from tod_core.ledger import ChainState

log = logging.getLogger(__name__)


def run(ledger, loop, stop: threading.Event, poll: float = 2.0) -> None:
    state = ChainState()
    while not stop.is_set():
        try:
            state.sync(ledger)
            loop.tick(state)
        except Exception:
            # A sync that fails part way has applied some events without moving last_block, so start over.
            log.exception("tick failed; rebuilding chain state")
            state = ChainState()
        stop.wait(poll)
