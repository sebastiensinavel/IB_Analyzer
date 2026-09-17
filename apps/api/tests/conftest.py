import pytest
from django.contrib.auth import get_user_model

ALLAUTH = "/_allauth/browser/v1"
PASSWORD = "correct-horse-battery"


@pytest.fixture
def user(db):
    return get_user_model().objects.create_user(email="a@example.com", password=PASSWORD)


@pytest.fixture
def auth_client(client, user):
    client.force_login(user)
    return client
