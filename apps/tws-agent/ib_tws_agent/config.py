"""One file, two settings: the origins the agent may answer, and the port it listens on.

The site's origin is never in the code (CLAUDE.md: no domain name in a versioned file); the
user adds it with `ib-tws-agent origin add …`, copied from the site's Help page, and may add
several — a production site and its development twin — then list or remove them.
"""

from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass
from pathlib import Path

from platformdirs import user_config_dir

APP_NAME = "ib-tws-agent"
DEFAULT_LISTEN = 8100

# Scheme, host, optional port. No path, no trailing slash: a browser's `Origin` header never has one.
ORIGIN_RE = re.compile(r"^https?://[^/\s?#]+$")


class ConfigError(Exception):
    """A message for the user; the CLI prints it and exits non-zero."""


@dataclass(frozen=True)
class Config:
    origins: tuple[str, ...]
    listen: int = DEFAULT_LISTEN


def config_path() -> Path:
    return Path(user_config_dir(APP_NAME)) / "config.toml"


ADD_HINT = "Run `ib-tws-agent origin add https://<your site>`: the site's Help page gives the exact command."


def _read(path: Path) -> tuple[list[str], int]:
    """The file's origins, possibly none, and its port; `load_config` alone demands an origin."""
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except (tomllib.TOMLDecodeError, OSError) as exc:
        raise ConfigError(f"Unreadable configuration at {path}: {exc}") from exc
    origins = data.get("origins", [])
    if not isinstance(origins, list) or not all(isinstance(o, str) and ORIGIN_RE.match(o) for o in origins):
        raise ConfigError(f"`origins` must be a list of origins such as \"https://app.example\" in {path}")
    listen = data.get("listen", DEFAULT_LISTEN)
    if isinstance(listen, bool) or not isinstance(listen, int) or not 1 <= listen <= 65535:
        raise ConfigError(f"`listen` must be a port between 1 and 65535 in {path}")
    # A browser lowercases scheme and host before sending them in the `Origin` header (RFC
    # 6454); the comparison in cors.py is a plain string equality, so anything stored with a
    # different case would silently never match. Lowered on read, not just when `add_origin`
    # writes, in case the file was hand-edited.
    return list(dict.fromkeys(o.lower() for o in origins)), listen


def _write(path: Path, origins: list[str], listen: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    quoted = ", ".join(f'"{o}"' for o in origins)
    path.write_text(f"origins = [{quoted}]\nlisten = {listen}\n", encoding="utf-8")


def load_config(path: Path | None = None) -> Config:
    path = path if path is not None else config_path()
    if not path.exists():
        raise ConfigError(f"No configuration at {path}.\n{ADD_HINT}")
    origins, listen = _read(path)
    if not origins:
        raise ConfigError(f"No origin in {path}.\n{ADD_HINT}")
    return Config(origins=tuple(origins), listen=listen)


def list_origins(path: Path | None = None) -> tuple[str, ...]:
    path = path if path is not None else config_path()
    return tuple(_read(path)[0]) if path.exists() else ()


def add_origin(origin: str, path: Path | None = None) -> bool:
    """False when the origin was already there. The port and the other origins are kept."""
    if not ORIGIN_RE.match(origin):
        raise ConfigError(f'"{origin}" is not an origin: expected https://host, without a path or a trailing slash')
    path = path if path is not None else config_path()
    origins, listen = _read(path) if path.exists() else ([], DEFAULT_LISTEN)
    origin = origin.lower()
    if origin in origins:
        return False
    _write(path, [*origins, origin], listen)
    return True


def remove_origin(origin: str, path: Path | None = None) -> bool:
    """False when the origin was not there. Removing the last one leaves an empty list, which
    `load_config` refuses with the command to add one."""
    path = path if path is not None else config_path()
    if not path.exists():
        return False
    origins, listen = _read(path)
    origin = origin.lower()
    if origin not in origins:
        return False
    _write(path, [o for o in origins if o != origin], listen)
    return True
