"""The deployment files are not code, but they are still checkable.

Nothing else in the suite reads `docker-compose.yml`, `.env.example` or the
Dockerfile, so two contradictions between them survived the whole sub-project:
the stack's health probe called Django with `Host: 127.0.0.1:8000` while
`.env.example` declared only the public domain in `DJANGO_ALLOWED_HOSTS` (a 400,
so a permanently `unhealthy` container on a real VPS), and `DJANGO_SECRET_KEY`
fell back in silence to a value committed in this repository.
"""
import importlib.util
import re
from pathlib import Path

import pytest
from django.core.exceptions import ImproperlyConfigured

REPO_ROOT = Path(__file__).resolve().parents[3]
COMPOSE = (REPO_ROOT / "docker-compose.yml").read_text()
ENV_EXAMPLE = (REPO_ROOT / ".env.example").read_text()


def env_example_value(name):
    match = re.search(rf"^{name}=(.*)$", ENV_EXAMPLE, re.MULTILINE)
    assert match, f"{name} is missing from .env.example"
    return match.group(1).strip()


def healthcheck_url_host():
    """The host:port the `api` service's healthcheck sends as its `Host` header."""
    match = re.search(r"healthcheck:.*?urlopen\('http://([^/']+)", COMPOSE, re.DOTALL)
    assert match, "no healthcheck calling urlopen found in docker-compose.yml"
    return match.group(1)


def test_the_healthcheck_host_is_allowed_by_the_env_template():
    host = healthcheck_url_host()
    bare_host = host.rsplit(":", 1)[0]
    allowed = [h.strip() for h in env_example_value("DJANGO_ALLOWED_HOSTS").split(",")]
    assert bare_host in allowed, (
        f"the healthcheck calls the api on {host!r}, which Django rejects with a 400 unless "
        f"{bare_host!r} is in DJANGO_ALLOWED_HOSTS; .env.example declares {allowed}"
    )


def test_the_env_template_still_carries_no_real_domain_or_secret():
    """Widening ALLOWED_HOSTS must not be an excuse to commit a real value."""
    for line in ENV_EXAMPLE.splitlines():
        if line.startswith(("PUBLIC_HOST=", "PUBLIC_BASE_URL=", "DJANGO_ALLOWED_HOSTS=", "DJANGO_CSRF_TRUSTED_ORIGINS=")):
            assert "<" in line, f"{line!r} looks like a real value, not a placeholder"


def load_settings_module():
    """Execute `config/settings.py` in a throwaway namespace, honouring the current env.

    A plain `importlib.reload` would leave a half-executed module in `sys.modules`
    for the rest of the session on the very case this checks — the one that raises.
    """
    spec = importlib.util.spec_from_file_location(
        "config._settings_probe", REPO_ROOT / "apps" / "api" / "config" / "settings.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_production_refuses_to_boot_on_the_committed_development_key(monkeypatch):
    monkeypatch.delenv("DJANGO_SECRET_KEY", raising=False)
    monkeypatch.setenv("DJANGO_DEBUG", "0")
    with pytest.raises(ImproperlyConfigured):
        load_settings_module()


def test_a_key_from_the_environment_is_all_it_takes(monkeypatch):
    monkeypatch.setenv("DJANGO_SECRET_KEY", "a-real-one")
    monkeypatch.setenv("DJANGO_DEBUG", "0")
    assert load_settings_module().SECRET_KEY == "a-real-one"


def test_debug_still_boots_without_a_key(monkeypatch):
    """Local development keeps its convenience: the guard only bites outside DEBUG."""
    monkeypatch.delenv("DJANGO_SECRET_KEY", raising=False)
    monkeypatch.setenv("DJANGO_DEBUG", "1")
    assert load_settings_module().SECRET_KEY == "dev-only-not-for-production"


def test_the_image_build_supplies_its_own_key():
    """`collectstatic` runs outside DEBUG in the Dockerfile, so it needs one too."""
    dockerfile = (REPO_ROOT / "apps" / "api" / "Dockerfile").read_text()
    build_step = next(line for line in dockerfile.splitlines() if "collectstatic" in line)
    assert "DJANGO_SECRET_KEY=" in build_step, build_step
