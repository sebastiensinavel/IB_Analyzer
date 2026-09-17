# Sous-projet 3 — Serveur Django, invitations, proxy Flex, VPS : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un utilisateur invité crée son compte sur un site en HTTPS, s'y connecte, saisit son jeton Flex, et l'application synchronise transactions et positions toute seule à l'ouverture d'un compte — sans que le serveur voie jamais une donnée de portefeuille.

**Architecture:** `apps/api` est un Django mince en deux apps : `core` (utilisateur, invitations — socle réutilisable) et `ib` (proxy Flex — spécifique). `django-allauth` headless fournit session, connexion et 2FA sous `/_allauth/browser/v1/` ; Django Ninja ne porte que trois endpoints (`/api/health`, l'acceptation d'invitation, les deux relais Flex). Le proxy est un **passe-plat intégral** : le XML d'IB ressort octet pour octet, le navigateur le parse. Côté navigateur, la base IndexedDB devient un profil par utilisateur, un module `flex/sync.ts` porte la boucle de reprise du protocole Flex, et **aucune route n'est protégée** : la connexion n'est exigée que pour appeler le proxy.

**Tech Stack:** Django LTS + Django Ninja + django-allauth (headless, mfa) + psycopg + gunicorn + WhiteNoise + httpx, uv et pytest / pytest-django / respx côté Python. Node 22, pnpm, TypeScript 6, Vitest 4, React 19, react-router 8, Dexie 4, `openapi-typescript` + `openapi-fetch`, Playwright. Docker, Docker Compose, Traefik, PostgreSQL.

**Spec:** `docs/specs/2026-09-04-serveur-django-design.md` (lire aussi `docs/specs/2026-09-03-architecture-design.md` §3.2, §5, §7, §9, §10, §11 et `CLAUDE.md`).

## Global Constraints

- **Le serveur ne voit jamais** transactions, positions ni jetons Flex, sauf le jeton en transit par le proxy, **jamais journalisé**. Aucun modèle, aucune table, aucune migration de portefeuille : une tâche qui semble en réclamer un est un **signal d'arrêt**, pas un travail à faire.
- **La connexion n'est jamais exigée pour utiliser l'application.** Elle est exigée pour le proxy Flex, et rien d'autre. Aucune route du SPA n'est protégée. Un serveur injoignable grise la synchro et n'affiche jamais d'erreur en travers de l'application.
- **Le nom de domaine n'entre dans aucun fichier versionné.** Spec, Compose, docs et `.env.example` parlent de `<domaine>` ; la valeur réelle vit dans le `.env` du VPS. Le sous-domaine porte des tirets, jamais d'underscore.
- **`pnpm check` ne lance jamais de Python.** La fraîcheur `openapi.json` ↔ Django est vérifiée par pytest ; la fraîcheur `schema.d.ts` ↔ `openapi.json` par `pnpm check`. Les tests Python se lancent par `pnpm test:api`.
- **Comptes jamais combinés** : toute clé IndexedDB et toute route reste scopée par `accountId`. La table `sectors` reste la seule exception voulue (une table par utilisateur).
- **Une valeur absente reste `null`**, jamais `0`, et s'affiche « — ».
- Attentes du protocole Flex, valeurs exactes (spec fondateur §3.2) : **5 s** sur les codes `1009` et `1019`, **10 s** sur `1018`. Limites IB : **10 requêtes par minute et 1 par seconde**.
- **Péremption de synchro : 12 heures**, constante nommée `FLEX_SYNC_STALE_MS` dans `apps/web`.
- shadcn ici est **base-ui**, pas Radix : `render={<X />}` au lieu de `asChild`, `onValueChange` typé `T | null`. Un lien stylé en bouton est un `<Link className={buttonVariants(...)}>`.
- Code et commentaires en anglais ; documentation, i18n et messages de commit en français.
- **Un test doit échouer si le comportement change**, pas seulement couvrir des lignes. `apps/web` teste sur `fake-indexeddb` avec une base semée, jamais en moquant les hooks. `apps/api` teste avec `respx` pour IB, jamais avec un vrai appel réseau.
- Dans `packages/ui`, après `pnpm dlx shadcn@latest add`, réécrire les imports `@/` du fichier généré en relatifs.
- Chaque commit se termine par les deux lignes :
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BKvgbeADs9RiENgGzvBrKu
  ```
- Le travail se fait dans un worktree `.claude/worktrees/serveur-django` (skill `superpowers:using-git-worktrees`), branche `serveur-django`, mergé sur `main` après revue.
- **Les cases de ce plan se cochent dans le worktree au fur et à mesure, dans le même commit que la tâche.**

---

## Structure des fichiers

```
pyproject.toml                            workspace uv racine : apps/api, tools/coverage-oracle
package.json                              + scripts "test:api", "gen:api", "check:api-types"
scripts/check-api-types.mjs               garde de dérive schema.d.ts (Node pur, jamais Python)

apps/api/
  pyproject.toml                          projet uv "ib-analyzer-api"
  manage.py
  pytest.ini                              DJANGO_SETTINGS_MODULE, --reuse-db
  openapi.json                            committé, fraîcheur vérifiée par pytest
  Dockerfile
  README.md                               versions retenues, commandes
  config/
    __init__.py
    settings.py                           ~130 lignes, secrets par variables d'environnement
    urls.py                               /api (Ninja), /_allauth, /admin
    api.py                                l'instance NinjaAPI et ses routeurs
    wsgi.py
  core/
    __init__.py, apps.py
    models.py                             User, Invitation
    managers.py                           UserManager sans username
    adapters.py                           AccountAdapter : inscription fermée
    admin.py                              UserAdmin, InvitationAdmin (affiche le lien)
    schemas.py                            AcceptInvitationIn, SessionUserOut, ErrorOut
    api.py                                POST /core/invitations/accept
    migrations/0001_initial.py
  ib/
    __init__.py, apps.py
    flex.py                               appel sortant httpx, aucune lecture du corps
    schemas.py                            SendRequestIn, GetStatementIn
    api.py                                POST /ib/flex/send-request, /ib/flex/get-statement
    throttling.py                         FlexBurstThrottle (1/s), FlexRateThrottle (10/min)
  tests/
    conftest.py                           fixtures : user, invitation, client connecté
    test_health.py, test_user.py, test_invitations.py
    test_allauth_wiring.py, test_openapi_freshness.py
    test_flex_proxy.py, test_flex_throttling.py, test_flex_no_logging.py

apps/web/
  Dockerfile                              build Vite -> nginx alpine
  nginx.conf                              repli SPA sur index.html
  src/api/
    schema.d.ts                           généré, committé
    client.ts                             openapi-fetch typé + jeton CSRF
    allauth.ts                            appels /_allauth/browser/v1 (session, login, logout, 2FA)
    session.tsx                           SessionProvider, useSession(), type SessionState
  src/db/
    schema.ts                             + champs Flex sur AccountRecord, version 3
    profile.ts                            profileDbName, profileDb, adoptDefaultProfile
    DbProvider.tsx                        contexte + useDb()
    importLock.ts                         withImportLock : flux unique
    importFile.ts                          lecture de l'état dans la transaction
    hooks.ts                              useDb() au lieu du singleton importé
  src/flex/
    sync.ts                               syncAccount : send-request, boucle, import
    stale.ts                              FLEX_SYNC_STALE_MS, isFlexSyncStale
  src/pages/
    LoginPage.tsx, InvitationPage.tsx, SettingsPage.tsx
    SourcesPage.tsx                       + formulaire jeton/query id, état et bouton de synchro
  src/components/
    SessionMenuItem.tsx                   pied de barre latérale
  src/routes/router.tsx                   + /login, /invitation/:token, /settings
  src/i18n/en.json, fr.json               + clés auth.*, settings.*, sync.*
  e2e/auth.spec.ts, e2e/sync.spec.ts      Playwright

packages/ib-parsers/src/
  flexEnvelope.ts                         parseFlexSendRequest, parseFlexStatementEnvelope
  flexEnvelope.test.ts

deploy/traefik/
  docker-compose.yml                      Traefik du VPS, réseau externe, ACME
  README.md                               infrastructure du VPS, pas de cette application

docker-compose.yml                        web + api + db, réseau externe Traefik
.env.example                              variables attendues, sans valeur réelle
docs/deploiement-vps.md                   procédure ordonnée
```

---

# Palier A — le serveur tourne en local

## Tâche 1 : worktree, workspace uv, squelette `apps/api`, `/api/health`

**Files:**
- Create: `pyproject.toml`, `apps/api/pyproject.toml`, `apps/api/manage.py`, `apps/api/pytest.ini`, `apps/api/README.md`, `apps/api/config/{__init__,settings,urls,api,wsgi}.py`, `apps/api/core/{__init__,apps,adapters,models}.py`, `apps/api/ib/{__init__,apps}.py`, `apps/api/tests/{__init__.py,test_health.py}`, `docker-compose.dev.yml`
- Modify: `package.json`, `.gitignore`

**Interfaces:**
- Consumes: rien.
- Produces: `config.api.api` (instance `NinjaAPI`), `GET /api/health` → `{"status": "ok"}`, la commande `pnpm test:api`, la constante de réglage `PUBLIC_BASE_URL`.

- [x] **Étape 1 : worktree**

```bash
cd /home/seb/IA/IB_Analyzer2
git worktree add .claude/worktrees/serveur-django -b serveur-django
cd .claude/worktrees/serveur-django
```

Tout le reste du plan se fait dans ce worktree.

- [x] **Étape 2 : constater les versions et l'écrire**

Le spec §3.2 laisse ce constat à l'implémentation, il ne se devine pas :

```bash
uv python list | head
uv run --with django python -c "import django; print(django.get_version())"
```

Retenir **la Django LTS la plus récente** et **la version de Python qu'elle supporte**. Si elle ne supporte pas 3.14, `apps/api/.python-version` épingle celle qu'elle supporte ; les autres projets uv du dépôt ne bougent pas. Écrire le constat dans `apps/api/README.md` :

```markdown
# apps/api

Serveur Django du sous-projet 3. Deux apps : `core` (socle réutilisable) et `ib`
(proxy Flex, spécifique IB). **Le serveur ne stocke aucune donnée de portefeuille**
— voir `docs/specs/2026-09-04-serveur-django-design.md`.

## Versions retenues

| Quoi | Version | Pourquoi |
|---|---|---|
| Django | <constaté> | LTS la plus récente |
| Python | <constaté> | la plus récente que cette LTS supporte |

## Commandes

    docker compose -f docker-compose.dev.yml up -d db
    uv run --project apps/api python apps/api/manage.py migrate
    uv run --project apps/api python apps/api/manage.py runserver
    pnpm test:api        # depuis la racine
```

- [x] **Étape 3 : workspace uv racine et projet `apps/api`**

`pyproject.toml` à la racine :

```toml
[tool.uv.workspace]
members = ["apps/api", "tools/coverage-oracle"]
```

`apps/api/pyproject.toml` — les bornes suivent le constat de l'étape 2 :

```toml
[project]
name = "ib-analyzer-api"
version = "0.1.0"
requires-python = ">=3.13"
dependencies = [
    "django>=5.2,<6.0",
    "django-ninja>=1.3",
    "django-allauth[mfa]>=65",
    "psycopg[binary]>=3.2",
    "dj-database-url>=2.2",
    "whitenoise>=6.7",
    "gunicorn>=23",
    "httpx>=0.27",
]

[dependency-groups]
dev = ["pytest>=8", "pytest-django>=4.9", "respx>=0.21"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["config", "core", "ib"]
```

- [x] **Étape 4 : PostgreSQL de développement**

`docker-compose.dev.yml` à la racine — **jamais déployé**, il ne sert qu'aux tests locaux :

```yaml
services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: ib
      POSTGRES_PASSWORD: ib
      POSTGRES_DB: ib_analyzer
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - devdb:/var/lib/postgresql/data

volumes:
  devdb:
```

`127.0.0.1` et pas `0.0.0.0` : règle du dépôt pour tout service local.

- [x] **Étape 5 : `config/settings.py`**

```python
"""Django settings. Secrets come from the environment; nothing is committed."""
import os
from pathlib import Path

import dj_database_url

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-only-not-for-production")
DEBUG = os.environ.get("DJANGO_DEBUG", "0") == "1"
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
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": os.environ.get("DJANGO_LOG_LEVEL", "INFO")},
}
```

- [x] **Étape 6 : `config/api.py`, `urls.py`, `wsgi.py`, `manage.py`, `pytest.ini`**

`config/api.py` :

```python
from ninja import NinjaAPI

api = NinjaAPI(title="IB Analyzer", version="1.0.0", csrf=True)


@api.get("/health", auth=None, url_name="health")
def health(request):
    """Liveness probe for Compose and Traefik. Touches nothing."""
    return {"status": "ok"}
```

`config/urls.py` :

```python
from django.contrib import admin
from django.urls import include, path

from config.api import api

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", api.urls),
    path("_allauth/", include("allauth.headless.urls")),
]
```

`config/wsgi.py` :

```python
import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
application = get_wsgi_application()
```

`manage.py` : le fichier standard généré par `django-admin startproject`, avec
`DJANGO_SETTINGS_MODULE = "config.settings"`.

`apps/api/pytest.ini` :

```ini
[pytest]
DJANGO_SETTINGS_MODULE = config.settings
python_files = test_*.py
addopts = --reuse-db
```

- [x] **Étape 7 : scripts racine et `.gitignore`**

Ajouter à `package.json` :

```json
"test:api": "uv run --project apps/api pytest apps/api"
```

Ajouter à `.gitignore` :

```
.env
apps/api/staticfiles/
apps/api/.pytest_cache/
```

- [x] **Étape 8 : le test (échec attendu)**

`apps/api/tests/test_health.py` :

```python
import pytest


