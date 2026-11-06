"""The ToD word mosaic in the terminal: rows of short protocol words, each tile coloured by a tone field.

Same rules as the web (apps/web/components/mosaic): seven tone levels on a warm-black ground, bone for the live
thing, void for a hole, tiles that dissolve in on random delays and a share of words that twinkle. Figures are the
web's ink maps (figures.json, exported by scripts/export_figures.py); type is a 5x7 bitmap font. Type posters colour
each character rather than each word, so letters stay crisp at terminal resolution.
"""
from __future__ import annotations

import base64
import json
import random
from dataclasses import dataclass
from functools import lru_cache
from importlib.resources import files
from typing import Callable

from rich.text import Text

GROUND = "#0b0908"
VOID = "#000000"
TEX = "#2b1411"
BG = ["", "#33100c", "#5c130e", "#8f150f", "#c4170f", "#e8361c", "#d6b48c", "#f2e9da"]
FG = ["", "#6b2318", "#b9442f", "#2a0705", "#2a0705", "#2a0705", "#2a0705", "#2a0705"]
THRESH = [0.1, 0.22, 0.36, 0.5, 0.64, 0.8, 0.97]
WORDS = ["TX", "ZK", "GAS", "ETH", "L2", "SGD", "LR", "GPU", "API", "CLI", "CI", "PR", "LOG", "ABI", "RPC", "SEED",
         "HASH", "NODE", "BOND", "ROOT", "MINT", "LOSS", "GRAD", "STEP", "BIAS", "RELU", "ADAM", "LORA", "JSON",
         "EVAL", "SALT", "SIGN", "ATTN", "FIX", "GIT", "TS", "PY", "0X", "200", "SSH", "ENV", "CUDA", "TOD"]

# Still mode (--still, TOD_MOTION=reduced): every poster draws its end frame once and nothing moves after.
STILL = False
STILL_T = 6.0  # a clock past every dissolve, with the offline poster at its darkest and no glint left
DIM = 0.15  # about one tone level: what a paused poster drops by

# A field maps a position (u, v in 0..1 across the poster), the tile's random key r and time t to a tone.
Field = Callable[[float, float, float, float], float]


def level(v: float) -> int:
    if v < 0:
        return -1
    lv = 0
    for k, th in enumerate(THRESH):
        if v >= th:
            lv = k + 1
    return lv


@dataclass
class Tile:
    x: int
    width: int
    word: str
    r: float
    blank: bool
    idx: int


def layout(w: int, h: int, seed: int, empty: float = 0.22) -> list[list[Tile]]:
    rnd = random.Random(seed)
    rows: list[list[Tile]] = []
    for _ in range(h):
        row, x, run = [], 0, 0
        while x < w:
            idx = rnd.randrange(len(WORDS))
            word = WORDS[idx]
            width = min(len(word), w - x)
            if run == 0 and rnd.random() < empty / 3:
                run = rnd.randint(1, 3)
            row.append(Tile(x, width, word[:width], rnd.random(), run > 0, idx))
            run = max(0, run - 1)
            x += width + 1
        rows.append(row)
    return rows


def render(field: Field, w: int, h: int, t: float, seed: int = 7, per_char: bool = False, twinkle: float = 0.1,
           empty: float = 0.22) -> Text:
    """One frame. Tiles not yet dissolved in show as ground; per_char colours each character on its own."""
    out = Text(no_wrap=True, overflow="crop")
    for y, row in enumerate(layout(w, h, seed, empty)):
        x = 0
        for tile in row:
            for gx in range(x, tile.x):
                # In type posters the gap between words takes the letter's colour too, so strokes stay unbroken.
                gv = level(field((gx + 0.5) / w, (y + 0.5) / h, tile.r, t)) if per_char and tile.r < t / 1.2 else 0
                out.append(" ", style=f"on {VOID if gv < 0 else BG[gv] if gv > 0 else GROUND}")
            word = tile.word
            if twinkle and tile.r < twinkle and t > 0:
                word = WORDS[(tile.idx + int(t * 0.7 + tile.r * 9)) % len(WORDS)][: tile.width].ljust(tile.width)
            shown = tile.r < t / 1.2
            for i, ch in enumerate(word):
                cx = (tile.x + (i + 0.5 if per_char else tile.width / 2)) / w
                v = field(cx, (y + 0.5) / h, tile.r, t) if shown else 0.0
                lv = level(v)
                if lv < 0:
                    out.append(" ", style=f"on {VOID}")
                elif lv == 0:
                    out.append(" " if tile.blank else ch, style=f"{TEX} on {GROUND}")
                else:
                    out.append(ch, style=f"bold {FG[lv]} on {BG[lv]}")
            x = tile.x + tile.width
        if x < w:
            out.append(" " * (w - x), style=f"on {GROUND}")
        if y < h - 1:
            out.append("\n")
    return out


