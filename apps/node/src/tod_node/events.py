"""Append-only event log (events.ndjson) with a seq that keeps counting across restarts; logs and status read it."""
import json
import threading
import time
from pathlib import Path


class EventLog:
    def __init__(self, path: Path):
        self.path, self._lock = path, threading.Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._drop_partial_line()
        last = self.read()[-1:] if self.path.exists() else []
        self.seq = last[0]["seq"] if last else 0

    def _drop_partial_line(self) -> None:
        """A crash mid-write leaves a line with no newline; cut it so the next event starts on its own line."""
        if not self.path.exists():
            return
        data = self.path.read_bytes()
        if data and not data.endswith(b"\n"):
            with self.path.open("r+b") as f:
                f.truncate(data.rfind(b"\n") + 1)

    def append(self, type_: str, job: int | None = None, round: int | None = None, **data) -> dict:
        with self._lock:
            self.seq += 1
            ev = {"seq": self.seq, "ts": round_ts(time.time()), "type": type_, "job": job, "round": round, "data": data}
            with self.path.open("a") as f:
                f.write(json.dumps(ev, sort_keys=True) + "\n")
                f.flush()
            return ev

    def read(self, since: int = 0) -> list[dict]:
        if not self.path.exists():
            return []
        out = []
        for line in self.path.read_text().splitlines():
            try:
                ev = json.loads(line)
            except ValueError:  # a crash mid-write can leave half a last line
                continue
            if ev["seq"] > since:
                out.append(ev)
        return out


def round_ts(t: float) -> float:
    return int(t * 10) / 10


def render(ev: dict) -> str:
    where = f"j{ev['job']} r{ev['round']}" if ev["job"] is not None else ""
    detail = " ".join(f"{k}={v}" for k, v in sorted(ev["data"].items()))
    return f"{time.strftime('%H:%M:%S', time.localtime(ev['ts']))}  {where:<8} {ev['type']:<16} {detail}".rstrip()
