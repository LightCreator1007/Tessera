"""Checks exact funding units and invalid inputs without network or signing side effects."""
import argparse
import importlib.util
from decimal import Decimal
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("tod_funding_under_test", ROOT / "scripts/fund.py")
fund = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fund)


@pytest.mark.parametrize("text,decimals,expected", [
    ("0", 6, 0), ("1.000001", 6, 1000001), ("0.000001", 6, 1),
    ("1.0000000", 6, 1000000), ("1e-18", 18, 1),
    (str(2**256 - 1), 0, 2**256 - 1),
    ("123456789012345678901234567890.123456", 6, 123456789012345678901234567890123456),
])
def test_exact_conversion_avoids_float_and_decimal_context_rounding(text, decimals, expected):
    assert fund.base_units(Decimal(text), decimals) == expected


@pytest.mark.parametrize("text,decimals", [
    ("-1", 6), ("NaN", 6), ("Infinity", 6), ("0.0000001", 6),
    ("1e-999999999", 6), ("1e999999999", 6), (str(2**256), 0),
])
def test_invalid_amounts_are_rejected(text, decimals):
    with pytest.raises(ValueError):
        fund.base_units(Decimal(text), decimals)


def test_malformed_decimal_has_a_cli_error():
    with pytest.raises(argparse.ArgumentTypeError):
        fund.parse_amount("not-a-number")


@pytest.mark.parametrize("address", ["not-an-address", "0x" + "00" * 20])
def test_invalid_recipient_is_rejected(address):
    with pytest.raises(ValueError):
        fund.recipient_address(address)
