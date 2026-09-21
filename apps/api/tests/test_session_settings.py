from datetime import timedelta

from django.conf import settings
from django.test import Client
from django.utils import timezone


def test_the_session_is_rolling_and_lasts_a_month():
    assert settings.SESSION_SAVE_EVERY_REQUEST is True
    assert settings.SESSION_COOKIE_AGE == 30 * 24 * 3600


def test_a_request_pushes_the_expiry_back(db, django_user_model):
    user = django_user_model.objects.create_user(email="a@b.c", password="x" * 12)
    client = Client()
    client.force_login(user)

    from django.contrib.sessions.models import Session

    session = Session.objects.get(session_key=client.cookies["sessionid"].value)
    stale = timezone.now() + timedelta(days=1)
    Session.objects.filter(pk=session.pk).update(expire_date=stale)

    client.get("/api/csrf")

    assert Session.objects.get(pk=session.pk).expire_date > stale


def test_the_body_limit_leaves_room_for_a_twenty_megabyte_blob():
    assert settings.DATA_UPLOAD_MAX_MEMORY_SIZE > 20 * 1024 * 1024
