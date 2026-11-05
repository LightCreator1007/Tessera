"""tod-verifier CLI. Only --version for now; replay and signing commands come with the verifier runtime."""

from importlib.metadata import version

import typer

app = typer.Typer(no_args_is_help=True)


def _print_version(value: bool) -> None:
    if value:
        typer.echo(version("tod-verifier"))
        raise typer.Exit()


@app.callback()
def main(
    _version: bool = typer.Option(
        False, "--version", callback=_print_version, is_eager=True, help="Print the version and exit."
    ),
) -> None:
    """Replay nodes' rounds and sign the verdicts."""
