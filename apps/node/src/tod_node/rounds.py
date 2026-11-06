"""Node side of a round: train, commit, reveal. Hashes and salt are on disk before the commit that needs them."""
import json
import logging
import os
import time
import urllib.error
from collections.abc import Callable
from pathlib import Path

from tod_core import encodings as enc
from tod_core.ledger import Phase, Reverted, RoundStatus

log = logging.getLogger(__name__)

AT_RISK = 0.2  # warn once less than this share of the reveal window is left and the reveal still hasn't landed

# (ChainState, job, round) -> checkpoint hashes h_0..h_K, where h_0 is the round's startWeightsHash.
Trainer = Callable[[object, int, int], list[bytes]]


class RoundStore:
    """Per-round hashes and salts in one JSON file, replaced atomically so a crash leaves the old or the new file."""

    def __init__(self, path: Path):
        self.path = path

    def _all(self) -> dict:
        return json.loads(self.path.read_text()) if self.path.exists() else {}

    def get(self, job: int, rnd: int) -> dict | None:
        rec = self._all().get(f"{job}/{rnd}")
        if rec is None:
            return None
        return {"hashes": [bytes.fromhex(h) for h in rec["hashes"]], "salt": bytes.fromhex(rec["salt"])}

    def put(self, job: int, rnd: int, hashes: list[bytes], salt: bytes) -> None:
        data = self._all()
        data[f"{job}/{rnd}"] = {"hashes": [h.hex() for h in hashes], "salt": salt.hex()}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        # 0600 because a salt seen before reveal would let anyone copy this node's commit.
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(data, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, self.path)


def check_hashes(hs: list[bytes], start: bytes, segments: int) -> str | None:
    """The same checks `reveal` makes on chain, so a bad training result is caught before anything is sent."""
    if len(hs) != segments + 1:
        return f"expected {segments + 1} checkpoint hashes, got {len(hs)}"
    if hs[0] != start:
        return "first checkpoint is not the round's start weights"
    if any(a == b for a, b in zip(hs, hs[1:])):
        return "two consecutive checkpoints are identical"
    return None


def _noop(type_: str, **fields) -> None:
    pass


