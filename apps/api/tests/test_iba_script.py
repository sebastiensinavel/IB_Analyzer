"""`deploy/iba`, the VPS operations script, driven against a fake `docker` and `git`.

The fakes log every call to a file and never touch a real container: what is checked is
which commands the script runs, in which order, and above all which ones it refuses to run.
"""
import getpass
import os
import stat
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / "deploy" / "iba"
LAUNCHER = REPO_ROOT / "deploy" / "iba-launcher"

FAKE_DOCKER = """#!/usr/bin/env bash
echo "docker $*" >> "$CALLS"
if [ "$1 $2" = "compose exec" ]; then
  [ -n "${FAKE_DUMP_FAILS:-}" ] && exit 1
  echo "-- fake dump"
fi
exit 0
"""

FAKE_SUDO = """#!/usr/bin/env bash
echo "sudo $*" >> "$CALLS"
exit 0
"""

FAKE_GIT = """#!/usr/bin/env bash
echo "git $*" >> "$CALLS"
if [ "$1" = "rev-parse" ]; then
  ref="${@: -1}"; ref="${ref%"^{commit}"}"
  case "$ref" in
    refs/tags/*) name="${ref#refs/tags/}"; for t in ${FAKE_TAGS:-}; do [ "$t" = "$name" ] && { echo deadbeef; exit 0; }; done; exit 1 ;;
    origin/*) name="${ref#origin/}"; for b in ${FAKE_BRANCHES:-}; do [ "$b" = "$name" ] && { echo cafebabe; exit 0; }; done; exit 1 ;;
  esac
  exit 1
fi
exit 0
"""


