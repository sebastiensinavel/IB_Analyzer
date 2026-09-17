from __future__ import annotations

from ib_tws_agent.config import Config
from tests.conftest import ORIGIN, FakeIB

PREFLIGHT = {"Origin": ORIGIN, "Access-Control-Request-Method": "GET", "Access-Control-Request-Private-Network": "true"}


def test_allowed_origin_is_echoed_with_vary(make_client):
    response = make_client().get("/health", headers={"Origin": ORIGIN})

    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] == ORIGIN
    assert response.headers["Vary"] == "Origin"


def test_unknown_origin_gets_a_normal_answer_without_allow_origin(make_client):
    response = make_client().get("/health", headers={"Origin": "https://evil.example"})

    assert response.status_code == 200
    assert "Access-Control-Allow-Origin" not in response.headers


def test_no_origin_header_means_no_cors_headers(make_client):
    response = make_client().get("/health")

    assert response.status_code == 200
    assert "Access-Control-Allow-Origin" not in response.headers


def test_preflight_for_an_allowed_origin_allows_get_post_json_and_the_private_network(make_client):
    response = make_client().options("/flex/send-request", headers={**PREFLIGHT, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"})

    assert response.status_code == 204
    assert response.headers["Access-Control-Allow-Origin"] == ORIGIN
    assert response.headers["Access-Control-Allow-Methods"] == "GET, POST"
    assert response.headers["Access-Control-Allow-Headers"] == "content-type"
    assert response.headers["Access-Control-Allow-Private-Network"] == "true"
    assert response.headers["Access-Control-Max-Age"] == "600"
    assert "Access-Control-Allow-Credentials" not in response.headers


def test_preflight_for_an_unknown_origin_carries_nothing(make_client):
    response = make_client().options("/snapshot", headers={**PREFLIGHT, "Origin": "https://evil.example"})

    assert response.status_code == 204
    assert "Access-Control-Allow-Origin" not in response.headers
    assert "Access-Control-Allow-Private-Network" not in response.headers
    assert "Access-Control-Allow-Methods" not in response.headers
    assert "Access-Control-Allow-Headers" not in response.headers


def test_every_configured_origin_is_allowed(make_client):
    config = Config(origins=(ORIGIN, "http://localhost:5173"), listen=8100)

    response = make_client(config=config).get("/health", headers={"Origin": "http://localhost:5173"})

    assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"


# Fix 2 of the whole-branch review: unlike /health, /snapshot may open a TWS connection, so an
# absent or unknown Origin must refuse before the handler runs, not merely omit a header the
# browser is trusted to check. An <img> load or a same-origin-by-DNS-rebinding page sends no
# Origin header at all, so "present and unknown" is not the right test - "present and allowed"
# is.
def test_snapshot_without_an_origin_is_refused_before_touching_tws(make_client):
    fake_ib = FakeIB()

    response = make_client(fake_ib).get("/snapshot", params={"port": 7502})

    assert response.status_code == 403
    assert response.json() == {"code": "origin-refused"}
    assert fake_ib.connected_to is None


def test_snapshot_with_an_unknown_origin_is_refused_before_touching_tws(make_client):
    fake_ib = FakeIB()

    response = make_client(fake_ib).get("/snapshot", params={"port": 7502}, headers={"Origin": "https://evil.example"})

    assert response.status_code == 403
    assert response.json() == {"code": "origin-refused"}
    assert fake_ib.connected_to is None


def test_health_stays_open_with_no_origin_and_with_an_unknown_one(make_client):
    assert make_client().get("/health").status_code == 200
    assert make_client().get("/health", headers={"Origin": "https://evil.example"}).status_code == 200