@pytest.mark.django_db
def test_health_answers_without_a_session(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [x] **Étape 9 : lancer, voir échouer**

```bash
docker compose -f docker-compose.dev.yml up -d db
pnpm test:api
```

Attendu : ÉCHEC — `AUTH_USER_MODEL` désigne `core.User`, qui n'existe pas.

- [x] **Étape 10 : squelettes `core` et `ib`**

`core/apps.py` et `ib/apps.py` portent une `AppConfig` de `name` `"core"` et `"ib"`.
`core/models.py` reste vide (la tâche 2 le remplit). `core/adapters.py` :

```python
from allauth.account.adapter import DefaultAccountAdapter


class AccountAdapter(DefaultAccountAdapter):
    """Signup is closed for good: an invitation is the only way in."""

    def is_open_for_signup(self, request):
        return False
```

Le test échoue encore tant que `core.User` n'existe pas : **c'est attendu**, la tâche 2
le règle. Pour finir la tâche 1, poser provisoirement dans `core/models.py` :

```python
from django.contrib.auth.models import AbstractUser


class User(AbstractUser):
    """Replaced by the email-identified model in task 2."""
```

et générer la migration :

```bash
uv run --project apps/api python apps/api/manage.py makemigrations core
```

- [x] **Étape 11 : lancer, voir passer**

```bash
pnpm test:api
```

Attendu : `test_health_answers_without_a_session` PASSE.

- [x] **Étape 12 : commit**

```bash
git add -A
git commit -m "feat(api): squelette Django, workspace uv, endpoint de santé"
```

---

## Tâche 2 : `core.User`, identifiant par email

**Files:**
- Modify: `apps/api/core/models.py`, `apps/api/core/migrations/0001_initial.py` (régénérée)
- Create: `apps/api/core/managers.py`, `apps/api/core/admin.py`, `apps/api/tests/test_user.py`

**Interfaces:**
- Consumes: le squelette `core` de la tâche 1.
- Produces: `core.models.User` avec `USERNAME_FIELD = "email"`, `User.objects.create_user(email=..., password=...)` et `create_superuser(email=..., password=...)`.

- [x] **Étape 1 : le test (échec attendu)**

`apps/api/tests/test_user.py` :

```python
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
```

- [x] **Étape 2 : lancer, voir échouer**

```bash
pnpm test:api -- apps/api/tests/test_user.py
```

Attendu : ÉCHEC — `create_user()` du modèle provisoire exige un `username`.

- [x] **Étape 3 : `core/managers.py`**

```python
from django.contrib.auth.models import BaseUserManager


class UserManager(BaseUserManager):
    """No username: the email is the identifier."""

    use_in_migrations = True

    def create_user(self, email, password=None, **extra):
        if not email:
            raise ValueError("An email is required")
        user = self.model(email=self.normalize_email(email), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        if not extra["is_staff"] or not extra["is_superuser"]:
            raise ValueError("A superuser needs both flags")
        return self.create_user(email, password, **extra)
```

- [x] **Étape 4 : `core/models.py`**

Remplacer le modèle provisoire :

```python
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
```

- [x] **Étape 5 : `core/admin.py`**

```python
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from core.models import User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ("email",)
    list_display = ("email", "is_staff", "is_active", "date_joined")
    search_fields = ("email",)
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
    )
    add_fieldsets = ((None, {"classes": ("wide",), "fields": ("email", "password1", "password2")}),)
```

- [x] **Étape 6 : régénérer la migration**

Le modèle utilisateur ayant changé de forme et aucune base de production n'existant,
la migration initiale se refait à zéro :

```bash
rm apps/api/core/migrations/0001_initial.py
uv run --project apps/api python apps/api/manage.py makemigrations core
```

- [x] **Étape 7 : lancer, voir passer**

```bash
pnpm test:api
```

Attendu : les quatre tests de `test_user.py` PASSENT, `test_health.py` toujours vert.

- [x] **Étape 8 : commit**

```bash
git add -A
git commit -m "feat(api): modèle utilisateur personnalisé, email comme identifiant"
```

---

## Tâche 3 : `core.Invitation` et son lien dans l'admin

**Files:**
- Modify: `apps/api/core/models.py`, `apps/api/core/admin.py`
- Create: `apps/api/tests/test_invitations.py`, migration `0002_invitation.py`

**Interfaces:**
- Consumes: `core.models.User`.
- Produces: `core.models.Invitation` (`token`, `email`, `created_by`, `created_at`, `expires_at`, `accepted_at`, `accepted_user`), la propriété `is_usable`, la méthode de classe `Invitation.issue(*, email, created_by=None)` et `invitation.link(base_url)`.

- [x] **Étape 1 : le test (échec attendu)**

`apps/api/tests/test_invitations.py` :

```python
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
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
```

- [x] **Étape 2 : lancer, voir échouer**

```bash
pnpm test:api -- apps/api/tests/test_invitations.py
```

Attendu : ÉCHEC à l'import de `Invitation`.

- [x] **Étape 3 : le modèle**

Ajouter à `core/models.py` (les imports `secrets` et `timedelta` en tête de fichier) :

```python
INVITATION_LIFETIME = timedelta(days=14)


def new_invitation_token():
    return secrets.token_urlsafe(32)


class Invitation(models.Model):
    """One-shot ticket to create an account. Signup is closed otherwise."""

    token = models.CharField(max_length=64, unique=True, default=new_invitation_token, editable=False)
    email = models.EmailField()
    created_by = models.ForeignKey(
        "core.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(default=lambda: timezone.now() + INVITATION_LIFETIME)
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
```

Une `lambda` n'étant pas sérialisable par les migrations, remplacer le `default` de
`expires_at` par une fonction nommée au niveau du module :

```python
def default_invitation_expiry():
    return timezone.now() + INVITATION_LIFETIME
```

- [x] **Étape 4 : l'admin affiche le lien**

Ajouter à `core/admin.py` :

```python
from django.conf import settings
from django.utils.html import format_html

from core.models import Invitation


@admin.register(Invitation)
class InvitationAdmin(admin.ModelAdmin):
    """No email is ever sent: the admin copies the link and passes it on."""

    list_display = ("email", "created_at", "expires_at", "accepted_at")
    readonly_fields = ("token", "created_at", "accepted_at", "accepted_user", "invitation_link")
    fields = ("email", "expires_at", "invitation_link", "token", "created_at", "accepted_at", "accepted_user")

    @admin.display(description="Invitation link")
    def invitation_link(self, obj):
        if not obj.pk:
            return "—"
        return format_html("<code>{}</code>", obj.link(settings.PUBLIC_BASE_URL))

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)
```

`PUBLIC_BASE_URL` vient de l'environnement (tâche 1, étape 5) : **aucun nom de domaine
n'est committé**.

```bash
uv run --project apps/api python apps/api/manage.py makemigrations core
```

- [x] **Étape 5 : lancer, voir passer**

```bash
pnpm test:api -- apps/api/tests/test_invitations.py
```

Attendu : les quatre tests PASSENT.

- [x] **Étape 6 : commit**

```bash
git add -A
git commit -m "feat(api): invitations à usage unique, lien affiché dans l'admin"
```

---

## Tâche 4 : `allauth` headless câblé, inscription fermée, 2FA disponible

**Files:**
- Create: `apps/api/tests/conftest.py`, `apps/api/tests/test_allauth_wiring.py`
- Modify: `apps/api/config/settings.py` si le constat de version impose d'autres noms de réglages

**Interfaces:**
- Consumes: `core.adapters.AccountAdapter`, `core.models.User`.
- Produces: les fixtures pytest `user` (email `a@example.com`, mot de passe `correct-horse-battery`) et `auth_client` (client Django avec session ouverte), et la constante de test `ALLAUTH = "/_allauth/browser/v1"`.

- [x] **Étape 1 : confirmer les chemins dans la doc de la version installée**

Ne pas deviner. Lire la documentation headless d'`allauth` de la version épinglée et
relever les chemins réels de : session courante, connexion, déconnexion, second facteur,
gestion des authentificateurs TOTP et des codes de secours. Les écrire en tête de
`apps/api/tests/test_allauth_wiring.py` en commentaire, et **les réutiliser tels quels**
dans `apps/web/src/api/allauth.ts` (tâche 12).

- [x] **Étape 2 : `conftest.py`**

```python
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
```

- [x] **Étape 3 : les tests (échec attendu)**

`apps/api/tests/test_allauth_wiring.py` :

```python
import pytest

from tests.conftest import ALLAUTH


@pytest.mark.django_db
def test_session_endpoint_reports_no_session_when_anonymous(client):
    response = client.get(f"{ALLAUTH}/auth/session")
    assert response.status_code in (401, 410)


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
    assert response.status_code in (403, 409)
    assert not get_user_model().objects.filter(email="intruder@example.com").exists()


@pytest.mark.django_db
def test_totp_authenticator_endpoint_is_mounted(auth_client):
    response = auth_client.get(f"{ALLAUTH}/account/authenticators/totp")
    # 404 means "no TOTP set up yet", which is the answer we want from a
    # mounted endpoint; a routing failure would be a Django 404 without JSON.
    assert response["content-type"].startswith("application/json")
```

Ajouter l'import manquant `from django.contrib.auth import get_user_model` en tête.

- [x] **Étape 4 : lancer, voir échouer puis passer**

```bash
pnpm test:api -- apps/api/tests/test_allauth_wiring.py
```

Si un chemin ne répond pas, c'est l'étape 1 qui a été sautée : corriger les chemins,
pas les assertions. Si `test_signup_is_closed` échoue, l'adaptateur n'est pas pris en
compte : vérifier `ACCOUNT_ADAPTER` et le nom exact du réglage dans la version installée.

- [x] **Étape 5 : commit**

```bash
git add -A
git commit -m "test(api): allauth headless câblé, inscription fermée, TOTP monté"
```

---

## Tâche 5 : `POST /api/core/invitations/accept` et `openapi.json`

**Files:**
- Create: `apps/api/core/schemas.py`, `apps/api/core/api.py`, `apps/api/openapi.json`, `apps/api/tests/test_openapi_freshness.py`
- Modify: `apps/api/config/api.py`, `apps/api/tests/test_invitations.py`

**Interfaces:**
- Consumes: `core.models.Invitation`, `core.models.User`.
- Produces: `POST /api/core/invitations/accept` avec le corps `{"token": str, "password": str}`, réponse `200 {"id": str, "email": str}` ou `400 {"code": str, "detail": str}` ; les schémas `AcceptInvitationIn`, `SessionUserOut`, `ErrorOut` ; le fichier `apps/api/openapi.json`.

- [x] **Étape 1 : les tests (échec attendu)**

Ajouter à `apps/api/tests/test_invitations.py` :

```python
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
```

`apps/api/tests/test_openapi_freshness.py` :

```python
import json
from pathlib import Path

from config.api import api

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "openapi.json"


def test_committed_openapi_matches_the_running_api():
    current = json.loads(json.dumps(api.get_openapi_schema(), sort_keys=True))
    committed = json.loads(SCHEMA_PATH.read_text())
    assert committed == current, (
        "openapi.json is stale. Regenerate it: "
        "uv run --project apps/api python apps/api/manage.py export_openapi_schema "
        "--api config.api.api --output apps/api/openapi.json"
    )
```

- [x] **Étape 2 : lancer, voir échouer**

```bash
pnpm test:api
```

Attendu : ÉCHEC — 404 sur `/api/core/invitations/accept`, et `openapi.json` absent.

- [x] **Étape 3 : `core/schemas.py`**

```python
from ninja import Schema


class AcceptInvitationIn(Schema):
    token: str
    password: str


class SessionUserOut(Schema):
    """The browser keys its local profile on `id`: it must be stable and opaque."""

    id: str
    email: str


class ErrorOut(Schema):
    code: str
    detail: str
```

- [x] **Étape 4 : `core/api.py`**

```python
from django.contrib.auth import get_user_model, login
from django.core.exceptions import ValidationError
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from django.utils import timezone
from ninja import Router

from core.models import Invitation
from core.schemas import AcceptInvitationIn, ErrorOut, SessionUserOut

router = Router(tags=["core"])

# One message for unknown, expired and already-accepted tokens alike: telling
# them apart would leak whether an invitation exists.
INVITATION_INVALID = {"code": "invitation-invalid", "detail": "This invitation cannot be used."}


@router.post("/invitations/accept", auth=None, response={200: SessionUserOut, 400: ErrorOut})
def accept_invitation(request, payload: AcceptInvitationIn):
    invitation = Invitation.objects.filter(token=payload.token).first()
    if invitation is None or not invitation.is_usable:
        return 400, INVITATION_INVALID

    user_model = get_user_model()
    candidate = user_model(email=invitation.email)
    try:
        validate_password(payload.password, candidate)
    except ValidationError as error:
        return 400, {"code": "password-invalid", "detail": " ".join(error.messages)}

    with transaction.atomic():
        # Re-read under the row lock: two clicks on the same link must not
        # create two users.
        locked = Invitation.objects.select_for_update().get(pk=invitation.pk)
        if not locked.is_usable:
            return 400, INVITATION_INVALID
        user = user_model.objects.create_user(email=locked.email, password=payload.password)
        locked.accepted_at = timezone.now()
        locked.accepted_user = user
        locked.save(update_fields=["accepted_at", "accepted_user"])

    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    return 200, {"id": str(user.pk), "email": user.email}
```

- [x] **Étape 5 : brancher le routeur et générer `openapi.json`**

Ajouter à `config/api.py` :

```python
from core.api import router as core_router

api.add_router("/core", core_router)
```

```bash
uv run --project apps/api python apps/api/manage.py export_openapi_schema \
  --api config.api.api --output apps/api/openapi.json
```

Si le test de fraîcheur compare des clés triées, régénérer avec le même tri que le test :
adapter la commande par un court script si nécessaire, l'important est que les deux
formes soient identiques.

- [x] **Étape 6 : lancer, voir passer**

```bash
pnpm test:api
```

Attendu : tout PASSE, y compris `test_committed_openapi_matches_the_running_api`.

- [x] **Étape 7 : commit**

```bash
git add -A
git commit -m "feat(api): acceptation d'invitation, schéma OpenAPI committé et vérifié"
```

---

## Tâche 6 : proxy Flex, passe-plat intégral

**Files:**
- Create: `apps/api/ib/flex.py`, `apps/api/ib/schemas.py`, `apps/api/ib/api.py`, `apps/api/tests/test_flex_proxy.py`
- Modify: `apps/api/config/api.py`, `apps/api/openapi.json`

**Interfaces:**
- Consumes: `core.schemas.ErrorOut`.
- Produces: `POST /api/ib/flex/send-request` (corps `{"token": str, "queryId": str}`) et `POST /api/ib/flex/get-statement` (corps `{"token": str, "referenceCode": str}`), tous deux réservés aux utilisateurs connectés, rendant le corps d'IB **tel quel** ; `ib.flex.call_flex(path, params)`.

- [x] **Étape 1 : les tests (échec attendu)**

`apps/api/tests/test_flex_proxy.py` :

```python
import httpx
import pytest
import respx

from ib.flex import FLEX_BASE

SEND = "/api/ib/flex/send-request"
GET = "/api/ib/flex/get-statement"

SUCCESS_XML = (
    b'<?xml version="1.0" encoding="UTF-8"?>'
    b"<FlexStatementResponse timestamp='04 September, 2026 08:00 AM EDT'>"
    b"<Status>Success</Status><ReferenceCode>1234567890</ReferenceCode>"
    b"<Url>https://ndcdyn.interactivebrokers.com/x</Url></FlexStatementResponse>"
)
FAIL_XML = (
    b'<?xml version="1.0" encoding="UTF-8"?>'
    b"<FlexStatementResponse><Status>Fail</Status><ErrorCode>1019</ErrorCode>"
    b"<ErrorMessage>Statement generation in progress.</ErrorMessage></FlexStatementResponse>"
)


@pytest.mark.django_db
def test_send_request_needs_a_session(client):
    response = client.post(SEND, data={"token": "t", "queryId": "q"}, content_type="application/json")
    assert response.status_code == 401


@pytest.mark.django_db
def test_get_statement_needs_a_session(client):
    response = client.post(GET, data={"token": "t", "referenceCode": "r"}, content_type="application/json")
    assert response.status_code == 401


@pytest.mark.django_db
@respx.mock
def test_send_request_passes_the_body_through_byte_for_byte(auth_client):
    route = respx.get(f"{FLEX_BASE}/SendRequest").mock(
        return_value=httpx.Response(200, content=SUCCESS_XML, headers={"content-type": "text/xml"})
    )
    response = auth_client.post(
        SEND, data={"token": "tok", "queryId": "123"}, content_type="application/json"
    )
    assert response.status_code == 200
    assert response.content == SUCCESS_XML
    assert response["content-type"].startswith("text/xml")
    assert dict(route.calls.last.request.url.params) == {"t": "tok", "q": "123", "v": "3"}


@pytest.mark.django_db
@respx.mock
def test_an_ib_failure_is_passed_through_untouched_not_translated(auth_client):
    respx.get(f"{FLEX_BASE}/GetStatement").mock(
        return_value=httpx.Response(200, content=FAIL_XML, headers={"content-type": "text/xml"})
    )
    response = auth_client.post(
        GET, data={"token": "tok", "referenceCode": "ref"}, content_type="application/json"
    )
    assert response.status_code == 200
    assert response.content == FAIL_XML


@pytest.mark.django_db
@respx.mock
def test_a_timeout_becomes_504_and_never_reveals_an_upstream_body(auth_client):
    respx.get(f"{FLEX_BASE}/SendRequest").mock(side_effect=httpx.ReadTimeout("too slow"))
    response = auth_client.post(SEND, data={"token": "tok", "queryId": "1"}, content_type="application/json")
    assert response.status_code == 504
    assert response.json() == {"code": "flex-timeout", "detail": "Interactive Brokers did not answer in time."}


@pytest.mark.django_db
@respx.mock
def test_an_unreachable_ib_becomes_502(auth_client):
    respx.get(f"{FLEX_BASE}/SendRequest").mock(side_effect=httpx.ConnectError("nope"))
    response = auth_client.post(SEND, data={"token": "tok", "queryId": "1"}, content_type="application/json")
    assert response.status_code == 502
    assert response.json()["code"] == "flex-unreachable"


@pytest.mark.django_db
@respx.mock
def test_the_token_never_travels_in_our_own_url(auth_client):
    respx.get(f"{FLEX_BASE}/SendRequest").mock(
        return_value=httpx.Response(200, content=SUCCESS_XML, headers={"content-type": "text/xml"})
    )
    response = auth_client.post(SEND, data={"token": "s3cr3t", "queryId": "1"}, content_type="application/json")
    assert response.status_code == 200
    assert "s3cr3t" not in response.request["PATH_INFO"]
    assert "s3cr3t" not in response.request.get("QUERY_STRING", "")
```

- [x] **Étape 2 : lancer, voir échouer**

```bash
pnpm test:api -- apps/api/tests/test_flex_proxy.py
```

Attendu : ÉCHEC à l'import de `ib.flex`.

- [x] **Étape 3 : `ib/flex.py`**

```python
"""Outbound call to the Flex Web Service.

The body that comes back is never read, parsed or logged here: it belongs to
the browser. This module only knows how to reach IB and how to fail.
"""
import httpx

FLEX_BASE = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService"
FLEX_VERSION = "3"
FLEX_TIMEOUT = httpx.Timeout(30.0, connect=10.0)


class FlexTimeout(Exception):
    pass


class FlexUnreachable(Exception):
    pass


def call_flex(endpoint, params):
    """`endpoint` is "SendRequest" or "GetStatement". Returns (bytes, content_type)."""
    try:
        with httpx.Client(timeout=FLEX_TIMEOUT) as client:
            response = client.get(f"{FLEX_BASE}/{endpoint}", params={**params, "v": FLEX_VERSION})
    except httpx.TimeoutException as error:
        raise FlexTimeout from error
    except httpx.RequestError as error:
        raise FlexUnreachable from error
    return response.content, response.headers.get("content-type", "application/xml")
```

- [x] **Étape 4 : `ib/schemas.py` et `ib/api.py`**

`ib/schemas.py` :

```python
from ninja import Schema


class SendRequestIn(Schema):
    token: str
    queryId: str  # noqa: N815 — matches the browser payload and IB's own naming


class GetStatementIn(Schema):
    token: str
    referenceCode: str  # noqa: N815
```

`ib/api.py` :

```python
from django.http import HttpResponse, JsonResponse
from ninja import Router
from ninja.security import django_auth

from core.schemas import ErrorOut
from ib.flex import FlexTimeout, FlexUnreachable, call_flex
from ib.schemas import GetStatementIn, SendRequestIn

router = Router(tags=["ib"], auth=django_auth)

TIMEOUT_BODY = {"code": "flex-timeout", "detail": "Interactive Brokers did not answer in time."}
UNREACHABLE_BODY = {"code": "flex-unreachable", "detail": "Interactive Brokers could not be reached."}


def _relay(endpoint, params):
    """Pass IB's answer through untouched, or fail with a body of our own."""
    try:
        content, content_type = call_flex(endpoint, params)
    except FlexTimeout:
        return JsonResponse(TIMEOUT_BODY, status=504)
    except FlexUnreachable:
        return JsonResponse(UNREACHABLE_BODY, status=502)
    return HttpResponse(content, status=200, content_type=content_type)


@router.post("/flex/send-request", response={200: str, 502: ErrorOut, 504: ErrorOut})
def send_request(request, payload: SendRequestIn):
    """200 carries IB's raw XML, `Fail` responses included: the browser parses it."""
    return _relay("SendRequest", {"t": payload.token, "q": payload.queryId})


@router.post("/flex/get-statement", response={200: str, 502: ErrorOut, 504: ErrorOut})
def get_statement(request, payload: GetStatementIn):
    """200 carries IB's raw XML, `Fail` responses included: the browser parses it."""
    return _relay("GetStatement", {"t": payload.token, "q": payload.referenceCode})
```

Le `200: str` du schéma déclare une **chaîne opaque** : la génération de types ne prétend
pas décrire le contenu Flex (spec §6). Retourner une `HttpResponse` court-circuite la
sérialisation de Ninja, ce qui est exactement ce qu'on veut.

- [x] **Étape 5 : brancher et régénérer le schéma**

Ajouter à `config/api.py` :

```python
from ib.api import router as ib_router

api.add_router("/ib", ib_router)
```

```bash
uv run --project apps/api python apps/api/manage.py export_openapi_schema \
  --api config.api.api --output apps/api/openapi.json
```

- [x] **Étape 6 : lancer, voir passer**

```bash
pnpm test:api
```

Attendu : les sept tests du proxy PASSENT et `openapi.json` est de nouveau à jour.

- [x] **Étape 7 : commit**

```bash
git add -A
git commit -m "feat(api): proxy Flex, passe-plat intégral réservé aux sessions ouvertes"
```

---

## Tâche 7 : throttling et non-journalisation du jeton

**Files:**
- Create: `apps/api/ib/throttling.py`, `apps/api/tests/test_flex_throttling.py`, `apps/api/tests/test_flex_no_logging.py`
- Modify: `apps/api/ib/api.py`, `apps/api/openapi.json`

**Interfaces:**
- Consumes: `ib.api.router`.
- Produces: `ib.throttling.FlexBurstThrottle` (1/s) et `FlexRateThrottle` (10/min), appliqués aux deux endpoints du proxy.

- [x] **Étape 1 : les tests (échec attendu)**

`apps/api/tests/test_flex_throttling.py` :

```python
import httpx
import pytest
import respx
from django.core.cache import cache

from ib.flex import FLEX_BASE

SEND = "/api/ib/flex/send-request"
OK = httpx.Response(200, content=b"<FlexStatementResponse/>", headers={"content-type": "text/xml"})


@pytest.fixture(autouse=True)
def clear_throttle_state():
    cache.clear()
    yield
    cache.clear()


@pytest.mark.django_db
@respx.mock
def test_an_eleventh_call_in_the_same_minute_is_throttled(auth_client, monkeypatch):
    respx.get(f"{FLEX_BASE}/SendRequest").mock(return_value=OK)
    # Neutralise the 1/s burst rule so this test only exercises the 10/min one.
    monkeypatch.setattr("ib.throttling.FlexBurstThrottle.allow_request", lambda self, request: True)

    for index in range(10):
        response = auth_client.post(
            SEND, data={"token": "t", "queryId": str(index)}, content_type="application/json"
        )
        assert response.status_code == 200, f"call {index} should have gone through"

    response = auth_client.post(SEND, data={"token": "t", "queryId": "11"}, content_type="application/json")
    assert response.status_code == 429
    assert response.has_header("Retry-After")


@pytest.mark.django_db
@respx.mock
def test_two_calls_in_the_same_second_are_throttled(auth_client):
    respx.get(f"{FLEX_BASE}/SendRequest").mock(return_value=OK)
    first = auth_client.post(SEND, data={"token": "t", "queryId": "1"}, content_type="application/json")
    second = auth_client.post(SEND, data={"token": "t", "queryId": "2"}, content_type="application/json")
    assert first.status_code == 200
    assert second.status_code == 429
```

`apps/api/tests/test_flex_no_logging.py` :

```python
import logging

import httpx
import pytest
import respx

from ib.flex import FLEX_BASE

SEND = "/api/ib/flex/send-request"
TOKEN = "a-very-recognisable-flex-token"


@pytest.mark.django_db
@respx.mock
def test_the_token_appears_in_no_log_record(auth_client, caplog):
    respx.get(f"{FLEX_BASE}/SendRequest").mock(
        return_value=httpx.Response(200, content=b"<FlexStatementResponse/>", headers={"content-type": "text/xml"})
    )
    with caplog.at_level(logging.DEBUG):
        response = auth_client.post(
            SEND, data={"token": TOKEN, "queryId": "1"}, content_type="application/json"
        )
    assert response.status_code == 200
    assert TOKEN not in caplog.text
    for record in caplog.records:
        assert TOKEN not in str(record.args)
```

- [x] **Étape 2 : lancer, voir échouer**

```bash
pnpm test:api -- apps/api/tests/test_flex_throttling.py
```

Attendu : ÉCHEC — la onzième et la deuxième requête passent encore.

- [x] **Étape 3 : `ib/throttling.py`**

```python
"""IB allows 1 request per second and 10 per minute per token (spec §3.2).

We throttle per user rather than per token: the server never keys anything on
a token, not even a rate-limit bucket.
"""
from ninja.throttling import UserRateThrottle


class FlexBurstThrottle(UserRateThrottle):
    rate = "1/s"


class FlexRateThrottle(UserRateThrottle):
    rate = "10/min"
```

- [x] **Étape 4 : appliquer aux deux endpoints**

Dans `ib/api.py`, ajouter l'import et la liste sur chaque opération :

```python
from ib.throttling import FlexBurstThrottle, FlexRateThrottle

FLEX_THROTTLE = [FlexBurstThrottle(), FlexRateThrottle()]
```

puis `throttle=FLEX_THROTTLE` en argument des deux décorateurs `@router.post(...)`.

Vérifier dans la documentation de la version de Ninja installée que la réponse `429`
porte bien `Retry-After` ; si elle ne le porte pas, ajouter un `exception_handler` sur
`ninja.errors.Throttled` dans `config/api.py` qui le pose :

```python
from ninja.errors import Throttled


@api.exception_handler(Throttled)
def on_throttled(request, exc):
    response = api.create_response(
        request, {"code": "rate-limited", "detail": "Too many Flex calls."}, status=429
    )
    response["Retry-After"] = str(int(exc.wait or 1))
    return response
```

- [x] **Étape 5 : lancer, voir passer**

```bash
pnpm test:api
uv run --project apps/api python apps/api/manage.py export_openapi_schema \
  --api config.api.api --output apps/api/openapi.json
pnpm test:api
```

Attendu : les trois nouveaux tests PASSENT et le schéma reste à jour.

- [x] **Étape 6 : commit**

```bash
git add -A
git commit -m "feat(api): throttling Flex aligné sur IB, jeton absent des journaux"
```

---

# Palier B — la pile tourne sur le VPS

## Tâche 8 : images Docker et pile applicative

**Files:**
- Create: `apps/api/Dockerfile`, `apps/web/Dockerfile`, `apps/web/nginx.conf`, `docker-compose.yml`, `.env.example`, `.dockerignore`

**Interfaces:**
- Consumes: `apps/api` complet, le build Vite d'`apps/web`.
- Produces: les services Compose `web`, `api` et `db`, et la liste des variables d'environnement attendues.

- [x] **Étape 1 : `apps/api/Dockerfile`**

```dockerfile
FROM python:3.13-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

COPY apps/api/pyproject.toml apps/api/uv.lock /app/
RUN uv sync --frozen --no-dev --no-install-project

COPY apps/api /app/
RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:$PATH"
RUN DJANGO_SECRET_KEY=build-only python manage.py collectstatic --noinput

EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--access-logfile", "-"]
```

`0.0.0.0` est correct **ici seulement** : c'est l'intérieur d'un conteneur, atteint
uniquement par Traefik sur le réseau Docker. La règle « `127.0.0.1`, jamais `0.0.0.0` »
vise les services qui tournent sur la machine de l'utilisateur.

La version de Python de l'image suit le constat de la tâche 1.

- [x] **Étape 2 : `apps/web/Dockerfile` et `nginx.conf`**

```dockerfile
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile
RUN pnpm --filter web build

FROM nginx:alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
```

`apps/web/nginx.conf` :

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # Hashed assets: cache hard. index.html: never.
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache";
    }
}
```

- [x] **Étape 3 : `docker-compose.yml`**

```yaml
services:
  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    restart: unless-stopped
    networks: [traefik, internal]
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=${TRAEFIK_NETWORK}"
      - "traefik.http.routers.ibweb.rule=Host(`${PUBLIC_HOST}`)"
      - "traefik.http.routers.ibweb.entrypoints=websecure"
      - "traefik.http.routers.ibweb.tls.certresolver=letsencrypt"
      - "traefik.http.routers.ibweb.priority=1"
      - "traefik.http.services.ibweb.loadbalancer.server.port=80"

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    restart: unless-stopped
    env_file: .env
    depends_on: [db]
    networks: [traefik, internal]
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/health')"]
      interval: 30s
      timeout: 5s
      retries: 3
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=${TRAEFIK_NETWORK}"
      - "traefik.http.routers.ibapi.rule=Host(`${PUBLIC_HOST}`) && (PathPrefix(`/api`) || PathPrefix(`/admin`) || PathPrefix(`/_allauth`) || PathPrefix(`/static`))"
      - "traefik.http.routers.ibapi.entrypoints=websecure"
      - "traefik.http.routers.ibapi.tls.certresolver=letsencrypt"
      - "traefik.http.routers.ibapi.priority=10"
      - "traefik.http.services.ibapi.loadbalancer.server.port=8000"

  db:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - pgdata:/var/lib/postgresql/data
    networks: [internal]

