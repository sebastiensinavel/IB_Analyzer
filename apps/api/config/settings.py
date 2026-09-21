"""Django settings. Secrets come from the environment; nothing is committed."""
import os
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured

from config.devkey import read_or_create_dev_secret

BASE_DIR = Path(__file__).resolve().parent.parent

DEV_SECRET_KEY = "dev-only-not-for-production"
DEBUG = os.environ.get("DJANGO_DEBUG", "0") == "1"
REPO_ROOT = BASE_DIR.parent.parent

# A forgotten DJANGO_SECRET_KEY in the VPS .env would otherwise start production on a key
# that is committed in this repository, and therefore public: session cookies and CSRF
# tokens forgeable by anyone who can read the code. Refusing to boot is the only safe
# failure here — a silent fallback is exactly what makes this class of bug survive.
#
# In DEBUG the key comes from the checkout's own git directory instead (config/devkey.py),
# so that every way of starting a dev server — `pnpm dev:api`, `pnpm dev:start`, a bare
# `manage.py runserver` — agrees on one key and stops invalidating each other's sessions.
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if not DEBUG:
        raise ImproperlyConfigured("DJANGO_SECRET_KEY must be set outside DEBUG")
    SECRET_KEY = read_or_create_dev_secret(REPO_ROOT)

ALLOWED_HOSTS = [h for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if h]
CSRF_TRUSTED_ORIGINS = [o for o in os.environ.get("DJANGO_CSRF_TRUSTED_ORIGINS", "").split(",") if o]

# Used to build invitation links in the admin. The real value lives in the
# VPS .env: no domain name is ever committed.
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "http://localhost:5173")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # No models, no urls: registered only so `export_openapi_schema` (a
    # management command that ships inside the package) is discoverable.
    "ninja",
    "allauth",
    "allauth.account",
    "allauth.headless",
    "allauth.mfa",
    "core",
    "ib",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "allauth.account.middleware.AccountMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {
    "default": dj_database_url.parse(
        os.environ.get("DATABASE_URL", "postgres://ib:ib@127.0.0.1:5432/ib_analyzer"),
        conn_max_age=600,
    )
}

# Flex throttling (spec §3.2, ib/throttling.py) needs one counter per user
# shared by every process answering requests - task 8 runs gunicorn with
# several workers. Django's own per-process default (`LocMemCache`) would
# give each worker its own counter, silently multiplying the effective rate
# limit by worker count. Redis is off the table until a background task needs
# it (spec §13); PostgreSQL is already there, so the shared cache rides on
# it. The table is created by core's `0003_cache_table` migration.
CACHES = {
    "default": {
        "BACKEND": os.environ.get("DJANGO_CACHE_BACKEND", "django.core.cache.backends.db.DatabaseCache"),
        "LOCATION": os.environ.get("DJANGO_CACHE_LOCATION", "django_cache"),
    }
}

AUTH_USER_MODEL = "core.User"
AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
    "allauth.account.auth_backends.AuthenticationBackend",
]
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# allauth: closed signup, email as the login identifier, optional TOTP.
# Setting names move between allauth majors: confirm every one of these in the
# docs of the version pinned in pyproject.toml before trusting this block.
ACCOUNT_ADAPTER = "core.adapters.AccountAdapter"
ACCOUNT_LOGIN_METHODS = {"email"}
ACCOUNT_SIGNUP_FIELDS = ["email*", "password1*"]
ACCOUNT_EMAIL_VERIFICATION = "none"
# core.User has no `username`: without this, allauth's default user display
# (used to serialize the headless session response) crashes looking one up.
ACCOUNT_USER_MODEL_USERNAME_FIELD = None
HEADLESS_ONLY = True
MFA_SUPPORTED_TYPES = ["totp", "recovery_codes"]

EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Request and response bodies are never logged: the Flex token travels in them.
# It also travels in the *URL* of our outbound call to IB (Flex is a GET API,
# the token is a query parameter) - httpx logs that full URL at INFO and
# httpcore repeats it at DEBUG, so both loggers are held at WARNING here,
# below either level, regardless of DJANGO_LOG_LEVEL.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": os.environ.get("DJANGO_LOG_LEVEL", "INFO")},
    "loggers": {
        "httpx": {"level": "WARNING"},
        "httpcore": {"level": "WARNING"},
    },
}
