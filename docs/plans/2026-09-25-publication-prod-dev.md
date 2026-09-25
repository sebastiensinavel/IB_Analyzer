# Publication d'une prod et d'une dev sur le VPS — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** rendre la pile Compose d'IB Analyzer déployable en deux instances distinctes
(prod, dev) derrière un Traefik partagé, fournir le script d'exploitation `iba`, préparer
l'infrastructure `/srv/infra` (Traefik et site vitrine) et la procédure de mise en ligne.

**Architecture :** une seule `docker-compose.yml` dont tout ce qui doit différer entre
instances — noms Traefik, politique de redémarrage, port d'admin, en-tête `X-Robots-Tag` — vient
du `.env` de l'instance, `COMPOSE_PROJECT_NAME` en tête. Un script bash `deploy/iba` porte
les gestes d'exploitation et leurs garde-fous. L'infrastructure partagée vit hors de ce dépôt,
dans `/srv/infra`, parce qu'elle porte des noms de domaine.

**Tech Stack :** Docker Compose v5, Traefik v3, nginx, bash, systemd, pytest (tests de
configuration et du script, sans base de données).

**Spec :** `docs/specs/2026-09-25-publication-prod-dev-design.md` — à lire en entier avant
toute tâche.

## Global Constraints

- **Aucun nom de domaine dans un fichier versionné**, ce plan compris : `<domaine>`,
  `<domaine-prod>`, `<domaine-dev>` dans le dépôt. Les vrais noms ne s'écrivent que dans les
  `.env` du VPS et dans `~/infra-staging` puis `/srv/infra`, hors dépôt. Le domaine du site
  vitrine se lit dans `/etc/caddy/Caddyfile` (le bloc qui sert `/var/www/…`).
- Tout port publié commence par `127.0.0.1:`, jamais `0.0.0.0`, sauf 80 et 443 de Traefik.
- Ports : `ADMIN_PORT` 8201 (prod) et 8211 (dev) ; tableau de bord Traefik `127.0.0.1:8080` ;
  test de la vitrine `127.0.0.1:8090`. Tous libres sur le VPS au 2026-09-25.
- Projets Compose : `iba-prod`, `iba-dev`. Réseau Traefik : `traefik`. Utilisateurs : `iba`
  (`/srv/iba`), `infra` (`/srv/infra`), tous deux déjà créés, dans `docker`.
- Le script `deploy/iba` : `set -euo pipefail`, aucun `docker compose down -v` hors de `reset`
  en dev.
- Tests Python : `uv run --project apps/api pytest apps/api/tests/<fichier> -q` depuis la
  racine du worktree ; ces deux fichiers-là ne demandent pas PostgreSQL. `pnpm test:api`
  complet (tâche 4) le demande : `docker compose -f docker-compose.dev.yml up -d db`.
- `pnpm check` **une seule fois**, à la fin (tâche 4).
- Cocher les cases du plan dans le même commit que la tâche.
- Pied de commit : `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `seb` n'a pas `sudo` sans mot de passe : toute commande `sudo` est **faite par Seb** (tâche
  5), jamais par un agent. Un agent n'écrit ni dans `/srv/iba` ni dans `/srv/infra`.

## Review Focus

1. **Un `.env` qui oublie `COMPOSE_PROJECT_NAME`, `ADMIN_PORT`, `PUBLIC_HOST` ou
   `TRAEFIK_NETWORK`** : Compose doit refuser la configuration, jamais créer un routeur `-web`
   ou publier un port vide. Couvert en tâche 1 (`:?` exigé, vérifié par `docker compose
   config`).
2. **`iba prod deploy` quand la base ne répond pas** : la sauvegarde échoue, donc rien n'est
   extrait ni migré, et aucun fichier `.sql.gz` tronqué ne reste. Tâche 2.
3. **`iba dev deploy <branche-inexistante>`** : échec avant toute construction, arbre de
   travail inchangé. Tâche 2.
4. **`iba dev reset` sans terminal** (entrée vide, EOF) : refus, aucun `down -v`. Tâche 2.
5. **La rétention des sauvegardes** ne supprime jamais celles de l'autre instance. Tâche 2.

---

## Préalable : le worktree

- [x] Créer le worktree `.claude/worktrees/publication` sur une branche `publication` depuis
  `main` (skill `superpowers:using-git-worktrees`), y copier ce plan s'il n'y est pas.

---

### Task 1 : la pile Compose paramétrée par instance

**Files :**
- Modify : `docker-compose.yml`
- Modify : `.env.example`
- Test : `apps/api/tests/test_deployment_config.py`

**Interfaces :**
- Produces : les variables `.env` `COMPOSE_PROJECT_NAME`, `RESTART_POLICY`, `ADMIN_PORT`,
  `ROBOTS_TAG` (lues par la tâche 2 et documentées en tâche 4) ; routeurs
  `<projet>-web`, `<projet>-api`, services homonymes, middleware `<projet>-headers`.

- [x] **Step 1 : écrire les tests qui échouent**

Ajouter à la fin de `apps/api/tests/test_deployment_config.py` :

```python
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
```

- [x] **Step 2 : vérifier qu'ils échouent**

Run : `uv run --project apps/api pytest apps/api/tests/test_deployment_config.py -q`
Expected : les nouveaux tests en FAIL (noms `ibweb`, `/admin` dans la règle, aucun `ports:`,
pas de `RESTART_POLICY`), les six anciens en PASS.

- [x] **Step 3 : réécrire `docker-compose.yml`**

```yaml
# Une instance par .env : COMPOSE_PROJECT_NAME (iba-prod, iba-dev) nomme la pile, ses
# volumes, son réseau interne et ses routeurs Traefik. Voir docs/deploiement-vps.md.
x-logging: &logging
  driver: json-file
  options:
    max-size: "10m"
    max-file: "5"

