"""System check for a node: CPU, RAM and GPUs, the label and size class it gets, and which jobs it can take."""
import os
import platform

GB = 2**30
DEVICE_ORDER = ("cuda", "mps")  # CUDA first: on a machine with both, it's the bigger, dedicated GPU


def _ram_gb() -> float:
    try:
        return round(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / GB, 1)
    except (AttributeError, ValueError, OSError):
        # Windows has no sysconf; RAM only sizes Apple GPUs, which Windows never has.
        return 0.0


def _gpus(ram_gb: float) -> tuple[str | None, list[dict]]:
    try:
        import torch
    except ImportError:
        return None, []
    gpus = []
    # A broken driver or a half-installed torch shouldn't stop the node from running CPU work.
    try:
        if torch.cuda.is_available():
            for i in range(torch.cuda.device_count()):
                d = torch.cuda.get_device_properties(i)
                gpus.append({"kind": "cuda", "name": d.name, "memGB": round(d.total_memory / GB, 1)})
        if torch.backends.mps.is_available():
            # Apple GPUs share system memory, so RAM is the most they can use.
            gpus.append({"kind": "mps", "name": "Apple GPU", "memGB": ram_gb})
    except Exception:
        gpus = []
    return torch.__version__, gpus


def label(gpus: list[dict]) -> tuple[str, str]:
    if not gpus:
        return "cpu", "s"
    g = max(gpus, key=lambda g: (g["kind"] == "cuda", g["memGB"]))  # label the GPU best_device would pick
    mem = g["memGB"]
    return ("gpu-nvidia" if g["kind"] == "cuda" else "gpu-apple"), ("s" if mem < 8 else "m" if mem < 16 else "l")


def probe() -> dict:
    ram = _ram_gb()
    version, gpus = _gpus(ram)
    name, size = label(gpus)
    return {"os": platform.system(), "arch": platform.machine(), "cores": os.cpu_count() or 1, "ramGB": ram,
            "torch": version, "gpus": gpus, "label": name, "size": size}


def best_device(profile: dict) -> str:
    kinds = {g["kind"] for g in profile["gpus"]}
    return next((k for k in DEVICE_ORDER if k in kinds), "cpu")


def meets(profile: dict, device_class: str) -> bool:
    return device_class != "gpu" or bool(profile["gpus"])
