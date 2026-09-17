"""Settings for the test suite: the real ones, with a key of their own.

`config.settings` refuses to boot outside DEBUG on the committed development key,
so that a forgotten `DJANGO_SECRET_KEY` on the VPS can never start production on a
publicly known one. The test suite is neither production nor DEBUG: it supplies a
key here rather than weakening that guard, and the environment variable still wins
if one is set. Everything else is imported verbatim — this module never diverges
from what production runs.
"""
import os

os.environ.setdefault("DJANGO_SECRET_KEY", "test-only-not-for-production")

from config.settings import *  # noqa: E402,F401,F403