services:
  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    restart: ${RESTART_POLICY:-unless-stopped}
    logging: *logging
    networks: [traefik, internal]
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=${TRAEFIK_NETWORK:?TRAEFIK_NETWORK manquant dans .env}"
      - "traefik.http.routers.${COMPOSE_PROJECT_NAME:?COMPOSE_PROJECT_NAME manquant dans .env}-web.rule=Host(`${PUBLIC_HOST:?PUBLIC_HOST manquant dans .env}`)"
      - "traefik.http.routers.${COMPOSE_PROJECT_NAME}-web.entrypoints=websecure"
      - "traefik.http.routers.${COMPOSE_PROJECT_NAME}-web.tls.certresolver=letsencrypt"
      - "traefik.http.routers.${COMPOSE_PROJECT_NAME}-web.priority=1"
      - "traefik.http.routers.${COMPOSE_PROJECT_NAME}-web.service=${COMPOSE_PROJECT_NAME}-web"
      - "traefik.http.routers.${COMPOSE_PROJECT_NAME}-web.middlewares=${COMPOSE_PROJECT_NAME}-headers"
      - "traefik.http.services.${COMPOSE_PROJECT_NAME}-web.loadbalancer.server.port=80"
      # Vide en prod : Traefik retire alors l'en-tête. `noindex` en dev.
      - "traefik.http.middlewares.${COMPOSE_PROJECT_NAME}-headers.headers.customresponseheaders.X-Robots-Tag=${ROBOTS_TAG:-}"

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    restart: ${RESTART_POLICY:-unless-stopped}
    logging: *logging
    env_file: .env
    depends_on: [db]
    networks: [traefik, internal]
    # L'admin n'est pas routé par Traefik : il se joint par tunnel SSH sur ce port.
    ports:
      - "127.0.0.1:${ADMIN_PORT:?ADMIN_PORT manquant dans .env}:8000"
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/health')"]
      interval: 30s
      timeout: 5s
      retries: 3
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=${TRAEFIK_NETWORK}"
      - "traefik.http.routers.${COMPOSE_PROJECT_NAME}-api.rule=Host(`${PUBLIC_HOST}`) && (PathPrefix(`/api`) || PathPrefix(`/_allauth`) || PathPrefix(`/static`))"
      - "traefik.http.routers.${COMPOSE_PROJECT_NAME}-api.entrypoints=websecure"
      - "traefik.http.routers.${COMPOSE_PROJECT_NAME}-api.tls.certresolver=letsencrypt"
      - "traefik.http.routers.${COMPOSE_PROJECT_NAME}-api.priority=10"
      - "traefik.http.routers.${COMPOSE_PROJECT_NAME}-api.service=${COMPOSE_PROJECT_NAME}-api"
      - "traefik.http.routers.${COMPOSE_PROJECT_NAME}-api.middlewares=${COMPOSE_PROJECT_NAME}-headers"
      - "traefik.http.services.${COMPOSE_PROJECT_NAME}-api.loadbalancer.server.port=8000"

  db:
    image: postgres:17-alpine
    restart: ${RESTART_POLICY:-unless-stopped}
    logging: *logging
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

Le test `test_the_healthcheck_host_is_allowed_by_the_env_template` lit toujours
`urlopen('http://…` : ne pas toucher au `healthcheck`.

- [x] **Step 4 : réécrire `.env.example`**

```dotenv
# Copié en .env dans /srv/iba/prod et /srv/iba/dev, et rempli là-bas. Jamais committé rempli.
# Les secrets sont générés pour chaque instance, jamais copiés de l'une à l'autre.

# Instance : iba-prod ou iba-dev. Nomme la pile, ses volumes et ses routeurs Traefik.
COMPOSE_PROJECT_NAME=<iba-prod ou iba-dev>
# unless-stopped en prod (repart au boot), no en dev (démarrée à la main).
RESTART_POLICY=<unless-stopped ou no>
# Port 127.0.0.1 de l'admin, joint par tunnel SSH : 8201 en prod, 8211 en dev.
ADMIN_PORT=<8201 ou 8211>
# Vide en prod ; noindex en dev, pour que les moteurs de recherche l'ignorent.
ROBOTS_TAG=

PUBLIC_HOST=<domaine>
PUBLIC_BASE_URL=https://<domaine>
TRAEFIK_NETWORK=traefik

# python3 -c 'import secrets; print(secrets.token_urlsafe(50))'
DJANGO_SECRET_KEY=<50 caractères aléatoires>
# 0 sur les deux instances : la dev est publique.
DJANGO_DEBUG=0
# 127.0.0.1 : la sonde de santé appelle l'API depuis l'intérieur du conteneur, avec
# `Host: 127.0.0.1:8000` ; sans lui, Django répond 400 et `api` reste `unhealthy`.
# localhost : l'admin par tunnel SSH arrive avec `Host: localhost:<ADMIN_PORT>`.
DJANGO_ALLOWED_HOSTS=<domaine>,127.0.0.1,localhost
# L'origine du tunnel d'admin, sans quoi Django refuse le formulaire de connexion (CSRF).
DJANGO_CSRF_TRUSTED_ORIGINS=https://<domaine>,http://localhost:<ADMIN_PORT>
DJANGO_LOG_LEVEL=INFO

POSTGRES_USER=ib
# openssl rand -hex 32 (hexadécimal : sans danger dans DATABASE_URL)
POSTGRES_PASSWORD=<mot de passe aléatoire>
POSTGRES_DB=ib_analyzer
DATABASE_URL=postgres://ib:<le même mot de passe>@db:5432/ib_analyzer
```

`env_example_value("ROBOTS_TAG")` doit trouver la ligne : la regex `^ROBOTS_TAG=(.*)$`
accepte une valeur vide.

