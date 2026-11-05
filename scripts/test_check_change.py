"""Tests for check_change.py, run against throwaway git repos."""
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).with_name("check_change.py").resolve()


class CheckChange(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.repo = pathlib.Path(self.dir.name)
        self.git("init", "-q", "-b", "main")
        self.commit("base", {"README": "hi\n"})

    def tearDown(self):
        self.dir.cleanup()

    def git(self, *args):
        env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
               "GIT_COMMITTER_EMAIL": "t@t"}
        return subprocess.run(["git", *args], cwd=self.repo, env=env, check=True, capture_output=True, text=True).stdout

    def commit(self, message, files):
        for name, body in files.items():
            path = self.repo / name
            path.write_bytes(body) if isinstance(body, bytes) else path.write_text(body)
        self.git("add", "-A")
        self.git("commit", "-q", "-m", message)

    def run_check(self, *args):
        r = subprocess.run([sys.executable, str(SCRIPT), *args], cwd=self.repo, capture_output=True, text=True)
        return r.returncode, r.stdout

    def test_small_change_passes(self):
        self.commit("Add notes", {"notes.txt": "a\nb\n"})
        self.assertEqual(self.run_check("HEAD~1")[0], 0)

    def test_limit_is_strictly_below_2000(self):
        self.commit("Add 1999", {"a.txt": "x\n" * 1999})
        self.assertEqual(self.run_check("HEAD~1")[0], 0)
        self.commit("Add one more", {"b.txt": "x\n"})
        code, out = self.run_check("HEAD~2")
        self.assertEqual(code, 1)
        self.assertIn("whole change: 2000 changed lines", out)

    def test_binary_rejected(self):
        self.commit("Add image", {"pic.bin": b"\x00\x01\x02"})
        self.assertIn("binary file pic.bin", self.run_check("HEAD~1")[1])

    def test_coauthor_trailer_rejected_any_case(self):
        self.commit("Fix typo\n\nco-AUTHORED-by: Someone <s@s>", {"notes.txt": "a\n"})
        self.assertIn("Co-authored-by", self.run_check("HEAD~1")[1])

    def test_merge_commit_rejected(self):
        self.git("checkout", "-q", "-b", "side")
        self.commit("Side work", {"side.txt": "s\n"})
        self.git("checkout", "-q", "main")
        self.commit("Main work", {"main.txt": "m\n"})
        self.git("merge", "-q", "--no-ff", "-m", "Merge side", "side")
        self.assertIn("merge commit", self.run_check("HEAD~1")[1])

    def test_staged_mode(self):
        (self.repo / "big.txt").write_text("x\n" * 2000)
        self.git("add", "big.txt")
        self.assertEqual(self.run_check("--staged")[0], 1)


if __name__ == "__main__":
    unittest.main()
