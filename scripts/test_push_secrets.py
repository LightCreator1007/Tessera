"""Tests how push_secrets reads a .env file, including the comment styles in .env.example."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from push_secrets import read_env  # noqa: E402


class ReadEnv(unittest.TestCase):
    def parse(self, text: str) -> dict[str, str]:
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / ".env"
            path.write_text(text)
            return read_env(path)

    def test_comment_after_a_value_is_not_part_of_it(self):
        self.assertEqual(self.parse("A=0xabc   # signs invites\n")["A"], "0xabc")

    def test_comment_after_an_empty_value_leaves_it_empty(self):
        self.assertEqual(self.parse("A=        # e.g. https://x\n")["A"], "")

    def test_hash_inside_a_value_stays(self):
        self.assertEqual(self.parse("A=abc#def\n")["A"], "abc#def")

    def test_quotes_keep_a_hash_and_are_removed(self):
        self.assertEqual(self.parse("A='a # b'  # note\nB=\"c\"\n"), {"A": "a # b", "B": "c"})

    def test_export_prefix_and_comment_lines(self):
        self.assertEqual(self.parse("# note\n\nexport A=1\nnot a pair\n"), {"A": "1"})


if __name__ == "__main__":
    unittest.main()
