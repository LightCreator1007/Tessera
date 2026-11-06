"""Launch splash: the crow develops in word tiles while the node, coordinator and chain checks resolve.

It leaves on its own once every source has answered (or failed), and any key skips it. A failed source turns its line
red and the app lands on the Node tab, where the Next step line already says what to do.
"""
from __future__ import annotations

from rich.text import Text
from textual.app import ComposeResult
from textual.screen import Screen
from textual.widgets import Static

from .mosaic import MosaicView, develop

CHECKS = ("node", "coordinator", "chain")
WORD = {"ok": "ok", "connecting": "…", "stale": "stale", "down": "fail"}


class Splash(Screen):
    DEFAULT_CSS = """
    Splash { layers: art copy; background: #0b0908; }
    #splash-art { layer: art; width: 1fr; height: 1fr; }
    #splash-copy { layer: copy; width: auto; height: auto; background: #0b0908; padding: 1 3 1 2; }
    #splash-skip { layer: copy; dock: bottom; width: auto; height: 1; background: #0b0908; color: #958e87; padding: 0 2; }
    """

    def __init__(self) -> None:
        super().__init__()
        self.shown = 0
        self.leaving = False

    def compose(self) -> ComposeResult:
        yield MosaicView(None, id="splash-art", seed=11, twinkle=0.12)
        yield Static(id="splash-copy")
        yield Static("any key · skip", id="splash-skip")

    def on_mount(self) -> None:
        self.set_interval(0.42, self.step)
        self.step()

    def states(self) -> list[tuple[str, str, str]]:
        snap = self.app.snap
        return [(k, snap.src(k).state, snap.src(k).detail) for k in CHECKS]

    def step(self) -> None:
        self.shown = min(len(CHECKS), self.shown + 1)
        rows = self.states()
        resolved = sum(1 for _, st, _ in rows[: self.shown] if st != "connecting")
        progress = resolved / len(CHECKS)
        self.query_one("#splash-art", MosaicView).show(_maker(progress), reset=False)
        copy = Text("ToD\n\n", style="bold #958e87")
        for k, st, detail in rows[: self.shown]:
            style = "#ff6b5b" if st in ("down", "stale") else "#f2f0ed" if st == "ok" else "#5c5550"
            copy.append(f"{k.upper():<13}{WORD.get(st, st):<7}{detail}\n", style=style)
        self.query_one("#splash-copy", Static).update(copy)
        if self.shown == len(CHECKS) and resolved == len(CHECKS) and not self.leaving:
            self.leaving = True
            self.set_timer(1.4, self.leave)

    def leave(self) -> None:
        if self.is_current:
            self.dismiss()

    def on_key(self) -> None:
        self.leave()


_makers: dict[float, object] = {}


def _maker(progress: float):
    """One maker per progress step, so the view keeps its clock until the picture actually changes."""
    if progress not in _makers:
        _makers[progress] = lambda w, h: develop("crow", w, h, progress, scale=1.05, ax=0.35)
    return _makers[progress]
