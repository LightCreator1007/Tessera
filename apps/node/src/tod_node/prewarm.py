"""Downloads each active job's dataset in the background, so no round has to wait on a first download."""
import logging
import threading
import time

from tod_core.ledger import JobStatus

log = logging.getLogger(__name__)
RETRY = 30  # s before a failed download (a dropped connection, a stalled mirror) is tried again


class NotReady(OSError):
    """The round loop treats OSError as "not available yet" and retries on its next tick, which is what we want here."""


class Prewarm:
    """Call with the chain state on every daemon tick. `datasets` is the loader the trainer uses; it never downloads."""

    def __init__(self, load, emit=lambda *a, **k: None, now=time.monotonic):
        self.load, self.emit, self.now = load, emit, now
        self.lock = threading.Lock()
        self.ready: dict[str, tuple] = {}
        self.fetching: set[str] = set()
        self.retry_at: dict[str, float] = {}
        self.broken: set[str] = set()  # an unknown dataset or a hash mismatch won't fix itself

    def __call__(self, state) -> None:
        for j in state.jobs.values():
            if j["status"] != JobStatus.ACTIVE:
                continue
            h = "0x" + bytes(j["params"].datasetHash).hex()
            with self.lock:
                if (h in self.ready or h in self.fetching or h in self.broken
                        or self.now() < self.retry_at.get(h, 0)):
                    continue
                self.fetching.add(h)
            threading.Thread(target=self._fetch, args=(h,), name=f"prewarm-{h[:10]}", daemon=True).start()

    def _fetch(self, h: str) -> None:
        self.emit("dataset.fetching", dataset=h)
        try:
            data = self.load(h)
        except OSError as e:
            with self.lock:
                self.fetching.discard(h)
                self.retry_at[h] = self.now() + RETRY
            self.emit("error", what="dataset", reason=f"{h}: {e}; retrying in {RETRY} s")
            return
        except Exception as e:
            with self.lock:
                self.fetching.discard(h)
                self.broken.add(h)
            self.emit("error", what="dataset", reason=f"{h}: {e}")
            return
        with self.lock:
            self.fetching.discard(h)
            self.ready[h] = data
        self.emit("dataset.ready", dataset=h)

    def datasets(self, h: str):
        with self.lock:
            if h in self.ready:
                return self.ready[h]
        raise NotReady(f"dataset {h} is still downloading")

    def busy(self) -> bool:
        """True while a download runs, so the heartbeat keeps the matcher from seating us in a round we'd miss."""
        with self.lock:
            return bool(self.fetching)

    def names(self) -> list[str]:
        with self.lock:
            return sorted(self.ready)
