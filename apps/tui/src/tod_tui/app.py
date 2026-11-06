"""tod-tui: three tabs, each answering one question, plus a "Next step" that always says what to do.

Node: is my node OK, and do I need to do anything. Round: who passed and who got caught. Pool: who else is out
there. Green marks only "current" and "run this"; red marks only slashes and errors. Motion marks change and
stops: a tab fades in, new activity arrives highlighted, a state change flashes once, earnings count up.
View text comes from pure functions of the Snapshot (model.py), so tests read exactly what the screen shows.
"""
from __future__ import annotations

import time

from rich.text import Text
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.color import Color
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.reactive import reactive
from textual.screen import ModalScreen
from textual.theme import Theme
from textual.widget import Widget
from textual.widgets import DataTable, Footer, Static, TabbedContent, TabPane

from . import mosaic
from .mosaic import BG, MosaicView, poster
from .splash import Splash
from .model import PHASES, RoundInfo, Seat, Snapshot

FG, MUTED, FAINT, ACCENT, BAD, WARN = "#f2f0ed", "#958e87", "#5c5550", "#d6b48c", "#ff6b5b", "#e8c547"
SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
FRESH_FOR = 3.0  # seconds a new activity line stays highlighted
INK = "#2a0705"  # dark ink on a lit tile, as in the posters
FLASH_FOR = 0.6  # seconds a roster row stays lit after a verdict lands
FLAP = 4  # spinner frames (0.1 s each) a changed block digit takes to land

NODE_STATUS = {
    "idle": "Waiting for a round", "assigned": "Getting ready", "fetching": "Downloading the model",
    "training": "Training", "trained": "Training done", "committing": "Sending its result",
    "committed": "Result sent, waiting to reveal", "revealing": "Revealing its result",
    "revealed": "Waiting for the verifiers", "verifying": "Being checked by the verifiers",
    "accepted": "Accepted, payment on the way", "settled": "Round finished", "skipped": "Skipped this round",
    "missed": "Missed this round", "slashed": "Slashed this round", "offline": "Offline",
}
WORKING = {"assigned", "fetching", "training", "trained", "committing", "committed", "revealing", "revealed",
           "verifying"}
SEAT_WORD = {"accepted": "Accepted", "slashed": "Slashed", "missed": "Missed", "verifying": "Being checked",
             "revealed": "Revealed", "committed": "Sent result", "training": "Training", "assigned": "Assigned",
             "idle": "Idle", "offline": "Offline", "committing": "Sending", "revealing": "Revealing",
             "settled": "Finished", "skipped": "Skipped", "fetching": "Downloading", "trained": "Trained"}
VERDICT = {"match": ("✓ match", FG), "mismatch": ("✗ mismatch", BAD), "drift": ("✗ drift", BAD),
           "unavailable": ("! no data", WARN), "replaying": ("checking…", MUTED), "offline": ("no report", WARN),
           "pending": ("", MUTED)}
PURPOSE = {"node": "Is your node working, and is there anything you need to do?",
           "round": "Who passed and who got caught in the current round.",
           "pool": "Every node in the network right now."}


def short(addr: str) -> str:
    return f"{addr[:6]}…{addr[-4:]}" if len(addr) > 12 else addr


def mmss(secs: int | None) -> str:
    return "" if secs is None else f"{secs // 60}:{secs % 60:02d}"


def problem(s: Snapshot) -> tuple[str, str] | None:
    """The one thing the operator should know first, and the command that deals with it."""
    if s.problems:
        return s.problems[0].message, s.problems[0].command
    if s.src("node").state == "stale":
        return "Can't reach your node right now. Showing what it last reported.", "tod-node status"
    if s.src("coordinator").state in ("stale", "down"):
        return "Can't reach the coordinator. Round and Pool show the last known data.", ""
    return None


def next_step(s: Snapshot) -> tuple[str, str | None]:
    """What the operator should do now, as a sentence and an optional command to run."""
    p = problem(s)
    if p:
        msg, cmd = p
        return msg, cmd if cmd.startswith("tod-") else None
    n = s.node
    if n is None:
        if s.src("node").state == "connecting":
            return "Looking for your node…", None
        return "Start your node:", "tod-node run"
    if n.state == "slashed":
        return "Your node was slashed this round. Press 2 to see why, then check this machine computes correctly:",             "tod-node selftest"
    if n.state in ("missed", "skipped"):
        return "Your node missed this round (no penalty). Make sure it stays online:", "tod-node status"
    if n.state in WORKING:
        return "Nothing to do. Keep this machine awake; it is safe to stop and restart at any time.", None
    if n.state in ("accepted", "settled"):
        return "Nothing to do. Your pay goes to your owner wallet; claim it in the web app.", None
    return "Nothing to do. Your node will be picked for the next round automatically.", None


