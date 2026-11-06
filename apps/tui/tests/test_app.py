"""The screen says the right thing in every state. View text comes from pure functions, plus one real mount."""
import asyncio
import json

from textual.widgets import DataTable

from tod_tui import plain
from tod_tui.app import (ToDApp, activity, facts, next_step, node_status, pool_rows, pool_summary, problem,
                             round_top, roster_rows, seat_detail, settlement_text)
from tod_tui.demo import DemoSource


def snap(clock=8.6, *states):
    src = DemoSource(clock)
    for s in states:
        src.toggle(s)
    return src.snapshot()


def plain_rows(rows):
    return [" | ".join(str(c) for c in cells) for _, cells in rows]


def test_node_training_reads_as_a_sentence():
    s = snap()
    assert "Training" in str(node_status(s)) and "step 3 of 4" in str(node_status(s))
    assert "result due in" in str(node_status(s))
    assert "✓ All good" in str(facts(s))
    assert problem(s) is None
    msg, cmd = next_step(s)
    assert msg.startswith("Nothing to do") and cmd is None


def test_activity_is_newest_first_and_marks_fresh_lines():
    s = snap(13.0)
    text = str(activity(s, {(s.events[-1].clock, s.events[-1].what)}))
    lines = text.splitlines()
    assert s.events[-1].what in lines[1] and lines[1].startswith("●")
    assert not lines[2].startswith("●")


def test_round_slash_is_explained():
    s = snap(28.0)
    rows = plain_rows(roster_rows(s))
    cheat = next(r for r in rows if r.startswith("0x9C1d"))
    assert "Slashed" in cheat and "✗ mismatch" in cheat and "-15.00" in cheat
    detail = str(seat_detail(s.round.roster[2]))
    assert "got a different result" in detail and "Verifiers got" in detail
    assert "Round settled" in str(settlement_text(s.round))


def test_stale_node_says_what_to_do():
    msg, cmd = next_step(snap(13.0, "stale"))
    assert "Can't reach your node" in msg and cmd == "tod-node status"


def test_no_node_tells_you_the_command():
    msg, cmd = next_step(snap(8.6, "offline"))
    assert "Start your node" in msg and cmd == "tod-node run"
    assert "Round and Pool tabs still work" in str(facts(snap(8.6, "offline")))


def test_coordinator_down():
    assert "coordinator" in problem(snap(8.6, "coordinator_down"))[0]


def test_one_verifier_silent():
    s = snap(25.0, "verifier_down")
    assert any("no report" in r for r in plain_rows(roster_rows(s)))
    assert "only 1 of 2 verifiers" in str(settlement_text(s.round))
    assert next_step(s)[1] is None  # nothing for the operator to run


def test_fresh_node_is_waiting():
    s = snap(8.6, "fresh")
    assert "Waiting for a round" in str(node_status(s))
    assert "picked for the next round" in next_step(s)[0]


def test_wrong_chain():
    msg, cmd = next_step(snap(8.6, "chain_mismatch"))
    assert "wrong network" in msg and cmd == "tod-node run --network base-sepolia"


def test_pool_lists_you_first_and_counts():
    s = snap(8.6, "big_pool")
    rows = plain_rows(pool_rows(s))
    assert len(rows) == 120 and "you" in rows[0]
    assert "online" in str(pool_summary(s))


def test_no_round():
    s = snap()
    s.round = None
    assert "No round is open" in str(round_top(s))


def test_app_mounts_and_tables_fill():
    app = ToDApp(DemoSource(28.0), tick=False)

    async def go():
        async with app.run_test(size=(120, 40)) as pilot:
            await pilot.press("2")
            await pilot.pause()
            assert app.query_one("#roster", DataTable).row_count == 6
            await pilot.press("down", "down")
            await pilot.pause()
            assert app.selected_seat().op.startswith("0x9C1d")
            await pilot.press("3")
            await pilot.pause()
            assert app.query_one("#pool-table", DataTable).row_count == 24
            await pilot.press("question_mark")
            await pilot.pause()
            assert app.screen.__class__.__name__ == "Help"
            await pilot.press("x")
            await pilot.pause()
            assert app.screen.__class__.__name__ != "Help"

    asyncio.run(go())


def test_plain_summary_is_json():
    s = DemoSource(28.0).snapshot()
    d = json.loads(json.dumps(plain.summary(s)))
    assert d["round"]["roster"][2]["state"] == "slashed"
    assert "slashed" in plain.text(s)


def test_banner_shows_off_the_node_tab_only():
    from textual.widgets import Static
    src = DemoSource(13.0)
    src.toggle("stale")
    app = ToDApp(src, tick=False)

    async def go():
        async with app.run_test(size=(120, 40)) as pilot:
            await pilot.pause()
            banner = app.query_one("#banner", Static)
            assert not banner.display  # Next step on the Node tab already says it
            await pilot.press("2")
            await pilot.pause()
            assert banner.display and "Press 1" in str(banner.render())

    asyncio.run(go())
