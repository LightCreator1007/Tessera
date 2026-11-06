"""Turns a job spec into the float ops a node runs, and ops into TOD: 1 TOD pays for 1 Gop of replayed training."""
import math

OPS_PER_TOD = 10**9  # one Gop
OPS_PER_UNIT = 10**3  # TOD has six decimals


def step_ops(B: int, d: int, h: int, o: int, loss: str = "ce") -> int:
    """Adds, subtracts, multiplies and divides in one mlp-exact step, for a batch B, d inputs, h hidden and o outputs.

    Dividing uint8 inputs by 255 is left out, about 0.2%, so this is never above what really runs.
    """
    params = d * h + h + h * o + o
    return 4 * B * d * h + 6 * B * h * o + 2 * B * h + (37 if loss == "ce" else 4) * B * o + 2 * params


def round_ops(spec: dict) -> int:
    """Ops one node runs in one round. Every seat in a job runs the same steps, so its hardware doesn't matter."""
    workload = spec["workload"]["id"]
    if workload != "mlp-exact/1":
        raise ValueError(f"{workload} has no op count yet")
    model, train = spec["model"], spec["train"]
    loss = "mse" if model["task"] == "regression" else "ce"
    return train["H"] * step_ops(train["B"], math.prod(model["inputShape"]), model.get("hidden", 128), model["outputs"], loss)


def job_budget(spec: dict, rounds: int, quorum: int) -> int:
    """A job's price in base units. Rounds down, so a TOD never pays for less than a Gop."""
    return rounds * quorum * round_ops(spec) // OPS_PER_UNIT


def ref_work(spec: dict) -> int:
    """refWorkSecondsPerRound: one reference second is one Gop, and the contract only holds whole ones, so round up."""
    return -(-round_ops(spec) // OPS_PER_TOD)
