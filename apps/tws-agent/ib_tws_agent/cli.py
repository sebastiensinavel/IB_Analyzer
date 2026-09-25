"""`ib-tws-agent origin add|list|remove` edits the configuration; `ib-tws-agent` serves."""

from __future__ import annotations

import argparse
import sys

from . import config as config_module
from .config import Config, ConfigError

RESTART_HINT = "Restart the agent for the change to take effect."


def serve(config: Config) -> None:
    # Imported here: `origin` must work on a machine where the server stack is not importable yet.
    import uvicorn

    from .main import create_app

    uvicorn.run(create_app(config), host="127.0.0.1", port=config.listen, log_level="warning")


def origin_command(args: argparse.Namespace) -> int:
    path = config_module.config_path()
    if args.action == "add":
        if config_module.add_origin(args.origin):
            print(f"Added {args.origin.lower()} to {path}\n{RESTART_HINT}")
        else:
            print(f"{args.origin.lower()} is already in {path}")
        return 0
    if args.action == "remove":
        if not config_module.remove_origin(args.origin):
            print(f"{args.origin.lower()} is not configured in {path}", file=sys.stderr)
            return 1
        print(f"Removed {args.origin.lower()} from {path}\n{RESTART_HINT}")
        return 0
    origins = config_module.list_origins()
    if not origins:
        print(f"No origin in {path}.\n{config_module.ADD_HINT}", file=sys.stderr)
    for origin in origins:
        print(origin)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ib-tws-agent", description="Local TWS agent of IB Options Analyzer 2.")
    subparsers = parser.add_subparsers(dest="command")
    origin = subparsers.add_parser("origin", help="manage the sites the agent answers")
    actions = origin.add_subparsers(dest="action", required=True)
    add = actions.add_parser("add", help="allow a site, e.g. https://app.example")
    add.add_argument("origin")
    actions.add_parser("list", help="print the allowed sites")
    remove = actions.add_parser("remove", help="stop answering a site")
    remove.add_argument("origin")
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return exc.code if isinstance(exc.code, int) else 2

    try:
        if args.command == "origin":
            return origin_command(args)
        serve(config_module.load_config())
        return 0
    except ConfigError as exc:
        print(exc, file=sys.stderr)
        return 2
