"""Capped gas top-up: the operator of a World ID-verified owner gets enough ETH for commits and reveals, and no more."""
import os
import threading
import time

from api import config

# 0.001 ETH pays for thousands of commit and reveal pairs at Base fees; the cap stops one human draining the faucet.
TARGET_WEI = int(os.environ.get("TOPUP_TARGET_WEI", str(10**15)))
CAP_WEI = int(os.environ.get("TOPUP_CAP_WEI", str(5 * 10**15)))
COOLDOWN = int(os.environ.get("TOPUP_COOLDOWN_SECONDS", "3600"))
TRANSFER_GAS = 21_000


class Refused(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class Chain:
    """The registry, market and faucet key on TOD_NETWORK, opened on first use so the API starts without an RPC."""

    def __init__(self):
        self._ledger = self._sender = None

    def _open(self):
        if self._ledger is None:
            from tod_core.ledger import Ledger, Network
            from tod_core.txmgr import TxManager, signer_from_env

            net = Network.load(os.environ.get("TOD_NETWORK", "anvil"))
            if net.chain_id != config.CHAIN_ID or net.registry.lower() != config.NODE_REGISTRY.lower():
                raise Refused(503, f"TOD_NETWORK {net.name} is not the chain and registry this coordinator serves")
            self._ledger = Ledger(net)
            faucet = signer_from_env("FAUCET_PRIVATE_KEY", "faucet", net.chain_id)
            self._sender = TxManager(self._ledger.w3, faucet, os.environ.get("TOPUP_JOURNAL_DIR", "txmgr-topup"))
        return self._ledger

    def node(self, operator: str) -> tuple[bool, str]:
        n = self._open().registry.getNode(operator)
        return n.joined, n.owner

    def confirmed(self, job: int, rnd: int, operator: str) -> int:
        """The failure kind both verifiers confirmed for this operator in this round, 0 for none."""
        return int(self._open().market.getNodeRound(job, rnd, operator).confirmed)

    def balance(self, operator: str) -> int:
        return self._open().w3.eth.get_balance(operator)

    def send(self, operator: str, wei: int) -> str:
        self._open()
        h = self._sender.transact(operator, "0x", value=wei, gas=TRANSFER_GAS)["transactionHash"]
        return h if isinstance(h, str) else "0x" + bytes(h).hex()


class Topups:
    def __init__(self, db, chain, now=time.time):
        self.db, self.chain, self.now = db, chain, now
        self._lock = threading.Lock()  # two requests for one human must not both pass the cap check
        db.execute("CREATE TABLE IF NOT EXISTS topups (nullifier TEXT PRIMARY KEY, total INTEGER, last INTEGER)")

    def grant(self, operator: str) -> dict:
        joined, owner = self.chain.node(operator)
        if not joined:
            raise Refused(403, "operator has not joined the registry")
        row = self.db.execute("SELECT nullifier FROM humans WHERE owner = ?", (owner,)).fetchone()
        if not row:
            raise Refused(403, "the operator's owner has not joined with World ID here")
        balance = self.chain.balance(operator)
        if balance >= TARGET_WEI // 2:
            return {"sent": 0, "balance": balance}
        with self._lock:
            total, last = self.db.execute("SELECT total, last FROM topups WHERE nullifier = ?",
                                          (row[0],)).fetchone() or (0, 0)
            now = int(self.now())
            if now - last < COOLDOWN:
                raise Refused(429, f"topped up {now - last} s ago; try again in {COOLDOWN - (now - last)} s")
            amount = min(TARGET_WEI - balance, CAP_WEI - total)
            if amount <= 0:
                raise Refused(403, "this human's gas allowance is used up")
            # Recorded before sending: a crash mid-send costs allowance, never a second payment.
            self.db.execute("INSERT OR REPLACE INTO topups VALUES (?, ?, ?)", (row[0], total + amount, now))
            self.db.commit()
        tx = self.chain.send(operator, amount)
        return {"sent": amount, "balance": balance + amount, "tx": tx}
