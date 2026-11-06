"""Workloads, their round defaults and the round runner shared by nodes and verifiers."""
from . import cnn_torch, mlp_exact  # noqa: F401  importing the package registers the workloads, which the coordinator relies on
