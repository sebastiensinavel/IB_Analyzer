import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError

User = get_user_model()


@pytest.mark.django_db
def test_user_is_identified_by_email_and_has_no_username():
    user = User.objects.create_user(email="a@example.com", password="correct-horse-battery")
    assert user.email == "a@example.com"
    assert User.USERNAME_FIELD == "email"
    assert not hasattr(user, "username")
    assert user.check_password("correct-horse-battery")


@pytest.mark.django_db
def test_the_domain_part_is_normalised_and_the_email_is_unique():
    User.objects.create_user(email="A@Example.COM", password="correct-horse-battery")
    assert User.objects.get().email == "A@example.com"
    with pytest.raises(IntegrityError):
        User.objects.create_user(email="A@example.com", password="another-long-password")


@pytest.mark.django_db
def test_a_user_without_an_email_is_refused():
    with pytest.raises(ValueError):
        User.objects.create_user(email="", password="correct-horse-battery")


@pytest.mark.django_db
def test_superuser_gets_both_flags():
    admin = User.objects.create_superuser(email="root@example.com", password="correct-horse-battery")
    assert admin.is_staff and admin.is_superuser