- [x] **Step 5 : vérifier que les tests passent**

Run : `uv run --project apps/api pytest apps/api/tests/test_deployment_config.py -q`
Expected : tout PASS.

- [x] **Step 6 : vérifier l'interpolation réelle par Compose**

Dans un dossier de travail hors dépôt (`$SCRATCH`, par exemple le scratchpad de la session),
écrire deux fichiers d'environnement factices, sans vrai domaine :

```bash
for inst in prod dev; do
  port=$([ $inst = prod ] && echo 8201 || echo 8211)
  cat > "$SCRATCH/env.$inst" <<EOF
COMPOSE_PROJECT_NAME=iba-$inst
RESTART_POLICY=$([ $inst = prod ] && echo unless-stopped || echo no)
ADMIN_PORT=$port
ROBOTS_TAG=$([ $inst = dev ] && echo noindex)
PUBLIC_HOST=$inst.example.test
PUBLIC_BASE_URL=https://$inst.example.test
TRAEFIK_NETWORK=traefik
DJANGO_SECRET_KEY=x
POSTGRES_USER=ib
POSTGRES_PASSWORD=x
POSTGRES_DB=ib_analyzer
DATABASE_URL=postgres://ib:x@db:5432/ib_analyzer
EOF
done
for inst in prod dev; do
  docker compose -p iba-$inst --env-file "$SCRATCH/env.$inst" config \
    | grep -E 'traefik\.http\.(routers|services|middlewares)\.[^.]+' -o | sort -u
done
```

Expected : des noms `iba-prod-web`, `iba-prod-api`, `iba-prod-headers` d'un côté, `iba-dev-…`
de l'autre, aucun commun ; `restart: "no"` et `127.0.0.1:8211` côté dev. **Attention** : `env_file:
.env` du service `api` exige un `.env` à la racine du worktree ; s'il n'existe pas, `config`
échoue — créer temporairement un `.env` vide à la racine du worktree, puis le supprimer
(il est ignoré par git ; vérifier par `git status` qu'il n'apparaît pas).

Vérifier aussi que `COMPOSE_PROJECT_NAME` lu **depuis l'env-file seul** (sans `-p`) nomme le
projet et remplit les labels :

```bash
docker compose --env-file "$SCRATCH/env.dev" config | grep -E '^name:|iba-dev-web\.rule'
```

Expected : `name: iba-dev` et la règle du routeur `iba-dev-web`. Puis vérifier le refus :

```bash
grep -v '^ADMIN_PORT=' "$SCRATCH/env.dev" > "$SCRATCH/env.broken"
docker compose --env-file "$SCRATCH/env.broken" config >/dev/null; echo "exit=$?"
```

Expected : `ADMIN_PORT manquant dans .env` et `exit=1`.

- [x] **Step 7 : vérifier qu'une valeur vide retire l'en-tête dans un vrai Traefik**

Traefik jetable sur un réseau et un port de test, deux nginx étiquetés, l'un avec
`X-Robots-Tag=` vide, l'autre avec `noindex` :

```bash
docker network create iba-hdr-test
docker run -d --name iba-hdr-traefik --network iba-hdr-test -p 127.0.0.1:18080:80 \
  -v /var/run/docker.sock:/var/run/docker.sock:ro traefik:v3 \
  --providers.docker=true --providers.docker.exposedbydefault=false --entrypoints.web.address=:80
for v in empty noindex; do
  val=$([ $v = noindex ] && echo noindex)
  docker run -d --name iba-hdr-$v --network iba-hdr-test \
    -l traefik.enable=true \
    -l "traefik.http.routers.$v.rule=Host(\`$v.test\`)" \
    -l "traefik.http.routers.$v.entrypoints=web" \
    -l "traefik.http.routers.$v.middlewares=$v-h" \
    -l "traefik.http.middlewares.$v-h.headers.customresponseheaders.X-Robots-Tag=$val" \
    nginx:alpine
done
sleep 3
curl -sI -H 'Host: empty.test' http://127.0.0.1:18080/ | grep -i -E '^HTTP|x-robots' 
curl -sI -H 'Host: noindex.test' http://127.0.0.1:18080/ | grep -i -E '^HTTP|x-robots'
docker rm -f iba-hdr-traefik iba-hdr-empty iba-hdr-noindex && docker network rm iba-hdr-test
```

Expected : `HTTP/1.1 200` sans `X-Robots-Tag` pour `empty.test` ; `200` avec
`X-Robots-Tag: noindex` pour `noindex.test`. **Si `empty.test` rend un en-tête vide ou une
erreur de routeur**, s'arrêter et appliquer le repli du spec §3.1 : retirer le label
`middlewares` et le middleware de `docker-compose.yml`, créer `docker-compose.dev.override.yml`
qui les ajoute, et documenter `COMPOSE_FILE=docker-compose.yml:docker-compose.dev.override.yml`
dans `.env.example` pour la dev — puis adapter les tests du Step 1 en conséquence.

- [x] **Step 8 : commit**

```bash
git add docker-compose.yml .env.example apps/api/tests/test_deployment_config.py docs/plans/2026-09-25-publication-prod-dev.md
git commit -m "Pile Compose par instance : noms Traefik, redémarrage, admin par tunnel, noindex

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2 : le script d'exploitation `deploy/iba`

**Files :**
- Create : `deploy/iba` (exécutable, `chmod 755`)
- Create : `deploy/systemd/iba-prod.service`
- Test : `apps/api/tests/test_iba_script.py`

