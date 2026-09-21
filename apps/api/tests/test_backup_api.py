import logging

import pytest
from django.test import Client

from core.models import MAX_BACKUP_BYTES

pytestmark = pytest.mark.django_db

# NOTE: the task brief writes these routes as `/api/backup` and `/api/backup/status`.
# That is wrong for this codebase: `config/api.py` mounts `core_router` under `/core`
# (`api.add_router("/core", core_router)`), so every core view lives under `/api/core/...`.
# The real routes, used below, are `/api/core/backup` and `/api/core/backup/status`.


def signed_in(django_user_model, email):
    user = django_user_model.objects.create_user(email=email, password="x" * 14)
    client = Client()
    client.force_login(user)
    return client


def test_deposit_then_read_gives_the_same_bytes(django_user_model):
    client = signed_in(django_user_model, "a@b.c")
    blob = bytes(range(256)) * 4

    assert client.post("/api/core/backup", data=blob, content_type="application/octet-stream").status_code == 200
    answer = client.get("/api/core/backup")

    assert answer.status_code == 200
    assert answer.content == blob


def test_a_second_deposit_replaces_the_first(django_user_model):
    client = signed_in(django_user_model, "a@b.c")
    client.post("/api/core/backup", data=b"first", content_type="application/octet-stream")
    client.post("/api/core/backup", data=b"second", content_type="application/octet-stream")

    assert client.get("/api/core/backup").content == b"second"


def test_status_tells_size_and_date_without_downloading(django_user_model):
    client = signed_in(django_user_model, "a@b.c")
    assert client.get("/api/core/backup/status").json() == {"present": False, "updatedAt": None, "bytes": None}

    client.post("/api/core/backup", data=b"12345", content_type="application/octet-stream")
    status = client.get("/api/core/backup/status").json()

    assert status["present"] is True
    assert status["bytes"] == 5
    assert status["updatedAt"]


def test_delete_removes_it(django_user_model):
    client = signed_in(django_user_model, "a@b.c")
    client.post("/api/core/backup", data=b"gone", content_type="application/octet-stream")

    assert client.delete("/api/core/backup").status_code == 200
    assert client.get("/api/core/backup").status_code == 404


def test_over_the_cap_is_refused_cleanly(django_user_model):
    client = signed_in(django_user_model, "a@b.c")
    answer = client.post(
        "/api/core/backup", data=b"x" * (MAX_BACKUP_BYTES + 1), content_type="application/octet-stream"
    )

    assert answer.status_code == 413
    assert answer.json()["code"] == "backup-too-large"
    assert client.get("/api/core/backup").status_code == 404


def test_over_the_cap_leaves_the_existing_backup_intact(django_user_model):
    client = signed_in(django_user_model, "a@b.c")
    original = bytes(range(256)) * 3
    client.post("/api/core/backup", data=original, content_type="application/octet-stream")

    answer = client.post(
        "/api/core/backup", data=b"x" * (MAX_BACKUP_BYTES + 1), content_type="application/octet-stream"
    )

    assert answer.status_code == 413
    kept = client.get("/api/core/backup")
    assert kept.status_code == 200
    assert kept.content == original


def test_one_user_never_reads_or_replaces_another(django_user_model):
    mine = signed_in(django_user_model, "a@b.c")
    theirs = signed_in(django_user_model, "d@e.f")
    mine.post("/api/core/backup", data=b"mine", content_type="application/octet-stream")

    assert theirs.get("/api/core/backup").status_code == 404
    theirs.post("/api/core/backup", data=b"theirs", content_type="application/octet-stream")
    assert mine.get("/api/core/backup").content == b"mine"


def test_anonymous_is_refused(client):
    assert client.get("/api/core/backup").status_code == 401


def test_the_blob_appears_in_no_log_record(django_user_model, caplog):
    client = signed_in(django_user_model, "a@b.c")
    # A distinctive marker: it must not leak into any log record, on deposit or on read.
    marker = b"a-very-recognisable-backup-marker"

    with caplog.at_level(logging.DEBUG):
        deposit = client.post("/api/core/backup", data=marker, content_type="application/octet-stream")
        fetched = client.get("/api/core/backup")

    assert deposit.status_code == 200
    assert fetched.content == marker
    assert marker.decode() not in caplog.text
    for record in caplog.records:
        assert marker.decode() not in str(record.args)
