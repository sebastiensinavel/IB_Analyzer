from django.middleware.csrf import get_token
from ninja import NinjaAPI

from core.api import router as core_router
from ib.api import router as ib_router

# django-ninja 1.7 (the version resolved by this pyproject.toml) has no
# top-level `csrf` flag on NinjaAPI(): CSRF checking is now a per-authenticator
# default (e.g. APIKeyCookie/SessionAuth default to csrf=True), so it applies
# automatically once session-based auth classes are added in later tasks.
api = NinjaAPI(title="IB Analyzer", version="1.0.0")


@api.get("/health", auth=None, url_name="health")
def health(request):
    """Liveness probe for Compose and Traefik. Touches nothing."""
    return {"status": "ok"}


@api.get("/csrf", auth=None, url_name="csrf")
def csrf(request):
    """Called once at boot so the SPA can send X-CSRFToken afterwards.

    `@ensure_csrf_cookie` doesn't work here: it wraps `view_func` expecting it
    to already return an HttpResponse to call `.set_cookie()` on, but a ninja
    view returns a plain dict that only becomes a JsonResponse further up in
    `Operation.run()`. Calling `get_token()` instead sets the same
    `CSRF_COOKIE_USED` flag on the request; `CsrfViewMiddleware`, which wraps
    the whole request/response cycle (not just this handler), attaches the
    cookie once the real response comes back through it.
    """
    get_token(request)
    return {"status": "ok"}


api.add_router("/core", core_router)
api.add_router("/ib", ib_router)
