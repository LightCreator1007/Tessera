"""SQLite connection that the API threadpool and the round driver thread can share."""
import sqlite3
import threading


class Rows(list):
    """A query's rows, read in full while the lock was held, with the cursor methods callers use."""

    def __init__(self, cur: sqlite3.Cursor):
        super().__init__(cur.fetchall())
        self.rowcount = cur.rowcount

    def fetchone(self):
        return self[0] if self else None

    def fetchall(self):
        return list(self)


class Locked(sqlite3.Connection):
    # sqlite3 raises InterfaceError, or returns a None row, when two threads use one connection at once.
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.lock = threading.RLock()

    def execute(self, *args) -> Rows:
        with self.lock:
            return Rows(super().execute(*args))

    def commit(self):
        with self.lock:
            super().commit()


def connect(path: str) -> Locked:
    return sqlite3.connect(path, check_same_thread=False, factory=Locked)
