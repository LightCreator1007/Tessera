"""Verifier loop decisions with a fake market: the safety breaker and the seed steps."""
from types import SimpleNamespace

from tod_core.ledger import Phase, Reverted, RoundStatus

from tod_verifier import verify
from tod_verifier.verify import VerifierLoop


class Market:
    def __init__(self, draw_error=None):
        self.calls, self.draw_error = [], draw_error

    def phase(self, job, rnd):
        return Phase.VERIFY

    def lockSeed(self, job, rnd):
        self.calls.append("lockSeed")

    def drawSeed(self, job, rnd):
        self.calls.append("drawSeed")
        if self.draw_error:
            raise Reverted(self.draw_error)

    def attestRound(self, job, rnd, report_hash, failures):
        self.calls.append(("attest", failures))


def state(seed=bytes(32), seed_block=0):
    return SimpleNamespace(rounds={(1, 1): {"status": RoundStatus.OPEN, "seed": seed, "seedBlock": seed_block}})


def test_more_than_half_failing_means_no_attestation(monkeypatch):
    results = {f"0x{i}": {"kind": "ReplayMismatch" if i < 2 else None} for i in range(3)}
    monkeypatch.setattr(verify, "replay_round", lambda *a: results)
    events, market = [], Market()
    loop = VerifierLoop(market, "0xV", None, emit=lambda t, **k: events.append(k.get("code")))
    loop.tick(state(seed=b"\1" * 32))
    assert market.calls == [] and events == ["verifier_suspects_self"] and loop.done == {(1, 1)}


def test_a_minority_of_failures_is_attested(monkeypatch):
    results = {f"0x{i}": {"kind": "ReplayMismatch" if i == 0 else None} for i in range(3)}
    monkeypatch.setattr(verify, "replay_round", lambda *a: results)
    market = Market()
    VerifierLoop(market, "0xV", None).tick(state(seed=b"\1" * 32))
    assert market.calls == [("attest", [("0x0", 3, False)])]


def test_seed_is_locked_then_drawn_and_relocked_when_lost():
    m = Market()
    VerifierLoop(m, "0xV", None).tick(state())
    assert m.calls == ["lockSeed"]
    m = Market(draw_error="TooEarly")
    VerifierLoop(m, "0xV", None).tick(state(seed_block=10))
    assert m.calls == ["drawSeed"]
    m = Market(draw_error="TooLate")
    VerifierLoop(m, "0xV", None).tick(state(seed_block=10))
    assert m.calls == ["drawSeed", "lockSeed"]


def test_only_the_two_registered_verifiers_get_anvil_dev_keys(monkeypatch):
    from typer.testing import CliRunner

    from tod_verifier.cli import app
    monkeypatch.delenv("VERIFIER_C_PRIVATE_KEY", raising=False)
    r = CliRunner().invoke(app, ["replay", "--job", "1", "--round", "1", "--network", "anvil",
                                 "--coordinator", "http://127.0.0.1:9", "--key-env", "VERIFIER_C_PRIVATE_KEY"])
    assert r.exit_code == 2 and "VERIFIER_A_PRIVATE_KEY or VERIFIER_B_PRIVATE_KEY" in r.output
