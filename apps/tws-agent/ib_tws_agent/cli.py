"""`ib-tws-agent init --origin https://…` writes the configuration; `ib-tws-agent` serves."""

from __future__ import annotations

import argparse
import sys

from . import config as config_module
from .config import Config, ConfigError


def serve(config: Config) -> None:
    # Imported here: `init` must work on a machine where the server stack is not importable yet.
    import uvicorn

    from .main import create_app

    uvicorn.run(create_app(config), host="127.0.0.1", port=config.listen, log_level="warning")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ib-tws-agent", description="Local TWS agent of IB Options Analyzer 2.")
    subparsers = parser.add_subparsers(dest="command")
    init = subparsers.add_parser("init", help="write the configuration file")
    init.add_argument("--origin", required=True, help="origin of the site, e.g. https://app.example")
    args = parser.parse_args(argv)

    try:
        if args.command == "init":
            path = config_module.write_config(args.origin)
            print(f"Configuration written to {path}")
            return 0
        serve(config_module.load_config())
        return 0
    except ConfigError as exc:
        print(exc, file=sys.stderr)
        return 2
