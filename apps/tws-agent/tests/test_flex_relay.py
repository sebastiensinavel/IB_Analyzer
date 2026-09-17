from __future__ import annotations

import logging

import httpx
import pytest

from ib_tws_agent.flex import FlexTimeout, FlexUnreachable, call_flex
from ib_tws_agent.main import create_app, get_flex_caller
from fastapi.testclient import TestClient
from tests.conftest import CONFIG, ORIGIN

HEADERS = {"Origin": ORIGIN}
TOKEN = "a-very-recognisable-flex-token"


class Recorder:
    def __init__(self, answer=(b"<FlexStatementResponse/>", "text/xml"), error: Exception | None = None):
        self.calls: list[tuple[str, dict[str, str]]] = []
        self.answer = answer
        self.error = error

    async def __call__(self, endpoint: str, params: dict[str, str]):
        self.calls.append((endpoint, params))
        if self.error is not None:
            raise self.error
        return self.answer


def client_with(caller) -> TestClient:
    app = create_app(CONFIG)
    app.dependency_overrides[get_flex_caller] = lambda: caller
    return TestClient(app, base_url="http://127.0.0.1")


def test_send_request_relays_ib_bytes_and_content_type_untouched():
    fail = b"<FlexStatementResponse><Status>Fail</Status><ErrorCode>1012</ErrorCode></FlexStatementResponse>"
    recorder = Recorder(answer=(fail, "text/xml"))

    response = client_with(recorder).post("/flex/send-request", json={"token": TOKEN, "queryId": "42"}, headers=HEADERS)

    assert response.status_code == 200
    assert response.content == fail
    assert response.headers["content-type"] == "text/xml"
    assert recorder.calls == [("SendRequest", {"t": TOKEN, "q": "42"})]


def test_get_statement_passes_the_reference_code_as_q():
    recorder = Recorder()

    response = client_with(recorder).post("/flex/get-statement", json={"token": TOKEN, "referenceCode": "REF1"}, headers=HEADERS)

    assert response.status_code == 200
    assert recorder.calls == [("GetStatement", {"t": TOKEN, "q": "REF1"})]


def test_a_timeout_is_a_504_with_the_servers_body():
    response = client_with(Recorder(error=FlexTimeout())).post(
        "/flex/send-request", json={"token": TOKEN, "queryId": "42"}, headers=HEADERS
    )

    assert response.status_code == 504
    assert response.json() == {"code": "flex-timeout", "detail": "Interactive Brokers did not answer in time."}


def test_an_unreachable_ib_is_a_502_with_the_servers_body():
    response = client_with(Recorder(error=FlexUnreachable())).post(
        "/flex/get-statement", json={"token": TOKEN, "referenceCode": "REF1"}, headers=HEADERS
    )

    assert response.status_code == 502
    assert response.json() == {"code": "flex-unreachable", "detail": "Interactive Brokers could not be reached."}


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/flex/send-request", {"token": TOKEN}),
        ("/flex/send-request", {"token": "", "queryId": "42"}),
        ("/flex/send-request", {"token": TOKEN, "queryId": 42}),
        ("/flex/get-statement", {"token": TOKEN, "referenceCode": ""}),
    ],
)
def test_an_incomplete_body_is_a_422_and_never_reaches_ib(path, body):
    recorder = Recorder()

    response = client_with(recorder).post(path, json=body, headers=HEADERS)

    assert response.status_code == 422
    assert recorder.calls == []


@pytest.mark.parametrize("headers", [{}, {"Origin": "https://evil.example"}])
@pytest.mark.parametrize("path", ["/flex/send-request", "/flex/get-statement"])
def test_an_absent_or_unknown_origin_is_refused_before_reaching_ib(path, headers):
    recorder = Recorder()

    response = client_with(recorder).post(path, json={"token": TOKEN, "queryId": "42", "referenceCode": "R"}, headers=headers)

    assert response.status_code == 403
    assert response.json() == {"code": "origin-refused"}
    assert recorder.calls == []


def test_the_token_appears_in_no_log_record(caplog):
    # A real httpx.AsyncClient on a MockTransport: httpx and httpcore really emit their
    # records, so this bites if flex.py stops holding their loggers at WARNING.
    transport = httpx.MockTransport(lambda request: httpx.Response(200, content=b"<x/>", headers={"content-type": "text/xml"}))

    async def caller(endpoint, params):
        return await call_flex(endpoint, params, transport=transport)

    with caplog.at_level(logging.DEBUG):
        response = client_with(caller).post("/flex/send-request", json={"token": TOKEN, "queryId": "42"}, headers=HEADERS)

    assert response.status_code == 200
    assert TOKEN not in caplog.text
    for record in caplog.records:
        assert TOKEN not in str(record.args)