volumes:
  pgdata:

networks:
  traefik:
    external: true
    name: ${TRAEFIK_NETWORK}
  internal:
```

`db` n'est **que** sur `internal` : il n'est joignable ni depuis Traefik ni depuis
l'extérieur. Le routeur `ibapi` a la priorité la plus haute pour que ses préfixes gagnent
sur le `Host` seul de `ibweb`.

- [x] **Étape 4 : `.env.example`**

```dotenv
# Copié en .env sur le VPS et rempli là-bas. Jamais committé rempli.
PUBLIC_HOST=<domaine>
PUBLIC_BASE_URL=https://<domaine>
TRAEFIK_NETWORK=<nom lu sur le VPS>

DJANGO_SECRET_KEY=<50 caractères aléatoires>
DJANGO_DEBUG=0
DJANGO_ALLOWED_HOSTS=<domaine>
DJANGO_CSRF_TRUSTED_ORIGINS=https://<domaine>
DJANGO_LOG_LEVEL=INFO

POSTGRES_USER=ib
POSTGRES_PASSWORD=<mot de passe aléatoire>
POSTGRES_DB=ib_analyzer
DATABASE_URL=postgres://ib:<le même mot de passe>@db:5432/ib_analyzer
```

- [x] **Étape 5 : `.dockerignore`**

```
node_modules
**/node_modules
**/dist
private
.git
.claude
tools/coverage-oracle
apps/api/.venv
apps/api/staticfiles
```

`private/` est exclu explicitement : aucune donnée réelle n'entre jamais dans une image.

- [x] **Étape 6 : vérifier que les deux images se construisent**

```bash
docker build -f apps/api/Dockerfile -t ib-api:test .
docker build -f apps/web/Dockerfile -t ib-web:test .
```

Attendu : deux images construites. Ne pas démarrer la pile ici : elle a besoin du réseau
Traefik, qui arrive à la tâche 9.

- [x] **Étape 7 : commit**

```bash
git add -A
git commit -m "build: images api et web, pile Compose derrière Traefik"
```

---

## Tâche 9 : Traefik du VPS et procédure de déploiement

**Files:**
- Create: `deploy/traefik/docker-compose.yml`, `deploy/traefik/README.md`, `docs/deploiement-vps.md`

**Interfaces:**
- Consumes: rien du code applicatif.
- Produces: le réseau Docker externe partagé et le résolveur ACME nommé `letsencrypt`, référencés par les labels de la tâche 8.

- [x] **Étape 1 : `deploy/traefik/docker-compose.yml`**

```yaml
services:
  traefik:
    image: traefik:v3.3
    restart: unless-stopped
    command:
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.web.http.redirections.entrypoint.to=websecure"
      - "--entrypoints.web.http.redirections.entrypoint.scheme=https"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
      - "--certificatesresolvers.letsencrypt.acme.email=${ACME_EMAIL}"
      - "--certificatesresolvers.letsencrypt.acme.storage=/acme/acme.json"
      - "--api.dashboard=false"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - acme:/acme
    networks: [proxy]

