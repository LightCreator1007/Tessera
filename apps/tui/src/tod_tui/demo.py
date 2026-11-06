"""Scripted demo round: six nodes, one running fake:stale. A pure function of the clock, so frames are exact.

Timeline (seconds into the round, block time compressed): fetch 0-2, train 2-11, commit 11-14, reveal 14-18,
verify 18-27, settle 27-30, then the next round opens. Flags reproduce every non-happy state for review.
"""
from __future__ import annotations

from dataclasses import dataclass

from .model import (Event, Health, NodeInfo, PoolNode, Problem, Rail, RoundInfo, Seat, Settlement, Snapshot,
                    Source, Verdict)

ROUND_LEN = 30.0
WINDOWS = (("FETCH", 0, 2), ("TRAIN", 2, 11), ("COMMIT", 11, 14), ("REVEAL", 14, 18), ("VERIFY", 18, 27),
           ("SETTLE", 27, 30))
ME = "0x8a4F2c1Eb0d93A57e1F0c6D44b9e2A7e7b391c2"
OWNER = "0x51B04fC2e8D1a9B37c6e0D2F4a18b5C9e0f77aE3"
FAKER = "0x9C1d77aB04eE3f5592cD0a81F6b2e4410c7d33A0"
ROSTER = [(ME, 3, 0.0), (OWNER, 0, 0.4), (FAKER, 5, 0.0), ("0x2Ee9A1c07B3d58F6e4a2C1b09D7f3E6a5c8b0d14", 1, 0.9),
          ("0xC07a33E1f9b2D4c6A85e0F17b3D29a4c6E81f5B2", 2, 0.2), ("0x6B4f0aD2c91E7b35F8a0C6d4E2b1f9A7c3D58e06", 4, 0.6)]
HONEST_HASH = "0x3f9ac17e5b20d4a9e8f61c03b7d2e95a4c18f07b62de39a1c5f804e7b93d2c61"
FAKER_COMMIT = "0x77ab0c4e19f2d83b5a6e07c1d9f4b28e3a5c60d17f9b42e8c03a1d5f6e7b9c40"
FAKER_REPLAY = "0x77ab0c4e19f2d83b5a6e0f31c8a2d47e9b5c60d17f9b42e8c03a1d5f6e7b9c40"
POOL_STATES = ["idle", "training", "idle", "offline", "committed", "training", "idle", "training", "revealed", "idle",
               "offline", "training", "committed", "idle", "training", "idle", "accepted", "training"]


@dataclass
class Flags:
    """Demo switches for the states the happy path never shows."""

    stale: float = 0.0  # seconds since the node API last answered; > 0 means stale
    offline: bool = False  # no node on this machine
    coordinator_down: float = 0.0
    verifier_down: bool = False  # verifier B never reports
    fresh: bool = False  # node joined, no round yet
    chain_mismatch: bool = False
    pool_size: int = 24


def _phase(t: float) -> tuple[int, str]:
    for i, (name, a, b) in enumerate(WINDOWS):
        if a <= t < b:
            return i, name
    return len(WINDOWS) - 1, "SETTLE"


def _rail(t: float) -> Rail:
    i, name = _phase(t)
    if name in ("FETCH", "TRAIN", "COMMIT"):
        left, label = int(14 - t), "result due"
    else:
        left = int(WINDOWS[i][2] - t)
        label = {"REVEAL": "reveal due", "VERIFY": "checks end", "SETTLE": "next round"}[name]
    return Rail(tuple(b - a for _, a, b in WINDOWS), t / ROUND_LEN, label, max(0, left))