def top_left(s: Snapshot, old: str | None = None, phase: int = FLAP) -> Text:
    t = Text()
    t.append("ToD", style=f"bold {FG}")
    t.append(f"   node {short(s.node.op)}" if s.node else "   no local node", style=FG)
    t.append(f"  ·  {s.network.title()}", style=MUTED)
    if s.block:
        t.append("  ·  block ", style=MUTED)
        t.append_text(flap(f"{s.block:,}", old, phase))
    return t


def flap(new: str, old: str | None, phase: int) -> Text:
    """Changed block digits split-flap: one tile frame with a passing digit, then land lit, then plain.
    A live block number is the proof the chain connection is up, so no pulsing dot is needed."""
    if old is None or phase >= FLAP or len(old) != len(new):
        return Text(new, style=MUTED)
    t = Text()
    for i, (a, b) in enumerate(zip(old, new)):
        if a == b or not b.isdigit():
            t.append(b, style=MUTED)
        elif phase < FLAP // 2:
            t.append(str((int(b) + 3 + i + phase) % 10), style=f"bold {INK} on {BG[4]}")
        else:
            t.append(b, style=f"bold {FG} on {BG[2]}")
    return t


def top_right(s: Snapshot, paused: bool) -> Text:
    if paused:
        return Text(" PAUSED ", style=f"bold {FG} on #28231f")
    if s.mode == "demo":
        return Text("demo data", style=MUTED)
    # A node CLI that is missing or erroring is not "reconnecting"; Next step says what is wrong.
    stale = s.src("node").state == "stale" or s.src("coordinator").state in ("stale", "down")
    return Text.assemble(("● ", WARN if stale else ACCENT), ("reconnecting" if stale else "live", MUTED))


def steps(r: RoundInfo | None, frame: int = 0, working: bool = True) -> Text:
    """✓ Fetch  ⠹ Train  ○ Commit …: where the round is, readable without a legend."""
    t = Text()
    cur = -1 if r is None else r.rail.current
    for i, name in enumerate(PHASES):
        word = name.title()
        if i < cur:
            t.append(f"✓ {word}", style=MUTED)
        elif i == cur:
            mark = SPINNER[frame % len(SPINNER)] if working else "●"
            t.append(f"{mark} {word}", style=f"bold {ACCENT}")
        else:
            t.append(f"○ {word}", style=FAINT)
        if i < len(PHASES) - 1:
            t.append("    ")
    return t


def node_status(s: Snapshot) -> Text:
    n, t = s.node, Text()
    if n is None:
        t.append("Connecting…" if s.src("node").state == "connecting" else "No node on this machine",
                 style=f"bold {FG}")
        return t
    bad = n.state in ("slashed", "missed")
    t.append(NODE_STATUS.get(n.state, n.state.title()), style=f"bold {BAD if bad else FG}")
    r = s.round if n.job is not None else None
    if r is None:
        if n.pool_position:
            t.append(f"\n{n.pool_position}", style=MUTED)
        return t
    bits = [f"Job {r.job}", f"round {r.round}"]
    if n.state == "training" and n.segments:
        bits.append(f"step {n.segment} of {n.segments}")
    if r.rail.secs_left is not None:
        bits.append(f"{r.rail.deadline_label} in {mmss(r.rail.secs_left)}")
    t.append("\n" + "  ·  ".join(bits), style=MUTED)
    return t


def next_text(s: Snapshot) -> Text:
    msg, cmd = next_step(s)
    t = Text()
    t.append("Next step   ", style=f"bold {MUTED}")
    t.append(msg, style=FG)
    if cmd:
        t.append("\n            ")
        t.append(f" {cmd} ", style=f"bold {ACCENT}")
        t.append("   press c to copy", style=FAINT)
    return t


