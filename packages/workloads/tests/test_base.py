"""Registry, round-length clamping and epoch-to-round maths."""
import pytest

from tod_workloads.base import RoundDefaults, derive_h, get, register, rounds_for_epochs

MLP = RoundDefaults(200, 4, 64, "0.05")


@register
class Dummy:
    id = "dummy/1"

    def __init__(self, size=1):
        self.size = size


def test_registry_roundtrip():
    assert get("dummy/1", size=3).size == 3
    with pytest.raises(KeyError):
        get("nope/1")


def test_derive_h_clamps():
    assert derive_h(MLP, 6000) == 184
    assert derive_h(MLP, 100_000) == 200
    assert derive_h(MLP, 64) == 52
    assert derive_h(RoundDefaults(900, 4, 64, "0.05"), 10**6) == 500


def test_h_divisible_by_k_and_at_least_50():
    for rows in range(1000, 20000, 997):
        h = derive_h(MLP, rows)
        assert h % 4 == 0 and h >= 50


def test_rounds_for_epochs():
    assert rounds_for_epochs(20, 48_000, 6, 200, 64) == 13
    assert rounds_for_epochs(20, 1_280_000, 20, 500, 64) == 40
