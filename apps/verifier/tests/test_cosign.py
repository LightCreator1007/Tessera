"""Co-signing helpers: the validation rows and the field-by-field comparison with the coordinator's Settlement."""
from tod_verifier.cosign import differences, val_rows, wire

S = {"outcome": 0, "aggregateHash": b"\1" * 32, "flaggedBitmap": 0, "aggEvidenceHash": b"\2" * 32,
     "payEvidenceHash": b"\3" * 32, "payouts": [("0xAbC" + "0" * 37, 5)]}


def test_validation_rows_follow_the_spec_split():
    spec = {"data": {"shards": [{"start": 0, "len": 400}, {"start": 400, "len": 400}], "valFrac": "0.1",
                     "testFrac": "0.1"}}
    rows = val_rows(spec, 1000)
    assert rows[0] == 800 and len(rows) == 100


def test_differences_ignore_case_but_not_amounts():
    theirs = {**wire(S), "aggregateHash": "0x" + "01" * 32, "payouts": [{"op": "0xabc" + "0" * 37, "amount": 5}],
              "digest": "0x00", "collected": 1}
    assert differences(wire(S), theirs) == []
    theirs["payouts"][0]["amount"] = 6
    theirs["flaggedBitmap"] = 1
    assert differences(wire(S), theirs) == ["flaggedBitmap", "payouts"]