class RoundLoop:
    def __init__(self, market, operator: str, chain_id: int, store: RoundStore, train: Trainer, emit=_noop,
                 clock: Callable[[], float] = time.time):
        self.market, self.store, self.train, self.emit, self.clock = market, store, train, emit, clock
        self.operator = operator.lower()
        self.dom = enc.domain(chain_id, market.address)
        self.accepting = True  # False once a stop is requested: finish reveals, start nothing new
        self.skipped: set[tuple[int, int]] = set()
        self.waiting: set[tuple[int, int]] = set()  # rounds whose inputs the coordinator refused so far
        self.at_risk: set[tuple[int, int]] = set()  # rounds already warned about, so the log gets one line each
        self.sent: set[tuple[int, int]] = set()  # reveals sent but not yet seen on chain by the last sync
        self.owed: list[dict] = []  # committed, unrevealed rounds as of the last tick; GET /v1/status serves it

    def _mine(self, state):
        """(job, round, round, our nodeRound) for every open round this node is on, oldest first."""
        for (job, rnd), r in sorted(state.rounds.items()):
            nr = next((v for op, v in r["nodeRounds"].items() if op.lower() == self.operator), None)
            if nr is not None and r["status"] == RoundStatus.OPEN and not nr["revealed"]:
                yield job, rnd, r, nr

    def pending_reveal(self, state) -> list[tuple[int, int]]:
        """Rounds where we committed but haven't revealed: leaving now would cost a no-reveal penalty."""
        return [(job, rnd) for job, rnd, _, nr in self._mine(state) if nr["committed"]]

    def owed_reveals(self, state) -> list[dict]:
        """What stopping now would put at risk: each owed reveal, its deadline, and the stake a miss there would cost."""
        out = []
        for job, rnd, r, nr in self._mine(state):
            if not nr["committed"] or (job, rnd) in self.sent:
                continue
            params = state.jobs[job]["params"]
            stake = getattr(params, "stakePerNode", None)
            # The contract counts misses per job; the next one costs 1%, 10%, then 50% of the job's stake.
            missed = sum(1 for (j, _), o in state.rounds.items() if j == job
                         and any(op.lower() == self.operator and v.get("noRevealReported") for op, v in o["nodeRounds"].items()))
            bps = 100 if missed == 0 else 1000 if missed == 1 else 5000
            out.append({"job": job, "round": rnd, "commitDeadline": r.get("commitDeadline"),
                        "revealDeadline": r.get("revealDeadline"), "missed": missed,
                        "penalty": stake * bps // 10_000 if stake is not None else None})
        return out

    def _warn_at_risk(self, owed: list[dict]) -> None:
        now = self.clock()
        for o in owed:
            key, start, end = (o["job"], o["round"]), o["commitDeadline"], o["revealDeadline"]
            if key in self.at_risk or start is None or end is None or end <= start:
                continue
            left = end - now
            if left < (end - start) * AT_RISK:
                self.at_risk.add(key)
                log.warning("job %s round %s: reveal still not in with %ds left", o["job"], o["round"], max(0, left))
                self.emit("reveal.at_risk", job=o["job"], round=o["round"], secondsLeft=max(0, int(left)),
                          revealDeadline=end, penalty=o["penalty"])

    def tick(self, state) -> None:
        """Act on every open round this node is in; safe to call as often as you like."""
        self.owed = self.owed_reveals(state)
        for job, rnd, r, nr in self._mine(state):
            if (job, rnd) in self.skipped:
                continue
            # Ask the contract: reveal opens early once every node has committed, so local clocks aren't enough.
            phase = Phase(self.market.phase(job, rnd))
            try:
                if phase == Phase.COMMIT and not nr["committed"] and self.accepting:
                    self._commit(state, job, rnd)
                elif phase == Phase.REVEAL and nr["committed"]:
                    self._reveal(job, rnd)
            except Reverted as e:
                log.warning("job %s round %s: %s reverted with %s", job, rnd, phase.name.lower(), e)
                self.emit("tx.reverted", job=job, round=rnd, kind=phase.name.lower(), revert=str(e))
        # After acting, so a reveal that just landed this tick isn't reported as at risk.
        self.owed = [o for o in self.owed if (o["job"], o["round"]) not in self.sent]
        self._warn_at_risk(self.owed)

    def _skip(self, job: int, rnd: int, reason: str) -> None:
        log.error("job %s round %s: skipped, %s", job, rnd, reason)
        self.skipped.add((job, rnd))
        self.emit("round.skipped", job=job, round=rnd, reason=reason)

    def _commit(self, state, job: int, rnd: int) -> None:
        r, segments = state.rounds[(job, rnd)], state.jobs[job]["params"].segments
        rec = self.store.get(job, rnd)
        if rec is None:
            try:
                hs = self.train(state, job, rnd)
            except (urllib.error.URLError, OSError) as e:
                # The coordinator lists a round's roster a tick after opening it, so an early fetch can be refused.
                # Try again on later ticks; tick only commits in the commit window, so this stops when it closes.
                if (job, rnd) not in self.waiting:
                    self.waiting.add((job, rnd))
                    self.emit("round.waiting", job=job, round=rnd, reason=f"inputs not available yet: {e}")
                return
            except Exception as e:  # a broken job must not take the node down or retrain every tick
                return self._skip(job, rnd, f"training failed: {e}")
            problem = check_hashes(hs, r["startWeightsHash"], segments)
            if problem:
                return self._skip(job, rnd, problem)
            rec = {"hashes": hs, "salt": os.urandom(32)}
            self.store.put(job, rnd, rec["hashes"], rec["salt"])
        root = enc.checkpoint_root(rec["hashes"])
        h = enc.commit_hash(self.dom, job, rnd, self.operator, root, rec["salt"])
        self.market.commit(job, rnd, h)
        log.info("job %s round %s: committed", job, rnd)
        self.emit("round.committed", job=job, round=rnd, commitHash="0x" + h.hex())

    def _reveal(self, job: int, rnd: int) -> None:
        rec = self.store.get(job, rnd)
        if rec is None:
            log.error("job %s round %s: committed but the saved hashes are gone, cannot reveal", job, rnd)
            self.emit("error", job=job, round=rnd, code="salt_lost")
            return
        self.market.reveal(job, rnd, rec["hashes"], rec["salt"])
        self.sent.add((job, rnd))
        log.info("job %s round %s: revealed", job, rnd)
        self.emit("round.revealed", job=job, round=rnd, updateHash="0x" + rec["hashes"][-1].hex())
