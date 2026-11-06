"""Prewarm: datasets download off the round loop, a round asks too early and waits, and the heartbeat says busy meanwhile."""
import threading
from types import SimpleNamespace

import pytest

from tod_core.ledger import JobStatus
from tod_node.prewarm import RETRY, NotReady, Prewarm

H = "0x" + "11" * 32


def chain(status=JobStatus.ACTIVE, h=H):
    return SimpleNamespace(jobs={1: {"status": status, "params": SimpleNamespace(datasetHash=bytes.fromhex(h[2:]))}})


def wait_for(p):
    for t in threading.enumerate():
        if t.name.startswith("prewarm-"):
            t.join(5)


def test_a_dataset_downloads_in_the_background_and_a_round_waits_for_it():
    gate, events = threading.Event(), []
    p = Prewarm(lambda h: (gate.wait(5), ("X", "y"))[1], emit=lambda t, **k: events.append(t))
    p(chain())
    p(chain())  # already fetching: no second download
    assert p.busy() and p.names() == []
    with pytest.raises(NotReady):  # an OSError, so the round loop retries instead of skipping
        p.datasets(H)
    gate.set()
    wait_for(p)
    assert not p.busy() and p.names() == [H] and p.datasets(H) == ("X", "y")
    assert events == ["dataset.fetching", "dataset.ready"]


def test_only_active_jobs_are_fetched():
    calls = []
    p = Prewarm(lambda h: calls.append(h))
    p(chain(status=JobStatus.COMPLETED))
    wait_for(p)
    assert calls == []


def test_a_dropped_download_is_retried_after_a_pause_and_a_bad_dataset_never_is():
    clock, calls = [0.0], []

    def flaky(h):
        calls.append(h)
        raise OSError("connection reset")

    p = Prewarm(flaky, now=lambda: clock[0])
    p(chain())
    wait_for(p)
    p(chain())
    wait_for(p)
    assert len(calls) == 1 and not p.busy()
    clock[0] += RETRY
    p(chain())
    wait_for(p)
    assert len(calls) == 2

    def unknown(h):
        calls.append(h)
        raise ValueError("unknown dataset")

    q = Prewarm(unknown, now=lambda: clock[0])
    q(chain())
    wait_for(q)
    clock[0] += 10 * RETRY
    q(chain())
    wait_for(q)
    assert calls.count(H) == 3
