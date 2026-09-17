import threading
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.db import connection
from django.test import Client
from django.utils import timezone

from core.models import Invitation

User = get_user_model()


@pytest.mark.django_db
def test_issue_makes_a_usable_invitation_with_an_unguessable_token():
    admin = User.objects.create_superuser(email="root@example.com", password="correct-horse-battery")
    first = Invitation.issue(email="a@example.com", created_by=admin)
    second = Invitation.issue(email="b@example.com", created_by=admin)
    assert first.is_usable
    assert len(first.token) >= 32
    assert first.token != second.token


@pytest.mark.django_db
def test_an_expired_invitation_is_not_usable():
    invitation = Invitation.issue(email="a@example.com")
    invitation.expires_at = timezone.now() - timedelta(seconds=1)
    invitation.save()
    assert not invitation.is_usable


@pytest.mark.django_db
def test_an_accepted_invitation_is_not_usable():
    invitation = Invitation.issue(email="a@example.com")
    invitation.accepted_at = timezone.now()
    invitation.accepted_user = User.objects.create_user(email="a@example.com", password="correct-horse-battery")
    invitation.save()
    assert not invitation.is_usable


@pytest.mark.django_db
def test_link_points_at_the_spa_route_and_carries_the_token():
    invitation = Invitation.issue(email="a@example.com")
    assert invitation.link("https://example.test/") == f"https://example.test/invitation/{invitation.token}"


ACCEPT = "/api/core/invitations/accept"
PASSWORD = "correct-horse-battery"


@pytest.mark.django_db
def test_accepting_creates_the_user_and_opens_the_session(client):
    invitation = Invitation.issue(email="a@example.com")
    response = client.post(
        ACCEPT, data={"token": invitation.token, "password": PASSWORD}, content_type="application/json"
    )
    assert response.status_code == 200
    assert response.json()["email"] == "a@example.com"
    user = User.objects.get(email="a@example.com")
    assert user.check_password(PASSWORD)
    invitation.refresh_from_db()
    assert invitation.accepted_user == user and invitation.accepted_at is not None
    # The session is open: the allauth session endpoint now answers.
    assert client.get("/_allauth/browser/v1/auth/session").status_code == 200


@pytest.mark.django_db
def test_accepting_lets_the_user_activate_totp_right_away(client):
    # allauth gates TOTP activation (and recovery codes, WebAuthn, email/phone management)
    # behind its own `reauthentication_required` decorator, which reads a "recently
    # authenticated" record that only allauth's *own* login flow writes — never Django's raw
    # `login()`, which is what `accept_invitation` calls. Without recording it too, a freshly
    # invited user hits an unimplemented "please reauthenticate" wall the very first time they
    # try to turn 2FA on (constaté by apps/web's task-20 e2e test).
    from allauth.mfa.totp.internal.auth import format_hotp_value, hotp_value, yield_hotp_counters_from_time

    invitation = Invitation.issue(email="a@example.com")
    accept = client.post(
        ACCEPT, data={"token": invitation.token, "password": PASSWORD}, content_type="application/json"
    )
    assert accept.status_code == 200

    status = client.get("/_allauth/browser/v1/account/authenticators/totp")
    assert status.status_code == 404  # not configured yet — the body carries a fresh secret
    secret = status.json()["meta"]["secret"]
    code = format_hotp_value(hotp_value(secret, next(yield_hotp_counters_from_time())))

    activate = client.post(
        "/_allauth/browser/v1/account/authenticators/totp",
        data={"code": code},
        content_type="application/json",
    )
    assert activate.status_code == 200


@pytest.mark.django_db
@pytest.mark.parametrize("case", ["unknown", "expired", "accepted"])
def test_unknown_expired_and_accepted_tokens_are_indistinguishable(client, case):
    if case == "unknown":
        token = "not-a-real-token"
    else:
        invitation = Invitation.issue(email="a@example.com")
        token = invitation.token
        if case == "expired":
            invitation.expires_at = timezone.now() - timedelta(seconds=1)
        else:
            invitation.accepted_at = timezone.now()
        invitation.save()

    response = client.post(ACCEPT, data={"token": token, "password": PASSWORD}, content_type="application/json")
    assert response.status_code == 400
    assert response.json() == {"code": "invitation-invalid", "detail": "This invitation cannot be used."}


@pytest.mark.django_db
def test_a_weak_password_is_refused_and_creates_nothing(client):
    invitation = Invitation.issue(email="a@example.com")
    response = client.post(ACCEPT, data={"token": invitation.token, "password": "1234"}, content_type="application/json")
    assert response.status_code == 400
    assert response.json()["code"] == "password-invalid"
    assert not User.objects.filter(email="a@example.com").exists()
    invitation.refresh_from_db()
    assert invitation.is_usable


@pytest.mark.django_db
def test_accepting_without_a_csrf_token_is_refused_and_with_it_succeeds():
    # This endpoint creates an account and opens a session: exactly what CSRF
    # protects. The default test `client` fixture never enforces CSRF, so it
    # would prove nothing here — a real check needs enforce_csrf_checks=True.
    csrf_client = Client(enforce_csrf_checks=True)
    invitation = Invitation.issue(email="a@example.com")

    # Prime the cookie the way the SPA does at boot.
    csrf_client.get("/api/csrf")
    token = csrf_client.cookies["csrftoken"].value

    without_token = csrf_client.post(
        ACCEPT, data={"token": invitation.token, "password": PASSWORD}, content_type="application/json"
    )
    assert without_token.status_code == 403
    assert not User.objects.filter(email="a@example.com").exists()

    with_token = csrf_client.post(
        ACCEPT,
        data={"token": invitation.token, "password": PASSWORD},
        content_type="application/json",
        HTTP_X_CSRFTOKEN=token,
    )
    assert with_token.status_code == 200


@pytest.mark.django_db(transaction=True)
def test_only_one_of_two_concurrent_accepts_wins():
    # `select_for_update()` inside accept_invitation must make the second of
    # two racing clicks on the same link a no-op. Two real threads, released
    # together by a barrier, are the only way to make that observable: a
    # sequential test cannot exercise the row lock at all.
    invitation = Invitation.issue(email="a@example.com")
    barrier = threading.Barrier(2)
    statuses = []
    lock = threading.Lock()

    def accept():
        barrier.wait(timeout=5)
        try:
            response = Client().post(
                ACCEPT, data={"token": invitation.token, "password": PASSWORD}, content_type="application/json"
            )
            with lock:
                statuses.append(response.status_code)
        finally:
            connection.close()

    threads = [threading.Thread(target=accept) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)

    assert sorted(statuses) == [200, 400]
    assert User.objects.filter(email="a@example.com").count() == 1
    invitation.refresh_from_db()
    assert invitation.accepted_at is not None
