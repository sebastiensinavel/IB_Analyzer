from __future__ import annotations

from tests.conftest import ORIGIN, FakeIB

# DNS rebinding: a page served from an attacker-controlled domain whose DNS resolves to
# 127.0.0.1 is same-origin as far as the browser is concerned, so it sends no Origin header at
# all and OriginMiddleware never even sees it. Only a Host check stops this (Fix 1 of the
# whole-branch review).
EVIL_HOST = {"Host": "evil.example"}


def test_health_with_a_spoofed_host_is_refused(make_client):
    response = make_client().get("/health", headers=EVIL_HOST)

    assert response.status_code == 400


def test_snapshot_with_a_spoofed_host_is_refused_before_touching_tws(make_client):
    fake_ib = FakeIB()

    response = make_client(fake_ib).get(
        "/snapshot", params={"port": 7502}, headers={**EVIL_HOST, "Origin": ORIGIN}
    )

    assert response.status_code == 400
    assert fake_ib.connected_to is None


def test_health_still_answers_for_both_allowed_hosts(make_client):
    assert make_client().get("/health", headers={"Host": "127.0.0.1"}).status_code == 200
    assert make_client().get("/health", headers={"Host": "localhost"}).status_code == 200
