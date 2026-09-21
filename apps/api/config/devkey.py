"""The development secret key, one per checkout, never committed.

Three different keys used to serve this application depending on how it was started —
settings' committed constant under DJANGO_DEBUG=1, tools/dev-env/api.mjs's own literal,
and whatever a human exported — and every switch between them silently invalidated every
session cookie at once (spec §2.2). One key per checkout, read or created here, is what
makes them agree.

It lives in the checkout's own git directory, beside `dev-slot`
(`checkoutGitDir`, tools/dev-env/ports.mjs): never versioned, and removed with the
worktree.
"""
import re
import secrets
from pathlib import Path

KEY_FILE = "dev-secret-key"


def checkout_git_dir(root: Path) -> Path:
    """`.git` in the main checkout, `.git/worktrees/<id>` in a linked worktree."""
    dot_git = root / ".git"
    if dot_git.is_dir():
        return dot_git
    if dot_git.is_file():
        match = re.search(r"^gitdir:\s*(.+)$", dot_git.read_text(), re.MULTILINE)
        if match:
            return (root / match.group(1).strip()).resolve()
    # No git directory at all (a source tarball, a container): the checkout root itself
    # is writable and per-checkout, which is all this needs.
    return root


def read_or_create_dev_secret(root: Path) -> str:
    path = checkout_git_dir(root) / KEY_FILE
    try:
        existing = path.read_text().strip()
        if existing:
            return existing
    except OSError:
        pass
    key = secrets.token_urlsafe(50)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{key}\n")
    return key
