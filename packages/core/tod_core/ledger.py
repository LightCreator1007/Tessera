"""Python adapter for both contracts: calls generated from the ABIs, one event reader, state rebuilt from events."""
import json
import os
import tomllib
from dataclasses import dataclass, field
from enum import IntEnum
from pathlib import Path
from typing import Iterator, NamedTuple

from requests import HTTPError
from web3 import Web3
from web3.exceptions import ContractCustomError, ContractLogicError, Web3RPCError

from .txmgr import TxManager, TxReverted

REPO = Path(__file__).resolve().parents[3]
ABI_DIR = REPO / "packages" / "abi" / "json"
ZERO32 = b"\0" * 32

# The token's own surface: it is an ERC-20 plus MockUSDC's open mint, and its errors surface through createJob.
TOKEN_ABI = [
    *({"type": "function", "name": n, "stateMutability": m, "inputs": [{"name": "", "type": t} for t in i],
       "outputs": [{"name": "", "type": o} for o in os_]} for n, m, i, os_ in [
        ("approve", "nonpayable", ["address", "uint256"], ["bool"]),
        ("transfer", "nonpayable", ["address", "uint256"], ["bool"]),
        ("mint", "nonpayable", ["address", "uint256"], []),
        ("allowance", "view", ["address", "address"], ["uint256"]),
        ("balanceOf", "view", ["address"], ["uint256"]),
        ("decimals", "view", [], ["uint8"]),
    ]),
    *({"type": "error", "name": n, "inputs": [{"name": "", "type": t} for t in i]} for n, i in [
        ("ERC20InsufficientBalance", ["address", "uint256", "uint256"]),
        ("ERC20InsufficientAllowance", ["address", "uint256", "uint256"]),
    ]),
]


class JobStatus(IntEnum):
    NONE, ACTIVE, COMPLETED, CANCELLED = range(4)


class RoundStatus(IntEnum):
    NONE, OPEN, SETTLED, VOID, REVERTED = range(5)


class Phase(IntEnum):
    NONE, COMMIT, REVEAL, VERIFY, FINALIZE, SETTLED, VOID, REVERTED = range(8)


class Kind(IntEnum):
    NONE, REPLAY_DRIFT, DATA_UNAVAILABLE, REPLAY_MISMATCH = range(4)


class Outcome(IntEnum):
    ACCEPTED, REVERTED = range(2)


class Reverted(Exception):
    """A contract call reverted. `name` is the Solidity error, e.g. "WrongState"."""

    def __init__(self, name: str):
        super().__init__(name)
        self.name = name


@dataclass(frozen=True)
class Network:
    """One networks/<name>.toml. `rpc` can hold an API key, so it stays out of repr and logs."""

    name: str
    chain_id: int
    rpc: str = field(repr=False)
    market: str
    registry: str
    token: str
    deploy_block: int
    log_span: int
    roles: dict
    windows: dict

    @classmethod
    def load(cls, network: str | Path, rpc: str | None = None) -> "Network":
        path = Path(network) if str(network).endswith(".toml") else REPO / "networks" / f"{network}.toml"
        d = tomllib.loads(path.read_text())
        c = d.get("contracts")
        if not c:
            raise RuntimeError(f"{path} has no [contracts]: run scripts/deploy.py first")
        url = rpc or os.environ.get(d.get("rpcEnv", ""), "") or d["rpc"]
        if not url:
            raise RuntimeError(f"RPC URL missing; set {d.get('rpcEnv', 'the network RPC')} or pass an override")
        return cls(d["name"], d["chainId"], url, c["market"], c["registry"], c["token"], c["deployBlock"],
                   d.get("logSpan", 2000), d["roles"], d.get("windows", {}))


class Event(NamedTuple):
    name: str
    args: dict
    block: int
    log_index: int
    tx_hash: str
    timestamp: int | None


