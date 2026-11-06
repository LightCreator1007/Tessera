"""The view model every renderer reads. Sources (demo, live) build it; renderers never talk to the network.

Everything a view shows is in here, already decided: state words, verdict words, phase fill. Renderers only lay
it out. That split is what lets the same frames come from the scripted demo, a recorded replay or the live API.
"""
from __future__ import annotations

from dataclasses import dataclass, field

PHASES = ("FETCH", "TRAIN", "COMMIT", "REVEAL", "VERIFY", "SETTLE")


@dataclass
class Rail:
    """The round on block time. weights are each phase's share of the rail; pos is now, 0..1 along it."""

    weights: tuple[float, ...]
    pos: float
    deadline_label: str
    secs_left: int | None

    @property
    def current(self) -> int:
        edge = 0.0
        total = sum(self.weights)
        for i, w in enumerate(self.weights):
            edge += w / total
            if self.pos < edge:
                return i
        return len(self.weights) - 1


@dataclass
class Verdict:
    """One verifier's word on one seat: pending, replaying, match, mismatch, drift, unavailable, offline."""

    state: str = "pending"
    replay_hash: str | None = None


@dataclass
class Seat:
    op: str
    shard: int
    state: str  # a tokens.STATES key
    committed: bool = False
    revealed: bool = False
    verdicts: list[Verdict] = field(default_factory=list)
    outcome: str = ""  # ACCEPTED, MISMATCH, DRIFT, UNAVAILABLE, NO REVEAL
    paid: str = ""
    committed_hash: str | None = None
    why: list[str] = field(default_factory=list)
    note: str = ""  # e.g. the demo's fake mode label
    evidence_url: str | None = None


@dataclass
class Settlement:
    done: bool
    outcome: str = ""  # ACCEPTED or REVERTED
    summary: str = ""
    aggregate: str = ""
    payouts: str = ""
    signed: int = 0
    threshold: int = 2


@dataclass
class RoundInfo:
    job: int
    round: int
    status: str
    workload: str
    rail: Rail
    roster: list[Seat]
    verifiers: list[str]  # display names, one per verifier column
    verifier_online: list[bool]
    settlement: Settlement


@dataclass
class PoolNode:
    op: str
    state: str
    arch: str = "?"
    version: str = "?"
    workloads: str = ""
    last_seen: str = ""
    job: str = "none"
    record: str = ""


@dataclass
class Health:
    key: str
    status: str  # ok, warn, bad, unknown
    detail: str


@dataclass
class NodeInfo:
    op: str
    owner: str
    mode: str
    version: str
    state: str  # tokens.STATES key; idle when no round
    job: int | None
    round: int | None
    shard: int | None
    workload: str
    segment: int
    segments: int
    committed: bool
    revealed: bool
    earned: str
    record: list[tuple[str, str]]
    health: list[Health]
    disk_used: int
    disk_cap: int
    pool_position: str = ""


@dataclass
class Event:
    clock: str  # already formatted HH:MM:SS
    job: int | None
    round: int | None
    what: str
    detail: str
    kind: str  # plain, ok, danger, active, warn


@dataclass
class Source:
    """One upstream. state: ok, connecting, stale (answered before, not lately), down (never answered)."""

    name: str
    state: str
    age: float = 0.0
    detail: str = ""


@dataclass
class Problem:
    """An active condition the operator must act on. Shown as the one attention line."""

    code: str
    message: str
    command: str


@dataclass
class Snapshot:
    mode: str  # demo or live
    network: str
    chain_id: int | None
    block: int | None
    node: NodeInfo | None
    round: RoundInfo | None
    pool: list[PoolNode]
    events: list[Event]
    sources: dict[str, Source]
    problems: list[Problem] = field(default_factory=list)

    def src(self, name: str) -> Source:
        return self.sources.get(name) or Source(name, "down")
