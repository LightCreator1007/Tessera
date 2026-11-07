"""Request and response shapes of API v1. Clients depend on these field names, so change them deliberately."""
from typing import Literal

from pydantic import BaseModel

Hex32 = str  # "0x" + 64 hex
Address = str  # "0x" + 40 hex
Trust = Literal["chain", "hash-checked", "untrusted"]


class Health(BaseModel):
    ok: bool
    chainId: int
    block: int | None  # null until the ledger feeds the API
    storeOk: bool
    version: str


class Config(BaseModel):
    chainId: int
    jobMarket: Address
    nodeRegistry: Address
    token: Address
    coordinator: Address
    verifiers: list[Address]
    threshold: int
    competitions: Address | None = None  # None on a network with no Competitions contract
    rlCompetitions: Address | None = None  # None on a network with no RLCompetitions contract


class Workload(BaseModel):
    id: str
    replayClass: Literal["exact", "tolerance"]
    defaults: dict
    tier: Literal["core", "stretch"]


class Selftest(BaseModel):
    workload: str
    startBlobHash: Hex32
    seed: Hex32
    expectedHash: Hex32 | None  # exact class
    tolerance: str | None  # tolerance class, decimal string


class DraftRequest(BaseModel):
    workload: str
    datasetHash: Hex32
    budget: int | None = None  # token units; the spec sets the price, so leave it out. Any other number is refused
    epochs: int
    minQuorum: int = 3
    maxPerRound: int = 6
    overrides: dict = {}


class Draft(BaseModel):
    spec: dict
    modelSpecHash: Hex32
    initialWeightsHash: Hex32
    windows: dict
    budget: int  # token units, what createJobCalldata asks for: 1 TOD pays for 1 Gop
    computeOps: int  # the float ops that budget buys: rounds x minQuorum x ops per node per round
    minStake: int
    createJobCalldata: str


class ProviderCompute(BaseModel):
    owner: Address
    rounds: int  # accepted rounds this owner was credited for
    ops: int  # float ops those rounds ran, each replayed by the verifiers. 10**9 ops is 1 Gop
    trust: Trust = "chain"


class Job(BaseModel):
    id: int
    status: Literal["open", "running", "completed", "abandoned", "invalid"]
    workload: str
    requester: Address
    budget: int
    remaining: int
    rounds: int
    currentRound: int | None
    stakePerNode: int
    modelSpecHash: Hex32
    trust: Trust = "chain"
    published: "Published | None" = None  # null while Arkiv publishing is off or the job has no final model yet
    waiting: "Waiting | None" = None  # set while the job is ready for a round but too few nodes can take a seat


class Waiting(BaseModel):
    """Why a running job isn't opening rounds. blocked counts nodes by the first rule they fail: notJoined, stake,
    offline, busy, selftest, benched or excluded."""
    since: int  # unix time the coordinator first saw the job stuck
    eligible: int  # owners with a node that could take a seat now
    quorum: int  # seats the job needs per round
    blocked: dict[str, int]
    abandonAfter: int  # unix time after which anyone may call abandonJob and get the unopened rounds refunded


class OwnerEvent(BaseModel):
    """One chain event that moved an owner's money or standing, as the history indexer stored it."""
    kind: Literal["joined", "paid", "claimed", "leftover", "forfeited", "slashed", "failure", "noReveal", "staked",
                  "unstaked", "budget", "refund"]
    job: int | None
    round: int | None
    op: Address | None  # the operator involved, for node events
    amount: int | None  # token units: paid, claimed, slashed (taken), penalty, staked, budget, refund
    detail: dict | None  # slashed {toPot, burned}, failure {kind}, noReveal {missed}, staked/unstaked {stake}
    block: int
    logIndex: int
    tx: Hex32
    at: int  # block time


class KindTally(BaseModel):
    count: int
    amount: int  # summed token units; 0 for kinds without an amount


class OwnerRecord(BaseModel):
    """An owner's public record in one read: its nodes, verified work, money and standing, from the history indexer."""
    owner: Address
    operators: list[Address]
    rounds: int  # accepted rounds credited, as /providers/{owner}/compute
    ops: int
    jobs: list[int]  # jobs this owner posted, as requester
    kinds: dict[str, KindTally]  # history event kind -> count and amount
    firstAt: int | None  # time of the first indexed event; null before any
    indexedTo: int | None


class OwnerHistory(BaseModel):
    owner: Address
    operators: list[Address]  # nodes this owner has joined
    events: list[OwnerEvent]  # newest first
    next: str | None  # pass as ?before= for the next page; null on the last page
    indexedTo: int | None  # last block indexed; null before the first pass or with TOD_NETWORK unset


class Published(BaseModel):
    """Where the job's final model is indexed on Arkiv. The keccak is the on-chain aggregateHash, the protocol hash."""
    round: int
    keccak: Hex32
    state: Literal["pending", "indexed", "failed"]
    arkivKey: Hex32 | None
    arkivTx: Hex32 | None
    swarmRef: str | None = None  # 64 hex, no 0x: the model's bytes on Swarm, when Swarm is on


class ModelRecord(BaseModel):
    """One model record read straight from Arkiv, not from the coordinator's own tables."""
    arkivKey: Hex32
    owner: Address
    expiresAt: int
    job: int
    round: int
    keccak: Hex32
    size: int
    chainId: int
    jobMarket: Address
    workload: str | None = None
    datasetHash: Hex32 | None = None
    url: str | None = None
    swarmRef: str | None = None


Job.model_rebuild()  # Published is declared after Job


class RoundState(BaseModel):
    round: int
    metric: str | None  # f64hex of test accuracy or loss
    seconds: int | None


class JobState(BaseModel):
    job: int
    rounds: list[RoundState]
    trust: Trust = "untrusted"


class RoundSummary(BaseModel):
    round: int
    status: Literal["open", "committing", "revealing", "verifying", "finalized", "reverted", "voided", "fallback"]
    startHash: Hex32
    aggregateHash: Hex32 | None


class DisputeIn(BaseModel):
    operator: Address
    segments: list[int]
    deadline: int  # unix s; no upload by then means the verifier reports DataUnavailable


class Dispute(DisputeIn):
    job: int
    round: int
    verifier: Address


class SignatureIn(BaseModel):
    verifier: Address
    signature: str  # 0x + 65-byte EIP-712 FinalizeRound signature


class Collected(BaseModel):
    collected: int
    threshold: int


class Seat(BaseModel):
    op: Address
    shard: int


class Payout(BaseModel):
    op: Address
    amount: int


class SettlementOut(BaseModel):
    jobId: int
    roundId: int
    outcome: int  # contract enum: 0 Accepted, 1 Reverted
    aggregateHash: Hex32
    flaggedBitmap: int
    aggEvidenceHash: Hex32
    payEvidenceHash: Hex32
    payoutsHash: Hex32
    payouts: list[Payout]
    digest: Hex32  # the EIP-712 FinalizeRound digest the verifiers sign
    collected: int  # verifier signatures in so far


class Round(RoundSummary):
    job: int
    roster: list[Seat]
    committed: list[Address]
    revealed: list[Address]
    seed: Hex32 | None
    confirmed: list[dict]  # [{op, kind}] from attestRound
    outcome: Literal["Accepted", "Reverted"] | None
    payouts: list[Payout]
    trust: Trust = "chain"


class EvidenceRef(BaseModel):
    hash: Hex32
    url: str


class Evidence(BaseModel):
    job: int
    round: int
    reports: list[EvidenceRef]  # one per verifier
    aggregate: EvidenceRef | None
    pay: EvidenceRef | None
    trust: Trust = "hash-checked"
