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

from config.devkey import checkout_git_dir

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
    """Local development keeps its convenience: the guard only bites outside DEBUG.

    Checked against the `dev-secret-key` file on disk, not against
    `read_or_create_dev_secret`'s own return value (that function's behaviour is
    test_devkey.py's job): this way the assertion would still catch settings.py
    falling back to a value it invents or hardcodes instead of the one this checkout
    already has on disk.
    """
    monkeypatch.delenv("DJANGO_SECRET_KEY", raising=False)
    monkeypatch.setenv("DJANGO_DEBUG", "1")
    key_file = checkout_git_dir(REPO_ROOT) / "dev-secret-key"
    assert load_settings_module().SECRET_KEY == key_file.read_text().strip()


def test_the_image_build_supplies_its_own_key():
    """`collectstatic` runs outside DEBUG in the Dockerfile, so it needs one too."""
    dockerfile = (REPO_ROOT / "apps" / "api" / "Dockerfile").read_text()
    build_step = next(line for line in dockerfile.splitlines() if "collectstatic" in line)
    assert "DJANGO_SECRET_KEY=" in build_step, build_step


LABELS = re.findall(r'^\s*-\s*"(traefik\.[^"]+)"', COMPOSE, re.MULTILINE)
SERVICE_BLOCKS = dict(
    re.findall(r"^  (\w+):\n((?:    .*\n|\n)+)", COMPOSE.split("\nvolumes:")[0], re.MULTILINE)
)


def traefik_names(kind):
    """The router, service or middleware names the labels declare."""
    return {m.group(1) for l in LABELS if (m := re.match(rf"traefik\.http\.{kind}\.([^.]+)\.", l))}


@pytest.mark.parametrize("kind", ["routers", "services", "middlewares"])
def test_every_traefik_name_belongs_to_the_instance(kind):
    """Two stacks behind one Traefik that both declare `ibweb` fight over one router."""
    names = traefik_names(kind)
    assert names, f"no traefik {kind} declared"
    for name in names:
        assert name.startswith("${COMPOSE_PROJECT_NAME"), f"{kind} {name!r} is not scoped to the instance"


def test_the_admin_is_never_routed_from_the_internet():
    """allauth's 2FA does not guard the Django admin's own login form."""
    rules = [l for l in LABELS if ".rule=" in l]
    assert rules
    for rule in rules:
        assert "/admin" not in rule, rule


def test_every_published_port_is_bound_to_loopback():
    published = re.findall(r"ports:\n((?:\s+- .*\n)+)", COMPOSE)
    assert published, "the api must publish its admin port for the SSH tunnel"
    for block in published:
        for line in re.findall(r"- \"?([^\"\n]+)", block):
            assert line.startswith("127.0.0.1:"), f"port {line!r} is reachable from outside the VPS"


@pytest.mark.parametrize("service", ["web", "api", "db"])
def test_each_service_restarts_by_policy_and_rotates_its_logs(service):
    block = SERVICE_BLOCKS[service]
    assert "restart: ${RESTART_POLICY:-unless-stopped}" in block
    assert "logging: *logging" in block
    assert 'max-size: "10m"' in COMPOSE and 'max-file: "5"' in COMPOSE


@pytest.mark.parametrize("name", ["COMPOSE_PROJECT_NAME", "ADMIN_PORT", "PUBLIC_HOST", "TRAEFIK_NETWORK"])
def test_a_missing_instance_variable_stops_compose(name):
    """One `:?` anywhere makes `docker compose` refuse the whole file when the variable is unset."""
    assert "${" + name + ":?" in COMPOSE, f"{name} unset would silently yield an empty value"


def test_the_env_template_describes_both_instances_and_the_tunnel():
    for name in ["COMPOSE_PROJECT_NAME", "RESTART_POLICY", "ADMIN_PORT", "ROBOTS_TAG"]:
        env_example_value(name)
    allowed = [h.strip() for h in env_example_value("DJANGO_ALLOWED_HOSTS").split(",")]
    assert {"127.0.0.1", "localhost"} <= set(allowed)
    origins = env_example_value("DJANGO_CSRF_TRUSTED_ORIGINS")
    assert "http://localhost:" in origins
    assert env_example_value("TRAEFIK_NETWORK") == "traefik"
