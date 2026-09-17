from __future__ import annotations

import json
import runpy
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "write_index.py"


def write_index(out_dir: Path) -> Path:
    module = runpy.run_path(str(SCRIPT))
    return module["main"](out_dir)


def test_index_names_the_one_wheel_and_its_version(tmp_path):
    (tmp_path / "ib_tws_agent-0.1.0-py3-none-any.whl").write_bytes(b"")

    index = write_index(tmp_path)

    assert index == tmp_path / "index.json"
    assert json.loads(index.read_text(encoding="utf-8")) == {
        "version": "0.1.0",
        "filename": "ib_tws_agent-0.1.0-py3-none-any.whl",
    }


@pytest.mark.parametrize("names", [[], ["ib_tws_agent-0.1.0-py3-none-any.whl", "ib_tws_agent-0.2.0-py3-none-any.whl"]])
def test_anything_but_exactly_one_wheel_is_refused(tmp_path, names):
    for name in names:
        (tmp_path / name).write_bytes(b"")

    with pytest.raises(SystemExit):
        write_index(tmp_path)
