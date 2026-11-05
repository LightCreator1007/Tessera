"""One sender queue per key: local nonces, a write-ahead journal, fee-bumped replacement, restart reconcile."""
import json
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from eth_account import Account
from web3 import Web3
from web3.exceptions import TransactionNotFound, Web3RPCError

from .hashing import k256

log = logging.getLogger(__name__)

ANVIL_CHAIN_ID = 31337
GAS_MARGIN = 1.3
GWEI = 10**9
# A lagging RPC replica can report the nonce used before it serves the receipt, so wait a few polls before giving up.
ORPHAN_POLLS = 5


class Signer(Protocol):
    """The only thing txmgr needs from a key, so a KMS can replace LocalSigner."""

    address: str

    def sign(self, tx: dict) -> bytes: ...


class LocalSigner:
    def __init__(self, key: bytes | str):
        self._account = Account.from_key(key)
        self.address = self._account.address

    def sign(self, tx: dict) -> bytes:
        return bytes(self._account.sign_transaction(tx).raw_transaction)


def dev_key(label: str) -> bytes:
    """A key derived from a public label: it guards nothing, so signer_from_env allows it on anvil only."""
    return k256(b"tod-dev/" + label.encode())


def signer_from_env(env: str, label: str, chain_id: int) -> LocalSigner:
    key = os.environ.get(env)
    if key:
        return LocalSigner(key)
    if chain_id != ANVIL_CHAIN_ID:
        raise RuntimeError(f"{env} is not set, and dev keys are refused on chain {chain_id}")
    return LocalSigner(dev_key(label))


class TxReverted(Exception):
    def __init__(self, receipt):
        super().__init__(f"tx {receipt['transactionHash'].hex()} reverted")
        self.receipt = receipt


class NonceTaken(Exception):
    """Another transaction used this nonce, so a second process is sending with this key."""


@dataclass
class Tx:
    nonce: int
    to: str | None
    data: str
    value: int
    gas: int
    max_fee: int
    tip: int
    raw: str
    hashes: list[str]
    sent_block: int
    receipt: dict | None = field(default=None, repr=False)
    error: Exception | None = field(default=None, repr=False)
    orphan_polls: int = 0

    def journal(self) -> dict:
        return {k: getattr(self, k) for k in
                ("nonce", "to", "data", "value", "gas", "max_fee", "tip", "raw", "hashes", "sent_block")}


