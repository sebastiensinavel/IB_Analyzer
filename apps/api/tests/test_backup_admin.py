import pytest
from django.contrib.auth import get_user_model

from core.models import Backup

pytestmark = pytest.mark.django_db

# A distinctive byte sequence: if it turns up anywhere in a rendered admin page, the
# `blob` field leaked, which is exactly what these tests exist to catch.
MARKER = b"a-very-recognisable-admin-blob-marker"


def staff_client(django_user_model):
    user = django_user_model.objects.create_superuser(email="root@example.com", password="x" * 14)
    from django.test import Client

    client = Client()
    client.force_login(user)
    return client


def make_backup(email="a@example.com", blob=MARKER):
    User = get_user_model()
    user = User.objects.create_user(email=email, password="x" * 14)
    return Backup.objects.create(user=user, blob=blob, bytes=len(blob))


def test_the_list_page_renders_for_a_staff_user(django_user_model):
    make_backup()
    client = staff_client(django_user_model)

    response = client.get("/admin/core/backup/")

    assert response.status_code == 200


def test_the_detail_page_renders_for_a_staff_user(django_user_model):
    backup = make_backup()
    client = staff_client(django_user_model)

    response = client.get(f"/admin/core/backup/{backup.pk}/change/")

    assert response.status_code == 200


def test_the_blob_never_appears_on_the_list_page(django_user_model):
    make_backup()
    client = staff_client(django_user_model)

    response = client.get("/admin/core/backup/")

    assert MARKER not in response.content
    assert MARKER.decode() not in response.content.decode()


def test_the_blob_never_appears_on_the_detail_page(django_user_model):
    backup = make_backup()
    client = staff_client(django_user_model)

    response = client.get(f"/admin/core/backup/{backup.pk}/change/")

    assert MARKER not in response.content
    assert MARKER.decode() not in response.content.decode()


def test_the_add_page_is_refused(django_user_model):
    client = staff_client(django_user_model)

    response = client.get("/admin/core/backup/add/")

    assert response.status_code == 403


def test_deleting_from_the_admin_removes_the_row(django_user_model):
    backup = make_backup()
    client = staff_client(django_user_model)

    response = client.post(
        f"/admin/core/backup/{backup.pk}/delete/",
        data={"post": "yes"},
    )

    assert response.status_code == 302
    assert not Backup.objects.filter(pk=backup.pk).exists()
