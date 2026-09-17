import httpx
import pytest
import respx
from django.core.cache import cache
from ninja.throttling import SimpleRateThrottle

from ib.flex import FLEX_BASE

SEND = "/api/ib/flex/send-request"
GET = "/api/ib/flex/get-statement"
OK = httpx.Response(200, content=b"<FlexStatementResponse/>", headers={"content-type": "text/xml"})


@pytest.fixture(autouse=True)
def clear_throttle_state():
    cache.clear()
    yield
    cache.clear()


@pytest.mark.django_db
@respx.mock
def test_an_eleventh_call_in_the_same_minute_is_throttled(auth_client, monkeypatch):
    respx.get(f"{FLEX_BASE}/SendRequest").mock(return_value=OK)
    # Neutralise the 1/s burst rule so this test only exercises the 10/min one.
    monkeypatch.setattr("ib.throttling.FlexBurstThrottle.allow_request", lambda self, request: True)

    for index in range(10):
        response = auth_client.post(
            SEND, data={"token": "t", "queryId": str(index)}, content_type="application/json"
        )
        assert response.status_code == 200, f"call {index} should have gone through"

    response = auth_client.post(SEND, data={"token": "t", "queryId": "11"}, content_type="application/json")
    assert response.status_code == 429
    assert response.has_header("Retry-After")


@pytest.mark.django_db
@respx.mock
def test_two_calls_in_the_same_second_are_throttled(auth_client):
    respx.get(f"{FLEX_BASE}/SendRequest").mock(return_value=OK)
    first = auth_client.post(SEND, data={"token": "t", "queryId": "1"}, content_type="application/json")
    second = auth_client.post(SEND, data={"token": "t", "queryId": "2"}, content_type="application/json")
    assert first.status_code == 200
    assert second.status_code == 429


# The browser's polling schedule, mirrored from `apps/web/src/flex/sync.ts`.
# Keep these three numbers in step with the constants there: they are the
# contract between the client's loop and this server's throttle, and nothing
# else checks it — `sync.test.ts` calls mocks and `e2e/sync.spec.ts` intercepts
# the routes inside the browser, so neither ever reaches this router.
SEND_TO_FIRST_GET_S = 1.5
POLL_INTERVAL_S = 7.0
MAX_GET_STATEMENT_CALLS = 12


@pytest.mark.django_db
@respx.mock
def test_the_browser_polling_schedule_never_trips_our_own_throttle(auth_client, monkeypatch):
    """Replay the exact call sequence `syncAccount` makes, against the real router."""
    respx.get(f"{FLEX_BASE}/SendRequest").mock(return_value=OK)
    respx.get(f"{FLEX_BASE}/GetStatement").mock(return_value=OK)
    start = 1_000_000.0
    clock = [start]
    monkeypatch.setattr(SimpleRateThrottle, "timer", staticmethod(lambda: clock[0]))

    schedule = [(SEND, 0.0, {"token": "t", "queryId": "1"})]
    schedule += [
        (GET, SEND_TO_FIRST_GET_S + POLL_INTERVAL_S * k, {"token": "t", "referenceCode": "REF"})
        for k in range(MAX_GET_STATEMENT_CALLS)
    ]
    for url, offset, body in schedule:
        clock[0] = start + offset
        response = auth_client.post(url, data=body, content_type="application/json")
        assert response.status_code == 200, f"{url} at t={offset}s was refused with {response.status_code}"
