"""Checks a change before it lands: size, binary files, co-author trailers and merge commits."""
import argparse
import re
import subprocess
import sys

LIMIT = 2000
EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
TRAILER = re.compile(r"^\s*co-authored-by\s*:", re.I | re.M)


def git(*args: str) -> str:
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout


def diff_problems(label: str, diff_args: list[str]) -> list[str]:
    problems, total = [], 0
    for line in git("diff", "--numstat", "--no-renames", *diff_args).splitlines():
        added, deleted, path = line.split("\t", 2)
        if added == "-":
            problems.append(f"{label}: binary file {path}")
            continue
        total += int(added) + int(deleted)
    if total >= LIMIT:
        problems.append(f"{label}: {total} changed lines, limit is {LIMIT - 1}")
    return problems


def message_problems(label: str, message: str) -> list[str]:
    return [f"{label}: has a Co-authored-by trailer"] if TRAILER.search(message) else []


def check_range(base: str, head: str) -> list[str]:
    problems = []
    for sha in git("rev-list", "--reverse", f"{base}..{head}").split():
        parents = git("rev-list", "--parents", "-n1", sha).split()[1:]
        label = sha[:7]
        if len(parents) > 1:
            problems.append(f"{label}: merge commit; rebase instead")
            continue
        problems += diff_problems(label, [parents[0] if parents else EMPTY_TREE, sha])
        problems += message_problems(label, git("log", "-1", "--format=%B", sha))
    # The whole range is checked too, since several small commits can still add up to one huge PR.
    problems += diff_problems("whole change", [git("merge-base", base, head).strip(), head])
    return problems


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--staged", action="store_true", help="check what is staged right now")
    p.add_argument("base", nargs="?")
    p.add_argument("head", nargs="?", default="HEAD")
    a = p.parse_args()
    if a.staged:
        problems = diff_problems("staged", ["--cached"])
    elif a.base:
        problems = check_range(a.base, a.head)
    else:
        p.error("pass --staged or a BASE commit")
    for line in problems:
        print("FAIL ", line)
    print("OK" if not problems else f"{len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