volumes:
  acme:

networks:
  proxy:
    name: ${TRAEFIK_NETWORK}
```

Le tableau de bord est **désactivé**. Le socket Docker est monté en lecture seule. Le
volume `acme` porte `acme.json`, que Traefik crée lui-même en `600`.

- [x] **Étape 2 : `deploy/traefik/README.md`**

```markdown
# Traefik — infrastructure du VPS

**Ceci n'appartient pas à l'application.** C'est le reverse proxy unique de tout le VPS :
une seule instance, un réseau Docker externe partagé, une pile Compose par application
derrière lui.

Il vit dans ce dépôt parce que IB Analyzer est la première application déployée sur ce
VPS. **Il déménagera dans son propre dépôt à l'arrivée de la deuxième.**

## Démarrage

    cp .env.example .env      # renseigner ACME_EMAIL et TRAEFIK_NETWORK
    docker compose up -d

`TRAEFIK_NETWORK` est le nom du réseau que les applications déclarent en `external`.
Le relever ici est la source de vérité : ne jamais le deviner ailleurs.

## Ce qui est délibéré

- Tableau de bord désactivé : rien à exposer, rien à protéger.
- `exposedbydefault=false` : un conteneur n'est routé que s'il porte `traefik.enable=true`.
- Redirection systématique de `web` vers `websecure`.
- ufw laisse entrer 80, 443 et 2002 (SSH) seulement.
```

- [x] **Étape 3 : `docs/deploiement-vps.md`**

```markdown
# Déploiement sur le VPS

Aucun nom de domaine n'apparaît dans ce dépôt : `<domaine>` est à remplacer par le vôtre,
dans le `.env` du VPS uniquement. Le sous-domaine porte des **tirets**, jamais
d'underscore : un underscore n'est pas valide dans un nom d'hôte et Let's Encrypt
refuserait d'émettre le certificat.

## 0. Prérequis

- Un enregistrement DNS `A` (et `AAAA` s'il y a une IPv6) pour `<domaine>` pointant sur
  le VPS.
- ufw : `deny incoming`, ports 80, 443 et 2002 ouverts.
- Docker et Docker Compose installés.

## 1. Traefik, une seule fois pour tout le VPS

    cd deploy/traefik
    cp .env.example .env        # ACME_EMAIL, TRAEFIK_NETWORK
    docker compose up -d
    docker network ls | grep "$TRAEFIK_NETWORK"

**Vérifier le certificat avant d'aller plus loin** : le premier `docker compose up` de
l'application doit trouver un Traefik capable d'émettre, sinon on débogue deux choses à la
fois.

## 2. La pile de l'application

    cp .env.example .env        # tout renseigner, TRAEFIK_NETWORK inclus
    docker compose build
    docker compose up -d

## 3. Migrer, une commande explicite

Les migrations **ne tournent pas au démarrage du conteneur** : deux répliques les
lanceraient en concurrence.

    docker compose run --rm api python manage.py migrate

## 4. Le super-utilisateur

    docker compose run --rm api python manage.py createsuperuser

## 5. La première invitation

Ouvrir `https://<domaine>/admin/`, se connecter, créer une `Invitation` avec l'email de
l'invité. La fiche affiche le lien : le transmettre soi-même. **Aucun email n'est envoyé.**

## 6. Vérifier

    curl -I https://<domaine>/            # 200, certificat valide
    curl -s https://<domaine>/api/health  # {"status":"ok"}

Puis, dans un navigateur : ouvrir le lien d'invitation, choisir un mot de passe, se
retrouver connecté.

## Mettre à jour

    git pull
    docker compose build
    docker compose up -d
    docker compose run --rm api python manage.py migrate
```

- [x] **Étape 4 : commit**

```bash
git add -A
git commit -m "build: Traefik du VPS et procédure de déploiement"
```

---

## Tâche 10 : déploiement réel, à deux

**Files:** aucun fichier du dépôt n'est modifié ; seul le VPS change.

**Interfaces:**
- Consumes: les tâches 8 et 9.
- Produces: un site en HTTPS sur lequel une invitation crée un compte.

> **Cette tâche ne se fait pas seul.** Elle demande un accès SSH au VPS, le vrai nom de
> domaine et le nom du réseau Traefik, aucun des trois n'étant dans le dépôt. Un agent qui
> exécute ce plan **s'arrête ici et rend la main**.

- [ ] **Étape 1 : demander à l'utilisateur de dérouler `docs/deploiement-vps.md`**

Sections 0 à 4. Relever au passage, pour les noter dans `apps/api/README.md` si elles
divergent de ce qui était prévu : la version de Traefik réellement installée, le nom du
réseau externe.

- [ ] **Étape 2 : vérifier ensemble**

```bash
curl -I https://<domaine>/
curl -s https://<domaine>/api/health
```

Attendu : `200` avec un certificat valide, et `{"status":"ok"}`.

- [ ] **Étape 3 : le parcours d'invitation en vrai**

Créer une invitation dans l'admin, ouvrir son lien dans un navigateur, choisir un mot de
passe, constater qu'on est connecté. **C'est le critère d'acceptation du palier B.**

- [ ] **Étape 4 : commit s'il y a eu des corrections**

```bash
git add -A
git commit -m "fix(deploy): corrections constatées au premier déploiement"
```

---

# Palier C — le navigateur parle au serveur

## Tâche 11 : client typé, jeton CSRF, garde de dérive

**Files:**
- Create: `apps/web/src/api/client.ts`, `scripts/check-api-types.mjs`, `apps/web/src/api/client.test.ts`
- Modify: `package.json`, `apps/web/package.json`, `apps/api/config/api.py`, `apps/api/openapi.json`, `apps/api/tests/test_health.py`
- Generated: `apps/web/src/api/schema.d.ts`

**Interfaces:**
- Consumes: `apps/api/openapi.json`.
- Produces: `apps/web/src/api/client.ts` exportant `api` (client `openapi-fetch` typé sur `paths`, `baseUrl: "/api"`, cookies de même origine, en-tête `X-CSRFToken`) et `ensureCsrfCookie()`.

- [x] **Étape 1 : l'endpoint qui pose le cookie CSRF (côté serveur)**

Tirée en avance à la tâche 5 (correction de revue : `accept_invitation` crée un compte et
ouvre une session sans ce cookie, l'endpoint devenait inappelable côté navigateur sans lui).
Écart par rapport au snippet ci-dessous : `@ensure_csrf_cookie` ne fonctionne pas tel quel
sur une vue ninja — il attend que la vue décorée renvoie déjà une `HttpResponse` pour lui
appeler `.set_cookie()`, alors qu'une vue ninja renvoie un dict qui ne devient une
`JsonResponse` que plus haut dans `Operation.run()` (`AttributeError: 'dict' object has no
attribute 'set_cookie'` à l'essai). Implémenté avec `django.middleware.csrf.get_token(request)`
à la place, qui pose le même indicateur `CSRF_COOKIE_USED` sur la requête ; `CsrfViewMiddleware`,
qui enveloppe tout le cycle requête/réponse (pas seulement cette vue), attache le cookie
quand la vraie réponse le retraverse. Voir `apps/api/config/api.py`.

Ninja avec `csrf=True` exige l'en-tête `X-CSRFToken`, que le navigateur ne peut poser que
s'il a le cookie. Ajouter à `config/api.py` :

```python
from django.views.decorators.csrf import ensure_csrf_cookie


@api.get("/csrf", auth=None, url_name="csrf")
@ensure_csrf_cookie
def csrf(request):
    """Called once at boot so the SPA can send X-CSRFToken afterwards."""
    return {"status": "ok"}
```

Ajouter à `apps/api/tests/test_health.py` :

```python
@pytest.mark.django_db
def test_csrf_endpoint_sets_the_cookie(client):
    response = client.get("/api/csrf")
    assert response.status_code == 200
    assert "csrftoken" in response.cookies
```

Vérifier, régénérer le schéma :

```bash
pnpm test:api
uv run --project apps/api python apps/api/manage.py export_openapi_schema \
  --api config.api.api --output apps/api/openapi.json
```

- [x] **Étape 2 : dépendances et scripts**

```bash
pnpm --filter web add openapi-fetch
pnpm --filter web add -D openapi-typescript
```

Ajouter à `package.json` racine :

```json
"gen:api": "pnpm --filter web exec openapi-typescript ../../apps/api/openapi.json -o src/api/schema.d.ts",
"check:api-types": "node scripts/check-api-types.mjs",
"check": "pnpm lint && pnpm typecheck && pnpm check:api-types && pnpm build && pnpm test"
```

- [x] **Étape 3 : la garde de dérive**

`scripts/check-api-types.mjs` — **Node pur, jamais Python** :

```js
#!/usr/bin/env node
/**
 * Fails when apps/web/src/api/schema.d.ts is not what openapi.json generates.
 * The other half of the chain — openapi.json against the running Django — is a
 * pytest test, so `pnpm check` never needs Python.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const committed = "apps/web/src/api/schema.d.ts";
const dir = mkdtempSync(join(tmpdir(), "api-types-"));
const fresh = join(dir, "schema.d.ts");

try {
  execFileSync(
    "pnpm",
    ["--filter", "web", "exec", "openapi-typescript", "../../apps/api/openapi.json", "-o", fresh],
    { stdio: "inherit" },
  );
  if (readFileSync(committed, "utf8") !== readFileSync(fresh, "utf8")) {
    console.error(`${committed} is stale. Run: pnpm gen:api`);
    process.exit(1);
  }
  console.log("api types up to date");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
```

- [x] **Étape 4 : générer le fichier de types**

```bash
pnpm gen:api
```

`apps/web/src/api/schema.d.ts` est **committé** : son diff se lit en revue comme un
journal des changements d'API.

- [x] **Étape 5 : le test du client (échec attendu)**

Écart par rapport au snippet ci-dessous : `apps/api/openapi.json` décrit des chemins absolus
(`/api/core/invitations/accept`, `/api/csrf`), pas des chemins relatifs à un point de montage
`/api` — Ninja construit le schéma depuis la résolution d'URL réelle (`path("api/", api.urls)`
dans `config/urls.py`), et `servers` y est vide. Les deux appels du test utilisent donc
`"/api/core/invitations/accept"` et (dans `client.ts`) `"/api/csrf"`, chemins qui existent
tels quels dans `paths` généré. Vérifié en listant les clés de
`apps/web/src/api/schema.d.ts` après génération.

`apps/web/src/api/client.test.ts` :

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ensureCsrfCookie } from "./client";

describe("api client", () => {
  beforeEach(() => {
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    vi.restoreAllMocks();
  });

  it("sends the CSRF token from the cookie", async () => {
    document.cookie = "csrftoken=abc123; path=/";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "1", email: "a@example.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await api.POST("/core/invitations/accept", { body: { token: "t", password: "p" } });

    const request = fetchSpy.mock.calls[0][0] as Request;
    expect(request.headers.get("X-CSRFToken")).toBe("abc123");
    expect(request.url).toContain("/api/core/invitations/accept");
  });

  it("sends no CSRF header when there is no cookie", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await api.POST("/core/invitations/accept", { body: { token: "t", password: "p" } });
    const request = fetchSpy.mock.calls[0][0] as Request;
    expect(request.headers.get("X-CSRFToken")).toBeNull();
  });

  it("ensureCsrfCookie calls the endpoint that sets it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await ensureCsrfCookie();
    expect((fetchSpy.mock.calls[0][0] as Request).url).toContain("/api/csrf");
  });
});
```

- [x] **Étape 6 : lancer, voir échouer**

```bash
pnpm --filter web test src/api/client.test.ts
```

Attendu : ÉCHEC, `./client` n'existe pas.

- [x] **Étape 7 : `apps/web/src/api/client.ts`**

Deux écarts par rapport au snippet ci-dessous. Primo, `baseUrl` : suite du constat de
l'étape 5, `baseUrl` porte l'origine (`window.location.origin`) plutôt que `"/api"`, les
chemins portant déjà le préfixe. Secundo, `fetch` : `openapi-fetch` capture sa référence
`fetch` une seule fois, à la construction du client (au chargement du module, avant que
`vi.spyOn(globalThis, "fetch")` ne s'exécute dans les tests) ; sans indirection, les appels
du client contournaient silencieusement l'espion et frappaient le réseau réel (constaté :
`SyntaxError: Unexpected token '<' ... is not valid JSON`, le serveur de dev répondant avec
son `index.html`). Passé une option `fetch` qui redirige vers `globalThis.fetch` à chaque
appel plutôt qu'une seule fois.

```ts
import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./schema";

/** Django's CSRF cookie. Absent until `ensureCsrfCookie()` has run once. */
function csrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

const csrfMiddleware: Middleware = {
  onRequest({ request }) {
    const token = csrfToken();
    if (token) request.headers.set("X-CSRFToken", token);
    return request;
  },
};

export const api = createClient<paths>({ baseUrl: "/api", credentials: "same-origin" });
api.use(csrfMiddleware);

/** Call once at boot: Django only sets the cookie on a view that asks for it. */
export async function ensureCsrfCookie(): Promise<void> {
  await api.GET("/csrf");
}
```

- [x] **Étape 8 : lancer, voir passer**

```bash
pnpm --filter web test src/api/client.test.ts
pnpm check
```

Attendu : les trois tests PASSENT et `check:api-types` sort en 0.

- [x] **Étape 9 : commit**

```bash
git add -A
git commit -m "feat(web): client API typé depuis l'OpenAPI, garde de dérive dans pnpm check"
```

---

## Tâche 12 : client `allauth` et `useSession()`

**Files:**
- Create: `apps/web/src/api/allauth.ts`, `apps/web/src/api/session.tsx`, `apps/web/src/api/session.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `ensureCsrfCookie` de la tâche 11, les chemins relevés à la tâche 4 étape 1.
- Produces: le type `SessionState` (`{status:"loading"} | {status:"anonymous"} | {status:"authenticated"; user:{id:string; email:string}} | {status:"unreachable"}`), le composant `SessionProvider`, le hook `useSession(): SessionState`, le hook `useSessionActions(): { login, logout, refresh }`, et les fonctions `fetchSession()`, `login(email, password)`, `logout()` de `allauth.ts`.

- [x] **Étape 1 : les tests (échec attendu)**

`apps/web/src/api/session.test.tsx` :

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionProvider, useSession } from "./session";