def _seat(op: str, shard: int, lag: float, t: float, verifier_down: bool) -> Seat:
    faker = op == FAKER
    s = Seat(op, shard, "assigned", verdicts=[Verdict(), Verdict()])
    tt = t - lag
    if tt >= 2:
        s.state = "training"
    if tt >= 11.5:
        s.state, s.committed = "committed", True
        s.committed_hash = FAKER_COMMIT if faker else HONEST_HASH
    if t >= 15 + lag:
        s.state, s.revealed = "revealed", True
    if t >= 18:
        s.state = "verifying"
        for k, at in enumerate((21 + lag * 3, 22 + lag * 3)):
            if k == 1 and verifier_down:
                s.verdicts[k] = Verdict("offline")
            elif t < at:
                s.verdicts[k] = Verdict("replaying")
            else:
                s.verdicts[k] = Verdict("mismatch" if faker else "match", FAKER_REPLAY if faker else HONEST_HASH)
    if t >= 26 and not verifier_down:
        s.state = "slashed" if faker else "accepted"
    if t >= 27 and not verifier_down:
        s.outcome = "MISMATCH" if faker else "ACCEPTED"
        s.paid = "-15.00" if faker else "1.67"
    if faker:
        s.note = "This node was set to cheat for the demo."
        if s.state == "slashed":
            s.why = ["Both verifiers replayed segment 2 from the", "same start and got different weights.",
                     "ReplayMismatch  ·  stake 15.00 TOD slashed"]
    if not s.why:
        done = [v for v in s.verdicts if v.state in ("match", "mismatch")]
        if done and all(v.state == "match" for v in done):
            s.why = [f"{'Both verifiers' if len(done) == 2 else 'One verifier'} replayed every segment and",
                     "got the exact bytes this node committed."]
        else:
            s.why = ["Verifiers replay after the seed is drawn.", "Nothing to compare yet."]
    s.evidence_url = f"https://coordinator.tod.local/v1/jobs/7/rounds/12/evidence#{op}"
    return s


EVENTS = [
    (0.0, "Picked for round", "shard 3, result due in 14 s", "active"),
    (1.6, "Downloaded the model", "1.2 MB, checked", "plain"),
    (4.3, "Training step 1 of 4", "done in 0.41 s", "plain"),
    (6.5, "Training step 2 of 4", "done in 0.39 s", "plain"),
    (8.8, "Training step 3 of 4", "done in 0.40 s", "plain"),
    (11.0, "Training finished", "4 of 4 steps", "plain"),
    (11.2, "Sending result", "on chain", "plain"),
    (12.4, "Result recorded", "block 18,220,120", "ok"),
    (12.9, "Checkpoint uploaded", "1.2 MB", "plain"),
    (15.1, "Result revealed", "", "ok"),
    (22.0, "Verifier A agrees", "same result as yours", "ok"),
    (23.1, "Verifier B agrees", "same result as yours", "ok"),
    (26.0, "Another node slashed", "0x9C1d…33A0 lost 15.00 TOD", "danger"),
    (27.2, "Paid", "1.67 TOD to your owner wallet", "ok"),
]


def _events(rnd: int, t: float, flags: Flags) -> list[Event]:
    out = []
    for a, what, detail, kind in [(-30 + a, w, d, k) for a, w, d, k in EVENTS[-4:]] + EVENTS:
        if a > t or (flags.verifier_down and what in ("Verifier B agrees", "Another node slashed", "Paid") and a >= 0):
            continue
        r = rnd if a >= 0 else rnd - 1
        secs = 2 * 60 + 11 + int(a) + (r - 12) * 30
        out.append(Event(f"14:{secs // 60:02d}:{secs % 60:02d}", 7, r, what, detail, kind))
    return out


def _pool(roster: list[Seat], size: int) -> list[PoolNode]:
    import hashlib

    out = [PoolNode(s.op, s.state, "arm64" if i % 2 else "x86_64", "0.2.0", "mlp-exact/1  cnn/1", "4 s ago",
                    "07  ·  round 12", "40 accepted  ·  1 slashed" if s.state == "slashed" else "41 accepted  ·  0 slashed")
           for i, s in enumerate(roster)]
    for i in range(max(0, size - len(out))):
        state = POOL_STATES[i % len(POOL_STATES)]
        op = "0x" + hashlib.sha1(str(i + 3).encode()).hexdigest()[:40]
        busy = state not in ("idle", "offline")
        out.append(PoolNode(op, state, "x86_64" if i % 3 else "arm64", "0.2.0", "mlp-exact/1",
                            "11 min ago" if state == "offline" else "4 s ago", "07  ·  round 12" if busy else "none",
                            f"{12 + i % 30} accepted  ·  0 slashed"))
    return out


