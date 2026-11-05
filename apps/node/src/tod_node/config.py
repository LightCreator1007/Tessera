"""Node settings, resolved as flag, then env, then data_dir/config.toml, with the source of each value kept."""
import json
import os
import tomllib
from pathlib import Path

ENV = {"network": "TOD_NETWORK", "coordinator": "TOD_COORDINATOR"}


def path(data_dir: Path) -> Path:
    return data_dir / "config.toml"


def read(data_dir: Path) -> dict:
    p = path(data_dir)
    return tomllib.loads(p.read_text()) if p.exists() else {}


def write(data_dir: Path, values: dict) -> None:
    data = {**read(data_dir), **{k: v for k, v in values.items() if v is not None}}
    p = path(data_dir)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    # Values are plain strings; JSON string escaping is valid TOML basic-string escaping.
    tmp.write_text("".join(f"{k} = {json.dumps(str(v))}\n" for k, v in sorted(data.items())))
    os.replace(tmp, p)


def resolve(data_dir: Path, **flags: str | None) -> dict[str, tuple[str | None, str]]:
    """{key: (value, source)} where source is flag, env, file or unset."""
    stored, out = read(data_dir), {}
    for key, env in ENV.items():
        if flags.get(key):
            out[key] = (flags[key], "flag")
        elif os.environ.get(env):
            out[key] = (os.environ[env], "env")
        elif stored.get(key):
            out[key] = (stored[key], "file")
        else:
            out[key] = (None, "unset")
    return out