function Probe() {
  const session = useSession();
  return <div data-testid="state">{session.status === "authenticated" ? session.user.email : session.status}</div>;
}

function renderProbe() {
  render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
}

describe("useSession", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("reports the user when the session endpoint answers 200", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/auth/session")) {
        return new Response(JSON.stringify({ data: { user: { id: 7, email: "a@example.com" } } }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("a@example.com"));
  });

  it("reports anonymous on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("anonymous"));
  });

  it("reports unreachable when the network fails, never an error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("unreachable"));
  });
});
```

- [x] **Étape 2 : lancer, voir échouer**

```bash
pnpm --filter web test src/api/session.test.tsx
```

Attendu : ÉCHEC, `./session` n'existe pas.

- [x] **Étape 3 : `allauth.ts`**

Les chemins viennent du relevé de la tâche 4, étape 1. Ne pas les inventer.

**Avant d'écrire à la main**, faire la vérification que le spec §6 laisse ouverte :
`allauth` publie-t-il, dans la version installée, une spécification OpenAPI exploitable
pour son mode headless ? Si oui, la passer dans `openapi-typescript` comme un second
schéma et typer ce module dessus. Si non — ou si elle décrit un client autre que
`browser` — écrire le module à la main comme ci-dessous, et **noter la réponse dans
`apps/api/README.md`** pour que la question ne se repose pas au sous-projet 6.

```ts
/** django-allauth headless, browser client. Not in Ninja's OpenAPI. */
const BASE = "/_allauth/browser/v1";

export interface SessionUser {
  id: string;
  email: string;
}

export type AllauthResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "anonymous" | "unreachable" | "rejected"; detail?: string };

function csrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function call(path: string, init: RequestInit = {}): Promise<Response | null> {
  const token = csrfToken();
  try {
    return await fetch(`${BASE}${path}`, {
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        ...(token ? { "X-CSRFToken": token } : {}),
        ...(init.headers ?? {}),
      },
      ...init,
    });
  } catch {
    // A network failure is never an error shown across the app (spec §2).
    return null;
  }
}

export async function fetchSession(): Promise<AllauthResult<SessionUser>> {
  const response = await call("/auth/session");
  if (response === null) return { ok: false, kind: "unreachable" };
  if (!response.ok) return { ok: false, kind: "anonymous" };
  const body = await response.json();
  const user = body?.data?.user;
  if (!user) return { ok: false, kind: "anonymous" };
  return { ok: true, value: { id: String(user.id), email: String(user.email) } };
}

export async function login(email: string, password: string): Promise<AllauthResult<SessionUser>> {
  const response = await call("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  if (response === null) return { ok: false, kind: "unreachable" };
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    return { ok: false, kind: "rejected", detail: body?.errors?.[0]?.message };
  }
  return fetchSession();
}

export async function logout(): Promise<void> {
  await call("/auth/session", { method: "DELETE" });
}
```

- [x] **Étape 4 : `session.tsx`**

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ensureCsrfCookie } from "./client";
import { fetchSession, login as allauthLogin, logout as allauthLogout, type SessionUser } from "./allauth";

export type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "unreachable" }
  | { status: "authenticated"; user: SessionUser };

const SessionContext = createContext<SessionState>({ status: "loading" });
const ActionsContext = createContext<{
  login: (email: string, password: string) => Promise<SessionState>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}>({
  login: async () => ({ status: "anonymous" }),
  logout: async () => {},
  refresh: async () => {},
});

function toState(result: Awaited<ReturnType<typeof fetchSession>>): SessionState {
  if (result.ok) return { status: "authenticated", user: result.value };
  return result.kind === "unreachable" ? { status: "unreachable" } : { status: "anonymous" };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  const refresh = useCallback(async () => {
    await ensureCsrfCookie();
    setState(toState(await fetchSession()));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const actions = useMemo(
    () => ({
      refresh,
      login: async (email: string, password: string) => {
        const next = toState(await allauthLogin(email, password));
        setState(next);
        return next;
      },
      logout: async () => {
        await allauthLogout();
        setState({ status: "anonymous" });
      },
    }),
    [refresh],
  );

  return (
    <SessionContext.Provider value={state}>
      <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}

export function useSessionActions() {
  return useContext(ActionsContext);
}
```

- [x] **Étape 5 : monter le provider**

Dans `apps/web/src/App.tsx`, envelopper l'arbre existant dans `<SessionProvider>`.
**Aucune route n'est protégée** : le provider ne bloque rien, il informe.

- [x] **Étape 6 : lancer, voir passer**

```bash
pnpm --filter web test src/api/session.test.tsx
```

Attendu : les trois tests PASSENT.

- [x] **Étape 7 : commit**

```bash
git add -A
git commit -m "feat(web): session allauth, trois états, jamais une erreur en travers"
```

---

## Tâche 13 : profils IndexedDB et adoption

**Files:**
- Create: `apps/web/src/db/profile.ts`, `apps/web/src/db/DbProvider.tsx`, `apps/web/src/db/profile.test.ts`
- Modify: `apps/web/src/db/hooks.ts`, `apps/web/src/App.tsx`, `apps/web/src/pages/AccountsPage.tsx`, `apps/web/src/pages/SourcesPage.tsx`, `apps/web/src/mocks/seed.ts`

**Interfaces:**
- Consumes: `AppDatabase` et le singleton `db` de `db/schema.ts`, `useSession()`.
- Produces: `DEFAULT_PROFILE_DB = "ib-analyzer"`, `profileDbName(userId: string | null): string`, `profileDb(userId: string | null): AppDatabase`, `adoptDefaultProfile(userId: string): Promise<boolean>`, le composant `DbProvider` et le hook `useDb(): AppDatabase`.

- [x] **Étape 1 : les tests (échec attendu)**

`apps/web/src/db/profile.test.ts` :

```ts
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppDatabase, db } from "./schema";
import { DEFAULT_PROFILE_DB, adoptDefaultProfile, profileDb, profileDbName } from "./profile";

const USER = "42";

async function seedDefault() {
  await db.open();
  await db.accounts.put({
    id: "beta",
    label: "Beta",
    ibAccountId: "U1234567",
    createdAt: "2026-09-01T00:00:00.000Z",
    warnedDroppedKinds: [],
  });
  await db.sectors.put({
    ticker: "AANZ",
    name: "EXAMPLE OPTICS",
    category: "Tech",
    score: 3,
    status: "core",
    importedAt: "2026-09-01T00:00:00.000Z",
  });
}

beforeEach(async () => {
  for (const name of await Dexie.getDatabaseNames()) await Dexie.delete(name);
});

afterEach(async () => {
  for (const name of await Dexie.getDatabaseNames()) await Dexie.delete(name);
});

describe("profileDbName", () => {
  it("names the anonymous profile and one database per user", () => {
    expect(profileDbName(null)).toBe(DEFAULT_PROFILE_DB);
    expect(profileDbName(USER)).toBe(`${DEFAULT_PROFILE_DB}-${USER}`);
  });

  it("returns the same instance for the same profile", () => {
    expect(profileDb(USER)).toBe(profileDb(USER));
    expect(profileDb(USER)).not.toBe(profileDb(null));
  });
});

describe("adoptDefaultProfile", () => {
  it("moves every table into the user profile and removes the source", async () => {
    await seedDefault();

    expect(await adoptDefaultProfile(USER)).toBe(true);

    const adopted = new AppDatabase(profileDbName(USER));
    await adopted.open();
    expect(await adopted.accounts.get("beta")).toMatchObject({ label: "Beta" });
    expect(await adopted.sectors.get("AANZ")).toMatchObject({ category: "Tech" });
    expect(await Dexie.exists(DEFAULT_PROFILE_DB)).toBe(false);
  });

  it("adopts nothing a second time and leaves a regarnished default alone", async () => {
    await seedDefault();
    await adoptDefaultProfile(USER);

    const second = profileDb(null);
    await second.open();
    await second.accounts.put({
      id: "alpha",
      label: "Alpha",
      ibAccountId: "U7654321",
      createdAt: "2026-09-02T00:00:00.000Z",
      warnedDroppedKinds: [],
    });

    expect(await adoptDefaultProfile(USER)).toBe(false);

    const adopted = new AppDatabase(profileDbName(USER));
    await adopted.open();
    expect(await adopted.accounts.get("alpha")).toBeUndefined();
    expect(await second.accounts.get("alpha")).toMatchObject({ label: "Alpha" });
  });

  it("adopts nothing when there is no default profile at all", async () => {
    expect(await adoptDefaultProfile(USER)).toBe(false);
  });
});
```

- [x] **Étape 2 : lancer, voir échouer**

```bash
pnpm --filter web test src/db/profile.test.ts
```

Attendu : ÉCHEC, `./profile` n'existe pas.

- [x] **Étape 3 : `profile.ts`**

```ts
import Dexie from "dexie";
import { AppDatabase, db } from "./schema";

/** The profile of whoever is not logged in. Also the one adoption consumes. */
export const DEFAULT_PROFILE_DB = "ib-analyzer";

export function profileDbName(userId: string | null): string {
  return userId === null ? DEFAULT_PROFILE_DB : `${DEFAULT_PROFILE_DB}-${userId}`;
}

const opened = new Map<string, AppDatabase>([[DEFAULT_PROFILE_DB, db]]);

export function profileDb(userId: string | null): AppDatabase {
  const name = profileDbName(userId);
  let instance = opened.get(name);
  if (!instance) {
    instance = new AppDatabase(name);
    opened.set(name, instance);
  }
  return instance;
}

/**
 * First login of a user who has no profile yet: the anonymous profile becomes
 * theirs, so nothing is lost by someone who started without an account. Runs
 * at most once per user; afterwards the default profile is a separate, intact
 * profile of its own.
 */
export async function adoptDefaultProfile(userId: string): Promise<boolean> {
  const targetName = profileDbName(userId);
  if (await Dexie.exists(targetName)) return false;
  if (!(await Dexie.exists(DEFAULT_PROFILE_DB))) return false;

  const source = profileDb(null);
  await source.open();
  const rows = await Promise.all(
    source.tables.map(async (table) => [table.name, await table.toArray()] as const),
  );

  const target = new AppDatabase(targetName);
  await target.open();
  await target.transaction("rw", target.tables, async () => {
    for (const [name, items] of rows) {
      if (items.length > 0) await target.table(name).bulkPut(items);
    }
  });
  opened.set(targetName, target);

  source.close();
  opened.delete(DEFAULT_PROFILE_DB);
  await Dexie.delete(DEFAULT_PROFILE_DB);
  // `db` is the module singleton for the default profile: reopening it later
  // recreates an empty database, which is exactly what we want.
  opened.set(DEFAULT_PROFILE_DB, db);
  return true;
}
```

- [x] **Étape 4 : `DbProvider.tsx`**

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useSession } from "@/api/session";
import { adoptDefaultProfile, profileDb } from "./profile";
import { db, type AppDatabase } from "./schema";

const DbContext = createContext<AppDatabase>(db);

/** Every hook and every writer reads its database here, never by import. */
export function useDb(): AppDatabase {
  return useContext(DbContext);
}

