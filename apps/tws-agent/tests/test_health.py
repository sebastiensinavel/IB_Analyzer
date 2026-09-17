from __future__ import annotations

import re

from tests.conftest import FakeIB


def test_health_gives_the_package_version(make_client):
    response = make_client().get("/health")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"version"}
    assert re.fullmatch(r"\d+\.\d+\.\d+", body["version"])


def test_health_never_touches_tws(make_client):
    fake_ib = FakeIB(connect_error=RuntimeError("must not connect"))

    response = make_client(fake_ib).get("/health")

    assert response.status_code == 200
    assert fake_ib.connected_to is None