@lru_cache(maxsize=None)
def figure(name: str) -> tuple[int, int, bytes]:
    data = json.loads(files("tod_tui").joinpath("figures.json").read_text())[name]
    return data["w"], data["h"], base64.b64decode(data["data"])


def figure_field(name: str, w: int, h: int, scale: float = 1.0, ax: float = 0.5, ay: float = 0.5,
                 contrast: float = 1.5, lift: float = -0.1) -> Callable[[float, float], float]:
    """The figure cover-fitted into a w x h cell poster. A terminal cell is about twice as tall as it is wide."""
    fw, fh, px = figure(name)
    pw, ph = w, h * 2
    s = max(pw / fw, ph / fh) * scale
    x0, y0 = (pw - fw * s) * ax, (ph - fh * s) * ay

    def at(u: float, v: float) -> float:
        ix, iy = int((u * pw - x0) / s), int((v * ph - y0) / s)
        if ix < 0 or iy < 0 or ix >= fw or iy >= fh:
            return 0.0
        g = px[iy * fw + ix] / 255
        return max(0.0, min(1.0, (g - 0.5) * contrast + 0.5 + lift))

    return at


# 5x7 bitmap font: only the glyphs the posters use. Each string is seven rows of five columns.
FONT = {
    "A": "01110 10001 10001 11111 10001 10001 10001", "D": "11110 10001 10001 10001 10001 10001 11110",
    "E": "11111 10000 10000 11110 10000 10000 11111", "F": "11111 10000 10000 11110 10000 10000 10000",
    "H": "10001 10001 10001 11111 10001 10001 10001", "I": "11111 00100 00100 00100 00100 00100 11111",
    "L": "10000 10000 10000 10000 10000 10000 11111", "M": "10001 11011 10101 10101 10001 10001 10001",
    "N": "10001 11001 10101 10011 10001 10001 10001", "O": "01110 10001 10001 10001 10001 10001 01110",
    "P": "11110 10001 10001 11110 10000 10000 10000", "S": "01111 10000 10000 01110 00001 00001 11110",
    "T": "11111 00100 00100 00100 00100 00100 00100", "W": "10001 10001 10001 10101 10101 10101 01010",
    "Y": "10001 10001 01010 00100 00100 00100 00100", "R": "11110 10001 10001 11110 10100 10010 10001",
    "C": "01110 10001 10000 10000 10000 10001 01110", "U": "10001 10001 10001 10001 10001 10001 01110",
    "0": "01110 10011 10101 10101 11001 10001 01110", "1": "00100 01100 00100 00100 00100 00100 01110",
    "2": "01110 10001 00001 00110 01000 10000 11111", "3": "11110 00001 00001 01110 00001 00001 11110",
    "4": "00010 00110 01010 10010 11111 00010 00010", "5": "11111 10000 11110 00001 00001 10001 01110",
    "6": "00110 01000 10000 11110 10001 10001 01110", "7": "11111 00001 00010 00100 01000 01000 01000",
    "8": "01110 10001 10001 01110 10001 10001 01110", "9": "01110 10001 10001 01111 00001 00010 01100",
    "+": "00000 00100 00100 11111 00100 00100 00000", "-": "00000 00000 00000 11111 00000 00000 00000",
    ".": "00000 00000 00000 00000 00000 01100 01100", "%": "11001 11010 00010 00100 01000 01011 10011",
    " ": "00000 00000 00000 00000 00000 00000 00000",
}


