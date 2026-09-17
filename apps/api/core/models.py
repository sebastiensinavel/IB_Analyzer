import secrets
from datetime import timedelta

from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.db import models
from django.utils import timezone

from core.managers import UserManager


class User(AbstractBaseUser, PermissionsMixin):
    """Nothing about a portfolio ever hangs off this model."""

    email = models.EmailField(unique=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    def __str__(self):
        return self.email


INVITATION_LIFETIME = timedelta(days=14)


def new_invitation_token():
    return secrets.token_urlsafe(32)


def default_invitation_expiry():
    return timezone.now() + INVITATION_LIFETIME


class Invitation(models.Model):
    """One-shot ticket to create an account. Signup is closed otherwise."""

    token = models.CharField(max_length=64, unique=True, default=new_invitation_token, editable=False)
    email = models.EmailField()
    created_by = models.ForeignKey(
        "core.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(default=default_invitation_expiry)
    accepted_at = models.DateTimeField(null=True, blank=True)
    accepted_user = models.OneToOneField(
        "core.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="invitation"
    )

    class Meta:
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.email} ({'used' if self.accepted_at else 'open'})"

    @classmethod
    def issue(cls, *, email, created_by=None):
        return cls.objects.create(email=UserManager.normalize_email(email), created_by=created_by)

    @property
    def is_usable(self):
        return self.accepted_at is None and self.expires_at > timezone.now()

    def link(self, base_url):
        return f"{base_url.rstrip('/')}/invitation/{self.token}"
