import httpx
import pytest
import respx
from django.test import Client

from ib.flex import FLEX_BASE

SEND = "/api/ib/flex/send-request"
GET = "/api/ib/flex/get-statement"

SUCCESS_XML = (
    b'<?xml version="1.0" encoding="UTF-8"?>'
    b"<FlexStatementResponse timestamp='04 September, 2026 08:00 AM EDT'>"
    b"<Status>Success</Status><ReferenceCode>1234567890</ReferenceCode>"
    b"<Url>https://ndcdyn.interactivebrokers.com/x</Url></FlexStatementResponse>"
)
FAIL_XML = (
    b'<?xml version="1.0" encoding="UTF-8"?>'
    b"<FlexStatementResponse><Status>Fail</Status><ErrorCode>1019</ErrorCode>"
    b"<ErrorMessage>Statement generation in progress.</ErrorMessage></FlexStatementResponse>"
)


@pytest.mark.django_db
def test_send_request_needs_a_session(client):
    response = client.post(SEND, data={"token": "t", "queryId": "q"}, content_type="application/json")
    assert response.status_code == 401


@pytest.mark.django_db
def test_get_statement_needs_a_session(client):
    response = client.post(GET, data={"token": "t", "referenceCode": "r"}, content_type="application/json")
    assert response.status_code == 401


@pytest.mark.django_db
@respx.mock
def test_send_request_passes_the_body_through_byte_for_byte(auth_client):
    route = respx.get(f"{FLEX_BASE}/SendRequest").mock(
        return_value=httpx.Response(200, content=SUCCESS_XML, headers={"content-type": "text/xml"})
    )
    response = auth_client.post(
        SEND, data={"token": "tok", "queryId": "123"}, content_type="application/json"
    )
    assert response.status_code == 200
    assert response.content == SUCCESS_XML
    assert response["content-type"].startswith("text/xml")
    assert dict(route.calls.last.request.url.params) == {"t": "tok", "q": "123", "v": "3"}


@pytest.mark.django_db
@respx.mock
def test_an_ib_failure_is_passed_through_untouched_not_translated(auth_client):
    respx.get(f"{FLEX_BASE}/GetStatement").mock(
        return_value=httpx.Response(200, content=FAIL_XML, headers={"content-type": "text/xml"})
    )
    response = auth_client.post(
        GET, data={"token": "tok", "referenceCode": "ref"}, content_type="application/json"
    )
    assert response.status_code == 200
    assert response.content == FAIL_XML


@pytest.mark.django_db
@respx.mock
def test_a_timeout_becomes_504_and_never_reveals_an_upstream_body(auth_client):
    respx.get(f"{FLEX_BASE}/SendRequest").mock(side_effect=httpx.ReadTimeout("too slow"))
    response = auth_client.post(SEND, data={"token": "tok", "queryId": "1"}, content_type="application/json")
    assert response.status_code == 504
    assert response.json() == {"code": "flex-timeout", "detail": "Interactive Brokers did not answer in time."}


@pytest.mark.django_db
@respx.mock
def test_an_unreachable_ib_becomes_502(auth_client):
    respx.get(f"{FLEX_BASE}/SendRequest").mock(side_effect=httpx.ConnectError("nope"))
    response = auth_client.post(SEND, data={"token": "tok", "queryId": "1"}, content_type="application/json")
    assert response.status_code == 502
    assert response.json()["code"] == "flex-unreachable"


@pytest.mark.django_db
@respx.mock
def test_the_token_never_travels_in_our_own_url(auth_client):
    respx.get(f"{FLEX_BASE}/SendRequest").mock(
        return_value=httpx.Response(200, content=SUCCESS_XML, headers={"content-type": "text/xml"})
    )
    response = auth_client.post(SEND, data={"token": "s3cr3t", "queryId": "1"}, content_type="application/json")
    assert response.status_code == 200
    assert "s3cr3t" not in response.request["PATH_INFO"]
    assert "s3cr3t" not in response.request.get("QUERY_STRING", "")


@pytest.mark.django_db
@respx.mock
def test_send_request_without_a_csrf_token_is_refused_and_with_it_succeeds(user):
    # This router carries a real session authenticator (`django_auth`), not
    # `auth=None`: opening it up to CSRF regressions is exactly the risk this
    # test guards, unlike task 5's `accept_invitation`, which checks CSRF by
    # hand because it has no authenticator to rely on. The `client`/`auth_client`
    # fixtures the rest of this file uses have `enforce_csrf_checks=False` and
    # would never observe a CSRF failure, so a real check needs a client built
    # with `enforce_csrf_checks=True` (same pattern as
    # test_invitations.py::test_accepting_without_a_csrf_token_is_refused_and_with_it_succeeds).
    # Only `send-request` is covered: both endpoints share the same
    # `Router(auth=django_auth)`, so the same auth callback runs the same CSRF
    # check on `get-statement` too — there is nothing endpoint-specific to
    # this mechanism to re-prove.
    respx.get(f"{FLEX_BASE}/SendRequest").mock(
        return_value=httpx.Response(200, content=SUCCESS_XML, headers={"content-type": "text/xml"})
    )
    csrf_client = Client(enforce_csrf_checks=True)
    csrf_client.force_login(user)
    csrf_client.get("/api/csrf")
    token = csrf_client.cookies["csrftoken"].value

    without_token = csrf_client.post(SEND, data={"token": "tok", "queryId": "1"}, content_type="application/json")
    assert without_token.status_code == 403

    with_token = csrf_client.post(
        SEND,
        data={"token": "tok", "queryId": "1"},
        content_type="application/json",
        HTTP_X_CSRFTOKEN=token,
    )
    assert with_token.status_code == 200
