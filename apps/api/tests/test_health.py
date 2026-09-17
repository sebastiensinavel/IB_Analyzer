import pytest


@pytest.mark.django_db
def test_health_answers_without_a_session(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.django_db
def test_csrf_endpoint_sets_the_cookie(client):
    response = client.get("/api/csrf")
    assert response.status_code == 200
    assert "csrftoken" in response.cookies
