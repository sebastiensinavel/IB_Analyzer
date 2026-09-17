"""Outbound call to the Flex Web Service.

The body that comes back is never read, parsed or logged here: it belongs to
the browser. This module only knows how to reach IB and how to fail.
"""
import httpx

FLEX_BASE = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService"
FLEX_VERSION = "3"
FLEX_TIMEOUT = httpx.Timeout(30.0, connect=10.0)


class FlexTimeout(Exception):
    pass


class FlexUnreachable(Exception):
    pass


def call_flex(endpoint, params):
    """`endpoint` is "SendRequest" or "GetStatement". Returns (bytes, content_type)."""
    try:
        with httpx.Client(timeout=FLEX_TIMEOUT) as client:
            response = client.get(f"{FLEX_BASE}/{endpoint}", params={**params, "v": FLEX_VERSION})
    except httpx.TimeoutException as error:
        raise FlexTimeout from error
    except httpx.RequestError as error:
        raise FlexUnreachable from error
    return response.content, response.headers.get("content-type", "application/xml")
