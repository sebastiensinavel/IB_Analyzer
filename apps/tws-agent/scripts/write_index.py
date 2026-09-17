"""Write index.json next to the agent's wheel, for the site's Help page.

The page reads `{ version, filename }` and builds `uv tool install <origin>/agent/<filename>`
from it: neither the version nor the file name is ever in the web app's code.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main(out_dir: Path) -> Path:
    wheels = sorted(out_dir.glob("ib_tws_agent-*.whl"))
    if len(wheels) != 1:
        raise SystemExit(f"expected exactly one ib_tws_agent wheel in {out_dir}, found {len(wheels)}")
    filename = wheels[0].name
    version = filename.split("-")[1]
    index = out_dir / "index.json"
    index.write_text(json.dumps({"version": version, "filename": filename}, indent=2) + "\n", encoding="utf-8")
    return index


if __name__ == "__main__":
    print(main(Path(sys.argv[1])))
