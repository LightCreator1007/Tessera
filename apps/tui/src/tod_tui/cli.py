"""tod-tui entry point: pick the source (demo or live) and the surface (screen, NDJSON, one-shot text)."""
from __future__ import annotations

import argparse
import os
import sys

from .live import DEFAULT_NODE


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="tod-tui", description="Watch a ToD node, its round and the pool.",
                                epilog="The same node in a browser: the web console at http://localhost:3100/node.")
    p.add_argument("--demo", action="store_true", help="scripted round, no network")
    p.add_argument("--node", default=os.environ.get("TOD_NODE", DEFAULT_NODE),
                   help="the node's local API URL, or a command that prints its status JSON when the API is off "
                        f"(env TOD_NODE; default: {DEFAULT_NODE})")
    p.add_argument("--coordinator", default=os.environ.get("TOD_COORDINATOR"),
                   help="coordinator base URL (env TOD_COORDINATOR; default: the one in the node's config.toml)")
    p.add_argument("--job", type=int, help="job to watch (default: the node's job, else the first running)")
    p.add_argument("--plain", action="store_true", help="NDJSON lines instead of the screen (default with no TTY)")
    p.add_argument("--once", action="store_true", help="print one text summary and exit")
    p.add_argument("--demo-state", action="append", default=[], metavar="STATE",
                   choices=["stale", "offline", "coordinator_down", "verifier_down", "fresh", "chain_mismatch",
                            "big_pool"], help="demo only: start in a problem state (repeatable)")
    p.add_argument("--demo-at", type=float, default=8.6, metavar="SECONDS",
                   help="demo only: start this many seconds into the 30 s round")
    p.add_argument("--still", action="store_true", default=os.environ.get("TOD_MOTION") == "reduced",
                   help="no motion: posters draw their end frame, no splash (env TOD_MOTION=reduced)")
    a = p.parse_args(argv)
    if a.still:
        from . import mosaic
        mosaic.STILL = True

    if a.demo:
        from .demo import DemoSource
        source = DemoSource(a.demo_at)
        for state in a.demo_state:
            source.toggle(state)
    else:
        from .live import LiveSource
        source = LiveSource(a.node, a.coordinator, a.job)

    if a.once or a.plain or not sys.stdout.isatty():
        from . import plain
        plain.run(source, a.once)
        return 0

    from .app import ToDApp
    ToDApp(source).run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
