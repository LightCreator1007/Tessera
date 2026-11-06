"""Heartbeats: tell the coordinator this node is online, whether it is busy, and which workloads passed its self-test."""
import logging
import os
import platform
import time
import urllib.error

from .client import node_post

log = logging.getLogger(__name__)
INTERVAL = 15  # s; the coordinator counts a node online for 60 s after its last heartbeat


class Heartbeat:
    """Call with the chain state on every daemon tick; it sends at most one heartbeat per INTERVAL."""

    def __init__(self, url: str, key: bytes, operator: str, version: str, selftest: dict,
                 emit=lambda *a, **k: None, now=time.monotonic, prewarm=None):
        self.url, self.key, self.operator, self.version = url, key, operator, version
        self.selftest, self.emit, self.now, self.prewarm = selftest, emit, now, prewarm
        self.last: float | None = None
        self.sent_profile = False  # profile and self-test only ride on the first heartbeat that gets through
        self.failing = False

    def __call__(self, state) -> None:
        t = self.now()
        if self.last is not None and t - self.last < INTERVAL:
            return
        self.last = t
        busy_job = (state.nodes.get(self.operator) or {}).get("busyJob", 0)
        body = {"version": self.version, "busy": bool(busy_job), "job": busy_job or None}
        if self.prewarm:
            # Busy while a dataset downloads: a round seated now would be missed, and missing costs stake.
            body.update(busy=body["busy"] or self.prewarm.busy(), prewarm={"datasets": self.prewarm.names()})
        if not self.sent_profile:
            body.update(profile={"os": platform.system(), "arch": platform.machine(), "cores": os.cpu_count()},
                        selftest=self.selftest)
        try:
            node_post(self.url, self.key, "/v1/nodes/heartbeat", body)
        except (urllib.error.URLError, OSError) as e:
            if not self.failing:  # once per outage, not every 15 s
                self.emit("error", what="heartbeat", reason=f"coordinator unreachable or refused: {e}")
            self.failing = True
            return
        if self.failing:
            self.emit("heartbeat.restored")
        self.failing, self.sent_profile = False, True
