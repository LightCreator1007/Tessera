"""The chain watcher that queues a job's final model for Arkiv once JobMarket says the job completed."""
import logging
import threading
from types import SimpleNamespace as NS

import pytest

import publish as P
from api import config
from publish import chain as C
from tod_core.ledger import JobStatus, RoundStatus

MARKET = "0x" + "ab" * 20
S, R, V, OPEN = RoundStatus.SETTLED, RoundStatus.REVERTED, RoundStatus.VOID, RoundStatus.OPEN


def g(n: int) -> bytes:
    return bytes([n]) * 32


def hx(n: int) -> str:
    return "0x" + g(n).hex()


class FakeLedger:
    """JobMarket as the watcher sees it: JobClosed logs by block, plus the getJob and getRound views."""

    def __init__(self, head=100, market=MARKET, deploy=5, span=10):
        self.net = NS(chain_id=config.CHAIN_ID, market=market, deploy_block=deploy, log_span=span, rpc="")
        self.w3 = NS(eth=NS(block_number=head))
        self.logs, self.jobs, self.ranges, self.fail = [], {}, [], None
        self.market = NS(getJob=self._job, getRound=self._round)

    def close(self, block, job, status=JobStatus.COMPLETED, rounds=()):
        """rounds: (status, fallback, aggregate) per round, oldest first."""
        self.logs.append((block, job, status))
        self.jobs[job] = (status, [NS(status=s, fallback_=f, aggregateHash=a) for s, f, a in rounds])

    def events(self, start, end, names=None):
        assert names == ["JobClosed"]
        self.ranges.append((start, end))
        for block, job, status in sorted(self.logs):
            if self.fail and block >= self.fail[0]:
                raise self.fail[1]
            if start <= block <= end:
                yield NS(name="JobClosed", args={"jobId": job, "status": int(status)}, block=block)

    def _job(self, job):
        status, rounds = self.jobs[job]
        return None, NS(status=status, roundsOpened=len(rounds))

    def _round(self, job, r):
        return self.jobs[job][1][r - 1]


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setattr(config, "ARKIV_ENABLED", True)
    for t in ("published", "chain_cursor"):
        P.db.execute(f"DELETE FROM {t}")
    P.db.commit()
    return FakeLedger()


def queued(job):
    s = P.status(job)
    return (s["round"], s["keccak"]) if s else None


def test_a_completed_job_queues_its_last_accepted_round(on):
    on.close(50, 1, rounds=[(S, False, g(1)), (S, False, g(2))])
    assert C.scan(on, 0)
    assert queued(1) == (2, hx(2)) and P.status(1)["state"] == "pending"


def test_later_reverted_void_and_fallback_rounds_keep_the_earlier_model(on):
    # Round 2 is the last verified change; 3 reverted, 4 void and 5 fell back, each ending on round 2's model.
    on.close(50, 1, rounds=[(S, False, g(1)), (S, False, g(2)), (R, False, g(2)), (V, False, g(2)), (S, True, g(2))])
    C.scan(on, 0)
    assert queued(1) == (2, hx(2))


def test_a_job_with_nothing_accepted_publishes_nothing(on, caplog):
    on.close(50, 1, rounds=[(R, False, g(9)), (V, False, g(9)), (S, True, g(9))])
    with caplog.at_level(logging.INFO, "tod.publish.chain"):
        C.scan(on, 0)
    assert queued(1) is None and "nothing was trained" in caplog.text


def test_a_cancelled_job_is_not_published(on):
    on.close(50, 1, status=JobStatus.CANCELLED, rounds=[(S, False, g(1)), (OPEN, False, g(0))])
    C.scan(on, 0)
    assert queued(1) is None


def test_the_chain_view_decides_not_the_event(on):
    # An event that says Completed for a job the views show as active (a reorg mid-scan, say) is not trusted.
    on.close(50, 1, rounds=[(S, False, g(1))])
    on.jobs[1] = (JobStatus.ACTIVE, on.jobs[1][1])
    C.scan(on, 0)
    assert queued(1) is None


def test_an_inconsistent_job_is_skipped_and_the_rest_still_publish(on, caplog):
    on.close(40, 1, rounds=[(S, False, g(1)), (R, False, g(7))])  # the last round should end on g(1)
    on.close(60, 2, rounds=[(S, False, g(3))])
    C.scan(on, 0)
    assert queued(1) is None and queued(2) == (1, hx(3))
    assert "not publishing it" in caplog.text and C.cursor(on.net) == 101


def test_unconfirmed_blocks_wait(on):
    on.close(95, 1, rounds=[(S, False, g(1))])
    C.scan(on, 10)  # confirmed head is 90
    assert queued(1) is None and C.cursor(on.net) == 91
    on.w3.eth.block_number = 105
    C.scan(on, 10)
    assert queued(1) == (1, hx(1))