**Interfaces :**
- Consumes : `COMPOSE_PROJECT_NAME` du `.env` de l'instance (tâche 1) ; services `api` et `db`.
- Produces : `iba <prod|dev> <up|down|status|logs|migrate|createsuperuser|backup|deploy <ref>|reset>`,
  code de sortie 2 sur usage invalide, 1 sur refus ; sauvegardes
  `${IBA_HOME:-/srv/iba}/backups/<projet>-AAAAMMJJ-HHMMSS.sql.gz`, 14 par projet.

- [x] **Step 1 : écrire les tests qui échouent**

`apps/api/tests/test_iba_script.py` :

```python
"""`deploy/iba`, the VPS operations script, driven against a fake `docker` and `git`.

The fakes log every call to a file and never touch a real container: what is checked is
which commands the script runs, in which order, and above all which ones it refuses to run.
"""
import os
import stat
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT = REPO_ROOT / "deploy" / "iba"

FAKE_DOCKER = """#!/usr/bin/env bash
echo "docker $*" >> "$CALLS"
if [ "$1 $2" = "compose exec" ]; then
  [ -n "${FAKE_DUMP_FAILS:-}" ] && exit 1
  echo "-- fake dump"
fi
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
    for name, body in [("docker", FAKE_DOCKER), ("git", FAKE_GIT)]:
        path = bin_dir / name
        path.write_text(body)
        path.chmod(path.stat().st_mode | stat.S_IEXEC)
    home = tmp_path / "srv"
    for inst in ["prod", "dev"]:
        (home / inst).mkdir(parents=True)
        (home / inst / ".env").write_text(f"COMPOSE_PROJECT_NAME=iba-{inst}\n")
    calls = tmp_path / "calls.log"
    calls.touch()
    return {
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "IBA_HOME": str(home),
        "CALLS": str(calls),
        "FAKE_TAGS": "v2026.10.01",
        "FAKE_BRANCHES": "main feature-x",
        "HOME": str(tmp_path),
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
    Path(env["IBA_HOME"], "dev", ".env").write_text("COMPOSE_PROJECT_NAME=iba-prod\n")
    result = run(env, "dev", "up")
    assert result.returncode == 1
    assert "iba-prod" in result.stderr
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
```

Note sur la rétention : le nouveau fichier porte la date du jour (2026 ou plus, après janvier),
il trie donc après tous les `202601…` ; 16 anciens + 1 neuf = 17, les 3 plus anciens partent.

- [x] **Step 2 : vérifier qu'ils échouent**

