# Headless endpoint map, django-allauth 65.19.2 (pinned range: django-allauth[mfa]>=65).
#
# Confirmed two ways: reading
# .venv/lib/python3.14/site-packages/allauth/headless/{urls,account/urls,base/urls,mfa/urls}.py
# for this exact version, then walking the live URL resolver with
# HEADLESS_ONLY=True and MFA_SUPPORTED_TYPES=["totp", "recovery_codes"] as set in
# config/settings.py. Base path for the browser client: /_allauth/browser/v1
# (an equivalent app client tree is mounted at /_allauth/app/v1 for native apps;
# apps/web talks to the browser tree exclusively).
#
# | Usage                                | Method + path                                          |
# |---------------------------------------|--------------------------------------------------------|
# | Current session (who am I / logout)   | GET/DELETE /_allauth/browser/v1/auth/session            |
# | Login                                  | POST       /_allauth/browser/v1/auth/login              |
# | Signup (closed, kept for completeness) | POST       /_allauth/browser/v1/auth/signup             |
# | Second factor: submit code at login    | POST       /_allauth/browser/v1/auth/2fa/authenticate   |
# | Second factor: reauthenticate          | POST       /_allauth/browser/v1/auth/2fa/reauthenticate |
# | List configured authenticators         | GET        /_allauth/browser/v1/account/authenticators  |
# | Manage TOTP authenticator              | GET/POST/DELETE /_allauth/browser/v1/account/authenticators/totp |
# | Manage recovery codes                  | GET/POST   /_allauth/browser/v1/account/authenticators/recovery-codes |
#
# GET on the TOTP endpoint returns 404 with a JSON body (meta.secret, meta.totp_url)
# when no TOTP authenticator is configured yet: that 404 is allauth answering "not set
# up", distinct from a Django routing 404, which carries no JSON at all.
import time

import pytest
from django.contrib.auth import get_user_model
from django.test import Client

from allauth.mfa.internal.constants import LoginStageKey
from allauth.mfa.totp.internal.auth import format_hotp_value, hotp_value
from allauth.mfa import app_settings as mfa_app_settings

from tests.conftest import ALLAUTH, PASSWORD


@pytest.mark.django_db
def test_session_endpoint_reports_no_session_when_anonymous(client):
    response = client.get(f"{ALLAUTH}/auth/session")
    assert response.status_code == 401
    assert response.json()["meta"]["is_authenticated"] is False


@pytest.mark.django_db
def test_session_endpoint_reports_the_user_when_logged_in(auth_client):
    response = auth_client.get(f"{ALLAUTH}/auth/session")
    assert response.status_code == 200
    assert response.json()["data"]["user"]["email"] == "a@example.com"


@pytest.mark.django_db
def test_signup_is_closed(client):
    response = client.post(
        f"{ALLAUTH}/auth/signup",
        data={"email": "intruder@example.com", "password": "correct-horse-battery"},
        content_type="application/json",
    )
    assert response.status_code == 403
    assert not get_user_model().objects.filter(email="intruder@example.com").exists()


@pytest.mark.django_db
def test_login_without_2fa_authenticates_directly(client, user):
    response = client.post(
        f"{ALLAUTH}/auth/login",
        data={"email": "a@example.com", "password": PASSWORD},
        content_type="application/json",
    )
    assert response.status_code == 200
    assert response.json()["data"]["user"]["email"] == "a@example.com"


@pytest.mark.django_db
def test_totp_authenticator_endpoint_is_mounted_and_reports_not_configured(auth_client):
    response = auth_client.get(f"{ALLAUTH}/account/authenticators/totp")
    # A real allauth "no TOTP yet" answer carries a JSON body with a fresh
    # secret and provisioning URL. A routing failure would be a bare Django
    # 404 with no such body, so asserting on the body distinguishes the two
    # where the brief's content-type-only check could not.
    assert response.status_code == 404
    body = response.json()
    assert "secret" in body["meta"]
    assert "totp_url" in body["meta"]


@pytest.mark.django_db
def test_activating_totp_makes_it_required_at_the_next_login(client, user):
    login = client.post(
        f"{ALLAUTH}/auth/login",
        data={"email": "a@example.com", "password": PASSWORD},
        content_type="application/json",
    )
    assert login.status_code == 200

    setup = client.get(f"{ALLAUTH}/account/authenticators/totp")
    assert setup.status_code == 404
    secret = setup.json()["meta"]["secret"]

    counter = int(time.time()) // mfa_app_settings.TOTP_PERIOD
    code = format_hotp_value(hotp_value(secret, counter))
    activation = client.post(
        f"{ALLAUTH}/account/authenticators/totp",
        data={"code": code},
        content_type="application/json",
    )
    assert activation.status_code == 200

    fresh_client = Client()
    second_login = fresh_client.post(
        f"{ALLAUTH}/auth/login",
        data={"email": "a@example.com", "password": PASSWORD},
        content_type="application/json",
    )
    # Password alone no longer completes authentication: allauth reports an
    # unauthenticated session with a pending mfa_authenticate flow instead of
    # logging the user in.
    assert second_login.status_code == 401
    flows = second_login.json()["data"]["flows"]
    pending = next(f for f in flows if f["id"] == LoginStageKey.MFA_AUTHENTICATE.value)
    assert pending["is_pending"] is True
    assert "totp" in pending["types"]
