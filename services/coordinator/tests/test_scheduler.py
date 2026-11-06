"""Matcher rules, and that a scheduler rebuilt from chain events picks the same roster as before the restart."""
from types import SimpleNamespace as NS

from api import tables
from scheduler import ORB_MIN_BUDGET, diagnose, pick, queue, rebuild
from tod_core.ledger import ChainState, JobStatus, RoundStatus

NOW = 1000
OPS = ["0x" + f"{i:02x}" * 20 for i in range(1, 7)]
P = NS(stakePerNode=15, minQuorum=2, maxPerRound=3, shards=5, budget=100 * 10**6)
CREDS = dict.fromkeys(OPS, "selfie")  # each test node is its own owner


def state(rounds=()):
    s = ChainState()
    s.jobs[1] = {"params": P}
    s.nodes = {op: {"joined": True, "busyJob": 0, "stake": 15, "owner": op} for op in OPS}
    for i, (nodes, shards, committed, seed) in enumerate(rounds, 1):
        s.rounds[(1, i)] = {"openedAt": i, "nodes": nodes, "shards": shards, "seed": seed, "status": RoundStatus.SETTLED,
                            "nodeRounds": {op: {"committed": op in committed} for op in nodes}}
    return s


def fleet(**changes):
    f = {op: {"seen": NOW, "busy": False, "selftest": {"w": {"ok": True}}} for op in OPS}
    for op, patch in changes.items():
        f[op] = {**f[op], **patch}
    return f


def match(s, f=None, creds=CREDS):
    return pick(s, rebuild(s), 1, fleet() if f is None else f, NOW, "w", creds)


def test_idle_nodes_go_first_sorted_by_address_on_the_least_recent_shards():
    s = state([(OPS[0:3], [0, 1, 2], OPS[0:3], b"\1" * 32)])
    roster, shards = match(s)
    assert set(roster) == set(OPS[3:6]) and roster == sorted(roster)  # nodes 4-6 never worked
    assert shards == [3, 4, 0]  # shards 3 and 4 never trained, then 0 (round 1, lowest index)


def test_ineligible_nodes_are_skipped():
    s = state()
    s.nodes[OPS[0]]["stake"] = 14
    s.nodes[OPS[1]]["busyJob"] = 7
    f = fleet(**{OPS[2]: {"seen": NOW - 61}, OPS[3]: {"busy": True}, OPS[4]: {"selftest": {}}})
    assert match(s, f) is None  # only OPS[5] is left, and the quorum is 2


def test_two_missed_commits_bench_a_node_until_rearm(monkeypatch):
    s = state([(OPS[0:3], [0, 1, 2], OPS[1:3], b"\0" * 32), (OPS[0:3], [3, 4, 0], OPS[1:3], b"\0" * 32)])
    sc = rebuild(s)
    assert tables.MISSED[OPS[0]] == 2
    assert OPS[0] not in pick(s, sc, 1, fleet(), NOW, "w", CREDS)[0]
    monkeypatch.setitem(tables.REARMED, OPS[0], 2)  # POST /v1/admin/nodes/{op}/rearm after both rounds opened
    sc = rebuild(s)  # the driver rebuilds every tick, and the re-arm must survive that
    two = {op: v for op, v in fleet().items() if op in OPS[:2]}  # two nodes online, quorum 2: OPS[0] must be seated
    assert OPS[0] in pick(s, sc, 1, two, NOW, "w", CREDS)[0]


def test_rebuild_after_a_restart_picks_the_same_roster():
    s = state([(OPS[0:3], [0, 1, 2], OPS[0:3], b"\2" * 32)])
    assert match(s) == match(s)