@pytest.fixture
def env(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, body in [("docker", FAKE_DOCKER), ("git", FAKE_GIT), ("sudo", FAKE_SUDO)]:
        path = bin_dir / name
        path.write_text(body)
        path.chmod(path.stat().st_mode | stat.S_IEXEC)
    home = tmp_path / "srv"
    for inst in ["prod", "dev"]:
        (home / inst).mkdir(parents=True)
        (home / inst / ".env").write_text(f"IBA_INSTANCE={inst}\n")
    calls = tmp_path / "calls.log"
    calls.touch()
    return {
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "IBA_HOME": str(home),
        "CALLS": str(calls),
        "FAKE_TAGS": "v2026.10.01",
        "FAKE_BRANCHES": "main feature-x",
        "HOME": str(tmp_path),
        "IBA_USER": getpass.getuser(),
    }


def run(env, *args, stdin="", **extra):
    return subprocess.run(
        [str(SCRIPT), *args], env={**env, **extra}, input=stdin, capture_output=True, text=True
    )


def calls(env):
    return Path(env["CALLS"]).read_text().splitlines()


def test_reset_is_refused_on_prod_without_touching_docker(env):
    result = run(env, "prod", "reset", stdin="iba-prod\n")
    assert result.returncode == 1
    assert not any(c.startswith("docker") for c in calls(env))


@pytest.mark.parametrize("answer", ["", "iba-prod\n", "oui\n"])
def test_reset_on_dev_needs_the_project_name_retyped(env, answer):
    result = run(env, "dev", "reset", stdin=answer)
    assert result.returncode == 1
    assert not any("down" in c for c in calls(env))


def test_reset_on_dev_wipes_rebuilds_migrates_and_asks_for_the_admin(env):
    result = run(env, "dev", "reset", stdin="iba-dev\n")
    assert result.returncode == 0, result.stderr
    docker = [c for c in calls(env) if c.startswith("docker")]
    assert docker == [
        "docker compose down -v",
        "docker compose up -d --build",
        "docker compose run --rm api python manage.py migrate",
        "docker compose run --rm api python manage.py createsuperuser",
    ]


def test_an_env_naming_another_project_is_refused(env):
    Path(env["IBA_HOME"], "dev", ".env").write_text("IBA_INSTANCE=prod\n")
    result = run(env, "dev", "up")
    assert result.returncode == 1
    assert "prod" in result.stderr
    assert calls(env) == []


@pytest.mark.parametrize("args", [[], ["prod"], ["staging", "up"], ["prod", "explode"]])
def test_bad_usage_exits_2(env, args):
    assert run(env, *args).returncode == 2


def test_prod_deploy_backs_up_before_checkout_and_migrate(env):
    result = run(env, "prod", "deploy", "v2026.10.01")
    assert result.returncode == 0, result.stderr
    log = calls(env)
    dump = next(i for i, c in enumerate(log) if c.startswith("docker compose exec -T db"))
    checkout = next(i for i, c in enumerate(log) if c.startswith("git checkout"))
    migrate = next(i for i, c in enumerate(log) if c.endswith("manage.py migrate"))
    assert dump < checkout < migrate
    assert "git checkout --detach deadbeef" in log
    assert len(list(Path(env["IBA_HOME"], "backups").glob("iba-prod-*.sql.gz"))) == 1


def test_prod_deploys_tags_only(env):
    result = run(env, "prod", "deploy", "main")
    assert result.returncode == 1
    assert not any(c.startswith("git checkout") or "up -d" in c for c in calls(env))


def test_prod_deploy_stops_when_the_backup_fails(env):
    result = run(env, "prod", "deploy", "v2026.10.01", FAKE_DUMP_FAILS="1")
    assert result.returncode != 0
    log = calls(env)
    assert not any(c.startswith("git checkout") or c.endswith("migrate") for c in log)
    backups = Path(env["IBA_HOME"], "backups")
    assert not list(backups.glob("*.sql.gz"))


def test_dev_deploys_a_branch_without_backup(env):
    result = run(env, "dev", "deploy", "feature-x")
    assert result.returncode == 0, result.stderr
    log = calls(env)
    assert "git checkout --detach cafebabe" in log
    assert not any("exec -T db" in c for c in log)
    assert log[-1] == "docker compose run --rm api python manage.py migrate"


def test_deploying_an_unknown_ref_stops_before_building(env):
    result = run(env, "dev", "deploy", "no-such-branch")
    assert result.returncode == 1
    assert not any(c.startswith("git checkout") or c.startswith("docker") for c in calls(env))


def test_backup_keeps_the_14_newest_of_its_own_project_only(env):
    backups = Path(env["IBA_HOME"], "backups")
    backups.mkdir()
    for day in range(1, 17):
        (backups / f"iba-prod-202601{day:02d}-000000.sql.gz").write_text("old")
    (backups / "iba-dev-20250101-000000.sql.gz").write_text("dev")
    result = run(env, "prod", "backup")
    assert result.returncode == 0, result.stderr
    prod = sorted(p.name for p in backups.glob("iba-prod-*.sql.gz"))
    assert len(prod) == 14
    assert "iba-prod-20260101-000000.sql.gz" not in prod
    assert "iba-prod-20260103-000000.sql.gz" not in prod
    assert "iba-prod-20260104-000000.sql.gz" in prod
    assert (backups / "iba-dev-20250101-000000.sql.gz").exists()


def test_an_env_setting_compose_project_name_is_refused(env):
    """It would override `name: iba-<instance>` and put the stack under another project."""
    Path(env["IBA_HOME"], "dev", ".env").write_text("IBA_INSTANCE=dev\nCOMPOSE_PROJECT_NAME=autre\n")
    result = run(env, "dev", "up")
    assert result.returncode == 1
    assert "COMPOSE_PROJECT_NAME" in result.stderr
    assert calls(env) == []


def test_another_user_is_handed_to_the_app_user_before_touching_the_instance(env, tmp_path):
    """/srv/iba is 750: a caller who is not `iba` cannot even test the directory."""
    result = run(env, "dev", "status", IBA_USER="iba", IBA_HOME=str(tmp_path / "unreadable"))
    assert result.returncode == 0, result.stderr
    assert calls(env) == [f"sudo -u iba -- env IBA_HOME={tmp_path / 'unreadable'} {SCRIPT} dev status"]


def test_the_launcher_runs_the_prod_clone_script_as_iba(env):
    """Installed as /usr/local/bin/iba, readable by all, pointing into the 750 directory."""
    result = subprocess.run([str(LAUNCHER), "dev", "up"], env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert calls(env) == ["sudo -u iba -- /srv/iba/prod/deploy/iba dev up"]