def facts(s: Snapshot, earned: float | None = None) -> Text:
    n, t = s.node, Text()
    if n is None:
        t.append("The Round and Pool tabs still work without a node.", style=MUTED)
        return t
    rec = dict(n.record)
    issues = [h for h in n.health if h.status != "ok"]
    shown = f"{earned:.2f}" if earned is not None else n.earned
    rows = []
    if n.earned:  # the node CLI does not report pay yet; no row beats a false 0.00
        rows.append(("Earned today", Text(f"{shown} TOD", style=FG)))
    if rec:
        rows.append(("Track record", Text(f"{rec.get('accepted', '0')} rounds accepted, " + (
            "never slashed" if rec.get("slashed", "0").startswith("0.00") else f"{rec['slashed']} slashed"),
            style=FG)))
    rows.append(("Health", Text("✓ All good", style=FG) if not issues else
                 Text("! " + ", ".join(f"{h.key} {h.detail}" for h in issues), style=WARN)))
    for i, (k, v) in enumerate(rows):
        t.append(f"{k:<16}", style=MUTED)
        t.append_text(v)
        if i < len(rows) - 1:
            t.append("\n")
    return t


def activity(s: Snapshot, fresh: set[tuple[str, str]] = frozenset()) -> Text:
    t = Text()
    t.append("Recent activity\n", style=f"bold {MUTED}")
    if not s.events:
        t.append("Nothing yet.", style=FAINT)
        return t
    for e in reversed(s.events[-8:]):  # newest first: the eye lands on what just happened
        new = (e.clock, e.what) in fresh
        color = BAD if e.kind == "danger" else (WARN if e.kind == "warn" else FG)
        t.append("● " if new else "  ", style=ACCENT)
        t.append(f"{e.clock}  ", style=FG if new else FAINT)
        t.append(f"{e.what:<24}", style=f"bold {color}" if new else color)
        t.append(f"{e.detail}\n", style=color if color != FG else (FG if new else MUTED))
    return t


def round_top(s: Snapshot) -> Text:
    r, t = s.round, Text()
    if r is None:
        t.append("No round is open right now.", style=MUTED)
        return t
    t.append(f"Job {r.job}  ·  Round {r.round}", style=f"bold {FG}")
    if r.rail.secs_left is not None and not r.settlement.done:
        t.append(f"  ·  {r.rail.deadline_label} in {mmss(r.rail.secs_left)}", style=MUTED)
    return t


def roster_rows(s: Snapshot, lit: dict[str, bool] | None = None) -> list[tuple[str, list[Text]]]:
    """lit: nodes whose verdict just landed, True for a pass (bone row), False for a fail (red row)."""
    if not s.round:
        return []
    me = s.node.op.lower() if s.node else ""
    out = []
    for seat in s.round.roster:
        bad = seat.state in ("slashed", "missed")
        mine = seat.op.lower() == me
        cells = [Text(short(seat.op) + ("  you" if mine else ""), style=f"bold {FG}" if mine else FG),
                 Text(SEAT_WORD.get(seat.state, seat.state.title()), style=f"bold {BAD}" if bad else FG)]
        for v in seat.verdicts:
            word, color = VERDICT[v.state]
            cells.append(Text(word, style=color))
        paid = seat.paid
        cells.append(Text(("+" + paid) if paid and not paid.startswith("-") else paid,
                          style=BAD if paid.startswith("-") else FG))
        if lit and seat.op in lit:
            wash = f"bold {INK} on {ACCENT}" if lit[seat.op] else f"bold {FG} on {BG[4]}"
            for c in cells:
                c.style = wash
        out.append((seat.op, cells))
    return out


FINAL = {"match", "mismatch", "drift", "unavailable", "offline"}


def verdict_key(seat: Seat) -> tuple[str, ...]:
    return (seat.state, *(v.state for v in seat.verdicts))


def landed(before: tuple[str, ...], seat: Seat) -> bool | None:
    """True when a verdict on this seat just landed as a pass, False as a fail, None when nothing new landed."""
    now = verdict_key(seat)
    if before == now:
        return None
    was = before[1:] + ("",) * max(0, len(now) - len(before))
    fresh = [v for v, w in zip(now[1:], was) if v in FINAL and v != w]
    settled = now[0] != before[0] and now[0] in ("accepted", "slashed", "missed")
    if not fresh and not settled:
        return None
    return not (seat.state in ("slashed", "missed") or any(v in ("mismatch", "drift") for v in fresh))


