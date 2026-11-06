"""Verifier side of a round: replay every revealed node, make sure the seed is drawn, attest once, then co-sign."""
import json
import logging

from tod_core import encodings as enc
from tod_core.hashing import k256
from tod_core.ledger import Kind, Phase, Reverted, RoundStatus

log = logging.getLogger(__name__)


def replay_round(runner, state, job: int, rnd: int) -> dict[str, dict]:
    """{operator: {kind, replayRoot, claimedRoot}} for every revealed node, replayed from the same public inputs."""
    out = {}
    for op, nr in sorted(state.rounds[(job, rnd)]["nodeRounds"].items()):
        if not nr["revealed"]:
            continue
        hs, _, _ = runner.run(state, job, rnd, nr["shard"])
        replay, claimed = enc.checkpoint_root(hs), bytes(nr["checkpointRoot"])
        out[op] = {"kind": None if replay == claimed else "ReplayMismatch",
                   "replayRoot": "0x" + replay.hex(), "claimedRoot": "0x" + claimed.hex()}
    return out


def report_bytes(job: int, rnd: int, verifier: str, results: dict) -> bytes:
    """Canonical report: sorted keys, no floats, so its keccak is a stable reportHash."""
    return json.dumps({"job": job, "round": rnd, "verifier": verifier, "results": results},
                      sort_keys=True, separators=(",", ":")).encode()


class VerifierLoop:
    def __init__(self, market, verifier: str, runner, emit=lambda *a, **k: None, upload=None, cosigner=None):
        self.market, self.runner, self.emit, self.upload, self.cosigner = market, runner, emit, upload, cosigner
        self.verifier = verifier
        self.accepting = True
        self.done: set[tuple[int, int]] = set()

    def pending_reveal(self, state) -> list:
        return []  # verifiers commit nothing, so stopping never costs them stake

    def tick(self, state) -> None:
        for (job, rnd), r in sorted(state.rounds.items()):
            if (job, rnd) in self.done or r["status"] != RoundStatus.OPEN:
                continue
            if Phase(self.market.phase(job, rnd)) != Phase.VERIFY:
                continue
            try:
                if r["seed"] == bytes(32):
                    self._seed(job, rnd, r)
                elif self.accepting:
                    self._attest(state, job, rnd)
            except Reverted as e:
                if str(e) == "AlreadyReported":
                    self.done.add((job, rnd))
                log.warning("job %s round %s: %s", job, rnd, e)
        if self.cosigner and self.accepting:
            self.cosigner.tick(state)

    def _seed(self, job: int, rnd: int, r: dict) -> None:
        """Lock, then draw two blocks later. The coordinator usually does this; racing it costs at most a revert."""
        if r["seedBlock"] == 0:
            self.market.lockSeed(job, rnd)
            return
        try:
            self.market.drawSeed(job, rnd)
        except Reverted as e:
            if str(e) == "TooLate":  # the seed block's hash is gone; pick a new one
                self.market.lockSeed(job, rnd)
            elif str(e) != "TooEarly":
                raise

    def _attest(self, state, job: int, rnd: int) -> None:
        results = replay_round(self.runner, state, job, rnd)
        failed = [op for op, v in results.items() if v["kind"]]
        if len(failed) * 2 > len(results):
            # More than half failing is likelier our own bug than a majority of cheats: never slash on that.
            self.done.add((job, rnd))
            self.emit("error", job=job, round=rnd, code="verifier_suspects_self", failed=len(failed), of=len(results))
            log.error("job %s round %s: %d of %d nodes failed replay, not attesting", job, rnd, len(failed), len(results))
            return
        report = report_bytes(job, rnd, self.verifier, results)
        if self.upload:
            try:
                self.upload(report, job, rnd)
            except OSError as e:  # the hash on chain still commits to the report; uploading is for readers
                log.warning("job %s round %s: report upload failed: %s", job, rnd, e)
        failures = [(op, int(Kind.REPLAY_MISMATCH), False) for op in failed]
        self.market.attestRound(job, rnd, k256(report), failures)
        self.done.add((job, rnd))
        self.emit("round.attested", job=job, round=rnd, failures=failed)
        log.info("job %s round %s: attested, %d failure(s)", job, rnd, len(failed))