export function DbProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const userId = session.status === "authenticated" ? session.user.id : null;
  const [ready, setReady] = useState<AppDatabase>(db);

  useEffect(() => {
    let cancelled = false;
    async function open() {
      if (userId !== null) await adoptDefaultProfile(userId);
      const next = profileDb(userId);
      await next.open();
      if (!cancelled) setReady(next);
    }
    void open();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return <DbContext.Provider value={ready}>{children}</DbContext.Provider>;
}
```

`DbProvider` se monte **à l'intérieur** de `SessionProvider` dans `App.tsx`.

- [x] **Étape 5 : les hooks passent par `useDb()`**

Dans `apps/web/src/db/hooks.ts`, remplacer l'import du singleton par `useDb()` et
**ajouter `db` aux dépendances de chaque `useLiveQuery`**, sans quoi un changement de
profil n'invaliderait pas la requête. Exemple pour le premier hook, à décliner sur les
six :

```ts
import { useDb } from "./DbProvider";

export function useAccounts(): AccountRecord[] | undefined {
  const db = useDb();
  return useLiveQuery(() => db.accounts.orderBy("id").toArray(), [db]);
}
```

Les quatre fichiers qui importent encore le singleton (`pages/AccountsPage.tsx`,
`pages/SourcesPage.tsx`, `db/hooks.ts`, `mocks/seed.ts`) passent à `useDb()`, sauf
`mocks/seed.ts` qui sème délibérément le profil par défaut et garde l'import direct.

- [x] **Étape 6 : lancer, voir passer**

```bash
pnpm --filter web test
```

Attendu : les cinq tests de `profile.test.ts` PASSENT, et **toute la suite existante
reste verte** : les tests actuels sèment le profil par défaut, qui est toujours celui que
`DbProvider` fournit par défaut.

- [x] **Étape 7 : commit**

```bash
git add -A
git commit -m "feat(web): une base IndexedDB par utilisateur, adoption du profil par défaut"
```

---

## Tâche 14 : écrans de connexion, d'invitation et de paramètres

**Files:**
- Create: `apps/web/src/pages/LoginPage.tsx`, `apps/web/src/pages/InvitationPage.tsx`, `apps/web/src/pages/SettingsPage.tsx`, `apps/web/src/components/SessionMenuItem.tsx`, et leurs tests `*.test.tsx`
- Modify: `apps/web/src/routes/router.tsx`, `apps/web/src/components/app-sidebar.tsx`, `apps/web/src/i18n/en.json`, `apps/web/src/i18n/fr.json`

**Interfaces:**
- Consumes: `useSession`, `useSessionActions`, `api` (pour `POST /core/invitations/accept`).
- Produces: les routes `/login`, `/invitation/:token`, `/settings`, et le composant `SessionMenuItem` au pied de la barre latérale.

- [x] **Étape 1 : les clés i18n**

Ajouter à `en.json` et `fr.json` les clés `auth.signIn`, `auth.signOut`, `auth.email`,
`auth.password`, `auth.submit`, `auth.badCredentials`, `auth.serverUnreachable`,
`auth.secondFactor`, `auth.code`, `invitation.title`, `invitation.choosePassword`,
`invitation.invalid`, `invitation.weakPassword`, `settings.title`, `settings.account`,
`settings.changePassword`, `settings.twoFactor`, `settings.enableTotp`,
`settings.recoveryCodes`, `settings.signedInAs`, `settings.signedOut`.

Les libellés français sont la référence ; l'anglais les traduit. **Aucune chaîne en dur
dans un composant.**

- [x] **Étape 2 : le test de la page de connexion (échec attendu)**

`apps/web/src/pages/LoginPage.test.tsx` :

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@/api/session";
import LoginPage from "./LoginPage";

function renderPage() {
  render(
    <MemoryRouter>
      <SessionProvider>
        <LoginPage />
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe("LoginPage", () => {
  it("shows the rejection message when the credentials are refused", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/auth/login")) return new Response(JSON.stringify({ errors: [] }), { status: 400 });
      return new Response("{}", { status: 401 });
    });

    renderPage();
    await userEvent.type(screen.getByLabelText(/e-?mail/i), "a@example.com");
    await userEvent.type(screen.getByLabelText(/mot de passe|password/i), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /se connecter|sign in/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("says the server is unreachable rather than blaming the credentials", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    renderPage();
    await userEvent.type(screen.getByLabelText(/e-?mail/i), "a@example.com");
    await userEvent.type(screen.getByLabelText(/mot de passe|password/i), "whatever");
    await userEvent.click(screen.getByRole("button", { name: /se connecter|sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/injoignable|unreachable/i);
  });
});
```

- [x] **Étape 3 : les trois pages**

`LoginPage.tsx` : un formulaire `email` + `password`, un `role="alert"` pour l'échec, et
la distinction **refus** / **serveur injoignable**. Après succès, redirection vers la
route d'où l'on vient (`location.state?.from`) ou `/`.

Si la réponse d'`allauth` indique qu'un second facteur est requis (statut et forme relevés
à la tâche 4, étape 1), afficher le champ de code et appeler l'endpoint de second facteur.

`InvitationPage.tsx` : lit `:token` par `useParams`, un champ mot de passe, appelle

```ts
const { data, error } = await api.POST("/core/invitations/accept", {
  body: { token, password },
});
```

`error.code === "invitation-invalid"` affiche `invitation.invalid` ;
`error.code === "password-invalid"` affiche `error.detail`. Sur succès, `refresh()` de
`useSessionActions` puis redirection vers `/`.

`SettingsPage.tsx` : section « Compte » avec l'email affiché, le changement de mot de
passe, l'activation et la désactivation de la TOTP et l'affichage **unique** des codes de
secours. La sauvegarde chiffrée y arrivera au sous-projet 6 : ne rien poser en attendant.

- [x] **Étape 4 : routes et barre latérale**

Ajouter à `router.tsx` les routes `/login`, `/invitation/:token` et `/settings`.
**Aucune n'est protégée, et aucune autre ne le devient.**

`SessionMenuItem.tsx` au pied de `app-sidebar.tsx` : `auth.signIn` en `<Link>` quand
l'état est `anonymous` ou `unreachable`, l'email et `auth.signOut` quand il est
`authenticated`, rien pendant `loading`.

- [x] **Étape 5 : lancer, voir passer**

```bash
pnpm --filter web test
```

- [x] **Étape 6 : capture visuelle**

```bash
pnpm dlx tsx .claude/skills/run-frontend/driver.mjs --seed --route=/login
```

Vérifier que le rendu reste celui de l'ancien frontend : mêmes composants, même thème.

- [x] **Étape 7 : commit**

```bash
git add -A
git commit -m "feat(web): écrans de connexion, d'invitation et de paramètres"
```

---

## Tâche 15 : champs Flex sur le compte, version 3 du schéma Dexie

**Files:**
- Modify: `apps/web/src/db/schema.ts`, `apps/web/src/db/accounts.ts`, `apps/web/src/pages/SourcesPage.tsx`, `apps/web/src/i18n/*.json`
- Create: `apps/web/src/db/flexCredentials.test.ts`

**Interfaces:**
- Consumes: `AccountRecord`.
- Produces: les champs facultatifs `flexToken`, `flexQueryId`, `lastFlexSyncAt`, `lastFlexSyncStatus` sur `AccountRecord`, et `setFlexCredentials(db, accountId, { token, queryId })`.

- [x] **Étape 1 : le test (échec attendu)**

`apps/web/src/db/flexCredentials.test.ts` :

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./schema";
import { setFlexCredentials } from "./accounts";

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.accounts.put({
    id: "beta",
    label: "Beta",
    ibAccountId: "U1234567",
    createdAt: "2026-09-01T00:00:00.000Z",
    warnedDroppedKinds: [],
  });
});

describe("setFlexCredentials", () => {
  it("stores the token and the query id on the account", async () => {
    await setFlexCredentials(db, "beta", { token: "tok", queryId: "123" });
    expect(await db.accounts.get("beta")).toMatchObject({ flexToken: "tok", flexQueryId: "123" });
  });

  it("clears them when given empty strings, never storing an empty token", async () => {
    await setFlexCredentials(db, "beta", { token: "tok", queryId: "123" });
    await setFlexCredentials(db, "beta", { token: "  ", queryId: "" });
    const account = await db.accounts.get("beta");
    expect(account?.flexToken).toBeUndefined();
    expect(account?.flexQueryId).toBeUndefined();
  });

  it("leaves the sync state alone", async () => {
    await db.accounts.update("beta", { lastFlexSyncAt: "2026-09-03T00:00:00.000Z" });
    await setFlexCredentials(db, "beta", { token: "tok", queryId: "1" });
    expect((await db.accounts.get("beta"))?.lastFlexSyncAt).toBe("2026-09-03T00:00:00.000Z");
  });
});
```

- [x] **Étape 2 : lancer, voir échouer**

```bash
pnpm --filter web test src/db/flexCredentials.test.ts
```

- [x] **Étape 3 : le schéma**

Ajouter à `AccountRecord` dans `db/schema.ts` :

```ts
  /** Flex Web Service token, typed by the user. Leaves the browser only for the proxy. */
  flexToken?: string;
  /** The query id of this account's Flex Query. */
  flexQueryId?: string;
  /** ISO timestamp of the last successful sync; absent means never. */
  lastFlexSyncAt?: string;
  /** Outcome of the last attempt, for the Sources page. */
  lastFlexSyncStatus?: { at: string; ok: boolean; code?: string };
```

et la version 3 du schéma — **aucun index nouveau**, ces champs ne sont jamais des clés :

```ts
    this.version(3).stores({
      accounts: "id",
    });
```

- [x] **Étape 4 : `setFlexCredentials`**

Dans `db/accounts.ts` :

```ts
/** An empty field clears the credential: an empty token is never stored. */
export async function setFlexCredentials(
  db: AppDatabase,
  accountId: string,
  input: { token: string; queryId: string },
): Promise<void> {
  const token = input.token.trim();
  const queryId = input.queryId.trim();
  await db.accounts.update(accountId, {
    flexToken: token === "" ? undefined : token,
    flexQueryId: queryId === "" ? undefined : queryId,
  });
}
```

- [x] **Étape 5 : le formulaire sur Sources de données**

Une carte « Flex Query » par compte : un champ `type="password"` pour le jeton, un champ
texte pour le query id, un bouton d'enregistrement. Clés i18n `sources.flexToken`,
`sources.flexQueryId`, `sources.saveCredentials`, `sources.credentialsSaved`.

- [x] **Étape 6 : lancer, voir passer, committer**

```bash
pnpm --filter web test
git add -A
git commit -m "feat(web): identifiants Flex par compte, schéma Dexie version 3"
```

---

## Tâche 16 : `ib-parsers`, enveloppes du Flex Web Service

**Files:**
- Create: `packages/ib-parsers/src/flexEnvelope.ts`, `packages/ib-parsers/src/flexEnvelope.test.ts`
- Modify: `packages/ib-parsers/src/index.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `parseFlexSendRequest(xml: string): FlexEnvelope` et `parseFlexStatementEnvelope(xml: string): FlexEnvelope`, avec
  `type FlexEnvelope = { status: "success"; referenceCode: string } | { status: "ready" } | { status: "error"; errorCode: string; errorMessage: string }`.

- [x] **Étape 1 : les tests (échec attendu)**

`packages/ib-parsers/src/flexEnvelope.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { parseFlexSendRequest, parseFlexStatementEnvelope } from "./flexEnvelope.ts";

const SUCCESS = `<?xml version="1.0"?>
<FlexStatementResponse timestamp="04 September, 2026 08:00 AM EDT">
  <Status>Success</Status>
  <ReferenceCode>1234567890</ReferenceCode>
  <Url>https://ndcdyn.interactivebrokers.com/x</Url>
</FlexStatementResponse>`;

const FAIL = `<?xml version="1.0"?>
<FlexStatementResponse>
  <Status>Fail</Status>
  <ErrorCode>1019</ErrorCode>
  <ErrorMessage>Statement generation in progress. Please try again shortly.</ErrorMessage>
</FlexStatementResponse>`;

const STATEMENT = `<?xml version="1.0"?>
<FlexQueryResponse queryName="Activity" type="AF">
  <FlexStatements count="1"><FlexStatement accountId="U1234567" fromDate="20250904" toDate="20260903"/></FlexStatements>
</FlexQueryResponse>`;

describe("parseFlexSendRequest", () => {
  it("reads the reference code of a success", () => {
    expect(parseFlexSendRequest(SUCCESS)).toEqual({ status: "success", referenceCode: "1234567890" });
  });

  it("reads the code and the message of a failure", () => {
    expect(parseFlexSendRequest(FAIL)).toEqual({
      status: "error",
      errorCode: "1019",
      errorMessage: "Statement generation in progress. Please try again shortly.",
    });
  });

  it("reports an error rather than throwing on a body that is not XML at all", () => {
    const result = parseFlexSendRequest("<html><body>502 Bad Gateway</body></html>");
    expect(result.status).toBe("error");
  });
});

describe("parseFlexStatementEnvelope", () => {
  it("says ready on an actual statement without parsing it", () => {
    expect(parseFlexStatementEnvelope(STATEMENT)).toEqual({ status: "ready" });
  });

  it("reads the error of a failure envelope", () => {
    expect(parseFlexStatementEnvelope(FAIL)).toEqual({
      status: "error",
      errorCode: "1019",
      errorMessage: "Statement generation in progress. Please try again shortly.",
    });
  });

  it("does not mistake a success envelope for a statement", () => {
    expect(parseFlexStatementEnvelope(SUCCESS).status).toBe("error");
  });
});
```

- [x] **Étape 2 : lancer, voir échouer**

```bash
pnpm --filter @ib/ib-parsers test src/flexEnvelope.test.ts
```

- [x] **Étape 3 : `flexEnvelope.ts`**

```ts
/**
 * The two-step Flex Web Service protocol answers with a small envelope before
 * it answers with a statement. Only the envelope is read here: the statement
 * itself goes to `parseFlexXml` untouched.
 */
export type FlexEnvelope =
  | { status: "success"; referenceCode: string }
  | { status: "ready" }
  | { status: "error"; errorCode: string; errorMessage: string };

const UNREADABLE: FlexEnvelope = {
  status: "error",
  errorCode: "unreadable",
  errorMessage: "The response was not a Flex Web Service envelope.",
};

function text(doc: Document, tag: string): string | null {
  return doc.querySelector(tag)?.textContent?.trim() ?? null;
}

function readError(doc: Document): FlexEnvelope {
  const errorCode = text(doc, "ErrorCode");
  if (errorCode === null) return UNREADABLE;
  return { status: "error", errorCode, errorMessage: text(doc, "ErrorMessage") ?? "" };
}

export function parseFlexSendRequest(xml: string): FlexEnvelope {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror")) return UNREADABLE;
  if (text(doc, "Status") === "Success") {
    const referenceCode = text(doc, "ReferenceCode");
    return referenceCode ? { status: "success", referenceCode } : UNREADABLE;
  }
  return readError(doc);
}

export function parseFlexStatementEnvelope(xml: string): FlexEnvelope {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror")) return UNREADABLE;
  if (doc.querySelector("FlexQueryResponse")) return { status: "ready" };
  return readError(doc);
}
```

- [x] **Étape 4 : exporter et vérifier**

Ajouter `export * from "./flexEnvelope.ts";` à `packages/ib-parsers/src/index.ts`.

```bash
pnpm --filter @ib/ib-parsers test
```

Attendu : les six tests PASSENT.

- [x] **Étape 5 : commit**

```bash
git add -A
git commit -m "feat(ib-parsers): enveloppes du Flex Web Service, sans lire le relevé"
```

---

## Tâche 17 : `flex/sync.ts`, la boucle de reprise

**Files:**
- Create: `apps/web/src/flex/stale.ts`, `apps/web/src/flex/proxy.ts`, `apps/web/src/flex/sync.ts`, `apps/web/src/flex/stale.test.ts`, `apps/web/src/flex/sync.test.ts`

**Interfaces:**
- Consumes: `api` (tâche 11), `parseFlexSendRequest` et `parseFlexStatementEnvelope` (tâche 16), `importFile` (existant), `AccountRecord` avec ses champs Flex (tâche 15).
- Produces:
  - `FLEX_SYNC_STALE_MS`, `isFlexSyncStale(lastAt: string | undefined, now: number): boolean`
  - `type ProxyResult = { ok: true; xml: string } | { ok: false; code: ProxyErrorCode }`
  - `sendRequest(input)` et `getStatement(input)` dans `proxy.ts`
  - `syncAccount(deps: FlexSyncDeps, account: AccountRecord): Promise<FlexSyncOutcome>`
  - `type FlexSyncOutcome = { status: "ok"; report: ImportReport } | { status: "skipped"; code: "no-credentials" } | { status: "failed"; code: string }`

- [x] **Étape 1 : le test de péremption (échec attendu)**

