"""Motion carries state: verdicts flash their row once, block digits flap, pause holds the posters, --still stops all."""
import asyncio

from tod_tui import cli, mosaic
from tod_tui.app import FLAP, ToDApp, flap, landed, roster_rows, top_right, verdict_key
from tod_tui.demo import DemoSource
from tod_tui.model import Seat, Verdict
from tod_tui.mosaic import BG, MosaicView, dim, level


def seat(state, *verdicts):
    return Seat("0xabc", 0, state, verdicts=[Verdict(v) for v in verdicts])


def test_verdict_lands_as_pass_or_fail_once():
    before = verdict_key(seat("verifying", "replaying", "pending"))
    assert landed(before, seat("verifying", "match", "pending")) is True
    assert landed(before, seat("verifying", "mismatch", "pending")) is False
    assert landed(before, seat("verifying", "replaying", "pending")) is None
    assert landed(verdict_key(seat("verifying", "match", "match")), seat("slashed", "match", "match")) is False


def test_lit_row_is_washed_and_others_are_not():
    s = DemoSource(28.0).snapshot()
    op = s.round.roster[0].op
    rows = roster_rows(s, {op: False})
    assert all(BG[4] in str(c.style) for c in rows[0][1])
    assert not any(BG[4] in str(c.style) for c in rows[1][1])


def test_block_digits_flap_then_land():
    assert BG[4] in str(flap("18,220,119", "18,220,118", 0).spans)
    assert BG[2] in str(flap("18,220,119", "18,220,118", FLAP - 1).spans)
    assert not flap("18,220,119", "18,220,118", FLAP).spans  # landed: one plain muted run


def test_paused_header_is_a_tile():
    t = top_right(DemoSource(8.6).snapshot(), paused=True)
    assert t.plain.strip() == "PAUSED"


def test_dim_drops_lit_tiles_one_tone_and_leaves_ground():
    f = dim(lambda u, v, r, t: 0.7, 1.0)
    assert level(f(0, 0, 0.5, 0)) == level(0.7) - 1
    assert dim(lambda u, v, r, t: 0.0, 1.0)(0, 0, 0.5, 0) == 0.0
    assert dim(lambda u, v, r, t: 0.7, 0.3)(0, 0, 0.5, 0) == 0.7  # not this tile's turn yet


def test_still_flag_and_env():
    try:
        cli.main(["--demo", "--once", "--still"])
        assert mosaic.STILL
        assert MosaicView().t == mosaic.STILL_T
    finally:
        mosaic.STILL = False


def test_space_holds_every_poster():
    app = ToDApp(DemoSource(28.0), tick=False)

    async def go():
        async with app.run_test(size=(120, 40)) as pilot:
            await pilot.press("space")
            await pilot.pause()
            assert all(v.hold for v in app.query(MosaicView))
            await pilot.press("space")
            await pilot.pause()
            assert not any(v.hold for v in app.query(MosaicView))

    asyncio.run(go())
