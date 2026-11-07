"""Matcher: rebuilds scheduling history from chain events and picks each round's nodes and shards."""
from dataclasses import dataclass, field

from web3 import Web3

from api import tables
from tod_core.ledger import ChainState, JobStatus, RoundStatus

ONLINE_WITHIN = 60  # s since the last heartbeat
BENCH_AFTER = 2  # missed commits in a row before a node sits out until rearmed
ZERO32 = b"\0" * 32


@dataclass
class Sched:
    """What the matcher remembers between rounds. All of it is rebuilt from chain events, except `rearm`."""
    last_assigned: dict[str, int] = field(default_factory=dict)  # op -> index of its latest round overall, 0 = never
    missed: dict[str, int] = field(default_factory=lambda: tables.MISSED)  # op -> missed commits in a row
    shard_last: dict[int, dict[int, int]] = field(default_factory=dict)  # job -> shard -> latest round id using it
    prev_seed: dict[int, bytes] = field(default_factory=dict)  # job -> seed of its latest drawn round


def rebuild(state: ChainState) -> Sched:
    """Recount everything from chain events. The driver calls it every tick, so a re-arm is kept apart in REARMED."""
    s = Sched()
    s.missed.clear()
    by_open_time = sorted(state.rounds.items(), key=lambda kv: (kv[1]["openedAt"], kv[0]))
    for i, ((job, rid), r) in enumerate(by_open_time, 1):
        for op in r["nodes"]:
            s.last_assigned[op] = i
        for shard in r["shards"]:
            s.shard_last.setdefault(job, {})[shard] = rid
        if r["seed"] != ZERO32:
            s.prev_seed[job] = r["seed"]
        if r["status"] == RoundStatus.OPEN:
            continue  # its commits are not final yet
        for op, nr in r["nodeRounds"].items():
            if r["openedAt"] <= tables.REARMED.get(op.lower(), 0):
                continue  # ponytail: compares chain time with our clock; fine while they agree within a round
            s.missed[op.lower()] = 0 if nr["committed"] else s.missed.get(op.lower(), 0) + 1
    return s


def _blocker(n: dict, hb: dict | None, p, sched: Sched, op: str, now: int, workload: str,
             excluded: set[str]) -> str | None:
    """Why this node can't be seated in the job's next round, or None if it can. The first failing rule wins."""
    if not n["joined"]:
        return "notJoined"
    if n["stake"] < p.stakePerNode:
        return "stake"  # includes a node slashed below the job's stake; depositStake brings it back
    if not hb or now - hb["seen"] > ONLINE_WITHIN:
        return "offline"
    if n["busyJob"] != 0 or hb["busy"]:
        return "busy"
    if not hb["selftest"].get(workload, {}).get("ok"):
        return "selftest"
    if sched.missed.get(op.lower(), 0) >= BENCH_AFTER:
        return "benched"
    if n["owner"].lower() in excluded:
        return "excluded"
    return None


def pick(state: ChainState, sched: Sched, job_id: int, fleet: dict, now: int, workload: str, excluded: set[str]):
    """Return (nodes, shards) for the job's next round, or None if fewer than minQuorum nodes qualify.

    fleet:       lowercase operator -> {"seen", "busy", "selftest": {workloadId: {"ok": bool}}}, from heartbeats
    excluded:    lowercase owners caught cheating, from the identity exclusions; any other joined owner is seated
    ponytail: no speed gate until selftest seconds have a reference time to compare against
    """
    p = state.jobs[job_id]["params"]
    prev = sched.prev_seed.get(job_id, ZERO32)
    ok = [op for op, n in state.nodes.items()
          if _blocker(n, fleet.get(op.lower()), p, sched, op, now, workload, excluded) is None]
    # Longest-idle first; the previous seed breaks ties so no operator is always first.
    ok.sort(key=lambda op: (sched.last_assigned.get(op, 0), Web3.keccak(prev + bytes.fromhex(op[2:]))))
    # openRound reverts on two seats for one owner, and on more nodes than shards.
    owners, seats = set(), []
    for op in ok:
        owner = state.nodes[op]["owner"].lower()
        if owner not in owners:
            owners.add(owner)
            seats.append(op)
    roster = sorted(seats[:min(p.maxPerRound, p.shards)], key=lambda op: bytes.fromhex(op[2:]))
    if len(roster) < p.minQuorum:
        return None
    last = sched.shard_last.get(job_id, {})
    shards = sorted(range(p.shards), key=lambda i: (last.get(i, 0), i))[:len(roster)]
    return roster, shards


def diagnose(state: ChainState, sched: Sched, job_id: int, fleet: dict, now: int, workload: str,
             excluded: set[str]) -> dict:
    """Why pick found no roster: how many nodes could take a seat against the quorum, and what held the rest back.

    Seats count one per owner, the way openRound does, so a second node of the same owner shows as "sameOwner".
    """
    p = state.jobs[job_id]["params"]
    blocked: dict[str, int] = {}
    owners = set()
    for op, n in state.nodes.items():
        why = _blocker(n, fleet.get(op.lower()), p, sched, op, now, workload, excluded)
        if why is None and n["owner"].lower() in owners:
            why = "sameOwner"
        if why is None:
            owners.add(n["owner"].lower())
        else:
            blocked[why] = blocked.get(why, 0) + 1
    return {"eligible": len(owners), "quorum": p.minQuorum, "blocked": blocked}


def queue(state: ChainState, sched: Sched, fleet: dict, now: int, workloads: dict[int, str], control: dict,
          excluded: set[str], stalled: dict | None = None):
    """Rosters for every job that can open a round now, as [(job, nodes, shards)], best-paying job first.

    A job's price is its next round budget as the contract computes it; ties go to the older job.
    workloads: job -> workload id; jobs missing here are skipped.
    control: job -> {"auto", "paused"}, set through the admin routes.
    stalled: if given, filled with job -> diagnose() for every job that is ready for a round but can't seat a quorum.
    """
    fleet = dict(fleet)
    ready = []
    for job, j in state.jobs.items():
        p, c = j["params"], control.get(job, {"auto": True, "paused": False})
        last = state.rounds.get((job, j["nextRound"] - 1))
        if (job not in workloads or j["status"] != JobStatus.ACTIVE or j.get("stopping") or j["roundsOpened"] >= p.rounds
                or not c["auto"] or c["paused"]
                or (last and last["status"] == RoundStatus.OPEN)):
            continue
        ready.append((-(j["remaining"] // (p.rounds - j["roundsOpened"])), job))
    out = []
    for _, job in sorted(ready):
        if match := pick(state, sched, job, fleet, now, workloads[job], excluded):
            out.append((job, *match))
            for op in match[0]:
                fleet[op.lower()] = {**fleet[op.lower()], "busy": True}  # a node works one job at a time
        elif stalled is not None:
            stalled[job] = diagnose(state, sched, job, fleet, now, workloads[job], excluded)
    return out