`apps/web/src/flex/stale.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { FLEX_SYNC_STALE_MS, isFlexSyncStale } from "./stale";

const NOW = Date.parse("2026-09-04T12:00:00.000Z");

describe("isFlexSyncStale", () => {
  it("is twelve hours", () => {
    expect(FLEX_SYNC_STALE_MS).toBe(12 * 60 * 60 * 1000);
  });

  it("is stale when there has never been a sync", () => {
    expect(isFlexSyncStale(undefined, NOW)).toBe(true);
  });

  it("is fresh one millisecond before the threshold", () => {
    expect(isFlexSyncStale(new Date(NOW - FLEX_SYNC_STALE_MS + 1).toISOString(), NOW)).toBe(false);
  });

  it("is stale exactly at the threshold", () => {
    expect(isFlexSyncStale(new Date(NOW - FLEX_SYNC_STALE_MS).toISOString(), NOW)).toBe(true);
  });

  it("treats an unparsable timestamp as stale rather than trusting it", () => {
    expect(isFlexSyncStale("not a date", NOW)).toBe(true);
  });
});
```

- [x] **Étape 2 : `stale.ts`**

```ts
/** Flex only moves once a day: syncing more often burns IB's quota for nothing. */
export const FLEX_SYNC_STALE_MS = 12 * 60 * 60 * 1000;

export function isFlexSyncStale(lastAt: string | undefined, now: number): boolean {
  if (!lastAt) return true;
  const last = Date.parse(lastAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= FLEX_SYNC_STALE_MS;
}
```

- [x] **Étape 3 : les tests de la boucle (échec attendu)**

`apps/web/src/flex/sync.test.ts` :

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, type AccountRecord } from "@/db/schema";
import { syncAccount, type FlexSyncDeps } from "./sync";

const ACCOUNT: AccountRecord = {
  id: "beta",
  label: "Beta",
  ibAccountId: "U1234567",
  createdAt: "2026-09-01T00:00:00.000Z",
  warnedDroppedKinds: [],
  flexToken: "tok",
  flexQueryId: "123",
};

const SENT = `<FlexStatementResponse><Status>Success</Status><ReferenceCode>REF1</ReferenceCode></FlexStatementResponse>`;
const inProgress = (code: string) =>
  `<FlexStatementResponse><Status>Fail</Status><ErrorCode>${code}</ErrorCode><ErrorMessage>wait</ErrorMessage></FlexStatementResponse>`;
const STATEMENT = `<FlexQueryResponse queryName="Activity" type="AF"><FlexStatements count="1">` +
  `<FlexStatement accountId="U1234567" fromDate="20250904" toDate="20260903" whenGenerated="20260904;080000">` +
  `<Trades></Trades></FlexStatement></FlexStatements></FlexQueryResponse>`;

function deps(overrides: Partial<FlexSyncDeps> = {}): FlexSyncDeps {
  return {
    db,
    sendRequest: vi.fn(async () => ({ ok: true as const, xml: SENT })),
    getStatement: vi.fn(async () => ({ ok: true as const, xml: STATEMENT })),
    sleep: vi.fn(async () => {}),
    now: () => new Date("2026-09-04T12:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.accounts.put(ACCOUNT);
});

describe("syncAccount", () => {
  it("does nothing at all without credentials", async () => {
    const d = deps();
    const outcome = await syncAccount(d, { ...ACCOUNT, flexToken: undefined });
    expect(outcome).toEqual({ status: "skipped", code: "no-credentials" });
    expect(d.sendRequest).not.toHaveBeenCalled();
  });

  it("waits five seconds on 1019 and ten on 1018, then imports", async () => {
    const answers = [inProgress("1019"), inProgress("1018"), STATEMENT];
    const getStatement = vi.fn(async () => ({ ok: true as const, xml: answers.shift()! }));
    const sleep = vi.fn(async () => {});
    const outcome = await syncAccount(deps({ getStatement, sleep }), ACCOUNT);

    expect(outcome.status).toBe("ok");
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([5000, 10000]);
    expect(getStatement).toHaveBeenCalledTimes(3);
  });

  it("waits five seconds on 1009 too", async () => {
    const answers = [inProgress("1009"), STATEMENT];
    const sleep = vi.fn(async () => {});
    await syncAccount(deps({ getStatement: vi.fn(async () => ({ ok: true as const, xml: answers.shift()! })), sleep }), ACCOUNT);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([5000]);
  });

  it("gives up on an error code that is not a retry, without waiting", async () => {
    const sleep = vi.fn(async () => {});
    const outcome = await syncAccount(
      deps({ getStatement: vi.fn(async () => ({ ok: true as const, xml: inProgress("1003") })), sleep }),
      ACCOUNT,
    );
    expect(outcome).toEqual({ status: "failed", code: "1003" });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up after the attempt ceiling rather than looping for ever", async () => {
    const getStatement = vi.fn(async () => ({ ok: true as const, xml: inProgress("1019") }));
    const outcome = await syncAccount(deps({ getStatement }), ACCOUNT);
    expect(outcome).toEqual({ status: "failed", code: "flex-retry-exhausted" });
    expect(getStatement.mock.calls.length).toBeLessThanOrEqual(12);
  });

  it("stops on a send-request failure without ever asking for the statement", async () => {
    const getStatement = vi.fn();
    const outcome = await syncAccount(
      deps({ sendRequest: vi.fn(async () => ({ ok: false as const, code: "unauthenticated" })), getStatement }),
      ACCOUNT,
    );
    expect(outcome).toEqual({ status: "failed", code: "unauthenticated" });
    expect(getStatement).not.toHaveBeenCalled();
  });

  it("records the outcome on the account, success or failure", async () => {
    await syncAccount(deps(), ACCOUNT);
    const ok = await db.accounts.get("beta");
    expect(ok?.lastFlexSyncAt).toBe("2026-09-04T12:00:00.000Z");
    expect(ok?.lastFlexSyncStatus).toEqual({ at: "2026-09-04T12:00:00.000Z", ok: true });

    await syncAccount(deps({ sendRequest: vi.fn(async () => ({ ok: false as const, code: "flex-unreachable" })) }), ACCOUNT);
    const failed = await db.accounts.get("beta");
    expect(failed?.lastFlexSyncStatus).toEqual({
      at: "2026-09-04T12:00:00.000Z",
      ok: false,
      code: "flex-unreachable",
    });
    // A failed attempt never moves the "last successful sync" mark.
    expect(failed?.lastFlexSyncAt).toBe("2026-09-04T12:00:00.000Z");
  });
});
```

- [x] **Étape 4 : lancer, voir échouer**

```bash
pnpm --filter web test src/flex
```

- [x] **Étape 5 : `proxy.ts`**

```ts
export type ProxyErrorCode =
  | "unauthenticated"
  | "rate-limited"
  | "flex-timeout"
  | "flex-unreachable"
  | "network";

export type ProxyResult = { ok: true; xml: string } | { ok: false; code: ProxyErrorCode };

async function relay(path: "/ib/flex/send-request" | "/ib/flex/get-statement", body: unknown): Promise<ProxyResult> {
  let response: Response;
  try {
    // openapi-fetch parses JSON; the proxy answers XML, so the raw Response is
    // what we want here. The typed client still guards the request body.
    response = await fetch(`/api${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        ...csrfHeader(),
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, code: "network" };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, code: "unauthenticated" };
  if (response.status === 429) return { ok: false, code: "rate-limited" };
  if (response.status === 504) return { ok: false, code: "flex-timeout" };
  if (!response.ok) return { ok: false, code: "flex-unreachable" };
  return { ok: true, xml: await response.text() };
}

function csrfHeader(): Record<string, string> {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]*)/);
  return match ? { "X-CSRFToken": decodeURIComponent(match[1]) } : {};
}

export function sendRequest(input: { token: string; queryId: string }): Promise<ProxyResult> {
  return relay("/ib/flex/send-request", input);
}

export function getStatement(input: { token: string; referenceCode: string }): Promise<ProxyResult> {
  return relay("/ib/flex/get-statement", input);
}
```

`fetch` brut plutôt qu'`openapi-fetch` ici : le corps est du XML opaque, `openapi-fetch`
le passerait par `JSON.parse`. La garantie de types de la tâche 11 porte sur les corps de
requête et les erreurs (spec §6), pas sur ce contenu.

- [x] **Étape 6 : `sync.ts`**

```ts
import { parseFlexSendRequest, parseFlexStatementEnvelope } from "@ib/ib-parsers";
import { importFile, type ImportReport } from "@/db/importFile";
import type { AccountRecord, AppDatabase } from "@/db/schema";
import type { ProxyResult } from "./proxy";

/** IB's own retry guidance (spec fondateur §3.2). Anything else is fatal. */
const RETRY_WAIT_MS: Record<string, number> = { "1009": 5000, "1019": 5000, "1018": 10000 };
const MAX_ATTEMPTS = 12;

export interface FlexSyncDeps {
  db: AppDatabase;
  sendRequest: (input: { token: string; queryId: string }) => Promise<ProxyResult>;
  getStatement: (input: { token: string; referenceCode: string }) => Promise<ProxyResult>;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
}

export type FlexSyncOutcome =
  | { status: "ok"; report: ImportReport }
  | { status: "skipped"; code: "no-credentials" }
  | { status: "failed"; code: string };

async function record(deps: FlexSyncDeps, accountId: string, outcome: FlexSyncOutcome): Promise<FlexSyncOutcome> {
  const at = deps.now().toISOString();
  const ok = outcome.status === "ok";
  await deps.db.accounts.update(accountId, {
    // `record` is only ever called on "ok" and "failed": a skipped sync returns
    // before it, and must leave the account untouched.
    lastFlexSyncStatus: outcome.status === "ok" ? { at, ok } : { at, ok, code: outcome.code },
    ...(ok ? { lastFlexSyncAt: at } : {}),
  });
  return outcome;
}

export async function syncAccount(deps: FlexSyncDeps, account: AccountRecord): Promise<FlexSyncOutcome> {
  const token = account.flexToken;
  const queryId = account.flexQueryId;
  if (!token || !queryId) return { status: "skipped", code: "no-credentials" };

  const sent = await deps.sendRequest({ token, queryId });
  if (!sent.ok) return record(deps, account.id, { status: "failed", code: sent.code });

  const envelope = parseFlexSendRequest(sent.xml);
  if (envelope.status !== "success") {
    return record(deps, account.id, {
      status: "failed",
      code: envelope.status === "error" ? envelope.errorCode : "unreadable",
    });
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const answer = await deps.getStatement({ token, referenceCode: envelope.referenceCode });
    if (!answer.ok) return record(deps, account.id, { status: "failed", code: answer.code });

    const state = parseFlexStatementEnvelope(answer.xml);
    if (state.status === "ready") {
      const day = deps.now().toISOString().slice(0, 10);
      const file = new File([answer.xml], `flex-${day}.xml`, { type: "application/xml" });
      const fresh = (await deps.db.accounts.get(account.id)) ?? account;
      const report = await importFile(deps.db, fresh, file);
      if (report.status === "error") {
        return record(deps, account.id, { status: "failed", code: "import-refused" });
      }
      return record(deps, account.id, { status: "ok", report });
    }

    const wait = state.status === "error" ? RETRY_WAIT_MS[state.errorCode] : undefined;
    if (wait === undefined) {
      return record(deps, account.id, {
        status: "failed",
        code: state.status === "error" ? state.errorCode : "unreadable",
      });
    }
    await deps.sleep(wait);
  }

  return record(deps, account.id, { status: "failed", code: "flex-retry-exhausted" });
}
```

- [x] **Étape 7 : lancer, voir passer**

```bash
pnpm --filter web test src/flex
```

Attendu : les cinq tests de `stale.test.ts` et les sept de `sync.test.ts` PASSENT.

- [x] **Étape 8 : commit**

```bash
git add -A
git commit -m "feat(web): boucle de synchro Flex, attentes IB et plafond d'essais"
```

---

## Tâche 18 : verrou d'import unique et `importFile` transactionnel

> **C'est la dette du sous-projet 2** (`docs/points-reportes.md`, « À traiter au
> sous-projet 3 »). Elle se paie maintenant parce que la synchro de fond peut croiser un
> import manuel.

**Files:**
- Create: `apps/web/src/db/importLock.ts`, `apps/web/src/db/importLock.test.ts`
- Modify: `apps/web/src/db/importFile.ts`, `apps/web/src/db/importFile.test.ts`, `apps/web/src/flex/sync.ts`, `apps/web/src/pages/SourcesPage.tsx`

**Interfaces:**
- Consumes: `importFile`.
- Produces: `withImportLock<T>(run: () => Promise<T>): Promise<T>`, et un `importFile` dont le plan est calculé **dans** la transaction.

- [x] **Étape 1 : les tests (échec attendu)**

`apps/web/src/db/importLock.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { withImportLock } from "./importLock";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("withImportLock", () => {
  it("never lets two imports overlap", async () => {
    const events: string[] = [];
    const first = deferred<void>();

    const a = withImportLock(async () => {
      events.push("a:start");
      await first.promise;
      events.push("a:end");
    });
    const b = withImportLock(async () => {
      events.push("b:start");
      events.push("b:end");
    });

    expect(events).toEqual(["a:start"]);
    first.resolve();
    await Promise.all([a, b]);
    expect(events).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("lets the queue carry on after a failure", async () => {
    const failing = withImportLock(async () => {
      throw new Error("boom");
    });
    await expect(failing).rejects.toThrow("boom");
    await expect(withImportLock(async () => "next")).resolves.toBe("next");
  });
});
```

Ajouter à `apps/web/src/db/importFile.test.ts` :

```ts
it("two concurrent imports of the same account agree on one ledger", async () => {
  const account = (await db.accounts.get("beta"))!;
  const file = () => new File([FLEX_XML], "flex.xml", { type: "application/xml" });

  const [first, second] = await Promise.all([
    withImportLock(() => importFile(db, account, file())),
    withImportLock(() => importFile(db, account, file())),
  ]);

  expect(first.status).toBe("ok");
  expect(second.status).toBe("ok");
  const rows = await db.transactions.where("accountId").equals("beta").toArray();
  // The second import replaces the first one's range: no duplicate, no loss.
  expect(rows).toHaveLength((first as { imported: number }).imported);
  expect(await db.imports.where("accountId").equals("beta").count()).toBe(2);
});
```

`FLEX_XML` est la fixture Flex déjà utilisée par ce fichier de tests ; réutiliser la
constante existante plutôt que d'en écrire une nouvelle. Ajouter en tête du fichier
`import { withImportLock } from "./importLock";`.

- [x] **Étape 2 : lancer, voir échouer**

```bash
pnpm --filter web test src/db/importLock.test.ts src/db/importFile.test.ts
```

- [x] **Étape 3 : `importLock.ts`**

```ts
/**
 * One import at a time, whatever its origin. A background Flex sync and a
 * manual file drop must not compute their plans against the same stale view of
 * the ledger.
 */
let tail: Promise<unknown> = Promise.resolve();

export function withImportLock<T>(run: () => Promise<T>): Promise<T> {
  const next = tail.then(run, run);
  tail = next.catch(() => undefined);
  return next;
}
```

- [x] **Étape 4 : le plan entre dans la transaction**

Dans `importFile.ts`, supprimer les trois lignes qui lisent l'état et calculent le plan
avant la transaction, et les refaire **à l'intérieur**, en relisant aussi le compte :

```ts
  let plan!: ReturnType<typeof planImport>;
  let newlyDropped: DroppedCount[] = [];
  const at = new Date().toISOString();
  // ... (snapshot, positionsWritten, cashWritten, staleSnapshot inchangés)

  await db.transaction("rw", db.transactions, db.imports, db.accounts, db.snapshots, async () => {
    // Read inside the transaction: a concurrent import must not make this plan
    // stale between the read and the write.
    const fresh = (await db.accounts.get(account.id)) ?? account;
    const existing = await db.transactions.where("accountId").equals(account.id).toArray();
    plan = planImport(existing, { source, transactions: parsed.transactions, period });
    newlyDropped = plan.dropped.filter((d) => !fresh.warnedDroppedKinds.includes(d.kind));

    await db.transactions.bulkDelete(plan.delete.map((externalId) => [account.id, externalId]));
    await db.transactions.bulkPut(plan.upsert);
    // ... (le bloc snapshot et le bloc imports.add inchangés)
    if (newlyDropped.length > 0) {
      await db.accounts.update(account.id, {
        warnedDroppedKinds: [...fresh.warnedDroppedKinds, ...newlyDropped.map((d) => d.kind)],
      });
    }
  });
```

Mettre à jour le commentaire d'en-tête de la fonction : le compte est désormais relu dans
la transaction, l'avertissement sur le `AccountRecord` fraîchement lu n'a plus lieu d'être.

- [x] **Étape 5 : brancher le verrou sur les deux appelants**

Dans `flex/sync.ts`, envelopper l'appel : `await withImportLock(() => importFile(...))`.
Dans `SourcesPage.tsx`, envelopper l'import manuel de la même façon.

- [x] **Étape 6 : lancer, voir passer**

```bash
pnpm --filter web test
```

- [x] **Étape 7 : retirer la dette et committer**

Supprimer de `docs/points-reportes.md` la section « À traiter au sous-projet 3 »
entièrement, puisqu'elle ne contenait que ce point.

```bash
git add -A
git commit -m "fix(web): plan d'import calculé dans la transaction, verrou d'import unique"
```

---

## Tâche 19 : déclenchement à l'ouverture, bouton manuel, états de Sources

**Files:**
- Create: `apps/web/src/flex/useFlexAutoSync.ts`, `apps/web/src/flex/useFlexAutoSync.test.tsx`
- Modify: `apps/web/src/routes/AppLayout.tsx`, `apps/web/src/pages/SourcesPage.tsx`, `apps/web/src/pages/SourcesPage.test.tsx`, `apps/web/src/i18n/*.json`

**Interfaces:**
- Consumes: `syncAccount`, `isFlexSyncStale`, `useSession`, `useDb`.
- Produces: le hook `useFlexAutoSync(accountId: string): { state: "idle" | "running"; run: () => Promise<void> }`.

- [x] **Étape 1 : les tests (échec attendu)**

`apps/web/src/flex/useFlexAutoSync.test.tsx` — chaque cas sème le compte avec le
`lastFlexSyncAt` voulu, moque `syncAccount`, et affirme sur le **nombre d'appels**, jamais
sur un délai :

```tsx
import { render, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@/api/session";
import { DbProvider } from "@/db/DbProvider";
import { db, type AccountRecord } from "@/db/schema";
import { FLEX_SYNC_STALE_MS } from "./stale";
import { useFlexAutoSync } from "./useFlexAutoSync";
import { syncAccount } from "./sync";

vi.mock("./sync", () => ({ syncAccount: vi.fn(async () => ({ status: "ok", report: {} })) }));

const NOW = Date.now();
const BASE: AccountRecord = {
  id: "beta",
  label: "Beta",
  ibAccountId: "U1234567",
  createdAt: "2026-09-01T00:00:00.000Z",
  warnedDroppedKinds: [],
  flexToken: "tok",
  flexQueryId: "123",
};

let runHandle: () => Promise<void>;

function Probe() {
  const { run } = useFlexAutoSync("beta");
  runHandle = run;
  return null;
}

/** `authenticated` when true, `anonymous` when false. Nothing else is mocked. */
function mockSession(loggedIn: boolean) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/auth/session")) {
      return loggedIn
        ? new Response(JSON.stringify({ data: { user: { id: 7, email: "a@example.com" } } }), { status: 200 })
        : new Response("{}", { status: 401 });
    }
    return new Response("{}", { status: 200 });
  });
}

async function seed(overrides: Partial<AccountRecord>) {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.accounts.put({ ...BASE, ...overrides });
}

function renderProbe() {
  render(
    <SessionProvider>
      <DbProvider>
        <Probe />
      </DbProvider>
    </SessionProvider>,
  );
}

beforeEach(() => vi.mocked(syncAccount).mockClear());
afterEach(() => vi.restoreAllMocks());

describe("useFlexAutoSync", () => {
  it("syncs on entering an account whose last sync is older than twelve hours", async () => {
    await seed({ lastFlexSyncAt: new Date(NOW - FLEX_SYNC_STALE_MS - 1000).toISOString() });
    mockSession(true);
    renderProbe();
    await waitFor(() => expect(syncAccount).toHaveBeenCalledTimes(1));
  });

  it("does not sync when the last sync is fresh", async () => {
    await seed({ lastFlexSyncAt: new Date(NOW - 60_000).toISOString() });
    mockSession(true);
    renderProbe();
    await waitFor(() => expect(syncAccount).not.toHaveBeenCalled());
  });

  it("does not sync when nobody is logged in, however stale it is", async () => {
    await seed({ lastFlexSyncAt: undefined });
    mockSession(false);
    renderProbe();
    await waitFor(() => expect(syncAccount).not.toHaveBeenCalled());
  });

  it("does not sync when the account has no token", async () => {
    await seed({ flexToken: undefined, lastFlexSyncAt: undefined });
    mockSession(true);
    renderProbe();
    await waitFor(() => expect(syncAccount).not.toHaveBeenCalled());
  });

  it("run() syncs whatever the staleness, once logged in", async () => {
    await seed({ lastFlexSyncAt: new Date(NOW - 60_000).toISOString() });
    mockSession(true);
    renderProbe();
    await waitFor(() => expect(runHandle).toBeDefined());
    await act(async () => {
      await runHandle();
    });
    expect(syncAccount).toHaveBeenCalledTimes(1);
  });
});
```

Le dernier cas est celui qui mord le plus : il distingue le bouton manuel, qui ignore la
péremption, de la synchro automatique, qui la respecte.

- [x] **Étape 2 : `useFlexAutoSync.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/api/session";
import { useDb } from "@/db/DbProvider";
import { getStatement, sendRequest } from "./proxy";
import { isFlexSyncStale } from "./stale";
import { syncAccount } from "./sync";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function useFlexAutoSync(accountId: string) {
  const db = useDb();
  const session = useSession();
  const [state, setState] = useState<"idle" | "running">("idle");
  const running = useRef(false);

  const run = useCallback(async () => {
    if (running.current) return;
    const account = await db.accounts.get(accountId);
    if (!account) return;
    running.current = true;
    setState("running");
    try {
      await syncAccount(
        { db, sendRequest, getStatement, sleep, now: () => new Date() },
        account,
      );
    } finally {
      running.current = false;
      setState("idle");
    }
  }, [accountId, db]);

  useEffect(() => {
    // Never without a session, never without credentials, never when fresh.
    if (session.status !== "authenticated") return;
    let cancelled = false;
    void (async () => {
      const account = await db.accounts.get(accountId);
      if (cancelled || !account?.flexToken || !account.flexQueryId) return;
      if (!isFlexSyncStale(account.lastFlexSyncAt, Date.now())) return;
      await run();
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, db, run, session.status]);

  return { state, run };
}
```

`importFile` et `withImportLock` restent chez `sync.ts` (tâche 18, étape 5) : ce hook ne
connaît que `syncAccount`.

- [x] **Étape 3 : brancher**

Dans `AppLayout.tsx`, appeler `useFlexAutoSync(accountId)` : c'est le composant monté à
l'entrée sur un compte.

Dans `SourcesPage.tsx`, une carte « Synchronisation » par compte :

| État | Ce qui s'affiche |
|---|---|
| pas de session | `sync.needsAccount` et un lien vers `/login`, bouton désactivé |
| serveur injoignable | `sync.serverUnreachable`, bouton désactivé |
| pas de jeton | `sync.needsCredentials`, bouton désactivé |
| prêt | dernière synchro réussie, bouton `sync.run` actif |
| en cours | bouton désactivé, libellé `sync.running` |
| dernier essai en échec | `sync.lastFailed` avec le code, bouton toujours actif |

**Aucun de ces états n'est une erreur** : ce sont des explications (contrainte globale).

- [x] **Étape 4 : lancer, voir passer, capturer**

```bash
pnpm --filter web test
pnpm dlx tsx .claude/skills/run-frontend/driver.mjs --seed --route=/accounts/beta/sources
```

- [x] **Étape 5 : commit**

```bash
git add -A
git commit -m "feat(web): synchro à l'ouverture si périmée, bouton manuel, états de Sources"
```

---

## Tâche 20 : bout en bout Playwright

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/auth.spec.ts`, `apps/web/e2e/sync.spec.ts`
- Modify: `apps/web/vite.config.ts`, `apps/web/package.json`

**Interfaces:**
- Consumes: la pile complète, serveur Django compris.
- Produces: la commande `pnpm --filter web e2e`.

- [x] **Étape 1 : le proxy de développement**

Sans lui, rien ne marche hors Docker : le SPA sur 5173 et Django sur 8000 ne partagent pas
d'origine. Ajouter à `apps/web/vite.config.ts` :

```ts
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/_allauth": "http://127.0.0.1:8000",
    },
  },
```

C'est ce qui reconstitue en développement l'origine unique qu'on a en production.

- [x] **Étape 2 : `playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:5173" },
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
  },
});
```

Le serveur Django et sa base sont lancés à la main avant : la commande est dans
`apps/api/README.md`. Un `e2e` qui démarre Docker serait plus fragile que le gain.

- [x] **Étape 3 : `e2e/auth.spec.ts`**

Le parcours du §12.3 du spec, en une seule spécification :

```ts
import { expect, test } from "@playwright/test";

