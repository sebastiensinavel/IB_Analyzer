"""One file, two settings: the origins the agent may answer, and the port it listens on.

The site's origin is never in the code (CLAUDE.md: no domain name in a versioned file); the
user types it once, `ib-tws-agent init --origin …`, copied from the site's Help page.
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


def load_config(path: Path | None = None) -> Config:
    path = path if path is not None else config_path()
    if not path.exists():
        raise ConfigError(
            f"No configuration at {path}.\n"
            "Run `ib-tws-agent init --origin https://<your site>` first: the site's Help page gives the exact command."
        )
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except (tomllib.TOMLDecodeError, OSError) as exc:
        raise ConfigError(f"Unreadable configuration at {path}: {exc}") from exc
    origins = data.get("origins")
    if not isinstance(origins, list) or not origins or not all(isinstance(o, str) and ORIGIN_RE.match(o) for o in origins):
        raise ConfigError(f"`origins` must be a non-empty list of origins such as \"https://app.example\" in {path}")
    listen = data.get("listen", DEFAULT_LISTEN)
    if isinstance(listen, bool) or not isinstance(listen, int) or not 1 <= listen <= 65535:
        raise ConfigError(f"`listen` must be a port between 1 and 65535 in {path}")
    # A browser lowercases scheme and host before sending them in the `Origin` header (RFC
    # 6454); the comparison in cors.py is a plain string equality, so anything stored with a
    # different case would silently never match. Lowered again here, not just in
    # `write_config`, in case the file was hand-edited.
    return Config(origins=tuple(o.lower() for o in origins), listen=listen)


def write_config(origin: str, path: Path | None = None) -> Path:
    """Overwrites: `init` is the way to change the origin, there is nothing else in the file."""
    if not ORIGIN_RE.match(origin):
        raise ConfigError(f'"{origin}" is not an origin: expected https://host, without a path or a trailing slash')
    path = path if path is not None else config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    # Lowered for the same reason as in `load_config`: a browser's Origin header is always
    # lowercase, and the runtime comparison is case-sensitive.
    path.write_text(f'origins = ["{origin.lower()}"]\nlisten = {DEFAULT_LISTEN}\n', encoding="utf-8")
    return path
