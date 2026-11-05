"""Dataset card: what a workload needs to know about a canonical dataset to decide if it fits."""
from dataclasses import dataclass


@dataclass(frozen=True)
class DatasetCard:
    hash: str
    rows: int
    x_shape: tuple[int, ...]  # one row's shape, e.g. (784,) or (32, 32, 3)
    task: str  # "classification" | "regression"
    classes: int | None
    x_dtype: str = "float32"  # "float32" | "uint8"