class TxManager:
    """Thread-safe sender for one key. Only one process may use a key at a time.

    `journal_dir` must survive restarts and holds signed transactions, never the key.
    ponytail: a receipt counts as final at one confirmation; add a confirmation depth if a chain reorgs in practice.
    """

    def __init__(self, w3: Web3, signer: Signer, journal_dir: str | Path, bump_blocks: int = 3, bump_pct: int = 20,
                 max_fee_cap: int = 500 * GWEI, poll_seconds: float = 1.0):
        self.w3, self.signer = w3, signer
        self.bump_blocks, self.bump_pct, self.max_fee_cap = bump_blocks, bump_pct, max_fee_cap
        self.poll_seconds = poll_seconds
        self._lock = threading.Lock()
        self._pending: dict[int, Tx] = {}
        self._path = Path(journal_dir) / f"txmgr-{w3.eth.chain_id}-{signer.address}.json"
        self._path.parent.mkdir(parents=True, exist_ok=True)
        # Only a local dev chain restarts under the same id, and public RPCs prune block 0, so check there alone.
        chain_id = w3.eth.chain_id
        self._genesis = w3.eth.get_block(0)["hash"].hex() if chain_id == ANVIL_CHAIN_ID else str(chain_id)
        self._reconcile()

    def pending(self) -> list[Tx]:
        with self._lock:
            return sorted(self._pending.values(), key=lambda t: t.nonce)

    def send(self, to: str | None, data: str, value: int = 0, gas: int | None = None) -> Tx:
        """Queues a transaction. An identical one still pending is returned, not sent again.

        Estimating first means a call that would revert raises here and costs no nonce.
        """
        if gas is None:
            tx = {"from": self.signer.address, "data": data, "value": value}
            if to:
                tx["to"] = to
            gas = int(self.w3.eth.estimate_gas(tx) * GAS_MARGIN)
        with self._lock:
            for tx in self._pending.values():
                if (tx.to, tx.data, tx.value) == (to, data, value):
                    return tx
            for retry in (True, False):
                tx = self._build(to, data, value, gas)
                self._pending[tx.nonce] = tx
                self._save()
                try:
                    self._broadcast(tx)
                except Web3RPCError as e:
                    del self._pending[tx.nonce]
                    self._save()
                    if not (retry and "nonce too low" in str(e).lower()):
                        raise
                    self._next_nonce = self.w3.eth.get_transaction_count(self.signer.address, "pending")
                    continue
                self._next_nonce = tx.nonce + 1
                return tx

    def poll(self) -> None:
        """Settles mined transactions and replaces the ones stuck for `bump_blocks` blocks."""
        with self._lock:
            if not self._pending:
                return
            head = self.w3.eth.block_number
            used = self.w3.eth.get_transaction_count(self.signer.address, "latest")
            for tx in sorted(self._pending.values(), key=lambda t: t.nonce):
                receipt = self._receipt(tx)
                if receipt:
                    tx.receipt = receipt
                    del self._pending[tx.nonce]
                elif tx.nonce < used:
                    tx.orphan_polls += 1
                    if tx.orphan_polls >= ORPHAN_POLLS:
                        tx.error = NonceTaken(f"nonce {tx.nonce} was used by a transaction this manager did not send")
                        del self._pending[tx.nonce]
                elif head - tx.sent_block >= self.bump_blocks:
                    self._replace(tx, head)
            self._save()

    def wait(self, tx: Tx, timeout: float = 120.0) -> dict:
        end = time.monotonic() + timeout
        while True:
            try:
                self.poll()
            except OSError as e:
                # Public RPCs rate-limit and drop connections; the tx is still queued, so keep waiting.
                log.warning("poll failed: %s", type(e).__name__)
            if tx.error:
                raise tx.error
            if tx.receipt:
                if tx.receipt["status"] == 0:
                    raise TxReverted(tx.receipt)
                return tx.receipt
            if time.monotonic() > end:
                raise TimeoutError(f"nonce {tx.nonce} not mined after {timeout} s; it stays queued")
            time.sleep(self.poll_seconds)

    def transact(self, to: str | None, data: str, value: int = 0, gas: int | None = None, timeout: float = 120.0) -> dict:
        return self.wait(self.send(to, data, value, gas), timeout)

    def _fees(self) -> tuple[int, int]:
        tip = self.w3.eth.max_priority_fee
        return tip, 2 * self.w3.eth.get_block("latest")["baseFeePerGas"] + tip

    def _sign(self, tx: Tx) -> None:
        body = {"chainId": self.w3.eth.chain_id, "nonce": tx.nonce, "data": tx.data, "value": tx.value, "gas": tx.gas,
                "maxFeePerGas": tx.max_fee, "maxPriorityFeePerGas": tx.tip, "type": 2}
        if tx.to:
            body["to"] = tx.to
        raw = self.signer.sign(body)
        tx.raw = raw.hex()
        tx.hashes.append(Web3.keccak(raw).to_0x_hex())

    def _build(self, to, data, value, gas) -> Tx:
        tip, max_fee = self._fees()
        tx = Tx(self._next_nonce, to, data, value, gas, max_fee, tip, "", [], self.w3.eth.block_number)
        self._sign(tx)
        return tx

    def _broadcast(self, tx: Tx) -> None:
        try:
            self.w3.eth.send_raw_transaction(bytes.fromhex(tx.raw.removeprefix("0x")))
        except OSError as e:
            # A dropped connection may still have delivered it, so keep the nonce; poll finds it or replaces it.
            log.warning("broadcast of nonce %d unconfirmed: %s", tx.nonce, type(e).__name__)

    def _replace(self, tx: Tx, head: int) -> None:
        tip, floor = self._fees()
        new_tip = max(tip, tx.tip * (100 + self.bump_pct) // 100 + 1)
        # A base fee spike can outrun +20%, so also meet the current market price.
        new_fee = max(floor, tx.max_fee * (100 + self.bump_pct) // 100 + 1, new_tip)
        if new_fee > self.max_fee_cap:
            log.warning("nonce %d stuck: replacing needs %d wei/gas, above the cap", tx.nonce, new_fee)
            return
        old = (tx.tip, tx.max_fee, tx.raw, list(tx.hashes))
        tx.tip, tx.max_fee = new_tip, new_fee
        self._sign(tx)
        self._save()
        try:
            self._broadcast(tx)
            tx.sent_block = head
        except Web3RPCError as e:
            # Most often the old one was mined meanwhile; the next poll sees it, or tries again.
            log.warning("replacing nonce %d failed: %s", tx.nonce, e)
            tx.tip, tx.max_fee, tx.raw, tx.hashes = old

    def _receipt(self, tx: Tx):
        for h in reversed(tx.hashes):
            try:
                return self.w3.eth.get_transaction_receipt(h)
            except TransactionNotFound:
                pass
        return None

    def _save(self) -> None:
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"genesis": self._genesis, "txs": [t.journal() for t in self._pending.values()]}))
        os.replace(tmp, self._path)

    def _reconcile(self) -> None:
        saved = json.loads(self._path.read_text()) if self._path.exists() else {"genesis": self._genesis, "txs": []}
        # A restarted dev chain has a new genesis; replaying the old journal there would run stale transactions.
        txs = [Tx(**d) for d in saved["txs"]] if saved["genesis"] == self._genesis else []
        used = self.w3.eth.get_transaction_count(self.signer.address, "latest")
        for tx in txs:
            if self._receipt(tx):
                continue
            self._pending[tx.nonce] = tx
            if tx.nonce >= used:
                try:
                    self._broadcast(tx)
                except Web3RPCError as e:
                    log.info("nonce %d not rebroadcast: %s", tx.nonce, e)
        self._save()
        chain = self.w3.eth.get_transaction_count(self.signer.address, "pending")
        self._next_nonce = max([chain] + [n + 1 for n in self._pending])
