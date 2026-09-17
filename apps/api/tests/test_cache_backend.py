from django.conf import settings

# Backends whose state lives in the Python process rather than somewhere all
# gunicorn workers can see it (task 8 runs several).
PER_PROCESS_BACKENDS = {
    "django.core.cache.backends.locmem.LocMemCache",
    "django.core.cache.backends.dummy.DummyCache",
}


def test_the_default_cache_is_shared_not_per_process():
    """Flex throttling (ib/throttling.py, spec §3.2) counts requests per user
    in `CACHES["default"]`. If that ever falls back to a per-process backend,
    each worker keeps its own counter and the 10/min and 1/s limits become
    10*N/min and N/s for N workers - IB's limits are a protocol fact, not a
    comfort setting, and exceeding them gets the account's calls rejected."""
    backend = settings.CACHES["default"]["BACKEND"]
    assert backend not in PER_PROCESS_BACKENDS, (
        f"CACHES['default'] fell back to the per-process backend {backend!r}: "
        "Flex throttling would no longer be enforced across gunicorn workers."
    )
