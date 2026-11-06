"""The op count behind a job's price: it must match what numpy runs, for any data, and never overpay a Gop."""
import numpy as np
import pytest

from tod_workloads import compute
from tod_workloads.mlp_exact import MLPExact

ARITHMETIC = {np.add, np.subtract, np.multiply, np.divide}
SHAPES = [(64, 784, 128, 10, "ce"), (64, 784, 32, 10, "ce"), (64, 3072, 128, 10, "ce"),
          (32, 8, 16, 4, "ce"), (32, 20, 16, 1, "mse"), (16, 50, 8, 1, "mse")]
counted = 0


class Counting(np.ndarray):
    def __array_ufunc__(self, ufunc, method, *inputs, **kw):
        global counted
        plain = [np.asarray(i) if isinstance(i, np.ndarray) else i for i in inputs]
        if "out" in kw:
            kw["out"] = tuple(np.asarray(o) for o in kw["out"])
        result = getattr(ufunc, method)(*plain, **kw)
        if ufunc in ARITHMETIC:
            counted += np.size(result)
        return result.view(Counting) if isinstance(result, np.ndarray) else result

    def __array_function__(self, func, types, args, kwargs):
        # np.where and np.concatenate hand back plain arrays, which would hide every op after them.
        result = super().__array_function__(func, types, args, kwargs)
        return result.view(Counting) if isinstance(result, np.ndarray) else result


def run_one_step(wl, w, x, y) -> int:
    global counted
    w, x = w.view(Counting), x.view(Counting)
    counted = 0
    wl.step(w, x, y)
    return counted


def mnist_spec(**train) -> dict:
    return {"workload": {"id": "mlp-exact/1"}, "train": {"H": 200, "B": 64, **train},
            "model": {"inputShape": [784], "outputs": 10, "hidden": 128, "task": "classification"}}


@pytest.mark.parametrize("B,d,h,o,loss", SHAPES)
def test_count_matches_what_numpy_runs_whatever_the_data(B, d, h, o, loss):
    rng = np.random.default_rng(0)
    wl = MLPExact(d, o, hidden=h, loss=loss)
    y = rng.integers(0, o, B) if loss == "ce" else rng.random(B, dtype=np.float32)
    x = rng.random((B, d), dtype=np.float32)
    want = compute.step_ops(B, d, h, o, loss)
    assert run_one_step(wl, wl.init(0), x, y) == want
    assert run_one_step(wl, wl.init(1) * 0.5, x * 0 + 1, y) == want


def test_a_mnist_round_and_job():
    spec = mnist_spec()
    assert compute.round_ops(spec) == 200 * 26_425_236 == 5_285_047_200
    assert compute.job_budget(spec, rounds=2, quorum=3) == 31_710_283  # 31.71 TOD
    assert compute.ref_work(spec) == 6  # whole Gops, rounded up, because the contract's field is a uint32 of them


@pytest.mark.parametrize("H", [50, 200, 500])
@pytest.mark.parametrize("rounds,quorum", [(1, 1), (2, 3), (7, 5)])
def test_a_tod_never_pays_for_less_than_a_gop(H, rounds, quorum):
    spec = mnist_spec(H=H)
    budget = compute.job_budget(spec, rounds, quorum)
    ops = rounds * quorum * compute.round_ops(spec)
    assert budget * compute.OPS_PER_TOD / 10**6 <= ops < (budget + 1) * compute.OPS_PER_UNIT


def test_regression_has_no_softmax_to_pay_for():
    spec = mnist_spec()
    spec["model"] |= {"outputs": 1, "task": "regression"}
    assert compute.round_ops(spec) == 200 * compute.step_ops(64, 784, 128, 1, "mse")


def test_only_the_exact_mlp_is_priced_so_far():
    with pytest.raises(ValueError, match="cnn-torch/1"):
        compute.round_ops({"workload": {"id": "cnn-torch/1"}})
