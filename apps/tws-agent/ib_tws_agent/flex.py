"""Outbound call to the Flex Web Service, twin of apps/api/ib/flex.py.

The body that comes back is never read, parsed or logged here: it belongs to the browser.
This module only knows how to reach IB and how to fail.
"""

from __future__ import annotations

import logging

import httpx

FLEX_BASE = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService"
FLEX_VERSION = "3"
FLEX_TIMEOUT = httpx.Timeout(30.0, connect=10.0)

# The token is a query parameter of IB's URL: httpx logs that full URL at INFO and httpcore
# repeats it at DEBUG. Held at WARNING here, whatever level uvicorn or the root logger runs at,
# exactly as apps/api/config/settings.py does for the server's proxy.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)


class FlexTimeout(Exception):
    pass


class FlexUnreachable(Exception):
    pass


async def call_flex(
    endpoint: str,
    params: dict[str, str],
    transport: httpx.AsyncBaseTransport | None = None,
) -> tuple[bytes, str]:
    """`endpoint` is "SendRequest" or "GetStatement". `transport` exists for tests only."""
    try:
        async with httpx.AsyncClient(timeout=FLEX_TIMEOUT, transport=transport) as client:
            response = await client.get(f"{FLEX_BASE}/{endpoint}", params={**params, "v": FLEX_VERSION})
    except httpx.TimeoutException as error:
        raise FlexTimeout from error
    except httpx.RequestError as error:
        raise FlexUnreachable from error
    return response.content, response.headers.get("content-type", "application/xml")