def test_queue_serves_the_best_price_first_and_a_node_works_one_job():
    s = state()
    s.jobs = {j: {"params": NS(**{**vars(P), "rounds": 4}), "status": JobStatus.ACTIVE, "remaining": r,
                  "roundsOpened": 0, "nextRound": 1} for j, r in {1: 400, 2: 800, 3: 800, 4: 900, 5: 900}.items()}
    s.rounds[(4, 1)] = {"openedAt": 1, "nodes": [], "shards": [], "seed": b"\0" * 32, "nodeRounds": {},
                        "status": RoundStatus.OPEN}  # job 4 has a round in flight
    s.jobs[4]["nextRound"] = 2
    s.jobs[5]["roundsOpened"] = 4  # job 5 has used all its rounds
    out = queue(s, rebuild(s), fleet(), NOW, dict.fromkeys(s.jobs, "w"), {3: {"auto": True, "paused": True}}, CREDS)
    assert [j for j, *_ in out] == [2, 1]  # 3 paused, 4 in flight, 5 done; six nodes fill two rosters of three
    assert not set(out[0][1]) & set(out[1][1])


def test_equal_price_goes_to_the_older_job():
    s = state()
    s.jobs = {j: {"params": NS(**{**vars(P), "rounds": 4}), "status": JobStatus.ACTIVE, "remaining": 800,
                  "roundsOpened": 0, "nextRound": 1} for j in (7, 3)}
    out = queue(s, rebuild(s), fleet(), NOW, dict.fromkeys(s.jobs, "w"), {}, CREDS)
    assert [j for j, *_ in out] == [3, 7]


def test_big_jobs_need_an_orb_credential():
    s = state()
    s.jobs[1] = {"params": NS(**{**vars(P), "budget": ORB_MIN_BUDGET})}
    assert match(s) is None  # selfie only
    assert match(s, creds={**CREDS, OPS[0]: "orb", OPS[1]: "orb"})[0] == OPS[:2]
    s.jobs[1] = {"params": P}
    assert match(s, creds={}) is None  # no recorded World ID is never matched


def test_one_seat_per_owner_so_open_round_cannot_revert():
    s = state()
    s.nodes[OPS[1]]["owner"] = OPS[0]  # two operators, one owner
    three = {op: v for op, v in fleet().items() if op in OPS[:3]}
    roster, _ = match(s, three)
    assert len(roster) == 2 and OPS[2] in roster and len({s.nodes[op]["owner"] for op in roster}) == 2
    assert match(s, {op: v for op, v in three.items() if op in OPS[:2]}) is None  # one owner cannot meet quorum 2


def test_roster_never_exceeds_the_shard_count():
    s = state()
    s.jobs[1] = {"params": NS(**{**vars(P), "shards": 2})}  # maxPerRound 3 > 2 shards
    roster, shards = match(s)
    assert len(roster) == len(shards) == 2


def test_diagnose_counts_each_node_by_the_first_rule_it_fails():
    s = state()
    s.nodes[OPS[0]]["stake"] = 14
    s.nodes[OPS[1]]["busyJob"] = 7
    s.nodes[OPS[5]]["joined"] = False
    f = fleet(**{OPS[2]: {"seen": NOW - 61}, OPS[3]: {"busy": True}, OPS[4]: {"selftest": {}}})
    d = diagnose(s, rebuild(s), 1, f, NOW, "w", CREDS)
    assert d == {"eligible": 0, "quorum": 2,
                 "blocked": {"stake": 1, "busy": 2, "offline": 1, "selftest": 1, "notJoined": 1}}


def test_diagnose_counts_one_seat_per_owner():
    s = state()
    for op in OPS[1:]:
        s.nodes[op]["owner"] = OPS[0]  # one person runs all six
    d = diagnose(s, rebuild(s), 1, fleet(), NOW, "w", CREDS)
    assert d == {"eligible": 1, "quorum": 2, "blocked": {"sameOwner": 5}}


def test_queue_reports_the_jobs_it_could_not_seat():
    s = state()
    s.jobs[1].update(status=JobStatus.ACTIVE, roundsOpened=0, nextRound=1, remaining=100)
    s.jobs[1]["params"] = NS(**vars(P), rounds=4)
    stalled = {}
    assert queue(s, rebuild(s), fleet(**{op: {"busy": True} for op in OPS[1:]}), NOW, {1: "w"}, {}, CREDS, stalled) == []
    assert stalled == {1: {"eligible": 1, "quorum": 2, "blocked": {"busy": 5}}}