def hash_compare(committed: str, replayed: str) -> Text:
    first = next((i for i, (a, b) in enumerate(zip(committed, replayed)) if a != b), None)
    t = Text()
    if first is None:
        t.append("✓ Its result and the verifiers' result are identical.", style=FG)
        return t
    a = max(2, first - 8)
    t.append("Its result       ", style=MUTED)
    t.append("…" + committed[a:a + 28] + "…\n", style=FG)
    t.append("Verifiers got    ", style=MUTED)
    t.append("…")
    for x, y in zip(committed[a:a + 28], replayed[a:a + 28]):
        t.append(y, style=f"bold {BAD}" if x != y else FG)
    t.append("…")
    return t


def seat_detail(seat: Seat | None) -> Text:
    t = Text()
    if seat is None:
        return t
    t.append(f"{seat.op}\n", style=f"bold {FG}")
    if seat.state == "slashed":
        t.append("Slashed. The verifiers re-ran this node's training and got a different result, "
                 "so its stake was taken.\n", style=BAD)
    elif seat.state == "accepted":
        t.append("Accepted. Every verifier re-ran its training and got the same result.\n", style=FG)
    elif seat.outcome == "NO REVEAL":
        t.append("Missed. It never revealed its result, so it was not paid.\n", style=WARN)
    else:
        t.append(" ".join(seat.why) + "\n", style=FG)
    replayed = next((v.replay_hash for v in seat.verdicts if v.replay_hash and v.replay_hash != seat.committed_hash),
                    next((v.replay_hash for v in seat.verdicts if v.replay_hash), None))
    if seat.committed_hash and replayed:
        t.append("\n")
        t.append_text(hash_compare(seat.committed_hash, replayed))
        t.append("\n")
    if seat.note:
        t.append(f"\n{seat.note}", style=MUTED)
    return t


def round_word(s: Snapshot) -> tuple[str, str] | None:
    """The round's poster once it settles: SLASHED if anyone was caught, else PAID; nothing while it runs."""
    r = s.round
    if r is None:
        return None
    if any(x.state == "slashed" for x in r.roster) or r.settlement.outcome == "REVERTED":
        return ("SLASHED", "slashed")
    return ("PAID", "paid") if r.settlement.done else None


def node_word(s: Snapshot) -> tuple[str, str] | None:
    """OFFLINE when the node never answered, IDLE while it waits for a job; otherwise the status line says enough."""
    if s.src("node").state == "down":
        return ("OFFLINE", "offline")
    if s.node is not None and s.node.job is None:
        return ("IDLE", "idle")
    return None


def settlement_text(r: RoundInfo | None) -> Text:
    t = Text()
    if r is None:
        return t
    st = r.settlement
    if st.done:
        t.append("Round settled", style=f"bold {FG}")
        t.append(f"  ·  {st.summary}", style=MUTED)
    elif False in r.verifier_online:
        t.append(f"Not settled yet: only {st.signed} of {st.threshold} verifiers have signed. "
                 "Nobody is paid or slashed until they all do.", style=WARN)
    else:
        t.append(f"Not settled yet  ·  {st.signed} of {st.threshold} verifiers have signed", style=MUTED)
    return t


ORDER = ["slashed", "missed", "training", "committed", "revealed", "verifying", "accepted", "idle", "offline"]


def pool_summary(s: Snapshot) -> Text:
    states = [p.state for p in s.pool]
    off, idle = states.count("offline"), states.count("idle")
    t = Text()
    if not states:
        t.append("No nodes have joined yet.", style=MUTED)
        return t
    t.append(f"{len(states) - off} online", style=f"bold {FG}")
    t.append(f"  ·  {len(states) - off - idle} working  ·  {idle} waiting  ·  {off} offline", style=MUTED)
    return t


def pool_order(s: Snapshot):
    me = s.node.op.lower() if s.node else ""
    return sorted(s.pool, key=lambda p: (p.op.lower() != me, ORDER.index(p.state) if p.state in ORDER else 99))


def pool_rows(s: Snapshot) -> list[tuple[str, list[Text]]]:
    me = s.node.op.lower() if s.node else ""
    out = []
    for p in pool_order(s):
        mine = p.op.lower() == me
        out.append((p.op, [Text(short(p.op) + ("  you" if mine else ""), style=f"bold {FG}" if mine else FG),
                           Text(SEAT_WORD.get(p.state, p.state.title()),
                                style=BAD if p.state == "slashed" else (FAINT if p.state == "offline" else FG)),
                           Text(p.job, style=MUTED), Text(p.last_seen, style=MUTED)]))
    return out