def _load_abi(name: str) -> list[dict]:
    abi = json.loads((ABI_DIR / f"{name}.json").read_text())
    for e in abi:
        # web3's decode_tuples keys outputs by name, so two unnamed ones collapse and getJob would lose its params.
        for i, out in enumerate(e.get("outputs", [])):
            out["name"] = out["name"] or f"_{i}"
    return abi


def _selectors(abi: list[dict]) -> dict[str, str]:
    return {Web3.keccak(text=f"{e['name']}({','.join(i['type'] for i in e['inputs'])})")[:4].hex().removeprefix("0x"): e["name"]
            for e in abi if e["type"] == "error"}


class _Bound:
    """`market.commit(job, round, h)`: views return decoded structs; writes go through txmgr and return the receipt."""

    def __init__(self, ledger: "Ledger", contract, abi: list[dict]):
        self._l, self._c = ledger, contract
        self._mut = {e["name"]: e["stateMutability"] for e in abi if e["type"] == "function"}
        self._errors = _selectors(abi)
        self.address = contract.address

    def __getattr__(self, name: str):
        if name not in self._mut:
            raise AttributeError(name)
        return lambda *args: self._invoke(name, args)

    def _invoke(self, name: str, args: tuple):
        data = None
        try:
            if self._mut[name] in ("view", "pure"):
                return self._c.functions[name](*args).call()
            if self._l.sender is None:
                raise RuntimeError(f"{name} is a write: call ledger.using(txmanager) first")
            data = self._c.encode_abi(name, args=list(args))
            return self._l.sender.transact(self._c.address, data)
        except TxReverted as e:
            # Lost a race after a clean estimate: replay against the block before to name the error.
            sender = self._l.sender.signer.address
            call = {"from": sender, "to": self._c.address, "data": data}
            try:
                self._l.w3.eth.call(call, block_identifier=e.receipt["blockNumber"] - 1)
            except ContractLogicError as replay:
                raise self._named(replay) from e
            raise Reverted("unknown") from e
        except ContractLogicError as e:
            raise self._named(e) from e

    def _named(self, e: ContractLogicError) -> Reverted:
        if isinstance(e, ContractCustomError):
            data = str(e.data).removeprefix("0x")
            return Reverted(self._errors.get(data[:8], "0x" + data[:8]))
        return Reverted(e.message or str(e))


class Ledger:
    """The adapter for one network. Reads need no key; `using(txmanager)` gives a copy that sends from that key."""

    def __init__(self, net: Network, sender: TxManager | None = None, w3: Web3 | None = None):
        self.net, self.sender = net, sender
        self.w3 = w3 or Web3(Web3.HTTPProvider(net.rpc, request_kwargs={"timeout": 30}))
        if w3 is None and self.w3.eth.chain_id != net.chain_id:
            raise RuntimeError(f"RPC is on chain {self.w3.eth.chain_id}, {net.name} is {net.chain_id}")
        market_abi, registry_abi = _load_abi("IJobMarket"), _load_abi("INodeRegistry")
        contract = lambda addr, abi: self.w3.eth.contract(address=addr, abi=abi, decode_tuples=True)  # noqa: E731
        self._market = contract(net.market, market_abi)
        self._registry = contract(net.registry, registry_abi)
        self.market = _Bound(self, self._market, market_abi)
        self.registry = _Bound(self, self._registry, registry_abi)
        self.token = _Bound(self, contract(net.token, TOKEN_ABI), TOKEN_ABI)
        self._timestamps: dict[int, int] = {}

    def using(self, sender: TxManager) -> "Ledger":
        return Ledger(self.net, sender, self.w3)

    def head(self) -> tuple[int, int]:
        block = self.w3.eth.get_block("latest")
        return block["number"], block["timestamp"]

    def events(self, from_block: int | None = None, to_block: int | None = None) -> Iterator[Event]:
        """All events of both contracts in chain order. Pages by `logSpan`, halving when an RPC refuses a range."""
        start = self.net.deploy_block if from_block is None else from_block
        end = self.w3.eth.block_number if to_block is None else to_block
        span = self.net.log_span
        while start <= end:
            stop = min(start + span - 1, end)
            try:
                logs = self.w3.eth.get_logs({"address": [self.net.market, self.net.registry],
                                             "fromBlock": start, "toBlock": stop})
            except (Web3RPCError, HTTPError) as e:
                # sepolia.base.org refuses a wide range with HTTP 413, not a JSON-RPC error; other HTTP errors aren't about range.
                wrong_status = isinstance(e, HTTPError) and getattr(e.response, "status_code", None) != 413
                if span == 1 or wrong_status:
                    raise
                span //= 2
                continue
            for entry in logs:
                yield self._decode(entry)
            start = stop + 1

    def rebuild(self) -> "ChainState":
        return ChainState().sync(self)

    def _decode(self, entry) -> Event:
        contract = self._market if entry["address"] == self.net.market else self._registry
        d = contract.get_event_by_topic(entry["topics"][0].to_0x_hex()).process_log(entry)
        timed = d["event"] in ("JobCreated", "RoundOpened", "RoundFinalized", "RoundVoided")
        return Event(d["event"], dict(d["args"]), entry["blockNumber"], entry["logIndex"],
                     entry["transactionHash"].to_0x_hex(), self._timestamp(entry["blockNumber"]) if timed else None)

    def _timestamp(self, block: int) -> int:
        if block not in self._timestamps:
            self._timestamps[block] = self.w3.eth.get_block(block)["timestamp"]
        return self._timestamps[block]


