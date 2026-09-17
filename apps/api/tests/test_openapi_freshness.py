import json
from pathlib import Path

from config.api import api

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "openapi.json"


def test_committed_openapi_matches_the_running_api():
    current = json.loads(json.dumps(api.get_openapi_schema(), sort_keys=True))
    committed = json.loads(SCHEMA_PATH.read_text())
    assert committed == current, (
        "openapi.json is stale. Regenerate it: "
        "uv run --project apps/api python apps/api/manage.py export_openapi_schema "
        "--api config.api.api --output apps/api/openapi.json"
    )
