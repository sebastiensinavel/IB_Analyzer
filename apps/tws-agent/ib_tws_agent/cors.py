"""Answer the site, and only the site.

Not Starlette's CORSMiddleware: the preflight must carry
`Access-Control-Allow-Private-Network`, which Chrome requires before a public HTTPS page may
talk to 127.0.0.1, and CORSMiddleware does not know that header. An unknown origin gets a
normal answer without any Allow-* header on `/health`: the browser is what refuses, the agent
stays dumb. `/snapshot` and the Flex relay are different (see `ACTING_PATHS` below): they make
the agent act, so they refuse outright instead of relying on the browser.
"""

from __future__ import annotations

from collections.abc import Iterable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

PREFLIGHT_MAX_AGE_S = 600

# Endpoints that make the agent act - open a TWS connection, or call Interactive Brokers with a
# Flex token - rather than merely answer. An unknown *or absent* Origin is refused before the
# handler runs: a same-origin request carries no Origin header at all (a DNS-rebinding page, or
# a plain <img src=…>), so "Origin present and unknown" is not strong enough - only "Origin
# present, present in the list" is.
ACTING_PATHS = frozenset({"/snapshot", "/flex/send-request", "/flex/get-statement"})


class OriginMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, origins: Iterable[str]):
        super().__init__(app)
        self.origins = frozenset(origins)

    async def dispatch(self, request: Request, call_next):
        origin = request.headers.get("origin")
        allowed = origin is not None and origin in self.origins

        if request.method == "OPTIONS" and "access-control-request-method" in request.headers:
            headers = {"Vary": "Origin"}
            if allowed:
                headers.update(
                    {
                        "Access-Control-Allow-Origin": origin,
                        "Access-Control-Allow-Methods": "GET, POST",
                        # The Flex relay posts JSON, which always triggers a preflight.
                        "Access-Control-Allow-Headers": "content-type",
                        "Access-Control-Allow-Private-Network": "true",
                        "Access-Control-Max-Age": str(PREFLIGHT_MAX_AGE_S),
                    }
                )
            return Response(status_code=204, headers=headers)

        if request.url.path in ACTING_PATHS and not allowed:
            return JSONResponse(status_code=403, content={"code": "origin-refused"})

        response = await call_next(request)
        if allowed:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers.append("Vary", "Origin")
        return response
