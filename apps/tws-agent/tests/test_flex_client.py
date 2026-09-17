from __future__ import annotations

import asyncio

import httpx
import pytest

from ib_tws_agent.flex import FLEX_BASE, FlexTimeout, FlexUnreachable, call_flex


def run(coro):
    return asyncio.run(coro)


def test_call_flex_hits_the_endpoint_with_the_params_and_version_and_returns_bytes_untouched():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, content=b"<FlexStatementResponse/>", headers={"content-type": "text/xml"})

    content, content_type = run(call_flex("SendRequest", {"t": "tok", "q": "42"}, transport=httpx.MockTransport(handler)))

    assert content == b"<FlexStatementResponse/>"
    assert content_type == "text/xml"
    assert len(seen) == 1
    assert seen[0].method == "GET"
    assert str(seen[0].url).startswith(f"{FLEX_BASE}/SendRequest?")
    assert dict(seen[0].url.params) == {"t": "tok", "q": "42", "v": "3"}


def test_call_flex_defaults_the_content_type_to_xml():
    transport = httpx.MockTransport(lambda request: httpx.Response(200, content=b"<x/>"))

    _, content_type = run(call_flex("GetStatement", {"t": "tok", "q": "REF"}, transport=transport))

    assert content_type == "application/xml"


def test_a_non_200_answer_from_ib_is_still_relayed():
    transport = httpx.MockTransport(lambda request: httpx.Response(500, content=b"oops", headers={"content-type": "text/plain"}))

    assert run(call_flex("GetStatement", {"t": "tok", "q": "REF"}, transport=transport)) == (b"oops", "text/plain")


def test_a_timeout_becomes_flex_timeout():
    def handler(request):
        raise httpx.ReadTimeout("slow", request=request)

    with pytest.raises(FlexTimeout):
        run(call_flex("SendRequest", {"t": "tok", "q": "42"}, transport=httpx.MockTransport(handler)))


def test_a_network_error_becomes_flex_unreachable():
    def handler(request):
        raise httpx.ConnectError("refused", request=request)

    with pytest.raises(FlexUnreachable):
        run(call_flex("SendRequest", {"t": "tok", "q": "42"}, transport=httpx.MockTransport(handler)))
