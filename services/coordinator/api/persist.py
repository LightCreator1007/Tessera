"""Keeps the tables that can't be rebuilt from chain events (admin job controls and node re-arms) in SQLite, so a
restart doesn't quietly resume a paused job or bench a node an operator re-armed."""
import json
import sqlite3
import threading

from . import config, tables

_lock = threading.Lock()
db = sqlite3.connect(config.DB_PATH, check_same_thread=False)
db.execute("CREATE TABLE IF NOT EXISTS kept_tables (name TEXT PRIMARY KEY, value TEXT)")
db.commit()


def save() -> None:
    """Write CONTROL and REARMED as they are now. Called after every admin change; both are a handful of rows."""
    rows = [("CONTROL", json.dumps({str(k): v for k, v in tables.CONTROL.items()})),
            ("REARMED", json.dumps(tables.REARMED))]
    with _lock:
        db.executemany("INSERT OR REPLACE INTO kept_tables VALUES (?, ?)", rows)
        db.commit()


def load() -> None:
    """Fill CONTROL and REARMED from the last save, before the driver's first tick reads them."""
    with _lock:
        kept = dict(db.execute("SELECT name, value FROM kept_tables").fetchall())
    tables.CONTROL.update({int(k): v for k, v in json.loads(kept.get("CONTROL", "{}")).items()})
    tables.REARMED.update(json.loads(kept.get("REARMED", "{}")))