def test_the_cursor_survives_and_a_rescan_changes_nothing(on):
    on.close(50, 1, rounds=[(S, False, g(1))])
    C.scan(on, 0)
    P._set(1, state="indexed", arkiv_key="0x" + "ee" * 32)
    on.ranges.clear()
    assert C.scan(on, 0) and on.ranges == []  # nothing new, so nothing is asked of the RPC
    P.db.execute("DELETE FROM chain_cursor")  # as if the cursor were lost: the full rescan is harmless
    C.scan(on, 0)
    assert P.status(1)["state"] == "indexed"


def test_an_rpc_failure_keeps_the_cursor_so_nothing_is_skipped(on):
    on.close(30, 1, rounds=[(S, False, g(1))])
    on.close(70, 2, rounds=[(S, False, g(2))])
    on.fail = (70, ConnectionError("rpc down"))
    with pytest.raises(ConnectionError):
        C.scan(on, 0)
    assert C.cursor(on.net) == 5 and queued(1) == (1, hx(1))
    on.fail = None
    C.scan(on, 0)
    assert queued(2) == (1, hx(2)) and queued(1) == (1, hx(1))


def test_a_long_backfill_saves_its_place_each_pass(on):
    on.w3.eth.block_number = 5 + 10 * C.PAGES_PER_PASS * 2 + 3
    on.close(5 + 10 * C.PAGES_PER_PASS + 1, 1, rounds=[(S, False, g(1))])
    assert not C.scan(on, 0) and queued(1) is None
    assert C.cursor(on.net) == 5 + 10 * C.PAGES_PER_PASS
    assert not C.scan(on, 0) and queued(1) == (1, hx(1))
    assert C.scan(on, 0)


def test_a_redeployed_market_starts_from_its_own_deploy_block(on):
    C.scan(on, 0)
    other = FakeLedger(market="0x" + "cd" * 20, deploy=80)
    assert C.cursor(other.net) == 80 and C.cursor(on.net) == 101


def test_a_rescan_never_requeues_a_failed_job(on):
    on.close(50, 1, rounds=[(S, False, g(1))])
    C.scan(on, 0)
    P._set(1, state="failed", error="x")
    P.db.execute("DELETE FROM chain_cursor")
    C.scan(on, 0)
    assert P.status(1)["state"] == "failed"  # the admin retry route is the way back, after checking the explorer


def test_watch_does_nothing_without_a_network(monkeypatch, caplog):
    monkeypatch.setattr(config, "TOD_NETWORK", "")
    C.watch(threading.Event(), opener=lambda: pytest.fail("must not open"), every=0)
    assert "admin" in caplog.text


def test_watch_stops_on_a_bad_setting_and_retries_a_flaky_rpc(on, monkeypatch, caplog):
    monkeypatch.setattr(config, "TOD_NETWORK", "anvil")
    calls, stop = [], threading.Event()

    def opener():
        calls.append(1)
        if len(calls) == 1:
            raise ConnectionError("HTTPSConnectionPool(host='base-sepolia.g.alchemy.com', port=443): Max retries "
                                  "exceeded with url: /v2/SECRETKEY (Caused by NewConnectionError) for url: "
                                  "https://base-sepolia.g.alchemy.com/v2/SECRETKEY")
        if len(calls) == 2:
            return on
        raise AssertionError("opened twice after success")

    on.close(50, 1, rounds=[(S, False, g(1))])
    t = threading.Thread(target=C.watch, args=(stop,), kwargs={"opener": opener, "every": 0.01})
    t.start()
    for _ in range(200):
        if queued(1):
            break
        threading.Event().wait(0.01)
    stop.set()
    t.join(2)
    assert queued(1) == (1, hx(1)) and len(calls) == 2
    assert "SECRETKEY" not in caplog.text and "<url>" in caplog.text

    def bad():
        raise C.Misconfigured("TOD_NETWORK x is not the chain and JobMarket this coordinator serves")

    C.watch(threading.Event(), opener=bad, every=0)  # returns instead of looping
    assert "not watching the chain" in caplog.text


def test_open_ledger_refuses_a_network_for_another_market(monkeypatch, tmp_path):
    toml = tmp_path / "x.toml"
    toml.write_text('name = "x"\nchainId = %d\nrpc = "http://127.0.0.1:1"\n[roles]\n[contracts]\n'
                    'token = "0x%s"\nregistry = "0x%s"\nmarket = "0x%s"\ndeployBlock = 1\n'
                    % (config.CHAIN_ID, "01" * 20, "02" * 20, "03" * 20))
    monkeypatch.setattr(config, "TOD_NETWORK", str(toml))
    monkeypatch.setattr(config, "JOB_MARKET", MARKET)
    with pytest.raises(C.Misconfigured, match="JobMarket"):
        C.open_ledger()
    toml.write_text(toml.read_text().replace('rpc = "http://127.0.0.1:1"', 'rpc = ""'))
    with pytest.raises(C.Misconfigured, match="RPC URL missing"):
        C.open_ledger()
