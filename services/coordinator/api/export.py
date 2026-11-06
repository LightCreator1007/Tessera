"""Writes the API's OpenAPI schema to openapi.json, with sorted keys so the output is stable."""
import json
import pathlib

from .app import app

OUT = pathlib.Path(__file__).parent.parent / "openapi.json"


def render():
    return json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n"


if __name__ == "__main__":
    OUT.write_text(render())