Run : `uv run --project apps/api pytest apps/api/tests/test_iba_script.py -q`
Expected : FAIL partout (`deploy/iba` n'existe pas).

- [x] **Step 3 : écrire `deploy/iba`**

```bash
#!/usr/bin/env bash
# iba <prod|dev> <commande> — exploitation des instances d'IB Analyzer sur le VPS.
# Procédure complète : docs/deploiement-vps.md.
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage : iba <prod|dev> <commande>
  up                 construire, démarrer, migrer
  down               arrêter (les données restent)
  status             conteneurs et révision déployée
  logs               journaux en continu
  migrate            migrations Django
  createsuperuser    créer un administrateur
  backup             sauvegarder la base (14 gardées par instance)
  deploy <ref>       prod : un tag ; dev : une branche ou un tag
  reset              dev seulement : tout effacer et repartir de zéro
EOF
  exit 2
}

fail() { echo "iba : $*" >&2; exit 1; }

[ $# -ge 2 ] || usage
instance=$1 command=$2
shift 2
case "$instance" in prod|dev) ;; *) usage ;; esac
case "$command" in up|down|status|logs|migrate|createsuperuser|backup|deploy|reset) ;; *) usage ;; esac

home=${IBA_HOME:-/srv/iba}
dir=$home/$instance
[ -d "$dir" ] || fail "$dir introuvable"

# Les clones, les .env et les sauvegardes appartiennent à l'utilisateur de l'application.
owner=$(stat -c %U "$dir")
if [ "$(id -un)" != "$owner" ]; then
  exec sudo -u "$owner" -- env IBA_HOME="$home" "$(readlink -f "$0")" "$instance" "$command" "$@"
fi

cd "$dir"
project=$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' .env 2>/dev/null || true)
[ "$project" = "iba-$instance" ] \
  || fail "$dir/.env déclare le projet « $project », attendu « iba-$instance »"

migrate() { docker compose run --rm api python manage.py migrate; }

backup() {
  local dest=$home/backups file
  mkdir -p "$dest"
  file=$dest/$project-$(date +%Y%m%d-%H%M%S).sql.gz
  # .part d'abord : une sauvegarde interrompue ne doit jamais passer pour une sauvegarde.
  if ! docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$file.part"; then
    rm -f "$file.part"
    fail "sauvegarde impossible (la base de $project tourne-t-elle ?)"
  fi
  mv "$file.part" "$file"
  # Les noms portent l'horodatage : l'ordre alphabétique est l'ordre chronologique.
  find "$dest" -maxdepth 1 -name "$project-*.sql.gz" | sort -r | tail -n +15 | xargs -r rm --
  echo "$file"
}

resolve() {
  local ref=$1
  if git rev-parse --verify -q "refs/tags/$ref^{commit}"; then return; fi
  [ "$instance" = prod ] && fail "la prod ne déploie que des tags ; « $ref » n'en est pas un"
  git rev-parse --verify -q "origin/$ref^{commit}" || fail "« $ref » n'est ni un tag ni une branche de origin"
}

case "$command" in
  up)              docker compose up -d --build; migrate ;;
  down)            docker compose down ;;
  status)          docker compose ps; git describe --tags --always ;;
  logs)            docker compose logs -f --tail=200 ;;
  migrate)         migrate ;;
  createsuperuser) docker compose run --rm api python manage.py createsuperuser ;;
  backup)          backup ;;
  deploy)
    [ $# -ge 1 ] || usage
    git fetch --tags origin
    sha=$(resolve "$1")
    [ "$instance" = prod ] && backup
    git checkout --detach "$sha"
    docker compose up -d --build
    migrate
    ;;
  reset)
    [ "$instance" = dev ] || fail "reset est réservé à la dev"
    read -r -p "Tout effacer de $project ? Retapez « $project » : " answer || answer=
    [ "$answer" = "$project" ] || fail "abandon, rien n'a été effacé"
    docker compose down -v
    docker compose up -d --build
    migrate
    docker compose run --rm api python manage.py createsuperuser
    ;;
esac
```

Deux pièges : `sha=$(resolve …)` s'exécute dans un sous-shell, donc le `fail` de `resolve`
sort du sous-shell seul — `set -e` fait alors échouer l'affectation et arrête le script, ce
que les tests vérifient ; et `[ "$instance" = prod ] && backup` en dev rend 1 sans arrêter le
script parce que `set -e` ignore une liste `&&`, mais **pas** si c'est la dernière commande
d'une fonction ou du script — elle ne l'est pas ici.

`chmod 755 deploy/iba`.

- [x] **Step 4 : vérifier que les tests passent**

Run : `uv run --project apps/api pytest apps/api/tests/test_iba_script.py -q`
Expected : tout PASS. Puis `bash -n deploy/iba` (aucune sortie) ; `shellcheck deploy/iba` si
l'outil est installé (il ne l'est pas sur le VPS au 2026-09-25 : le noter, ne pas l'installer).

- [x] **Step 5 : écrire `deploy/systemd/iba-prod.service`**

```ini
# Démarre la prod d'IB Analyzer au boot, même après un `iba prod down` manuel.
# Installation : docs/deploiement-vps.md. La dev n'a pas d'unité : elle se démarre à la main.
[Unit]
Description=IB Analyzer (prod)
Requires=docker.service
After=docker.service network-online.target infra-traefik.service
Wants=network-online.target infra-traefik.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=iba
WorkingDirectory=/srv/iba/prod
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose stop

[Install]
WantedBy=multi-user.target
```

Vérifier : `systemd-analyze verify deploy/systemd/iba-prod.service` (les avertissements sur
`infra-traefik.service` introuvable et l'utilisateur sont attendus hors du VPS configuré ;
aucune erreur de syntaxe).

- [x] **Step 6 : commit**

```bash
git add deploy/iba deploy/systemd/iba-prod.service apps/api/tests/test_iba_script.py docs/plans/2026-09-25-publication-prod-dev.md
git commit -m "Script d'exploitation iba et unité systemd de la prod

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3 : l'infrastructure partagée, préparée hors dépôt

**Files (hors dépôt, dans `~/infra-staging/`, jamais dans le worktree) :**
- Create : `traefik/docker-compose.yml`, `traefik/.env.example`
- Create : `vitrine/docker-compose.yml`, `vitrine/.env.example`, `vitrine/nginx.conf`,
  `vitrine/docker-compose.test.yml`
- Create : `systemd/infra-traefik.service`, `systemd/infra-vitrine.service`
- Create : `README.md`, `.gitignore`
- Modify (dépôt) : ce plan seul, pour cocher les cases.

**Interfaces :**
- Produces : le réseau Docker `traefik`, les entrypoints `web`/`websecure`, le résolveur
  `letsencrypt`, que la pile de la tâche 1 référence ; l'unité `infra-traefik.service` que
  `iba-prod.service` attend.

- [x] **Step 1 : constater la version de Traefik**

```bash
docker pull traefik:v3 >/dev/null && docker run --rm traefik:v3 version | sed -n 's/^Version: *//p'
```

Noter la version exacte (par exemple `3.7.2`) : elle s'écrit en toutes lettres dans l'image
(`traefik:v3.7.2`), jamais `v3` ni `latest`.

- [x] **Step 2 : `traefik/`**

`~/infra-staging/traefik/docker-compose.yml` (remplacer `<version>` par celle du Step 1) :

```yaml
# Le reverse proxy unique du VPS. Chaque application le rejoint par le réseau « traefik »
# et déclare ses routes par des labels (exposedbydefault=false).
services:
  traefik:
    image: traefik:v<version>
    restart: unless-stopped
    command:
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--providers.docker.network=traefik"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.web.http.redirections.entrypoint.to=websecure"
      - "--entrypoints.web.http.redirections.entrypoint.scheme=https"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
      - "--certificatesresolvers.letsencrypt.acme.email=${ACME_EMAIL:?ACME_EMAIL manquant dans .env}"
      - "--certificatesresolvers.letsencrypt.acme.storage=/acme/acme.json"
      - "--accesslog=true"
      - "--accesslog.format=json"
      - "--log.level=INFO"
      # Tableau de bord en lecture seule, sur 127.0.0.1 seulement : tunnel SSH.
      - "--api.dashboard=true"
      - "--api.insecure=true"
    ports:
      - "80:80"
      - "443:443"
      - "127.0.0.1:8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - acme:/acme
    networks: [traefik]
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"

volumes:
  acme:

networks:
  traefik:
    name: traefik
```

`~/infra-staging/traefik/.env.example` :

```dotenv
# Copié en .env et rempli. Adresse qui reçoit les avis d'expiration de Let's Encrypt.
ACME_EMAIL=<email>
```

- [x] **Step 3 : `vitrine/`**

`~/infra-staging/vitrine/nginx.conf` — reproduit la liste blanche de `/etc/caddy/Caddyfile` :

```nginx
# Liste blanche : tout ce qui n'est pas listé ici renvoie 404 (le dossier contient aussi
# .git, src/ et des notes, jamais servis).
server {
    listen 80;
    root /usr/share/nginx/html;
    gzip on;
    gzip_types text/css application/javascript image/svg+xml;

    location = / { try_files /index.html =404; }
    location = /index.html { }
    location /img/ { try_files $uri =404; }
    location /logo/ { try_files $uri =404; }
    location / { return 404; }
}
```

`~/infra-staging/vitrine/docker-compose.yml` :

```yaml
# Le site vitrine : ses fichiers restent dans leur dossier (propriété de seb, qui les édite),
# montés en lecture seule.
services:
  nginx:
    image: nginx:alpine
    restart: unless-stopped
    volumes:
      - ${VITRINE_ROOT:?VITRINE_ROOT manquant dans .env}:/usr/share/nginx/html:ro
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    networks: [traefik]
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=traefik"
      - "traefik.http.routers.vitrine.rule=Host(`${VITRINE_HOST:?VITRINE_HOST manquant dans .env}`)"
      - "traefik.http.routers.vitrine.entrypoints=websecure"
      - "traefik.http.routers.vitrine.tls.certresolver=letsencrypt"
      - "traefik.http.routers.vitrine.service=vitrine"
      - "traefik.http.routers.vitrine-www.rule=Host(`www.${VITRINE_HOST}`)"
      - "traefik.http.routers.vitrine-www.entrypoints=websecure"
      - "traefik.http.routers.vitrine-www.tls.certresolver=letsencrypt"
      - "traefik.http.routers.vitrine-www.service=vitrine"
      - "traefik.http.routers.vitrine-www.middlewares=vitrine-www"
      - 'traefik.http.middlewares.vitrine-www.redirectregex.regex=^https://www\.(.+)$$'
      - "traefik.http.middlewares.vitrine-www.redirectregex.replacement=https://$${1}"
      - "traefik.http.middlewares.vitrine-www.redirectregex.permanent=true"
      - "traefik.http.services.vitrine.loadbalancer.server.port=80"

networks:
  traefik:
    external: true
    name: traefik
```

`~/infra-staging/vitrine/.env.example` :

```dotenv
# Le domaine nu du site vitrine (le www y est redirigé) et le dossier de ses fichiers.
VITRINE_HOST=<domaine>
VITRINE_ROOT=/var/www/<dossier>
```

Écrire aussi `~/infra-staging/vitrine/.env` avec les vraies valeurs, lues dans
`/etc/caddy/Caddyfile` (domaine du bloc `root * /var/www/…`, et ce dossier).

`~/infra-staging/vitrine/docker-compose.test.yml` — sert uniquement à la vérification avant
bascule, sans Traefik :

```yaml
services:
  nginx:
    ports:
      - "127.0.0.1:8090:80"
    networks: !reset []
    labels: !reset []

networks: !reset {}
```

- [x] **Step 4 : vérifier la vitrine contre sa liste blanche**

```bash
cd ~/infra-staging/vitrine
docker compose -p vitrine-test -f docker-compose.yml -f docker-compose.test.yml up -d
sleep 2
img=$(cd "$(sed -n 's/^VITRINE_ROOT=//p' .env)" && ls img | head -1)
for p in / /index.html "/img/$img" /logo/logo.svg /img/ /img /.git/HEAD /Competence.md /src/ /nope; do
  printf '%-28s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8090$p")"
done
docker compose -p vitrine-test -f docker-compose.yml -f docker-compose.test.yml down
```

Expected : `200` pour `/`, `/index.html`, l'image et `/logo/logo.svg` ; `404` pour `/img/`,
`/img`, `/.git/HEAD`, `/Competence.md`, `/src/`, `/nope`. Puis vérifier la configuration
complète : `docker compose config >/dev/null` dans `traefik/` (avec un `.env` contenant un
`ACME_EMAIL` factice, supprimé ensuite) et dans `vitrine/` — aucune erreur. Le réseau externe
`traefik` n'existe pas encore : `config` ne le vérifie pas, c'est attendu.

- [x] **Step 5 : `systemd/`**

`~/infra-staging/systemd/infra-traefik.service` :

```ini
[Unit]
Description=Traefik, reverse proxy du VPS
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
User=infra
WorkingDirectory=/srv/infra/traefik
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose stop

[Install]
WantedBy=multi-user.target
```

`~/infra-staging/systemd/infra-vitrine.service` : identique, sauf
`Description=Site vitrine`, `After=docker.service network-online.target infra-traefik.service`,
`Wants=network-online.target infra-traefik.service`, `WorkingDirectory=/srv/infra/vitrine`.

Vérifier : `systemd-analyze verify ~/infra-staging/systemd/*.service` — pas d'erreur de
syntaxe (les avertissements d'utilisateur ou de dossier absents sont attendus).

- [x] **Step 6 : `README.md` et `.gitignore`**

`~/infra-staging/.gitignore` :

```
.env
```

`~/infra-staging/README.md` :

```markdown
# Infrastructure du VPS

Ce qui est commun à toutes les applications du VPS. Propriétaire : l'utilisateur `infra`.
Les applications vivent chacune sous leur propre utilisateur (`/srv/iba` pour IB Analyzer).

- `traefik/` — le reverse proxy unique : ports 80 et 443, certificats Let's Encrypt,
  journaux d'accès JSON (`docker compose logs traefik`), tableau de bord sur
  `127.0.0.1:8080` (tunnel : `ssh -L 8080:127.0.0.1:8080 <vps>`).
- `vitrine/` — le site vitrine, servi par nginx depuis son dossier, en lecture seule.
- `systemd/` — une unité par pile, copiées dans `/etc/systemd/system/`.

## Ajouter une application

1. Sa pile Compose déclare le réseau externe `traefik` et le rejoint avec les services
   exposés.
2. Chaque service exposé porte `traefik.enable=true`, `traefik.docker.network=traefik`, et
   des routeurs dont le nom est propre à l'application et à l'instance.
3. Un enregistrement DNS vers le VPS ; le certificat vient au premier appel
   (`tls.certresolver=letsencrypt`).

## Ce qui est délibéré

- `exposedbydefault=false` : un conteneur n'est routé que s'il le demande.
- Socket Docker en lecture seule. Le groupe `docker` vaut root : `infra` et les utilisateurs
  d'application le sont de fait.
- Rien n'est publié hors de 80, 443 et `127.0.0.1`.
```

- [x] **Step 7 : commit (le plan seul)**

Vérifier d'abord que rien de `~/infra-staging` n'est entré dans le worktree :
`git status --short` ne montre que le plan.

```bash
git add docs/plans/2026-09-25-publication-prod-dev.md
git commit -m "Infrastructure du VPS préparée hors dépôt : Traefik, vitrine, unités systemd

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4 : documentation et vérification finale

**Files :**
- Modify : `docs/deploiement-vps.md` (réécrit)
- Delete : `deploy/traefik/` (trois fichiers)
- Modify : `CLAUDE.md` (règle des domaines, registre, section VPS)
- Modify : `docs/points-reportes.md`
- Modify : `docs/specs/2026-09-03-architecture-design.md` (§12, sous-projet 3)
- Modify : `docs/specs/2026-09-25-publication-prod-dev-design.md` (statut)

- [x] **Step 1 : supprimer `deploy/traefik/`**

`git rm -r deploy/traefik`. Puis `grep -rn "deploy/traefik" --exclude-dir=node_modules
--exclude-dir=.git .` : les seules occurrences restantes sont dans `docs/specs/` et
`docs/plans/` datés d'avant (historiques, on n'y touche pas), dans ce plan et dans le spec 32.

- [x] **Step 2 : réécrire `docs/deploiement-vps.md`**

Structure, dans l'ordre d'exécution, chaque commande en bloc de code, `<domaine-prod>`,
`<domaine-dev>`, `<vps>` comme seuls emplacements :

0. **Vue d'ensemble** — le schéma du spec §2, les utilisateurs `iba` et `infra`, la phrase
   « le groupe `docker` vaut root ».
1. **Prérequis** — DNS `A`/`AAAA` des deux domaines vers le VPS (tirets, jamais
   d'underscore) ; utilisateurs créés (`useradd --system --create-home --home-dir /srv/iba
   --shell /bin/bash iba`, idem `infra`, `usermod -aG docker`, `chmod 750`) ; clés de
   déploiement GitHub en lecture seule, une par clone, alias d'hôte dans `~/.ssh/config`
   d'`iba` ; `sudo systemctl enable docker`.
2. **L'infrastructure** — `sudo -u infra cp -r ~seb/infra-staging/. /srv/infra/` (ou depuis
   là où elle a été préparée), `git init` et premier commit sous `infra`, `.env` de
   `traefik/` et de `vitrine/`, copie des unités dans `/etc/systemd/system/`,
   `systemctl daemon-reload`.
3. **La bascule depuis Caddy** — le spec §7 mot pour mot : vérification préalable de la
   vitrine sur `127.0.0.1:8090`, `stop caddy`, `enable --now infra-traefik infra-vitrine`,
   vérifications `curl -I https://<vitrine>/` et `https://www.<vitrine>/` (301), `disable
   caddy` ; retour arrière.
4. **La prod** — `.env` depuis `.env.example` (valeurs prod du tableau, secrets générés,
   `chmod 600`), `iba prod up`, `iba prod createsuperuser`, `sudo ln -s
   /srv/iba/prod/deploy/iba /usr/local/bin/iba`, unité `iba-prod.service` copiée et
   `enable`, crontab d'`iba` : `30 3 * * * /usr/local/bin/iba prod backup >/dev/null`.
5. **La dev** — `.env` (valeurs dev, **nouveaux** secrets, `ROBOTS_TAG=noindex`,
   `RESTART_POLICY=no`), `iba dev up`, `iba dev createsuperuser`. Démarrer, arrêter,
   `deploy <branche>`, `reset` (ce qu'il efface et ce qu'il n'efface pas : les données des
   testeurs vivent dans leur navigateur).
6. **L'admin par tunnel** — `ssh -p 2002 -L 8201:127.0.0.1:8201 -L 8211:127.0.0.1:8211 <vps>`,
   puis `http://localhost:8201/admin/` ; une session sur la dev déconnecte celle de la prod ;
   créer une invitation, le lien s'affiche, aucun email n'est envoyé.
7. **Livrer** — merge sur `main`, `git tag vAAAA.MM.JJ && git push --tags`, `iba prod
   deploy vAAAA.MM.JJ` ; retour arrière : `iba prod deploy <tag précédent>`, et restaurer une
   sauvegarde si une migration a changé le schéma
   (`gunzip -c <fichier> | docker compose exec -T db psql -U ib ib_analyzer` sur une base
   vidée).
8. **L'agent local** — `origins` de `config.toml` avec les deux origines, `init` n'en écrit
   qu'une.
9. **Vérifier** — la liste du spec §1, une commande par critère.

Garder de l'ancien texte : le paragraphe sur `127.0.0.1` dans `DJANGO_ALLOWED_HOSTS` et
celui sur `django_cache` après la première migration.

- [x] **Step 3 : `CLAUDE.md`**

- Règle « Aucun nom de domaine » : remplacer « et dans `deploy/traefik/.env` » par « et dans
  `/srv/infra`, hors du dépôt ».
- Registre : ligne 3, statut `fait (2026-09-04), mis en ligne par le sous-projet 32` ; ajouter
  `| 32 | Publication : une prod et une dev sur le VPS | fait (<date du merge>) |`.
- Section « VPS (sous-projet 3) » renommée « VPS (sous-projets 3 et 32) » et réécrite :
  deux instances `iba-prod`/`iba-dev` sous `/srv/iba` (utilisateur `iba`), Traefik et site
  vitrine sous `/srv/infra` (utilisateur `infra`, dépôt git local, hors de ce dépôt parce
  qu'il porte des domaines) ; admin jamais routé, par tunnel sur `127.0.0.1:8201`/`8211` ;
  `deploy/iba` et ses garde-fous (prod : tags seulement, sauvegarde avant migration ; `reset`
  dev seulement) ; la pile Compose tire toute différence d'instance du `.env`,
  `COMPOSE_PROJECT_NAME` en tête — ne jamais recoder un nom de routeur ; procédure dans
  `docs/deploiement-vps.md`. Supprimer le paragraphe sur `deploy/traefik/` et « le site n'a
  jamais répondu en HTTPS » (la tâche 5 le rend faux ; si la tâche 5 n'est pas faite au
  merge, écrire « mise en ligne en attente de la tâche 5 du plan 32 »).
- Outillage : ajouter que `test_deployment_config.py` et `test_iba_script.py` ne demandent
  pas PostgreSQL.

- [x] **Step 4 : `docs/points-reportes.md`**

Dans « Reporté par les sous-projets 3 et 4 », supprimer les entrées « `deploy/traefik/` vit
dans ce dépôt » et « `traefik:v3.3` … est provisoire » ; remplacer « Aucune sauvegarde de
PostgreSQL sur le VPS » par la version réduite ci-dessous. Ajouter une section :

```markdown
## Reporté par le sous-projet 32 (publication prod et dev)

- **Les sauvegardes PostgreSQL restent sur le VPS.** `iba prod backup` en garde 14 dans
  `/srv/iba/backups` : une fausse manœuvre se rattrape, la perte du VPS non. Une copie hors du
  serveur (stockage objet OVH, ou tirée depuis une autre machine) reste à poser.
- **Une session d'admin sur la dev déconnecte celle de la prod** : les deux tunnels arrivent
  sur `localhost`, et les cookies ne séparent pas les ports. Rendre `SESSION_COOKIE_NAME`
  réglable par instance le fermerait.
- **`seb` est dans le groupe `docker`**, donc root de fait, et contourne la séparation `iba` /
  `infra`. Le retirer ferait passer toute opération par `sudo -iu`.
- **`/srv/infra` n'a pas de dépôt distant** : son historique vit sur le VPS seul.
- **Aucun tableau de trafic** : les journaux d'accès JSON de Traefik permettent GoAccess ou
  Prometheus, rien n'est posé.
- **Caddy est arrêté et désactivé, pas désinstallé** : `/etc/caddy/Caddyfile` ne sert plus
  rien et peut tromper un lecteur.
```

- [x] **Step 5 : specs**

`docs/specs/2026-09-03-architecture-design.md` §12, point 3 : ajouter « Mis en ligne au
sous-projet 32. » ; `docs/specs/2026-09-25-publication-prod-dev-design.md` : `Statut : livré
(<date>).`

- [x] **Step 6 : vérification finale**

```bash
docker compose -f docker-compose.dev.yml up -d db   # si la base de dev ne tourne pas
pnpm test:api
pnpm check
# Le domaine se lit hors dépôt, jamais écrit ici ; il couvre aussi les sous-domaines.
grep -rniF "$(sed -n 's/^VITRINE_HOST=//p' ~/infra-staging/vitrine/.env)" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=private . || echo "aucun domaine"
```

Expected : `pnpm test:api` et `pnpm check` verts ; le `grep` affiche `aucun domaine`.

- [x] **Step 7 : commit**

```bash
git add -A docs CLAUDE.md deploy
git commit -m "Documente la publication prod et dev ; deploy/traefik quitte le dépôt

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Puis `pnpm dev:start` dans le worktree pour la relecture (règle du workflow), bien que rien
ne change à l'écran : Seb relit la branche, `pnpm dev:stop` avant le merge.

---

### Task 5 : mise en ligne, faite par Seb, accompagnée

Après merge sur `main` et `git push`. Chaque commande `sudo` est tapée par Seb ; l'agent
fournit la commande, lit la sortie, et vérifie par `curl` depuis le VPS. Cocher chaque case
dans un commit de suivi sur `main`.

- [ ] DNS : `dig +short <domaine-prod>` et `dig +short <domaine-dev>` rendent l'IP du VPS.
- [ ] `/srv/iba/prod` et `/srv/iba/dev` à jour (`sudo -iu iba git -C /srv/iba/prod pull`, idem
  dev).
- [ ] Infrastructure copiée dans `/srv/infra`, `git init`, `.env` remplis, unités installées
  (`docs/deploiement-vps.md` §2).
- [ ] Bascule depuis Caddy (§3) : vitrine en 200 sur HTTPS, `www` en 301, 404 hors liste
  blanche ; Caddy désactivé.
- [ ] Prod (§4) : `https://<domaine-prod>/` en 200, `/api/health` en `{"status":"ok"}`,
  `/admin/` sert le SPA (pas l'admin Django), aucun `X-Robots-Tag` ; admin par tunnel,
  super-utilisateur créé ; unité `iba-prod` activée ; crontab posée ; `iba prod backup`
  produit un fichier.
- [ ] Dev (§5) : `https://<domaine-dev>/` en 200 avec `X-Robots-Tag: noindex` ; admin par
  tunnel sur 8211.
- [ ] `sudo reboot` : la vitrine et la prod répondent, `iba dev status` montre la dev arrêtée.
- [ ] `iba dev reset` : la dev repart vide ; `iba prod reset` refusé.
- [ ] Agent local : les deux origines dans `config.toml`, badge « En direct » sur la prod.
- [ ] `CLAUDE.md` : retirer la mention « en attente de la tâche 5 » si elle a été écrite.