// The token comes from the environment: a Django management command creates
// the invitation before the run. No invitation is ever committed.
const TOKEN = process.env.E2E_INVITATION_TOKEN!;
const PASSWORD = "correct-horse-battery";

test("invitation, password, login, 2FA, logout", async ({ page }) => {
  await page.goto(`/invitation/${TOKEN}`);
  await page.getByLabel(/mot de passe|password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /valider|submit/i }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/settings");
  await expect(page.getByText(/e2e@example\.test/)).toBeVisible();

  await page.getByRole("button", { name: /activer|enable/i }).click();
  await expect(page.getByText(/code|secret/i)).toBeVisible();

  await page.getByRole("button", { name: /se déconnecter|sign out/i }).click();
  await expect(page.getByRole("link", { name: /se connecter|sign in/i })).toBeVisible();
});
```

Créer l'invitation avant la campagne :

```bash
uv run --project apps/api python apps/api/manage.py shell -c \
  "from core.models import Invitation; print(Invitation.issue(email='e2e@example.test').token)"
```

- [x] **Étape 4 : `e2e/sync.spec.ts`**

Une synchro complète contre un proxy stubbé : `page.route("**/api/ib/flex/**", ...)` rend
d'abord l'enveloppe de succès, puis un `1019`, puis le relevé de la fixture anonymisée.
Vérifier que la page Historique se remplit et que Sources affiche une dernière synchro.

- [x] **Étape 5 : lancer**

```bash
docker compose -f docker-compose.dev.yml up -d db
uv run --project apps/api python apps/api/manage.py runserver &
E2E_INVITATION_TOKEN=<jeton> pnpm --filter web exec playwright test
```

- [x] **Étape 6 : commit**

```bash
git add -A
git commit -m "test(web): parcours d'invitation et de synchro en bout en bout"
```

---

## Tâche 21 : documentation, dette, revue et merge

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/specs/2026-09-03-architecture-design.md`, `docs/points-reportes.md`

- [x] **Étape 1 : `CLAUDE.md`**

- Tableau des sous-projets : 3 passe à « fait (2026-09-04) ».
- La ligne « `apps/api` n'existe pas avant le sous-projet 3 » devient : **`apps/api` existe
  et n'a jamais de table de portefeuille** ; le signal d'arrêt reste identique.
- Section Outillage : `pnpm test:api`, `pnpm gen:api`, le workspace uv racine, la
  dépendance à un PostgreSQL local pour les tests.
- Nouvelle règle qui mord : **la connexion n'est jamais exigée pour utiliser
  l'application**, seulement pour le proxy Flex.
- Nouvelle règle qui mord : **aucun nom de domaine dans un fichier versionné**.
- Section VPS : Traefik est désormais installé, `deploy/traefik/` est de
  l'infrastructure partagée, déménageable.

- [x] **Étape 2 : spec fondateur**

Amender le §7.3 : l'inscription reste fermée et sur invitation, mais **l'application
n'est pas derrière une porte**. Ajouter au §12 le statut du sous-projet 3. Ajouter au §13
la ligne « application fermée derrière la connexion » avec sa raison, telle qu'écrite au
§13 du spec du sous-projet.

- [x] **Étape 3 : `README.md`**

Ajouter le démarrage complet : PostgreSQL de développement, migrations, `pnpm dev`,
`pnpm test:api`, et le renvoi à `docs/deploiement-vps.md`.

- [x] **Étape 4 : `docs/points-reportes.md`**

Ouvrir une section « À traiter au sous-projet 4 ou plus tard » avec ce que ce sous-projet
laisse derrière lui. Au minimum, et à compléter par ce que la revue trouvera :

- Aucune réinitialisation de mot de passe en autonomie : l'administrateur recrée une
  invitation. Devient gênant au premier utilisateur qui n'est pas l'auteur.
- Aucune sauvegarde de PostgreSQL sur le VPS. Le seul contenu irremplaçable est la table
  des utilisateurs ; les données de portefeuille n'y sont pas, par construction.
- `deploy/traefik/` vit dans ce dépôt faute d'un deuxième occupant.
- La ligne « aucune intégration continue », déjà présente, reste valable.

- [x] **Étape 5 : la vérification complète**

```bash
pnpm check
pnpm test:api
```

Les deux doivent sortir en 0. **Ne rien affirmer avant d'avoir vu les deux sorties.**

- [x] **Étape 6 : revue de branche**

Invoquer `superpowers:requesting-code-review` sur la branche entière. Traiter les retours
avec `superpowers:receiving-code-review` : vérifier chaque point plutôt que l'appliquer
d'office.

- [x] **Étape 7 : commit et merge**

```bash
git add -A
git commit -m "docs: sous-projet 3 clos, statut, dette et démarrage à jour"
```

Puis `superpowers:finishing-a-development-branch` pour le merge sur `main` et le retrait
du worktree.