def pool_detail(p) -> Text:
    t = Text()
    if p is None:
        return t
    t.append(f"{p.op}\n", style=f"bold {FG}")
    t.append(f"{SEAT_WORD.get(p.state, p.state.title())}", style=BAD if p.state == "slashed" else FG)
    for bit in (p.arch, f"v{p.version}", p.workloads, p.record):
        if bit and bit not in ("?", "v?"):
            t.append(f"  ·  {bit}", style=MUTED)
    return t


def sync_table(table: DataTable, columns: list[str], rows: list[tuple[str, list[Text]]]) -> None:
    """Refresh a table in place so the cursor and scroll position survive each update."""
    if [str(c.label) for c in table.columns.values()] != columns:
        table.clear(columns=True)
        table.add_columns(*columns)
    keys = [k for k, _ in rows]
    if [k.value for k in table.rows] != keys:
        row = table.cursor_row
        table.clear()
        for k, cells in rows:
            table.add_row(*cells, key=k)
        if rows:
            table.move_cursor(row=min(row, len(rows) - 1))
        return
    for k, cells in rows:
        for col_key, cell in zip(table.columns, cells):
            table.update_cell(k, col_key, cell)


def flash(w: Widget, color: str, strength: float = 0.28, duration: float = 0.9) -> None:
    """One soft wash of colour that fades out: marks that something changed, then gets out of the way."""
    if mosaic.STILL:
        return
    c = Color.parse(color)
    w.styles.background = c.with_alpha(strength)
    w.styles.animate("background", c.with_alpha(0.0), duration=duration, easing="out_cubic")


def fade_in(w: Widget, duration: float = 0.18) -> None:
    if mosaic.STILL:
        return
    w.styles.opacity = 0.0
    w.styles.animate("opacity", 1.0, duration=duration, easing="out_cubic")


HELP = Text.assemble(
    ("What this is\n", f"bold {FG}"),
    ("A window onto your ToD node. The one thing it changes is stopping the node, and it asks first. "
     "When anything else needs doing, it tells you the command to run.\n\n", MUTED),
    ("1  Node   ", f"bold {FG}"), ("Is your node working? The Next step line always says what to do.\n", MUTED),
    ("2  Round  ", f"bold {FG}"), ("Everyone in the current round. Select a row to see why it passed or failed.\n", MUTED),
    ("3  Pool   ", f"bold {FG}"), ("Every node in the network. Select a row for details.\n\n", MUTED),
    ("Keys\n", f"bold {FG}"),
    ("↑ ↓ or click   select a row\nc              copy the suggested command\n"
     "s then s       stop the node after the reveals it owes\nspace          pause\n?              this help\nq              quit\n\n", MUTED),
    ("Press any key to close.", FAINT),
)


class Help(ModalScreen):
    DEFAULT_CSS = """
    Help { align: center middle; background: $background 70%; }
    #help { width: 96; height: auto; padding: 1 3; background: $surface; border: round #3b3530; }
    """

    def compose(self) -> ComposeResult:
        yield Static(HELP, id="help")

    def on_mount(self) -> None:
        fade_in(self.query_one("#help"), 0.15)

    def on_key(self, event) -> None:
        event.stop()
        self.dismiss()

    def on_click(self) -> None:
        self.dismiss()


THEME = Theme(name="tod", primary=ACCENT, secondary=MUTED, accent=ACCENT, foreground=FG, background="#0b0908",
              surface="#12100e", panel="#1a1715", success=FG, warning=WARN, error=BAD, dark=True)


