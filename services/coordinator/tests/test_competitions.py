"""Where a competition stands at each point in its life, which tells the page who acts next."""
import competitions as C

BASE = {"settled": False, "deadline": 100, "revealWindow": 50, "labelsRevealedAt": 0, "entries": 2}


def at(now, **over):
    return C.status({**BASE, **over}, now)


def test_status_walks_the_lifecycle():
    assert at(99) == "open"
    assert at(100) == "awaiting-labels"
    assert at(150) == "labels-hidden"  # the host missed the window: entrants share the prize
    assert at(150, entries=0) == "refundable"
    assert at(160, labelsRevealedAt=120) == "scoring"
    assert at(170, labelsRevealedAt=120) == "ready-to-settle"
    assert at(999, labelsRevealedAt=120, settled=True) == "settled"


def test_meta_is_forgiving():
    assert C._meta('{"title": "digits"}') == {"title": "digits"}
    assert C._meta("not json") == {} and C._meta("[1]") == {}