def type_field(text: str, w: int, h: int, fill: float = 0.86) -> Callable[[float, float], bool]:
    """Whether (u, v) falls on a lit pixel of `text` set in the 5x7 font, contain-fitted and centred."""
    glyphs = [FONT.get(c, FONT[" "]).split() for c in text.upper()]
    gw, gh = len(glyphs) * 6 - 1, 7
    pw, ph = w, h * 2
    s = min(pw * fill / gw, ph * fill / gh)
    x0, y0 = (pw - gw * s) / 2, (ph - gh * s) / 2

    def on(u: float, v: float) -> bool:
        gx, gy = (u * pw - x0) / s, (v * ph - y0) / s
        if gx < 0 or gy < 0 or gx >= gw or gy >= gh:
            return False
        k, col = divmod(int(gx), 6)
        return col < 5 and glyphs[k][int(gy)][col] == "1"

    return on


def poster(word: str, kind: str, w: int, h: int) -> Field:
    """A state word as a poster field: paid glints, slashed cracks, idle and empty are faint, offline goes dark."""
    on = type_field(word, w, h)

    def f(u: float, v: float, r: float, t: float) -> float:
        lit = on(u, v)
        dark = kind == "offline" and r < min(0.85, (t % 10) / 7)
        if not lit:
            return -1.0 if dark else 0.0
        if kind in ("idle", "empty"):
            return 0.32
        if kind == "offline":
            return -1.0 if dark else 0.42
        if kind == "paid":
            return 1.05 if r > t / 1.2 - 0.12 else 0.88
        crack = 0.5 + (v - 0.5) * 0.35 + 0.02 * ((int(v * h * 2) % 3) - 1)
        if abs(u - crack) < 0.012:
            return -1.0
        return 0.38 if u > crack else 0.62

    return f


def develop(name: str, w: int, h: int, progress: float, scale: float = 1.0, ax: float = 0.5) -> Field:
    """The figure developing like a print: tones above the threshold show, the developing edge in bone."""
    at = figure_field(name, w, h, scale=scale, ax=ax)
    th = 1 - max(0.12, progress)

    def f(u: float, v: float, r: float, t: float) -> float:
        g = at(u, v)
        if g < 0.1 or g < th - 0.06:
            return 0.0
        return 1.05 if progress < 1 and g < th + 0.05 else g

    return f


from textual.widgets import Static  # noqa: E402  (kept beside the renderer it draws)


class MosaicView(Static):
    """A widget that redraws a field at its own size about six times a second while it is shown.

    Paused, it holds its breath: the clock stops, so twinkle stops, and every lit tile drops one tone, tiles dimming
    (and on resume relighting) in random order over half a second.
    """

    def __init__(self, make: Callable[[int, int], Field] | None = None, per_char: bool = False, seed: int = 7,
                 twinkle: float = 0.1, **kw) -> None:
        super().__init__(**kw)
        self.make, self.per_char, self.seed, self.twinkle = make, per_char, seed, twinkle
        self.t = STILL_T if STILL else 0.0
        self.hold, self.dimmed = False, 0.0

    def on_mount(self) -> None:
        if not STILL:
            self.set_interval(1 / 6, self.step)

    def show(self, make: Callable[[int, int], Field] | None, seed: int | None = None, reset: bool = True) -> None:
        """Swap the field; with reset the new field dissolves in from scratch, without it the clock carries on."""
        if make is not self.make:
            self.make = make
            if reset and not STILL:
                self.t = 0.0
            if seed is not None:
                self.seed = seed
        self.display = make is not None
        self.paint()

    def pause(self, on: bool) -> None:
        if on == self.hold:
            return
        self.hold = on
        if STILL:
            self.dimmed = 1.0 if on else 0.0
            self.paint()

    def step(self) -> None:
        if not self.display or self.make is None:
            return
        moving = self.dimmed != (1.0 if self.hold else 0.0)
        self.dimmed = min(1.0, self.dimmed + 0.34) if self.hold else max(0.0, self.dimmed - 0.34)
        if not self.hold:
            self.t += 1 / 6
        if moving or not self.hold:
            self.paint()

    def paint(self) -> None:
        w, h = self.size.width, self.size.height
        if not self.make or w < 4 or h < 2:
            return
        field = self.make(w, h)
        if self.dimmed:
            field = dim(field, self.dimmed)
        self.update(render(field, w, h, self.t, self.seed, self.per_char, 0.0 if STILL else self.twinkle))


def dim(field: Field, share: float) -> Field:
    """Drop lit tiles one tone; only tiles whose key is under share, so dimming spreads in random order."""

    def f(u: float, v: float, r: float, t: float) -> float:
        x = field(u, v, r, t)
        return max(THRESH[0], x - DIM) if x >= THRESH[0] and r < share else x

    return f
