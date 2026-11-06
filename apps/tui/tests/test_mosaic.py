"""The terminal word mosaic: frames fill their box exactly, type lights where the letters are, holes are void."""
from tod_tui.mosaic import VOID, figure, poster, render, type_field


def test_frame_fills_the_box():
    lines = render(lambda u, v, r, t: 0.7, 60, 5, t=9).plain.split("\n")
    assert len(lines) == 5 and all(len(line) == 60 for line in lines)


def test_type_lights_the_letter_and_not_the_margin():
    on = type_field("I", 40, 10)
    assert on(0.5, 0.5)
    assert not on(0.02, 0.5)


def test_slashed_poster_cracks_to_void():
    f = poster("SLASHED", "slashed", 80, 9)
    frame = render(f, 80, 9, t=9, per_char=True)
    assert any(VOID in str(span.style) for span in frame.spans)


def test_figures_ship_with_the_package():
    w, h, px = figure("crow")
    assert len(px) == w * h
