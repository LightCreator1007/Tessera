"""Matcher rules, and that a scheduler rebuilt from chain events picks the same roster as before the restart."""
from types import SimpleNamespace as NS

from api import tables
from scheduler import diagnose, pick, queue, rebuild
from tod_core.ledger import ChainState, JobStatus, RoundStatus

NOW = 1000
OPS = ["0x" + f"{i:02x}" * 20 for i in range(1, 7)]
P = NS(stakePerNode=15, minQuorum=2, maxPerRound=3, shards=5, budget=100 * 10**6)
NONE: set[str] = set()  # no excluded owners


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


def match(s, f=None, excluded=NONE):
    return pick(s, rebuild(s), 1, fleet() if f is None else f, NOW, "w", excluded)


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
    assert OPS[0] not in pick(s, sc, 1, fleet(), NOW, "w", NONE)[0]
    monkeypatch.setitem(tables.REARMED, OPS[0], 2)  # POST /v1/admin/nodes/{op}/rearm after both rounds opened
    sc = rebuild(s)  # the driver rebuilds every tick, and the re-arm must survive that
    two = {op: v for op, v in fleet().items() if op in OPS[:2]}  # two nodes online, quorum 2: OPS[0] must be seated
    assert OPS[0] in pick(s, sc, 1, two, NOW, "w", NONE)[0]


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
    out = queue(s, rebuild(s), fleet(), NOW, dict.fromkeys(s.jobs, "w"), {3: {"auto": True, "paused": True}}, NONE)
    assert [j for j, *_ in out] == [2, 1]  # 3 paused, 4 in flight, 5 done; six nodes fill two rosters of three
    assert not set(out[0][1]) & set(out[1][1])


def test_a_cancelling_job_gets_no_new_round():
    s = state()
    s.jobs = {j: {"params": NS(**{**vars(P), "rounds": 4}), "status": JobStatus.ACTIVE, "remaining": 800,
                  "roundsOpened": 1, "nextRound": 2} for j in (1, 2)}
    s.jobs[2]["stopping"] = True  # openRound would revert with WrongState
    out = queue(s, rebuild(s), fleet(), NOW, dict.fromkeys(s.jobs, "w"), {}, NONE)
    assert [j for j, *_ in out] == [1]


def test_equal_price_goes_to_the_older_job():
    s = state()
    s.jobs = {j: {"params": NS(**{**vars(P), "rounds": 4}), "status": JobStatus.ACTIVE, "remaining": 800,
                  "roundsOpened": 0, "nextRound": 1} for j in (7, 3)}
    out = queue(s, rebuild(s), fleet(), NOW, dict.fromkeys(s.jobs, "w"), {}, NONE)
    assert [j for j, *_ in out] == [3, 7]


def test_any_joined_owner_is_seated_except_an_excluded_one():
    s = state()
    roster, _ = match(s)
    assert OPS[0] in roster  # no World ID on record for anyone, still seated
    assert OPS[0] not in match(s, excluded={OPS[0].lower()})[0]


def test_one_owners_nodes_each_take_a_seat():
    s = state()
    s.nodes[OPS[1]]["owner"] = OPS[0]  # two operators, one owner
    three = {op: v for op, v in fleet().items() if op in OPS[:3]}
    roster, _ = match(s, three)
    assert roster == OPS[:3]  # both of one owner's nodes take a seat
    assert match(s, {op: v for op, v in three.items() if op in OPS[:2]})[0] == OPS[:2]  # one owner meets quorum 2


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
    d = diagnose(s, rebuild(s), 1, f, NOW, "w", NONE)
    assert d == {"eligible": 0, "quorum": 2,
                 "blocked": {"stake": 1, "busy": 2, "offline": 1, "selftest": 1, "notJoined": 1}}


def test_diagnose_counts_every_node_of_one_owner():
    s = state()
    for op in OPS[1:]:
        s.nodes[op]["owner"] = OPS[0]  # one person runs all six
    d = diagnose(s, rebuild(s), 1, fleet(), NOW, "w", NONE)
    assert d == {"eligible": 6, "quorum": 2, "blocked": {}}


def test_queue_reports_the_jobs_it_could_not_seat():
    s = state()
    s.jobs[1].update(status=JobStatus.ACTIVE, roundsOpened=0, nextRound=1, remaining=100)
    s.jobs[1]["params"] = NS(**vars(P), rounds=4)
    stalled = {}
    assert queue(s, rebuild(s), fleet(**{op: {"busy": True} for op in OPS[1:]}), NOW, {1: "w"}, {}, NONE, stalled) == []
    assert stalled == {1: {"eligible": 1, "quorum": 2, "blocked": {"busy": 5}}}