class ToDApp(App):
    CSS = """
    #top { height: 1; padding: 0 2; margin-top: 1; }
    #top-left { width: 1fr; }
    #top-right { width: auto; }
    #banner { height: auto; margin: 1 2 0 2; padding: 0 1; border-left: thick $error; display: none; }
    TabbedContent { height: 1fr; margin-top: 1; }
    TabPane { padding: 1 2; }
    Tabs:focus Tab.-active { background: transparent; color: $foreground; text-style: bold; }
    Tab.-active { color: $foreground; text-style: bold; }
    Tab { color: #958e87; }
    .purpose { color: #5c5550; margin-bottom: 1; }
    .gap { margin-top: 1; }
    .hint { color: #5c5550; margin-top: 1; }
    #node-next { margin-top: 1; padding: 1 2; background: #12100e; }
    #round-detail-box { height: auto; }
    #round-poster { height: 9; }
    #node-poster { height: 7; margin-bottom: 1; }
    DataTable { height: auto; max-height: 24; background: $background; }
    DataTable > .datatable--header { background: $background; color: #958e87; text-style: bold; }
    DataTable > .datatable--cursor { background: #211d1a; }
    DataTable:focus > .datatable--cursor { background: #2e2924; }
    Footer { background: #12100e; }
    FooterKey .footer-key--key { color: $foreground; background: #28231f; text-style: bold; }
    FooterKey .footer-key--description { color: #958e87; }
    FooterKey.-disabled .footer-key--key { color: #5c5550; }
    """
    ENABLE_COMMAND_PALETTE = False
    BINDINGS = [Binding("1", "tab('node')", "Node"), Binding("2", "tab('round')", "Round"),
                Binding("3", "tab('pool')", "Pool"), Binding("c", "copy", "Copy command"),
                Binding("question_mark", "help", "Help", key_display="?"), Binding("q", "quit", "Quit"),
                Binding("space", "pause", "Pause", show=False), Binding("s", "stop", "Stop node", show=False)]
    ROSTER_HEAD = ["Node", "Status"]
    POOL_HEAD = ["Node", "Status", "Job", "Last seen"]
    earned = reactive(0.0, init=False)

    def __init__(self, source, tick: bool = True):
        super().__init__()
        self.source, self.want_tick = source, tick
        self.snap: Snapshot = source.snapshot()
        self.frame = 0
        self.seen: dict[tuple[str, str], float] = {}
        self.last_state: str | None = None
        self.last_cmd: str | None = None
        self.posters: dict[tuple[str, str], object] = {}
        self.verdicts: dict[str, tuple[str, ...]] = {}
        self.lit: dict[str, tuple[bool, float]] = {}
        self.block_old: str | None = None
        self.flap_phase = FLAP

    @property
    def paused(self) -> bool:
        return getattr(self.source, "paused", False)

    def compose(self) -> ComposeResult:
        with Horizontal(id="top"):
            yield Static(id="top-left")
            yield Static(id="top-right")
        yield Static(id="banner")
        with TabbedContent(initial="node"):
            with TabPane("Node", id="node"):
                with VerticalScroll():
                    yield Static(PURPOSE["node"], classes="purpose")
                    yield MosaicView(None, id="node-poster", per_char=True, seed=19, twinkle=0.06)
                    yield Static(id="node-status")
                    yield Static(id="node-steps", classes="gap")
                    yield Static(id="node-next")
                    yield Static(id="node-facts", classes="gap")
                    yield Static(id="node-activity", classes="gap")
            with TabPane("Round", id="round"):
                with VerticalScroll():
                    yield Static(PURPOSE["round"], classes="purpose")
                    yield Static(id="round-top")
                    yield Static(id="round-steps", classes="gap")
                    yield DataTable(id="roster", cursor_type="row", cell_padding=2, classes="gap")
                    yield Static("↑ ↓ or click a row to see why a node passed or failed.", classes="hint")
                    with Vertical(id="round-detail-box", classes="gap"):
                        yield Static(id="round-detail")
                    yield MosaicView(None, id="round-poster", per_char=True, seed=23, classes="gap")
                    yield Static(id="round-settle", classes="gap")
            with TabPane("Pool", id="pool"):
                with VerticalScroll():
                    yield Static(PURPOSE["pool"], classes="purpose")
                    yield Static(id="pool-summary")
                    yield DataTable(id="pool-table", cursor_type="row", cell_padding=2, classes="gap")
                    yield Static(id="pool-detail", classes="gap")
        yield Footer()

    def on_mount(self) -> None:
        self.register_theme(THEME)
        self.theme = "tod"
        if hasattr(self.source, "run"):
            self.run_worker(self.source.run(), exclusive=True, name="live-source")
        self.redraw(first=True)
        if self.want_tick:
            if not mosaic.STILL:
                self.push_screen(Splash())
            self.set_interval(0.5, self.tick)
            self.set_interval(0.1, self.spin)

    def torn_down(self) -> bool:
        # On quit the screen goes before the app's timers stop; a late tick must not query missing widgets.
        return not self.query("#node-steps")

    def tick(self) -> None:
        if self.torn_down():
            return
        if hasattr(self.source, "advance"):
            self.source.advance(0.5)
        self.redraw()

    def spin(self) -> None:
        if self.torn_down():
            return
        if mosaic.STILL:
            return
        self.frame += 1
        self.draw_steps()
        if self.flap_phase < FLAP:
            self.flap_phase += 1
            self.query_one("#top-left", Static).update(top_left(self.snap, self.block_old, self.flap_phase))

    def draw_steps(self) -> None:
        s = self.snap
        n = s.node
        mine = s.round if n is not None and n.job is not None else None
        working = (n is not None and n.state in WORKING and not self.paused and s.src("node").state == "ok"
                   and not mosaic.STILL)
        node_steps = self.query_one("#node-steps", Static)
        node_steps.display = mine is not None
        if mine is not None:
            node_steps.update(steps(mine, self.frame, working))
        settled = s.round is None or s.round.settlement.done
        self.query_one("#round-steps", Static).update(
            steps(s.round, self.frame, not settled and not self.paused and not mosaic.STILL) if s.round else "")

    def selected_seat(self) -> Seat | None:
        r = self.snap.round
        if not r or not r.roster:
            return None
        return r.roster[min(self.query_one("#roster", DataTable).cursor_row, len(r.roster) - 1)]

    def selected_pool(self):
        nodes = pool_order(self.snap)
        return nodes[min(self.query_one("#pool-table", DataTable).cursor_row, len(nodes) - 1)] if nodes else None

    def fresh_events(self) -> set[tuple[str, str]]:
        now = time.monotonic()
        first = not self.seen
        for e in self.snap.events:
            # On the first draw everything is history, not news: nothing gets the "just arrived" mark.
            self.seen.setdefault((e.clock, e.what), now - (FRESH_FOR if first else 0))
        return {k for k, t0 in self.seen.items() if now - t0 < FRESH_FOR}

    def poster(self, spec: tuple[str, str] | None):
        """A stable maker per (word, kind), so a poster keeps its dissolve between redraws."""
        if spec is None:
            return None
        if spec not in self.posters:
            self.posters[spec] = lambda w, h: poster(spec[0], spec[1], w, h)
        return self.posters[spec]

    def redraw(self, first: bool = False) -> None:
        prev = self.snap
        s = self.snap = self.source.snapshot()
        if not first and not mosaic.STILL and prev.block and s.block and s.block != prev.block:
            self.block_old, self.flap_phase = f"{prev.block:,}", 0
        self.query_one("#top-left", Static).update(top_left(s, self.block_old, self.flap_phase))
        self.query_one("#top-right", Static).update(top_right(s, self.paused))

        self.draw_banner()

        status = self.query_one("#node-status", Static)
        status.update(node_status(s))
        state = s.node.state if s.node else None
        if not first and state != self.last_state and state is not None:
            flash(status, BAD if state in ("slashed", "missed") else ACCENT, 0.22)
        self.last_state = state

        self.query_one("#node-next", Static).update(next_text(s))
        cmd = next_step(s)[1]
        if cmd != self.last_cmd:
            self.last_cmd = cmd
            self.refresh_bindings()

        target = float(s.node.earned) if s.node and s.node.earned else 0.0
        if first or not self.want_tick or mosaic.STILL:
            self.set_reactive(ToDApp.earned, target)
        elif target != self.earned:
            self.animate("earned", target, duration=0.8, easing="out_cubic")
        self.query_one("#node-facts", Static).update(facts(s, self.earned if s.node else None))
        act = self.query_one("#node-activity", Static)
        act.display = s.node is not None  # activity comes from the node; without one there is none to show
        act.update(activity(s, self.fresh_events()))

        self.query_one("#round-top", Static).update(round_top(s))
        verifiers = [v.title() for v in s.round.verifiers] if s.round else []
        roster = self.query_one("#roster", DataTable)
        sync_table(roster, self.ROSTER_HEAD + verifiers + ["Paid (TOD)"], roster_rows(s, self.verdict_flashes(first)))
        self.query_one("#round-detail", Static).update(seat_detail(self.selected_seat()))
        self.query_one("#round-settle", Static).update(settlement_text(s.round))
        for view in self.query(MosaicView):
            view.pause(self.paused)
        self.query_one("#round-poster", MosaicView).show(self.poster(round_word(s)))
        self.query_one("#node-poster", MosaicView).show(self.poster(node_word(s)))

        self.query_one("#pool-summary", Static).update(pool_summary(s))
        sync_table(self.query_one("#pool-table", DataTable), self.POOL_HEAD, pool_rows(s))
        self.query_one("#pool-detail", Static).update(pool_detail(self.selected_pool()))
        self.draw_steps()

    def verdict_flashes(self, first: bool) -> dict[str, bool]:
        """Rows whose verdict landed in the last FLASH_FOR seconds. A seat seen for the first time is history."""
        now = time.monotonic()
        for seat in self.snap.round.roster if self.snap.round else []:
            before = self.verdicts.get(seat.op)
            passed = None if before is None or first or mosaic.STILL else landed(before, seat)
            if passed is not None:
                self.lit[seat.op] = (passed, now)
                self.set_timer(FLASH_FOR + 0.05, self.redraw)
            self.verdicts[seat.op] = verdict_key(seat)
        self.lit = {op: v for op, v in self.lit.items() if now - v[1] < FLASH_FOR}
        return {op: v[0] for op, v in self.lit.items()}

    def watch_earned(self, value: float) -> None:
        if self.snap.node:
            self.query_one("#node-facts", Static).update(facts(self.snap, value))

    def on_data_table_row_highlighted(self, event: DataTable.RowHighlighted) -> None:
        if event.data_table.id == "roster":
            box = self.query_one("#round-detail", Static)
            box.update(seat_detail(self.selected_seat()))
        else:
            box = self.query_one("#pool-detail", Static)
            box.update(pool_detail(self.selected_pool()))
        fade_in(box, 0.15)

    def draw_banner(self) -> None:
        """The alert above the tabs. Hidden on Node, whose Next step already says it; elsewhere it points there."""
        banner, p = self.query_one("#banner", Static), problem(self.snap)
        show = p is not None and self.query_one(TabbedContent).active != "node"
        if show and not banner.display:
            fade_in(banner, 0.25)
        banner.display = show
        if show:
            banner.update(Text.assemble((p[0], FG), ("   Press 1 for what to do.", MUTED)))

    def on_tabbed_content_tab_activated(self, event: TabbedContent.TabActivated) -> None:
        self.draw_banner()
        fade_in(event.pane, 0.18)
        # Arrows should move through the list straight away, whether the tab was clicked or keyed.
        table = {"round": "#roster", "pool": "#pool-table"}.get(event.pane.id or "")
        if table:
            self.query_one(table, DataTable).focus()

    def check_action(self, action: str, parameters: tuple) -> bool | None:
        if action == "copy":
            return True if next_step(self.snap)[1] else None  # shown dimmed when there is nothing to copy
        return True

    def action_tab(self, tab: str) -> None:
        self.query_one(TabbedContent).active = tab

    def action_copy(self) -> None:
        cmd = next_step(self.snap)[1]
        if cmd:
            self.copy_to_clipboard(cmd)
            self.notify(f"Copied  {cmd}", timeout=2.5)

    def action_stop(self) -> None:
        """Stop takes two presses within five seconds: it is the one thing this screen changes."""
        if not hasattr(self.source, "stop_node"):
            self.notify("The demo has no node to stop.", timeout=2.5)
            return
        now = time.monotonic()
        if now - getattr(self, "_stop_armed", -10.0) > 5:
            self._stop_armed = now
            owed = self.source.owed() if hasattr(self.source, "owed") else []
            if owed:
                where = ", ".join(f"job {o['job']} round {o['round']}" for o in owed)
                self.notify(f"Your node owes a reveal in {where}. Press s again to stop once it is in; "
                            "a forced stop would be slashed for a missed reveal.", timeout=5, severity="warning")
            else:
                self.notify("Press s again to stop the node. It finishes the reveals it owes first.", timeout=5)
            return
        self._stop_armed = -10.0

        async def go() -> None:
            self.notify(await self.source.stop_node(), timeout=6)
        self.run_worker(go(), name="stop-node")

    def action_help(self) -> None:
        self.push_screen(Help())

    def action_pause(self) -> None:
        if hasattr(self.source, "paused"):
            self.source.paused = not self.source.paused
            self.redraw()
