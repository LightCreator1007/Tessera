"""Smoke test: the tod-verifier CLI starts and reports its version."""

from importlib.metadata import version

from typer.testing import CliRunner

from tod_verifier.cli import app


def test_version():
    result = CliRunner().invoke(app, ["--version"])
    assert result.exit_code == 0
    assert result.output.strip() == version("tod-verifier")