def snapshot(clock: float, flags: Flags | None = None) -> Snapshot:
    f = flags or Flags()
    rnd = 12 + int(clock // ROUND_LEN)
    t = clock % ROUND_LEN
    roster = [_seat(op, shard, lag, t, f.verifier_down) for op, shard, lag in ROSTER]
    settled = t >= 27 and not f.verifier_down
    rounds_paid = int(clock // ROUND_LEN) + (1 if settled else 0)
    i, phase = _phase(t)
    settlement = Settlement(done=settled, signed=1 if f.verifier_down and t >= 22 else (2 if settled else 0))
    if settled:
        settlement = Settlement(True, "ACCEPTED", "5 paid  ·  1 slashed",
                                "0x5d1e83c0a9f24b7e61d05c3a8f92e4b17c0d6a35e8f1b294c7a03d5e6f8b1c22",
                                "5 × 1.67 TOD  ·  15.00 TOD slashed to the community pool  ·  tx 0x4be1...07", 2, 2)
    round_info = RoundInfo(7, rnd, phase.lower(), "mlp-exact/1", _rail(t), roster, ["VERIFIER A", "VERIFIER B"],
                           [True, not f.verifier_down], settlement)

    me = roster[0]
    stale = f.stale > 0
    health = [Health("rpc", "unknown" if stale else "ok", "unknown" if stale else "180 ms"),
              Health("coordinator", "bad" if f.coordinator_down else "ok",
                     f"no answer {f.coordinator_down:.0f} s" if f.coordinator_down else "v0.3.1"),
              Health("heartbeat", "unknown" if stale else "ok", "unknown" if stale else "4 s ago"),
              Health("clock", "ok", "+0.4 s"), Health("gas", "ok", "0.0021 ETH")]
    seg = 0 if t < 2 else min(4, int((t - 2) / 2.25) + 1)
    node = NodeInfo(ME, OWNER, "honest", "0.2.0", "idle" if f.fresh else me.state, None if f.fresh else 7,
                    None if f.fresh else rnd, None if f.fresh else me.shard, "mlp-exact/1", seg, 4, me.committed,
                    me.revealed, "0.00" if f.fresh else f"{12.40 + 1.67 * rounds_paid:.2f}",
                    [("accepted", "0" if f.fresh else str(41 + rounds_paid)), ("skipped", "0" if f.fresh else "1"),
                     ("no-reveals", "0"), ("slashed", "0.00 TOD"), ("probation", "0.0 / 5.0 h" if f.fresh else "3.4 / 5.0 h")],
                    health, 0 if f.fresh else 212_000_000, 2_048_000_000, "9 other nodes are also waiting.")
    if f.offline:
        node = None

    sources = {"node": Source("node", "down" if f.offline else ("stale" if stale else "ok"), f.stale, "127.0.0.1:7777"),
               "coordinator": Source("coordinator", "stale" if f.coordinator_down else "ok", f.coordinator_down,
                                     "coordinator.tod.local"),
               "chain": Source("chain", "ok", 0, "84532")}
    problems = []
    if f.chain_mismatch:
        problems.append(Problem("chain_mismatch", "Your node is on the wrong network (31337, expected 84532). "
                                "Restart it on the right one:", "tod-node run --network base-sepolia"))
    if f.verifier_down and t >= 22:
        problems.append(Problem("verifier_silent", "Verifier B has not reported yet. The round settles once it does.",
                                "Nothing to do on your side."))
    return Snapshot("demo", "BASE SEPOLIA", 84532, 18220114 + int(clock / 2), node, round_info,
                    _pool(roster, f.pool_size), [] if f.fresh else _events(rnd, t, f), sources, problems)


class DemoSource:
    """Drives the scripted round for the app: owns the clock, pause and the simulated states."""

    def __init__(self, clock: float = 8.6, flags: Flags | None = None):
        self.clock, self.flags, self.paused = clock, flags or Flags(), False
        self.coord_clock: float | None = None  # clock when the coordinator went quiet; Round and Pool freeze there

    def advance(self, dt: float) -> None:
        f = self.flags
        if f.stale:
            f.stale += dt
        if f.coordinator_down:
            f.coordinator_down += dt
        if not self.paused and not f.stale:
            self.clock += dt

    def toggle(self, key: str) -> None:
        f = self.flags
        if key == "stale":
            f.stale = 0.0 if f.stale else 14.0
        elif key == "coordinator_down":
            f.coordinator_down = 0.0 if f.coordinator_down else 40.0
            self.coord_clock = None if not f.coordinator_down else self.clock
        elif key == "big_pool":
            f.pool_size = 24 if f.pool_size > 24 else 120
        else:
            setattr(f, key, not getattr(f, key))

    def snapshot(self) -> Snapshot:
        snap = snapshot(self.clock, self.flags)
        if self.coord_clock is not None:
            frozen = snapshot(self.coord_clock, self.flags)
            snap.round, snap.pool = frozen.round, frozen.pool
        return snap