class ChainState:
    """Jobs, rounds and the node pool from events, with the same field names as the Solidity structs.

    `jobs[id]`, `rounds[(job, round)]` (with `nodes`, `shards`, `nodeRounds[op]`), `nodes[op]`. Call `sync` once on
    restart, then again to tail new blocks.
    ponytail: applies blocks at `latest` and never unwinds, so a reorg needs a fresh rebuild.
    """

    def __init__(self):
        self.jobs: dict[int, dict] = {}
        self.rounds: dict[tuple[int, int], dict] = {}
        self.nodes: dict[str, dict] = {}
        self.last_block: int | None = None

    def sync(self, ledger: Ledger) -> "ChainState":
        head = ledger.w3.eth.block_number
        start = ledger.net.deploy_block if self.last_block is None else self.last_block + 1
        for ev in ledger.events(start, head):
            self.apply(ev, ledger)
        self.last_block = head
        return self

    def apply(self, ev: Event, ledger: Ledger) -> None:
        a, name = ev.args, ev.name
        key = (a.get("jobId"), a.get("roundId"))
        match name:
            case "NodeJoined":
                self.nodes[a["operator"]] = {"owner": a["owner"], "stake": 0, "busyJob": 0, "busyRound": 0,
                                             "joined": True, "customCode": False}
            case "StakeDeposited" | "StakeWithdrawn":
                self.nodes[a["operator"]]["stake"] = a["newStake"]
            case "StakeSlashed":
                self.nodes[a["operator"]]["stake"] -= a["amount"]
            case "CustomCodeSet":
                self.nodes[a["operator"]]["customCode"] = a["enabled"]
            case "NodeBusy":
                self.nodes[a["operator"]].update(busyJob=a["jobId"], busyRound=a["roundId"])
            case "NodeFreed":
                self.nodes[a["operator"]].update(busyJob=0, busyRound=0)
            case "JobCreated":
                # Params never change and most are in no event, so one view per job is safe at any later block.
                self.jobs[a["jobId"]] = {"params": ledger.market.getJob(a["jobId"])[0], "requester": a["requester"],
                                         "status": JobStatus.ACTIVE, "remaining": a["budget"], "nextRound": 1,
                                         "roundsOpened": 0, "closedAt": ev.timestamp}
            case "RoundOpened":
                job = self.jobs[a["jobId"]]
                job["remaining"] -= a["budget"]
                job["nextRound"] += 1
                job["roundsOpened"] += 1
                self.rounds[key] = {
                    "status": RoundStatus.OPEN, "fallback_": False, "nodeCount": len(a["nodes"]), "committedCount": 0,
                    "revealedCount": 0, "flaggedBitmap": 0, "confirmedBitmap": 0, "openedAt": ev.timestamp,
                    "commitDeadline": a["commitDeadline"], "revealDeadline": a["revealDeadline"],
                    "verifyDeadline": a["verifyDeadline"],
                    "finalizeBy": a["verifyDeadline"] + job["params"].windows.finalize,
                    "closedAt": 0, "budget": a["budget"], "drip": a["drip"], "seedBlock": 0, "seed": ZERO32,
                    "startWeightsHash": a["startWeightsHash"], "aggregateHash": ZERO32, "aggEvidenceHash": ZERO32,
                    "payEvidenceHash": ZERO32, "nodes": list(a["nodes"]), "shards": list(a["shards"]),
                    "nodeRounds": {op: {"slot": i, "shard": a["shards"][i], "assigned": True, "committed": False,
                                        "revealed": False, "noRevealReported": False, "confirmed": Kind.NONE,
                                        "commitHash": ZERO32, "checkpointRoot": ZERO32, "updateHash": ZERO32}
                                   for i, op in enumerate(a["nodes"])},
                }
            case "Committed":
                self.rounds[key]["committedCount"] += 1
                self.rounds[key]["nodeRounds"][a["operator"]].update(committed=True, commitHash=a["commitHash"])
            case "Revealed":
                hs = a["checkpointHashes"]
                self.rounds[key]["revealedCount"] += 1
                self.rounds[key]["nodeRounds"][a["operator"]].update(
                    revealed=True, updateHash=hs[-1], checkpointRoot=Web3.keccak(b"".join(hs)))
            case "SeedLocked":
                self.rounds[key]["seedBlock"] = a["seedBlock"]
            case "SeedDrawn":
                self.rounds[key]["seed"] = a["seed"]
            case "FailureConfirmed":
                r = self.rounds[key]
                nr = r["nodeRounds"][a["operator"]]
                nr["confirmed"] = Kind(a["kind"])
                r["confirmedBitmap"] |= 1 << nr["slot"]
            case "Slashed":
                self.rounds[key]["budget"] += a["toPot"]
            case "NoRevealReported":
                # A no-reveal slash pays the job, not budget_r, and its Slashed event came first.
                to_pot = a["penalty"] // 2
                self.rounds[key]["budget"] -= to_pot
                self.jobs[a["jobId"]]["remaining"] += to_pot
                self.rounds[key]["nodeRounds"][a["operator"]]["noRevealReported"] = True
            case "RoundFinalized":
                r = self.rounds[key]
                accepted = a["outcome"] == Outcome.ACCEPTED
                r.update(status=RoundStatus.SETTLED if accepted else RoundStatus.REVERTED, fallback_=a["fallback_"],
                         aggregateHash=a["aggregateHash"], flaggedBitmap=a["flaggedBitmap"],
                         aggEvidenceHash=a["aggEvidenceHash"], payEvidenceHash=a["payEvidenceHash"],
                         closedAt=ev.timestamp)
                self.jobs[a["jobId"]]["closedAt"] = ev.timestamp
                if not accepted:
                    self.jobs[a["jobId"]]["remaining"] += r["budget"]
            case "RoundVoided":
                r = self.rounds[key]
                r.update(status=RoundStatus.VOID, aggregateHash=r["startWeightsHash"], closedAt=ev.timestamp)
                self.jobs[a["jobId"]]["closedAt"] = ev.timestamp
                self.jobs[a["jobId"]]["remaining"] += r["budget"]
            case "JobClosed":
                self.jobs[a["jobId"]].update(status=JobStatus(a["status"]), remaining=0)
