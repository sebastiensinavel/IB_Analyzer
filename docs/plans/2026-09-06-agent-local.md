# Sous-projet 4 — Agent local, positions intraday, exécutions du jour : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un utilisateur qui fait tourner TWS sur sa machine installe un agent local depuis la page Aide du site, renseigne un port par compte dans Sources de données, et voit ses positions, son cash et ses exécutions du jour dans Positions, Dashboard et Historique, rafraîchis toutes les cinq minutes ou sur un bouton — sans qu'aucune donnée TWS ne quitte sa machine.

**Architecture:** L'agent (`apps/tws-agent`, Python, `ib_async` + FastAPI) est une troisième source symétrique de Flex : il sérialise ce qu'`ib_async` lui donne sans rien convertir, et deux endpoints suffisent (`GET /health` gratuit, `GET /snapshot?port=` qui ouvre et referme une connexion TWS). Tout le métier est en TypeScript : `parseAgentSnapshot` dans `ib-parsers`, `planAgent` dans `ledger` (« n'écrit qu'après la borne Flex, ne supprime jamais »), et `apps/web/src/agent/` calque `flex/` (client, synchro, hook de cadence). **Il n'y a pas de page Aujourd'hui** : les trois pages existantes lisent le même ledger et le même snapshot, et deviennent intraday sans rien recalculer. Une page Aide construit les commandes d'installation depuis l'origine courante et un `index.json` servi à côté de la roue Python par l'image `web`.

**Tech Stack:** Python 3.14, uv, `ib_async`, FastAPI, uvicorn, platformdirs, pytest. Node 22, pnpm, TypeScript 6, Vitest 4, React 19, react-router 8, Dexie 4, Playwright. Docker (image `web` : étape uv + nginx).

**Spec:** `docs/specs/2026-09-06-agent-local-design.md` (lire aussi `docs/specs/2026-09-03-architecture-design.md` §2, §3.4, §6.2, §6.8, §8, §13, et `CLAUDE.md`).

## Global Constraints

- **Le serveur ne voit jamais** transactions, positions ni données TWS. L'agent parle au navigateur, sur `127.0.0.1`, et à rien d'autre. Aucun modèle, aucune table, aucune migration côté `apps/api` : une tâche qui semble en réclamer est un **signal d'arrêt**.
- **L'agent est optionnel** : son absence, TWS éteint, un mauvais port ne produisent jamais une erreur en travers de l'application, seulement un badge et une ligne dans Sources de données. La dernière copie connue reste affichée.
- **Aucun nom de domaine dans un fichier versionné.** L'agent reçoit ses origines par `config.toml`, la page Aide lit `window.location.origin`, l'adresse de l'agent `http://127.0.0.1:8100` est une constante parce que ce n'est pas un nom de domaine.
- **Données brutes côté Python, noms bruts** : chaque champ JSON porte le nom de l'attribut `ib_async`, en camelCase, sans conversion. Seule exception : `cashAvailable`. Toute conversion vit dans `packages/ib-parsers/src/agent.ts`.
- **L'agent n'écrit qu'après `max(when)` Flex, strictement, et ne supprime jamais rien.** Un snapshot `agent` remplace toujours le courant ; un snapshot fichier remplace si son `asOf` atteint le **jour** du courant.
- **Aucun `ImportRecord` pour l'agent.** L'état vit sur `AccountRecord` (`twsPort`, `lastAgentSyncAt`, `lastAgentSyncStatus`).
- Cadence, constantes nommées : `AGENT_POLL_MS = 5 min`, `AGENT_PROBE_TIMEOUT_MS = 2 s`, `AGENT_FETCH_TIMEOUT_MS = 15 s`, connexion TWS `CONNECT_TIMEOUT_S = 5`, `clientId 0`.
- **Une valeur absente reste `null`**, jamais `0`, et s'affiche « — ». `commission` absente reste `null`.
- **Comptes jamais combinés** : toute écriture reste scopée par `accountId` ; le navigateur refuse d'écrire si `ibAccountId` n'est pas dans `accounts` rendu par TWS.
- shadcn ici est **base-ui**, pas Radix : `render={<X />}` au lieu de `asChild`. Un lien stylé en bouton est un `<Link className={cn(buttonVariants(...))}>`.
- Code et commentaires en anglais ; documentation, i18n et messages de commit en français.
- **Un test doit échouer si le comportement change.** `apps/web` teste sur `fake-indexeddb` avec une base semée, jamais en moquant les hooks ; `fetch` est remplacé au niveau du réseau seulement. `apps/tws-agent` teste sur un `FakeIB` typé au canard, jamais un vrai TWS.
- **`pnpm check` ne lance jamais de Python.** Les tests de l'agent se lancent par `pnpm test:agent`.
- Chaque commit se termine par les deux lignes :
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_015uoVB8wzb8JFk3dTAVuEVN
  ```
- Le travail se fait dans un worktree `.claude/worktrees/agent-local` (skill `superpowers:using-git-worktrees`), branche `agent-local`, mergé sur `main` après revue.
- **Les cases de ce plan se cochent dans le worktree au fur et à mesure, dans le même commit que la tâche.**

---

## Structure des fichiers

```
pyproject.toml                            + membre apps/tws-agent
package.json                              + scripts "test:agent", "build:agent"
.gitignore                                + apps/web/public/agent/

apps/tws-agent/
  pyproject.toml                          projet uv "ib-tws-agent", script ib-tws-agent
  README.md                               commandes, réglages TWS, validation manuelle
  ib_tws_agent/
    __init__.py
    config.py                             Config, config_path, load_config, write_config, ConfigError
    cli.py                                main(argv) : `init --origin`, ou lancement uvicorn
    cors.py                               OriginMiddleware : Allow-Origin par liste, preflight PNA
    main.py                               create_app, get_ib_factory, sérialisation, /health, /snapshot
  scripts/write_index.py                  index.json à côté de la roue
  tests/
    conftest.py                           FakeIB et doubles, fabrique de TestClient
    test_config.py, test_cli.py, test_health.py, test_snapshot.py, test_cors.py, test_write_index.py

packages/ledger/src/import.ts             + planAgent, planImport accepte "agent"
packages/ledger/src/import.test.ts        + cas agent

packages/ib-parsers/src/
  agent.ts                                parseAgentSnapshot, describeContract, types de charge utile
  agent.test.ts
  issues.ts                               + code "multiplier-missing"
  index.ts                                + export agent.ts
packages/ib-parsers/tests/fixtures/agent_snapshot_sample.json

apps/web/src/
  db/schema.ts                            + twsPort, lastAgentSyncAt, lastAgentSyncStatus, AgentSyncCode ; SnapshotRecord.source "flex" | "agent" ; ImportRecord.source sans "agent"
  db/snapshot.ts (+ test)                 shouldReplaceSnapshot
  db/accounts.ts (+ twsPort.test.ts)      setTwsPort, code "tws-port-invalid"
  db/importLock.ts (+ test)               withImportLock(accountId, run) : une file par compte
  db/importFile.ts                        shouldReplaceSnapshot au lieu de asOf >=
  agent/client.ts (+ test)                AGENT_URL, probeAgent, fetchSnapshot, délais
  agent/sync.ts (+ test)                  syncAgent : appel, parseur, contrôle de compte, transaction Dexie
  agent/useAgentSync.ts (+ test)          présence, useAgentSync, useAgentPolling, AGENT_POLL_MS
  agent/agentIndex.ts (+ test)            fetchAgentIndex, useAgentIndex (page Aide)
  components/SnapshotStatus.tsx (+ test)  badge d'horodatage, badge d'échec, bouton Actualiser
  pages/PositionsPage.tsx, DashboardPage.tsx, HistoryPage.tsx   en-tête SnapshotStatus
  pages/SourcesPage.tsx (+ test)          carte « Agent local »
  pages/HelpPage.tsx (+ test)             sept blocs, commandes construites depuis l'origine
  routes/router.tsx, lib/navigation.ts    - today, + /help
  routes/AppLayout.tsx                    + useAgentPolling
  lib/format.ts                           + formatClockTime
  mocks/agent-snapshot.json               charge utile de démonstration (driver, e2e)
  i18n/fr.json, en.json                   - nav.today ; + nav.help, snapshot.*, agent.*, help.*, sources.issues.multiplier-missing
  e2e/agent.spec.ts                       Playwright, agent intercepté
apps/web/Dockerfile                       + étape uv, roue et index copiés sous /agent/
apps/web/nginx.conf                       + location /agent/ no-cache

.claude/skills/run-frontend/driver.mjs    + --agent
.claude/skills/run-frontend/SKILL.md      + --agent

CLAUDE.md, docs/specs/2026-09-03-architecture-design.md, docs/points-reportes.md
```

## Versions retenues

`ib_async` 2.x, FastAPI 0.115+, uvicorn 0.30+, platformdirs 4.x, bornées au majeur suivant. Python `>= 3.14` comme le reste du workspace : `uv tool install` télécharge l'interpréteur au besoin. `uv` 0.12 et Python 3.14 sont installés sur cette machine.

## Commandes

```bash
pnpm test:agent                      # uv run --project apps/tws-agent pytest apps/tws-agent
pnpm --filter @ib/ledger test
pnpm --filter @ib/ib-parsers test
pnpm --filter web test src/agent
pnpm check                           # lint, typecheck, garde openapi, build, tests TS
pnpm build:agent                     # roue + index.json dans apps/web/public/agent/
node .claude/skills/run-frontend/driver.mjs /accounts/alpha/positions --seed --agent
```

---

# Palier A — l'agent Python

## Tâche 1 : worktree, membre uv, configuration, `init`, `/health`

**Files:**
- Create: `apps/tws-agent/pyproject.toml`, `apps/tws-agent/ib_tws_agent/__init__.py`, `apps/tws-agent/ib_tws_agent/config.py`, `apps/tws-agent/ib_tws_agent/cli.py`, `apps/tws-agent/ib_tws_agent/main.py`, `apps/tws-agent/tests/conftest.py`, `apps/tws-agent/tests/test_config.py`, `apps/tws-agent/tests/test_cli.py`, `apps/tws-agent/tests/test_health.py`
- Modify: `pyproject.toml` (racine), `package.json` (racine)

**Interfaces:**
- Produces: `Config(origins: tuple[str, ...], listen: int)`, `config_path() -> Path`, `load_config(path: Path | None = None) -> Config`, `write_config(origin: str, path: Path | None = None) -> Path`, `ConfigError`, `cli.main(argv: list[str] | None = None) -> int`, `main.create_app(config: Config) -> FastAPI`, `main.get_ib_factory() -> Callable[[], IB]`, et la fabrique de test `make_client(fake_ib=None, config=CONFIG) -> TestClient`.

- [x] **Étape 1 : le worktree**

```bash
git worktree add .claude/worktrees/agent-local -b agent-local main
cd .claude/worktrees/agent-local
pnpm install
```

- [x] **Étape 2 : le membre du workspace uv**

`pyproject.toml` à la racine :

```toml
[tool.uv.workspace]
members = ["apps/api", "apps/tws-agent", "tools/coverage-oracle"]
```

`apps/tws-agent/pyproject.toml` :

```toml
[project]
name = "ib-tws-agent"
version = "0.1.0"
description = "Agent local d'IB Options Analyzer 2 : lit TWS sur cette machine, ne stocke rien, ne parle qu'au site."
requires-python = ">=3.14"
dependencies = [
    "ib_async>=2.1,<3",
    "fastapi>=0.115,<1",
    "uvicorn>=0.30,<1",
    "platformdirs>=4,<5",
]

[project.scripts]
ib-tws-agent = "ib_tws_agent.cli:main"

[dependency-groups]
dev = ["pytest>=8", "httpx>=0.27"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["ib_tws_agent"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
```

`apps/tws-agent/ib_tws_agent/__init__.py` et `apps/tws-agent/tests/__init__.py` vides (le second, comme dans `apps/api/tests/`, rend `from tests.conftest import …` possible). Puis :

```bash
uv lock
uv sync --project apps/tws-agent
```

Ajouter à `package.json` racine, dans `scripts` :

```json
"test:agent": "uv run --project apps/tws-agent pytest apps/tws-agent",
```

- [x] **Étape 3 : les tests de configuration (échec attendu)**

`apps/tws-agent/tests/test_config.py` :

```python
from __future__ import annotations

import pytest

from ib_tws_agent.config import DEFAULT_LISTEN, Config, ConfigError, load_config, write_config


def test_write_then_load_round_trips(tmp_path):
    path = write_config("https://app.example", tmp_path / "config.toml")

    assert path.read_text(encoding="utf-8") == 'origins = ["https://app.example"]\nlisten = 8100\n'
    assert load_config(path) == Config(origins=("https://app.example",), listen=DEFAULT_LISTEN)


def test_write_creates_the_parent_directory(tmp_path):
    path = write_config("https://app.example", tmp_path / "nested" / "dir" / "config.toml")
    assert path.exists()


@pytest.mark.parametrize("origin", ["app.example", "https://app.example/", "https://app.example/path", "ftp://x", ""])
def test_write_refuses_anything_but_a_bare_origin(tmp_path, origin):
    with pytest.raises(ConfigError):
        write_config(origin, tmp_path / "config.toml")


def test_missing_file_names_the_init_command(tmp_path):
    with pytest.raises(ConfigError, match="ib-tws-agent init --origin"):
        load_config(tmp_path / "config.toml")


def test_several_origins_are_all_kept(tmp_path):
    path = tmp_path / "config.toml"
    path.write_text('origins = ["https://app.example", "http://localhost:5173"]\nlisten = 8123\n', encoding="utf-8")
    assert load_config(path) == Config(origins=("https://app.example", "http://localhost:5173"), listen=8123)


@pytest.mark.parametrize(
    "body",
    [
        "origins = []\n",
        'origins = "https://app.example"\n',
        'origins = ["https://app.example"]\nlisten = 0\n',
        'origins = ["https://app.example"]\nlisten = "8100"\n',
        "not toml at all [[[",
    ],
)
def test_invalid_file_is_refused(tmp_path, body):
    path = tmp_path / "config.toml"
    path.write_text(body, encoding="utf-8")
    with pytest.raises(ConfigError):
        load_config(path)
```

- [x] **Étape 4 : lancer, voir échouer**

```bash
pnpm test:agent
```

Attendu : `ModuleNotFoundError: ib_tws_agent.config`.

- [x] **Étape 5 : `config.py`**

```python
"""One file, two settings: the origins the agent may answer, and the port it listens on.

The site's origin is never in the code (CLAUDE.md: no domain name in a versioned file); the
user types it once, `ib-tws-agent init --origin …`, copied from the site's Help page.
"""

from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass
from pathlib import Path

from platformdirs import user_config_dir

APP_NAME = "ib-tws-agent"
DEFAULT_LISTEN = 8100

# Scheme, host, optional port. No path, no trailing slash: a browser's `Origin` header never has one.
ORIGIN_RE = re.compile(r"^https?://[^/\s?#]+$")


class ConfigError(Exception):
    """A message for the user; the CLI prints it and exits non-zero."""


@dataclass(frozen=True)
class Config:
    origins: tuple[str, ...]
    listen: int = DEFAULT_LISTEN


def config_path() -> Path:
    return Path(user_config_dir(APP_NAME)) / "config.toml"


def load_config(path: Path | None = None) -> Config:
    path = path if path is not None else config_path()
    if not path.exists():
        raise ConfigError(
            f"No configuration at {path}.\n"
            "Run `ib-tws-agent init --origin https://<your site>` first: the site's Help page gives the exact command."
        )
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except (tomllib.TOMLDecodeError, OSError) as exc:
        raise ConfigError(f"Unreadable configuration at {path}: {exc}") from exc
    origins = data.get("origins")
    if not isinstance(origins, list) or not origins or not all(isinstance(o, str) and ORIGIN_RE.match(o) for o in origins):
        raise ConfigError(f"`origins` must be a non-empty list of origins such as \"https://app.example\" in {path}")
    listen = data.get("listen", DEFAULT_LISTEN)
    if isinstance(listen, bool) or not isinstance(listen, int) or not 1 <= listen <= 65535:
        raise ConfigError(f"`listen` must be a port between 1 and 65535 in {path}")
    return Config(origins=tuple(origins), listen=listen)


def write_config(origin: str, path: Path | None = None) -> Path:
    """Overwrites: `init` is the way to change the origin, there is nothing else in the file."""
    if not ORIGIN_RE.match(origin):
        raise ConfigError(f'"{origin}" is not an origin: expected https://host, without a path or a trailing slash')
    path = path if path is not None else config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f'origins = ["{origin}"]\nlisten = {DEFAULT_LISTEN}\n', encoding="utf-8")
    return path
```

- [x] **Étape 6 : les tests de la CLI (échec attendu)**

`apps/tws-agent/tests/test_cli.py` :

```python
from __future__ import annotations

from ib_tws_agent import cli, config


def test_init_writes_the_configuration_at_the_platform_path(tmp_path, monkeypatch, capsys):
    target = tmp_path / "config.toml"
    monkeypatch.setattr(config, "config_path", lambda: target)

    code = cli.main(["init", "--origin", "https://app.example"])

    assert code == 0
    assert target.read_text(encoding="utf-8") == 'origins = ["https://app.example"]\nlisten = 8100\n'
    assert str(target) in capsys.readouterr().out


def test_init_refuses_a_bad_origin_without_writing(tmp_path, monkeypatch, capsys):
    target = tmp_path / "config.toml"
    monkeypatch.setattr(config, "config_path", lambda: target)

    code = cli.main(["init", "--origin", "app.example/"])

    assert code == 2
    assert not target.exists()
    assert "not an origin" in capsys.readouterr().err


def test_run_without_configuration_explains_and_exits(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(config, "config_path", lambda: tmp_path / "config.toml")
    started = []
    monkeypatch.setattr(cli, "serve", lambda cfg: started.append(cfg))

    code = cli.main([])

    assert code == 2
    assert started == []
    assert "ib-tws-agent init --origin" in capsys.readouterr().err


def test_run_serves_the_loaded_configuration(tmp_path, monkeypatch):
    target = tmp_path / "config.toml"
    config.write_config("https://app.example", target)
    monkeypatch.setattr(config, "config_path", lambda: target)
    started = []
    monkeypatch.setattr(cli, "serve", lambda cfg: started.append(cfg))

    assert cli.main([]) == 0
    assert started == [config.Config(origins=("https://app.example",), listen=8100)]
```

- [x] **Étape 7 : `cli.py`**

```python
"""`ib-tws-agent init --origin https://…` writes the configuration; `ib-tws-agent` serves."""

from __future__ import annotations

import argparse
import sys

from . import config as config_module
from .config import Config, ConfigError


def serve(config: Config) -> None:
    # Imported here: `init` must work on a machine where the server stack is not importable yet.
    import uvicorn

    from .main import create_app

    uvicorn.run(create_app(config), host="127.0.0.1", port=config.listen, log_level="warning")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ib-tws-agent", description="Local TWS agent of IB Options Analyzer 2.")
    subparsers = parser.add_subparsers(dest="command")
    init = subparsers.add_parser("init", help="write the configuration file")
    init.add_argument("--origin", required=True, help="origin of the site, e.g. https://app.example")
    args = parser.parse_args(argv)

    try:
        if args.command == "init":
            path = config_module.write_config(args.origin)
            print(f"Configuration written to {path}")
            return 0
        serve(config_module.load_config())
        return 0
    except ConfigError as exc:
        print(exc, file=sys.stderr)
        return 2
```

`write_config` et `load_config` sont appelés **par le module** (`config_module.write_config`), et `config_path` est lu par eux au moment de l'appel : c'est ce qui permet au test de remplacer `config.config_path`.

- [x] **Étape 8 : la fabrique de test et le test de `/health` (échec attendu)**

`apps/tws-agent/tests/conftest.py` :

```python
"""Doubles for ib_async. Duck-typed on purpose, never subclasses of the real classes."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from ib_tws_agent.config import Config
from ib_tws_agent.main import create_app, get_ib_factory

ORIGIN = "https://app.example"
CONFIG = Config(origins=(ORIGIN,), listen=8100)


@dataclass
class FakeContract:
    conId: int = 0
    symbol: str = "AAPL"
    localSymbol: str = "AAPL"
    secType: str = "STK"
    right: str = ""
    strike: float = 0.0
    lastTradeDateOrContractMonth: str = ""
    multiplier: str = ""
    currency: str = "USD"


@dataclass
class FakePortfolioItem:
    contract: FakeContract = field(default_factory=FakeContract)
    position: float = 0.0
    marketPrice: float = 0.0
    marketValue: float = 0.0
    averageCost: float = 0.0
    unrealizedPNL: float = 0.0


@dataclass
class FakeAccountValue:
    account: str = "U1234567"
    tag: str = "TotalCashBalance"
    value: str = "0"
    currency: str = "USD"
    modelCode: str = ""


@dataclass
class FakeExecution:
    execId: str = "0000e1a7.68bc1234.01.01"
    acctNumber: str = "U1234567"
    side: str = "BOT"
    shares: float = 1.0
    price: float = 1.0
    cumQty: float = 1.0
    avgPrice: float = 1.0
    orderRef: str = ""
    time: datetime = field(default_factory=lambda: datetime(2026, 9, 6, 14, 31, 2, tzinfo=timezone.utc))


@dataclass
class FakeCommissionReport:
    execId: str = ""
    commission: float = 0.0
    currency: str = ""


@dataclass
class FakeFill:
    contract: FakeContract = field(default_factory=FakeContract)
    execution: FakeExecution = field(default_factory=FakeExecution)
    commissionReport: FakeCommissionReport = field(default_factory=FakeCommissionReport)


class FakeIB:
    def __init__(
        self,
        *,
        managed_accounts=None,
        portfolio=None,
        account_values=None,
        fills=None,
        connect_error: Exception | None = None,
        portfolio_error: Exception | None = None,
    ):
        self._managed_accounts = managed_accounts if managed_accounts is not None else ["U1234567"]
        self._portfolio = portfolio if portfolio is not None else []
        self._account_values = account_values if account_values is not None else []
        self._fills = fills if fills is not None else []
        self._connect_error = connect_error
        self._portfolio_error = portfolio_error
        self.connected_to: tuple | None = None
        self.disconnected = False

    async def connectAsync(self, host, port, clientId=0, timeout=4):
        self.connected_to = (host, port, clientId, timeout)
        if self._connect_error is not None:
            raise self._connect_error

    def disconnect(self):
        self.disconnected = True

    def managedAccounts(self):
        return list(self._managed_accounts)

    def portfolio(self):
        if self._portfolio_error is not None:
            raise self._portfolio_error
        return list(self._portfolio)

    def accountValues(self):
        return list(self._account_values)

    def fills(self):
        return list(self._fills)


@pytest.fixture
def make_client():
    def _make(fake_ib: FakeIB | None = None, config: Config = CONFIG) -> TestClient:
        app = create_app(config)
        if fake_ib is not None:
            app.dependency_overrides[get_ib_factory] = lambda: (lambda: fake_ib)
        return TestClient(app)

    return _make
```

`apps/tws-agent/tests/test_health.py` :

```python
from __future__ import annotations

import re

from tests.conftest import FakeIB


def test_health_gives_the_package_version(make_client):
    response = make_client().get("/health")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"version"}
    assert re.fullmatch(r"\d+\.\d+\.\d+", body["version"])


def test_health_never_touches_tws(make_client):
    fake_ib = FakeIB(connect_error=RuntimeError("must not connect"))

    response = make_client(fake_ib).get("/health")

    assert response.status_code == 200
    assert fake_ib.connected_to is None
```

- [x] **Étape 9 : `main.py`, version minimale**

```python
"""The HTTP face of the agent. Raw ib_async data out, nothing stored, nothing computed."""

from __future__ import annotations

from collections.abc import Callable
from importlib.metadata import version as package_version

from fastapi import FastAPI
from ib_async import IB

from .config import Config


def get_ib_factory() -> Callable[[], IB]:
    """Overridden in tests with a FakeIB factory."""
    return IB


def create_app(config: Config) -> FastAPI:
    app = FastAPI(title="ib-tws-agent", docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/health")
    async def health() -> dict[str, str]:
        # The detection ping: free, TWS is never touched here.
        return {"version": package_version("ib-tws-agent")}

    return app
```

`config` sera utilisé à la tâche 3 (middleware) ; le laisser en paramètre dès maintenant fixe la signature.

- [x] **Étape 10 : lancer, voir passer, committer**

```bash
pnpm test:agent
git add -A
git commit -m "feat(agent): paquet ib-tws-agent, configuration, init et /health"
```

---

## Tâche 2 : `/snapshot`, une connexion TWS, données brutes

**Files:**
- Modify: `apps/tws-agent/ib_tws_agent/main.py`
- Create: `apps/tws-agent/tests/test_snapshot.py`

**Interfaces:**
- Consumes: `create_app`, `get_ib_factory`, `FakeIB` et ses doubles.
- Produces: `GET /snapshot?port=` avec le corps du spec §3.4 ; `extract_usd_cash(values) -> float | None`, `serialize_contract(contract) -> dict`, `serialize_position(item) -> dict`, `serialize_execution(fill) -> dict`, `utc_now_iso() -> str` ; constantes `IB_HOST`, `CLIENT_ID`, `CONNECT_TIMEOUT_S`, `CASH_TAGS`.

- [x] **Étape 1 : les tests (échec attendu)**

`apps/tws-agent/tests/test_snapshot.py` :

```python
from __future__ import annotations

import re

from ib_tws_agent.main import CASH_TAGS, extract_usd_cash
from tests.conftest import (
    FakeAccountValue,
    FakeCommissionReport,
    FakeContract,
    FakeExecution,
    FakeFill,
    FakeIB,
    FakePortfolioItem,
)

OPTION = FakeContract(
    conId=700000001,
    symbol="AAPL",
    localSymbol="AAPL  261218C00180000",
    secType="OPT",
    right="C",
    strike=180.0,
    lastTradeDateOrContractMonth="20261218",
    multiplier="100",
    currency="USD",
)
STOCK = FakeContract(conId=265598, symbol="AAPL", localSymbol="AAPL", secType="STK")


def test_snapshot_connects_once_on_the_requested_port_with_client_id_zero_and_disconnects(make_client):
    fake_ib = FakeIB()

    response = make_client(fake_ib).get("/snapshot", params={"port": 7502})

    assert response.status_code == 200
    assert fake_ib.connected_to == ("127.0.0.1", 7502, 0, 5)
    assert fake_ib.disconnected is True


def test_snapshot_envelope(make_client):
    response = make_client(FakeIB(managed_accounts=["U1234567", "U7654321"])).get("/snapshot", params={"port": 7502})

    body = response.json()
    assert set(body) == {"accounts", "fetchedAt", "cashAvailable", "positions", "executions"}
    assert body["accounts"] == ["U1234567", "U7654321"]
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z", body["fetchedAt"])
    assert body["positions"] == []
    assert body["executions"] == []


def test_positions_are_serialized_raw_stock_and_option_alike(make_client):
    fake_ib = FakeIB(
        portfolio=[
            FakePortfolioItem(contract=STOCK, position=100.0, averageCost=150.25, marketPrice=172.1, marketValue=17210.0, unrealizedPNL=2185.0),
            FakePortfolioItem(contract=OPTION, position=-1.0, averageCost=250.0, marketPrice=2.0, marketValue=-200.0, unrealizedPNL=50.0),
        ]
    )

    positions = make_client(fake_ib).get("/snapshot", params={"port": 7502}).json()["positions"]

    assert positions == [
        {
            "conId": 265598, "symbol": "AAPL", "localSymbol": "AAPL", "secType": "STK", "right": "", "strike": 0.0,
            "lastTradeDateOrContractMonth": "", "multiplier": "", "currency": "USD",
            "position": 100.0, "averageCost": 150.25, "marketPrice": 172.1, "marketValue": 17210.0, "unrealizedPNL": 2185.0,
        },
        {
            "conId": 700000001, "symbol": "AAPL", "localSymbol": "AAPL  261218C00180000", "secType": "OPT", "right": "C",
            "strike": 180.0, "lastTradeDateOrContractMonth": "20261218", "multiplier": "100", "currency": "USD",
            # Per contract, as TWS gives it: the browser divides by the multiplier, not the agent.
            "position": -1.0, "averageCost": 250.0, "marketPrice": 2.0, "marketValue": -200.0, "unrealizedPNL": 50.0,
        },
    ]


def test_execution_with_a_commission_report(make_client):
    fill = FakeFill(
        contract=OPTION,
        execution=FakeExecution(execId="0000e1a7.68bc1234.01.01", side="SLD", shares=1.0, price=2.5, cumQty=1.0, avgPrice=2.5),
        commissionReport=FakeCommissionReport(execId="0000e1a7.68bc1234.01.01", commission=1.05, currency="USD"),
    )

    executions = make_client(FakeIB(fills=[fill])).get("/snapshot", params={"port": 7502}).json()["executions"]

    assert executions == [
        {
            "execId": "0000e1a7.68bc1234.01.01",
            "time": "2026-09-06T14:31:02+00:00",
            "acctNumber": "U1234567",
            "side": "SLD",
            "shares": 1.0,
            "price": 2.5,
            "cumQty": 1.0,
            "avgPrice": 2.5,
            "orderRef": "",
            "contract": {
                "conId": 700000001, "symbol": "AAPL", "localSymbol": "AAPL  261218C00180000", "secType": "OPT", "right": "C",
                "strike": 180.0, "lastTradeDateOrContractMonth": "20261218", "multiplier": "100", "currency": "USD",
            },
            # Positive, as CommissionReport.commission is: the browser turns it into a cost.
            "commission": 1.05,
            "commissionCurrency": "USD",
        }
    ]


def test_execution_without_a_commission_report_yet_has_null_commission_never_zero(make_client):
    fill = FakeFill(contract=STOCK, execution=FakeExecution(side="BOT", shares=10.0, price=172.0))

    execution = make_client(FakeIB(fills=[fill])).get("/snapshot", params={"port": 7502}).json()["executions"][0]

    assert execution["commission"] is None
    assert execution["commissionCurrency"] is None
    assert execution["side"] == "BOT"
    assert execution["shares"] == 10.0


def test_cash_available_is_the_usd_total_cash_balance(make_client):
    fake_ib = FakeIB(
        account_values=[
            FakeAccountValue(tag="TotalCashBalance", value="16284.37", currency="USD"),
            FakeAccountValue(tag="TotalCashBalance", value="999.99", currency="USD", modelCode="MODEL"),
            FakeAccountValue(tag="TotalCashBalance", value="5.00", currency="EUR"),
            FakeAccountValue(tag="AvailableFunds", value="1.00", currency="USD"),
        ]
    )

    body = make_client(fake_ib).get("/snapshot", params={"port": 7502}).json()

    assert body["cashAvailable"] == 16284.37


def test_cash_available_is_null_not_zero_when_no_tag_gives_anything(make_client):
    body = make_client(FakeIB(account_values=[FakeAccountValue(currency="EUR")])).get("/snapshot", params={"port": 7502}).json()

    assert body["cashAvailable"] is None


def test_extract_usd_cash_falls_through_the_tags_in_order():
    assert CASH_TAGS == ("TotalCashBalance", "CashBalance", "AvailableFunds")
    values = [FakeAccountValue(tag="AvailableFunds", value="3"), FakeAccountValue(tag="CashBalance", value="2")]
    assert extract_usd_cash(values) == 2.0
    assert extract_usd_cash([FakeAccountValue(tag="CashBalance", value="not a number")]) is None


def test_tws_down_is_a_503_with_a_code_and_the_connection_is_released(make_client):
    fake_ib = FakeIB(connect_error=ConnectionRefusedError("refused"))

    response = make_client(fake_ib).get("/snapshot", params={"port": 7502})

    assert response.status_code == 503
    assert response.json() == {"code": "tws-unreachable", "detail": "ConnectionRefusedError: refused"}
    assert fake_ib.disconnected is True


def test_a_failure_while_reading_still_disconnects(make_client):
    fake_ib = FakeIB(portfolio_error=RuntimeError("boom"))

    try:
        make_client(fake_ib).get("/snapshot", params={"port": 7502})
    except RuntimeError:
        pass  # TestClient re-raises server exceptions by default; what matters is below.

    assert fake_ib.disconnected is True


def test_port_is_required_and_bounded(make_client):
    client = make_client(FakeIB())

    assert client.get("/snapshot").status_code == 422
    assert client.get("/snapshot", params={"port": 0}).status_code == 422
    assert client.get("/snapshot", params={"port": 70000}).status_code == 422
```

- [x] **Étape 2 : lancer, voir échouer**

```bash
pnpm test:agent
```

- [x] **Étape 3 : `main.py` complet**

```python
"""The HTTP face of the agent. Raw ib_async data out, nothing stored, nothing computed.

Every JSON field carries the name of the ib_async attribute it comes from, unconverted:
`lastTradeDateOrContractMonth` stays "20261218", `multiplier` stays a string, an option's
`averageCost` stays per contract, a commission stays positive. The browser's parser
(packages/ib-parsers/src/agent.ts) does every conversion, and is where they are tested.
The one exception is `cashAvailable` (see `extract_usd_cash`).
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from datetime import datetime, timezone
from importlib.metadata import version as package_version
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Query
from fastapi.responses import JSONResponse
from ib_async import IB

from .config import Config

IB_HOST = "127.0.0.1"
CLIENT_ID = 0  # Mandatory to see the orders placed from the TWS window itself (spec fondateur §3.4).
CONNECT_TIMEOUT_S = 5
CASH_TAGS = ("TotalCashBalance", "CashBalance", "AvailableFunds")


def get_ib_factory() -> Callable[[], IB]:
    """Overridden in tests with a FakeIB factory."""
    return IB


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def extract_usd_cash(account_values: Iterable[Any]) -> float | None:
    """The USD `TotalCashBalance`: the same figure as Flex's Cash Report `endingCash` and as
    the history's reconciliation oracle. IB repeats each tag per account and per model, so
    model rows are skipped and values are collapsed per account before being summed; the
    first tag that yields anything wins, to avoid double counting. `None`, never 0.0, when
    nothing yields: unknown is not zero.
    """
    for tag in CASH_TAGS:
        per_account: dict[str, float] = {}
        for value in account_values:
            if getattr(value, "tag", None) != tag:
                continue
            if (getattr(value, "currency", "") or "").upper() != "USD":
                continue
            if getattr(value, "modelCode", "") or "":
                continue
            try:
                per_account[getattr(value, "account", "")] = float(value.value)
            except (TypeError, ValueError):
                continue
        if per_account:
            return sum(per_account.values())
    return None


def serialize_contract(contract: Any) -> dict[str, Any]:
    return {
        "conId": contract.conId,
        "symbol": contract.symbol,
        "localSymbol": contract.localSymbol,
        "secType": contract.secType,
        "right": contract.right,
        "strike": contract.strike,
        "lastTradeDateOrContractMonth": contract.lastTradeDateOrContractMonth,
        "multiplier": contract.multiplier,
        "currency": contract.currency,
    }


def serialize_position(item: Any) -> dict[str, Any]:
    return {
        **serialize_contract(item.contract),
        "position": item.position,
        "averageCost": item.averageCost,
        "marketPrice": item.marketPrice,
        "marketValue": item.marketValue,
        "unrealizedPNL": item.unrealizedPNL,
    }


def serialize_execution(fill: Any) -> dict[str, Any]:
    execution = fill.execution
    report = fill.commissionReport
    # IB sends the commission report a moment after the fill: until then there is no report,
    # and no report means `None`, never 0.0.
    has_report = bool(report.execId)
    return {
        "execId": execution.execId,
        "time": execution.time.isoformat(),
        "acctNumber": execution.acctNumber,
        "side": execution.side,
        "shares": execution.shares,
        "price": execution.price,
        "cumQty": execution.cumQty,
        "avgPrice": execution.avgPrice,
        "orderRef": execution.orderRef,
        "contract": serialize_contract(fill.contract),
        "commission": report.commission if has_report else None,
        "commissionCurrency": report.currency if has_report else None,
    }


def create_app(config: Config) -> FastAPI:
    app = FastAPI(title="ib-tws-agent", docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/health")
    async def health() -> dict[str, str]:
        # The detection ping: free, TWS is never touched here.
        return {"version": package_version("ib-tws-agent")}

    @app.get("/snapshot")
    async def snapshot(
        port: Annotated[int, Query(ge=1, le=65535)],
        ib_factory: Callable[[], IB] = Depends(get_ib_factory),
    ):
        # One connection per call, closed whatever happens: TWS restarts nightly and loses its
        # session, so the agent never holds a connection (spec fondateur §3.4).
        ib = ib_factory()
        try:
            await ib.connectAsync(IB_HOST, port, clientId=CLIENT_ID, timeout=CONNECT_TIMEOUT_S)
        except Exception as exc:  # noqa: BLE001 - whatever ib_async raises, the answer is the same
            ib.disconnect()
            return JSONResponse(
                status_code=503,
                content={"code": "tws-unreachable", "detail": f"{type(exc).__name__}: {exc}"},
            )
        try:
            return {
                "accounts": ib.managedAccounts(),
                "fetchedAt": utc_now_iso(),
                "cashAvailable": extract_usd_cash(ib.accountValues()),
                "positions": [serialize_position(item) for item in ib.portfolio()],
                "executions": [serialize_execution(fill) for fill in ib.fills()],
            }
        finally:
            ib.disconnect()

    return app
```

- [x] **Étape 4 : lancer, voir passer, committer**

```bash
pnpm test:agent
git add -A
git commit -m "feat(agent): /snapshot, une connexion TWS par appel, données brutes"
```

---

## Tâche 3 : CORS par liste d'origines et preflight réseau privé

**Files:**
- Create: `apps/tws-agent/ib_tws_agent/cors.py`, `apps/tws-agent/tests/test_cors.py`
- Modify: `apps/tws-agent/ib_tws_agent/main.py`

**Interfaces:**
- Produces: `OriginMiddleware(app, origins: Iterable[str])`, monté par `create_app` sur `config.origins`.

- [x] **Étape 1 : les tests (échec attendu)**

`apps/tws-agent/tests/test_cors.py` :

```python
from __future__ import annotations

from ib_tws_agent.config import Config
from tests.conftest import ORIGIN

PREFLIGHT = {"Origin": ORIGIN, "Access-Control-Request-Method": "GET", "Access-Control-Request-Private-Network": "true"}


def test_allowed_origin_is_echoed_with_vary(make_client):
    response = make_client().get("/health", headers={"Origin": ORIGIN})

    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] == ORIGIN
    assert response.headers["Vary"] == "Origin"


def test_unknown_origin_gets_a_normal_answer_without_allow_origin(make_client):
    response = make_client().get("/health", headers={"Origin": "https://evil.example"})

    assert response.status_code == 200
    assert "Access-Control-Allow-Origin" not in response.headers


def test_no_origin_header_means_no_cors_headers(make_client):
    response = make_client().get("/health")

    assert response.status_code == 200
    assert "Access-Control-Allow-Origin" not in response.headers


def test_preflight_for_an_allowed_origin_allows_get_and_the_private_network(make_client):
    response = make_client().options("/snapshot", headers=PREFLIGHT)

    assert response.status_code == 204
    assert response.headers["Access-Control-Allow-Origin"] == ORIGIN
    assert response.headers["Access-Control-Allow-Methods"] == "GET"
    assert response.headers["Access-Control-Allow-Private-Network"] == "true"
    assert response.headers["Access-Control-Max-Age"] == "600"
    assert "Access-Control-Allow-Credentials" not in response.headers


def test_preflight_for_an_unknown_origin_carries_nothing(make_client):
    response = make_client().options("/snapshot", headers={**PREFLIGHT, "Origin": "https://evil.example"})

    assert response.status_code == 204
    assert "Access-Control-Allow-Origin" not in response.headers
    assert "Access-Control-Allow-Private-Network" not in response.headers


def test_every_configured_origin_is_allowed(make_client):
    config = Config(origins=(ORIGIN, "http://localhost:5173"), listen=8100)

    response = make_client(config=config).get("/health", headers={"Origin": "http://localhost:5173"})

    assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
```

- [x] **Étape 2 : lancer, voir échouer**

```bash
pnpm test:agent
```

- [x] **Étape 3 : `cors.py` et son montage**

```python
"""Answer the site, and only the site.

Not Starlette's CORSMiddleware: the preflight must carry
`Access-Control-Allow-Private-Network`, which Chrome requires before a public HTTPS page may
talk to 127.0.0.1, and CORSMiddleware does not know that header. An unknown origin gets a
normal answer without any Allow-* header: the browser is what refuses, the agent stays dumb.
"""

from __future__ import annotations

from collections.abc import Iterable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

PREFLIGHT_MAX_AGE_S = 600


class OriginMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, origins: Iterable[str]):
        super().__init__(app)
        self.origins = frozenset(origins)

    async def dispatch(self, request: Request, call_next):
        origin = request.headers.get("origin")
        allowed = origin is not None and origin in self.origins

        if request.method == "OPTIONS" and "access-control-request-method" in request.headers:
            headers = {"Vary": "Origin"}
            if allowed:
                headers.update(
                    {
                        "Access-Control-Allow-Origin": origin,
                        "Access-Control-Allow-Methods": "GET",
                        "Access-Control-Allow-Private-Network": "true",
                        "Access-Control-Max-Age": str(PREFLIGHT_MAX_AGE_S),
                    }
                )
            return Response(status_code=204, headers=headers)

        response = await call_next(request)
        if allowed:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
        return response
```

Dans `main.py`, après la construction de `app` :

```python
from .cors import OriginMiddleware
# …
    app.add_middleware(OriginMiddleware, origins=config.origins)
```

- [x] **Étape 4 : lancer, voir passer, committer**

```bash
pnpm test:agent
git add -A
git commit -m "feat(agent): CORS par liste d'origines et preflight réseau privé"
```

---

# Palier B — parseur et règle d'import

## Tâche 4 : `planAgent`, n'écrit qu'après la borne Flex, ne supprime jamais

**Files:**
- Modify: `packages/ledger/src/import.ts`, `packages/ledger/src/import.test.ts`

**Interfaces:**
- Consumes: `planImport(existing, batch)`, `ImportBatch`, `ImportPlan`, `Transaction`.
- Produces: `planImport` accepte `source: "agent"` (période `null`) ; `UnsupportedSourceError` n'est plus levée pour `agent`.

- [x] **Étape 1 : les tests (échec attendu)**

Ajouter à `packages/ledger/src/import.test.ts`, à côté des `describe` existants :

```ts
const agent = (id: string, when: string, extra: Partial<Transaction> = {}) =>
  tx({ source: "agent", externalId: `agent:${id}`, when, ...extra });

describe("planImport from the agent", () => {
  const flexMax = "2026-09-05T20:00:00.000Z";
  const existing = [flex("1", "2026-01-10T10:00:00.000Z"), flex("2", flexMax)];

  it("writes only what is strictly after Flex's newest row", () => {
    const atBound = agent("at-bound", flexMax);
    const after = agent("after", "2026-09-05T20:00:00.001Z");
    const before = agent("before", "2026-09-05T19:59:59.000Z");
    const plan = planImport(existing, { source: "agent", transactions: [atBound, after, before], period: null });
    expect(plan.upsert).toEqual([after]);
    expect(plan.skipped).toBe(2);
  });

  it("writes everything when there is no Flex row at all", () => {
    const rows = [agent("a", "2026-09-06T14:00:00.000Z"), agent("b", "2026-01-01T00:00:00.000Z")];
    const plan = planImport([html("h", "2026-02-01T00:00:00.000Z")], { source: "agent", transactions: rows, period: null });
    expect(plan.upsert).toEqual(rows);
    expect(plan.skipped).toBe(0);
  });

  it("never deletes anything, not even its own rows missing from the batch", () => {
    const stale = agent("gone", "2026-09-06T09:00:00.000Z");
    const plan = planImport([...existing, stale], { source: "agent", transactions: [agent("new", "2026-09-06T15:00:00.000Z")], period: null });
    expect(plan.delete).toEqual([]);
    expect(plan.dropped).toEqual([]);
  });

  it("is idempotent: the same batch twice plans the same writes", () => {
    const batch = { source: "agent" as const, transactions: [agent("x", "2026-09-06T15:00:00.000Z")], period: null };
    const first = planImport(existing, batch);
    const second = planImport([...existing, ...first.upsert], batch);
    expect(second.upsert).toEqual(first.upsert);
    expect(second.delete).toEqual([]);
  });

  it("returns a fresh array, never the caller's own", () => {
    const rows = [agent("x", "2026-09-06T15:00:00.000Z")];
    const plan = planImport([], { source: "agent", transactions: rows, period: null });
    expect(plan.upsert).not.toBe(rows);
  });
});

describe("planImport from Flex, over agent rows", () => {
  it("retires agent rows inside its range: Flex replaces the day the agent wrote", () => {
    const existing = [agent("morning", "2026-09-05T14:00:00.000Z"), agent("after", "2026-09-05T20:00:00.001Z")];
    const incoming = [flex("1", "2026-09-01T10:00:00.000Z"), flex("2", "2026-09-05T20:00:00.000Z")];
    const plan = planImport(existing, { source: "flex", transactions: incoming, period: null });
    expect(plan.delete).toEqual(["agent:morning"]);
    expect(plan.dropped).toEqual([{ kind: "trade", count: 1 }]);
  });
});
```

Et remplacer le test existant qui affirme qu'`agent` lève `UnsupportedSourceError` (chercher `UnsupportedSourceError` dans le fichier) par :

```ts
it("still refuses a source it does not know", () => {
  expect(() =>
    planImport([], { source: "csv" as unknown as TransactionSource, transactions: [], period: null }),
  ).toThrow(UnsupportedSourceError);
});
```

(`TransactionSource` s'importe depuis `./types.ts`.)

- [x] **Étape 2 : lancer, voir échouer**

```bash
pnpm --filter @ib/ledger test
```

- [x] **Étape 3 : `planAgent`**

Dans `packages/ledger/src/import.ts`, remplacer le `switch` de `planImport` :

```ts
    case "agent":
      return planAgent(existing, batch.transactions);
```

et ajouter :

```ts
/**
 * The agent writes only *after* Flex's newest row, strictly: a fill at the very instant of
 * Flex's last row is Flex's, and Flex's range is closed on both ends (`planFlex`). It never
 * deletes: a TWS restarted mid-day no longer reports the morning's fills, and erasing them
 * would lose true information. The next Flex sync replaces the whole day anyway (spec
 * fondateur §6.2). Upserting by externalId makes a five-minute cadence idempotent, and lets
 * a later pass fill in a commission that IB reported after the fill.
 */
function planAgent(existing: readonly Transaction[], incoming: readonly Transaction[]): ImportPlan {
  let flexMax: string | null = null;
  for (const tx of existing) {
    if (tx.source === "flex" && (flexMax === null || tx.when > flexMax)) flexMax = tx.when;
  }
  const kept = flexMax === null ? [...incoming] : incoming.filter((tx) => tx.when > flexMax);
  return { delete: [], upsert: kept, dropped: [], skipped: incoming.length - kept.length };
}
```

- [x] **Étape 4 : lancer, voir passer, committer**

```bash
pnpm --filter @ib/ledger test
git add -A
git commit -m "feat(ledger): planAgent, l'agent n'écrit qu'après la borne Flex et ne supprime jamais"
```

---

## Tâche 5 : `parseAgentSnapshot`, toutes les conversions au même endroit

**Files:**
- Create: `packages/ib-parsers/src/agent.ts`, `packages/ib-parsers/src/agent.test.ts`, `packages/ib-parsers/tests/fixtures/agent_snapshot_sample.json`
- Modify: `packages/ib-parsers/src/issues.ts`, `packages/ib-parsers/src/index.ts`

**Interfaces:**
- Consumes: `Position`, `Transaction` (`@ib/ledger`), `NormalizationError`, `flexDateToIsoDay` (`./common.ts`), `warning`, `ParseIssue` (`./issues.ts`).
- Produces:
  ```ts
  interface AgentContract { conId: number; symbol: string; localSymbol: string; secType: string; right: string; strike: number; lastTradeDateOrContractMonth: string; multiplier: string; currency: string }
  interface AgentPosition extends AgentContract { position: number; averageCost: number; marketPrice: number; marketValue: number; unrealizedPNL: number }
  interface AgentExecution { execId: string; time: string; acctNumber: string; side: string; shares: number; price: number; cumQty: number; avgPrice: number; orderRef: string; contract: AgentContract; commission: number | null; commissionCurrency: string | null }
  interface AgentSnapshotPayload { accounts: string[]; fetchedAt: string; cashAvailable: number | null; positions: AgentPosition[]; executions: AgentExecution[] }
  interface AgentSnapshot { accounts: string[]; fetchedAt: string; cashAvailable: number | null; positions: Position[]; transactions: Transaction[]; issues: ParseIssue[] }
  function parseAgentSnapshot(payload: unknown, accountId: string): AgentSnapshot
  function describeContract(c: { symbol: string; localSymbol: string; secType: string; right: "C" | "P" | ""; strike: number | null; expiry: string | null }): string
  ```
  et le code d'anomalie `"multiplier-missing"`.

- [x] **Étape 1 : la fixture**

`packages/ib-parsers/tests/fixtures/agent_snapshot_sample.json`, construite à la main, aucune donnée réelle. Les prix sont choisis pour que les produits soient exacts en flottant (2.5 × 100, 172 × 10) :

```json
{
  "accounts": ["U0000001"],
  "fetchedAt": "2026-09-06T13:02:11.482Z",
  "cashAvailable": 16284.37,
  "positions": [
    {
      "conId": 265598, "symbol": "SYMA", "localSymbol": "SYMA", "secType": "STK", "right": "", "strike": 0.0,
      "lastTradeDateOrContractMonth": "", "multiplier": "", "currency": "USD",
      "position": 100.0, "averageCost": 150.25, "marketPrice": 172.1, "marketValue": 17210.0, "unrealizedPNL": 2185.0
    },
    {
      "conId": 700000001, "symbol": "SYMB", "localSymbol": "SYMB  261218C00180000", "secType": "OPT", "right": "C",
      "strike": 180.0, "lastTradeDateOrContractMonth": "20261218", "multiplier": "100", "currency": "USD",
      "position": -1.0, "averageCost": 250.0, "marketPrice": 2.0, "marketValue": -200.0, "unrealizedPNL": 50.0
    }
  ],
  "executions": [
    {
      "execId": "0000e1a7.68bc1234.01.01", "time": "2026-09-06T14:31:02+00:00", "acctNumber": "U0000001",
      "side": "SLD", "shares": 1.0, "price": 2.5, "cumQty": 1.0, "avgPrice": 2.5, "orderRef": "",
      "contract": {
        "conId": 700000001, "symbol": "SYMB", "localSymbol": "SYMB  261218C00180000", "secType": "OPT", "right": "C",
        "strike": 180.0, "lastTradeDateOrContractMonth": "20261218", "multiplier": "100", "currency": "USD"
      },
      "commission": 1.05, "commissionCurrency": "USD"
    },
    {
      "execId": "0000e1a7.68bc1234.01.02", "time": "2026-09-06T15:00:00+00:00", "acctNumber": "U0000001",
      "side": "BOT", "shares": 10.0, "price": 172.0, "cumQty": 10.0, "avgPrice": 172.0, "orderRef": "",
      "contract": {
        "conId": 265598, "symbol": "SYMA", "localSymbol": "SYMA", "secType": "STK", "right": "", "strike": 0.0,
        "lastTradeDateOrContractMonth": "", "multiplier": "", "currency": "USD"
      },
      "commission": null, "commissionCurrency": null
    },
    {
      "execId": "0000e1a7.68bc1234.01.03", "time": "2026-09-06T15:10:00+00:00", "acctNumber": "U0000001",
      "side": "SLD", "shares": 1000.0, "price": 1.1, "cumQty": 1000.0, "avgPrice": 1.1, "orderRef": "",
      "contract": {
        "conId": 12087792, "symbol": "EUR", "localSymbol": "EUR.USD", "secType": "CASH", "right": "", "strike": 0.0,
        "lastTradeDateOrContractMonth": "", "multiplier": "", "currency": "USD"
      },
      "commission": 2.0, "commissionCurrency": "EUR"
    }
  ]
}
```

- [x] **Étape 2 : les tests (échec attendu)**

`packages/ib-parsers/src/agent.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import sample from "../tests/fixtures/agent_snapshot_sample.json" with { type: "json" };
import { describeContract, parseAgentSnapshot, type AgentSnapshotPayload } from "./agent.ts";
import { NormalizationError } from "./common.ts";

const ACCOUNT = "test";
const payload = sample as AgentSnapshotPayload;

function withPosition(overrides: Partial<AgentSnapshotPayload["positions"][number]>, index = 1): AgentSnapshotPayload {
  const positions = payload.positions.map((p, i) => (i === index ? { ...p, ...overrides } : p));
  return { ...payload, positions };
}

describe("parseAgentSnapshot", () => {
  it("passes the envelope through and normalises fetchedAt to a Z instant", () => {
    const snapshot = parseAgentSnapshot(payload, ACCOUNT);
    expect(snapshot.accounts).toEqual(["U0000001"]);
    expect(snapshot.fetchedAt).toBe("2026-09-06T13:02:11.482Z");
    expect(snapshot.cashAvailable).toBe(16284.37);
    expect(snapshot.issues).toEqual([]);
  });

  it("keeps an absent cash as null, never zero", () => {
    expect(parseAgentSnapshot({ ...payload, cashAvailable: null }, ACCOUNT).cashAvailable).toBeNull();
  });

  it("converts a stock position field by field", () => {
    const [stock] = parseAgentSnapshot(payload, ACCOUNT).positions;
    expect(stock).toEqual({
      symbol: "SYMA",
      secType: "STK",
      right: "",
      strike: null,
      expiry: null,
      multiplier: null,
      quantity: 100,
      avgPrice: 150.25,
      marketPrice: 172.1,
      marketValue: 17210,
      unrealizedPnl: 2185,
      currency: "USD",
      conid: "265598",
      description: "SYMA",
    });
  });

  it("brings an option's averageCost from per contract to per unit, and reads its expiry", () => {
    const [, option] = parseAgentSnapshot(payload, ACCOUNT).positions;
    expect(option).toMatchObject({
      symbol: "SYMB",
      secType: "OPT",
      right: "C",
      strike: 180,
      expiry: "2026-12-18",
      multiplier: 100,
      quantity: -1,
      avgPrice: 2.5,
      conid: "700000001",
      description: "SYMB 18DEC26 180 C",
    });
  });

  it("leaves an option without a multiplier with a null avgPrice and says so", () => {
    const snapshot = parseAgentSnapshot(withPosition({ multiplier: "" }), ACCOUNT);
    expect(snapshot.positions[1].avgPrice).toBeNull();
    expect(snapshot.positions[1].multiplier).toBeNull();
    expect(snapshot.issues).toEqual([{ severity: "warning", code: "multiplier-missing", detail: "SYMB 18DEC26 180 C" }]);
  });

  it("turns a SLD option fill into a negative-quantity trade with gross proceeds and a negative commission", () => {
    const [sold] = parseAgentSnapshot(payload, ACCOUNT).transactions;
    expect(sold).toEqual({
      accountId: ACCOUNT,
      externalId: "agent:0000e1a7.68bc1234.01.01",
      source: "agent",
      kind: "trade",
      symbol: "SYMB",
      secType: "OPT",
      right: "C",
      strike: 180,
      expiry: "2026-12-18",
      quantity: -1,
      price: 2.5,
      amount: 250,
      commission: -1.05,
      currency: "USD",
      when: "2026-09-06T14:31:02.000Z",
      description: "SYMB 18DEC26 180 C",
    });
  });

  it("turns a BOT stock fill into a positive quantity, a negative amount, and keeps a missing commission null", () => {
    const [, bought] = parseAgentSnapshot(payload, ACCOUNT).transactions;
    expect(bought).toMatchObject({
      externalId: "agent:0000e1a7.68bc1234.01.02",
      symbol: "SYMA",
      secType: "STK",
      quantity: 10,
      price: 172,
      amount: -1720,
      commission: null,
      when: "2026-09-06T15:00:00.000Z",
      description: "SYMA",
    });
  });

  it("names a currency pair by its dotted localSymbol so the ledger recognises it", () => {
    const [, , forex] = parseAgentSnapshot(payload, ACCOUNT).transactions;
    expect(forex).toMatchObject({ symbol: "EUR.USD", secType: "CASH", quantity: -1000, amount: 1100, currency: "USD", commission: -2 });
  });

  it("refuses a fill without an execId: it is the dedup key", () => {
    const broken = { ...payload, executions: [{ ...payload.executions[0], execId: "" }] };
    expect(() => parseAgentSnapshot(broken, ACCOUNT)).toThrow(NormalizationError);
  });

  it("refuses a side it does not know", () => {
    const broken = { ...payload, executions: [{ ...payload.executions[0], side: "XXX" }] };
    expect(() => parseAgentSnapshot(broken, ACCOUNT)).toThrow(/side/);
  });

  it("refuses anything that is not the expected shape, naming the path", () => {
    expect(() => parseAgentSnapshot(null, ACCOUNT)).toThrow(NormalizationError);
    expect(() => parseAgentSnapshot("nope", ACCOUNT)).toThrow(NormalizationError);
    expect(() => parseAgentSnapshot({ ...payload, positions: "x" }, ACCOUNT)).toThrow(/payload\.positions/);
    expect(() => parseAgentSnapshot(withPosition({ marketPrice: "1" as unknown as number }), ACCOUNT)).toThrow(/positions\[1\]\.marketPrice/);
    expect(() => parseAgentSnapshot({ ...payload, fetchedAt: "yesterday" }, ACCOUNT)).toThrow(/fetchedAt/);
  });
});

describe("describeContract", () => {
  it("writes an option the way IB's own description does, so a Flex leg and an agent leg read the same", () => {
    expect(describeContract({ symbol: "SYMB", localSymbol: "x", secType: "OPT", right: "P", strike: 2.5, expiry: "2028-01-21" })).toBe("SYMB 21JAN28 2.5 P");
  });

  it("falls back to the local symbol for anything else", () => {
    expect(describeContract({ symbol: "EUR", localSymbol: "EUR.USD", secType: "CASH", right: "", strike: null, expiry: null })).toBe("EUR.USD");
  });
});
```

- [x] **Étape 3 : lancer, voir échouer**

```bash
pnpm --filter @ib/ib-parsers test src/agent.test.ts
```

- [x] **Étape 4 : le code d'anomalie et l'export**

Dans `issues.ts`, ajouter `| "multiplier-missing"` à `ParseIssueCode`. Dans `index.ts` : `export * from "./agent.ts";`.

- [x] **Étape 5 : `agent.ts`**

```ts
import type { Position, Transaction } from "@ib/ledger";
import { NormalizationError, flexDateToIsoDay } from "./common.ts";
import { warning, type ParseIssue } from "./issues.ts";

/** The wire shape of `GET /snapshot` of apps/tws-agent, field names being ib_async's own. */
export interface AgentContract {
  conId: number;
  symbol: string;
  localSymbol: string;
  secType: string;
  right: string;
  strike: number;
  /** "20261218", or "" */
  lastTradeDateOrContractMonth: string;
  /** "100", or "" */
  multiplier: string;
  currency: string;
}

export interface AgentPosition extends AgentContract {
  position: number;
  /** Per contract for an option, multiplier included: TWS's convention, converted below. */
  averageCost: number;
  marketPrice: number;
  marketValue: number;
  unrealizedPNL: number;
}

export interface AgentExecution {
  execId: string;
  time: string;
  acctNumber: string;
  side: string;
  shares: number;
  price: number;
  cumQty: number;
  avgPrice: number;
  orderRef: string;
  contract: AgentContract;
  /** Positive, as CommissionReport gives it; `null` until IB sends the report. */
  commission: number | null;
  commissionCurrency: string | null;
}

export interface AgentSnapshotPayload {
  accounts: string[];
  fetchedAt: string;
  cashAvailable: number | null;
  positions: AgentPosition[];
  executions: AgentExecution[];
}

export interface AgentSnapshot {
  accounts: string[];
  /** ISO 8601 UTC, normalised to a trailing Z. */
  fetchedAt: string;
  cashAvailable: number | null;
  positions: Position[];
  transactions: Transaction[];
  issues: ParseIssue[];
}

type Obj = Record<string, unknown>;

function fail(path: string, expected: string): never {
  throw new NormalizationError(`Agent payload: ${path} should be ${expected}`);
}

function obj(value: unknown, path: string): Obj {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "an object");
  return value as Obj;
}

function str(o: Obj, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== "string") fail(`${path}.${key}`, "a string");
  return v;
}

function num(o: Obj, key: string, path: string): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isFinite(v)) fail(`${path}.${key}`, "a number");
  return v;
}

function numOrNull(o: Obj, key: string, path: string): number | null {
  const v = o[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) fail(`${path}.${key}`, "a number or null");
  return v;
}

function list(o: Obj, key: string, path: string): unknown[] {
  const v = o[key];
  if (!Array.isArray(v)) fail(`${path}.${key}`, "an array");
  return v;
}

function instant(o: Obj, key: string, path: string): string {
  const date = new Date(str(o, key, path));
  if (Number.isNaN(date.getTime())) fail(`${path}.${key}`, "an ISO 8601 date");
  return date.toISOString();
}

function readContract(value: unknown, path: string): AgentContract {
  const o = obj(value, path);
  return {
    conId: num(o, "conId", path),
    symbol: str(o, "symbol", path),
    localSymbol: str(o, "localSymbol", path),
    secType: str(o, "secType", path),
    right: str(o, "right", path),
    strike: num(o, "strike", path),
    lastTradeDateOrContractMonth: str(o, "lastTradeDateOrContractMonth", path),
    multiplier: str(o, "multiplier", path),
    currency: str(o, "currency", path),
  };
}

const OPTION_TYPES = new Set(["OPT", "FOP"]);
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

interface ContractFields {
  symbol: string;
  localSymbol: string;
  secType: string;
  right: "C" | "P" | "";
  strike: number | null;
  expiry: string | null;
}

/**
 * IB's own description format for an option ("SYMB 20MAR26 20 P"), so that a leg reads the
 * same in Positions and History whether Flex or the agent reported it. TWS gives no company
 * name, so anything else is its local symbol.
 */
export function describeContract(c: ContractFields): string {
  if (OPTION_TYPES.has(c.secType) && c.expiry !== null && c.strike !== null) {
    const [year, month, day] = c.expiry.split("-");
    return `${c.symbol} ${day}${MONTHS[Number(month) - 1]}${year.slice(2)} ${c.strike} ${c.right}`;
  }
  return c.localSymbol || c.symbol;
}

function readFields(c: AgentContract, what: string): ContractFields & { multiplier: number | null } {
  let multiplier: number | null = null;
  if (c.multiplier !== "") {
    multiplier = Number(c.multiplier);
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      throw new NormalizationError(`Unreadable multiplier "${c.multiplier}" for ${what}`);
    }
  }
  return {
    // A currency pair comes as symbol "EUR" / localSymbol "EUR.USD"; the ledger recognises the
    // pair by its dotted form (spec fondateur §3.5).
    symbol: c.secType === "CASH" ? c.localSymbol : c.symbol,
    localSymbol: c.localSymbol,
    secType: c.secType,
    right: c.right === "C" || c.right === "P" ? c.right : "",
    strike: c.strike === 0 ? null : c.strike,
    expiry: flexDateToIsoDay(c.lastTradeDateOrContractMonth),
    multiplier,
  };
}

function readPosition(value: unknown, path: string, issues: ParseIssue[]): Position {
  const o = obj(value, path);
  const contract = readContract(o, path);
  const fields = readFields(contract, path);
  const description = describeContract(fields);
  const averageCost = num(o, "averageCost", path);
  let avgPrice: number | null = averageCost;
  if (OPTION_TYPES.has(fields.secType)) {
    // TWS's averageCost of an option is per contract, multiplier included; Position wants per unit.
    if (fields.multiplier === null) {
      issues.push(warning("multiplier-missing", description));
      avgPrice = null;
    } else {
      avgPrice = averageCost / fields.multiplier;
    }
  }
  return {
    symbol: fields.symbol,
    secType: fields.secType,
    right: fields.right,
    strike: fields.strike,
    expiry: fields.expiry,
    multiplier: fields.multiplier,
    quantity: num(o, "position", path),
    avgPrice,
    marketPrice: num(o, "marketPrice", path),
    marketValue: num(o, "marketValue", path),
    unrealizedPnl: num(o, "unrealizedPNL", path),
    currency: contract.currency,
    conid: String(contract.conId),
    description,
  };
}

function readExecution(value: unknown, path: string, accountId: string): Transaction {
  const o = obj(value, path);
  const execId = str(o, "execId", path);
  if (execId === "") fail(`${path}.execId`, "non-empty: it is the dedup key");
  const side = str(o, "side", path);
  if (side !== "BOT" && side !== "SLD") fail(`${path}.side`, '"BOT" or "SLD"');
  const contract = readContract(o["contract"], `${path}.contract`);
  const fields = readFields(contract, `${path}.contract`);
  const shares = num(o, "shares", path);
  const price = num(o, "price", path);
  const quantity = side === "BOT" ? shares : -shares;
  const commission = numOrNull(o, "commission", path);
  return {
    accountId,
    externalId: `agent:${execId}`,
    source: "agent",
    kind: "trade",
    symbol: fields.symbol,
    secType: fields.secType,
    right: fields.right,
    strike: fields.strike,
    expiry: fields.expiry,
    quantity,
    price,
    // Gross proceeds, commission apart: the same convention as a Flex Trade's `proceeds`.
    amount: -quantity * price * (fields.multiplier ?? 1),
    // A commission is a cost; `null` stays `null`, the next pass may bring it.
    commission: commission === null ? null : -commission,
    currency: contract.currency,
    when: instant(o, "time", path),
    description: describeContract(fields),
  };
}

/** Anything that is not the shape of §3.4 of the sub-project 4 spec is a `NormalizationError` naming the path. */
export function parseAgentSnapshot(payload: unknown, accountId: string): AgentSnapshot {
  const root = obj(payload, "payload");
  const issues: ParseIssue[] = [];
  const accounts = list(root, "accounts", "payload").map((v, i) =>
    typeof v === "string" ? v : fail(`payload.accounts[${i}]`, "a string"),
  );
  const fetchedAt = instant(root, "fetchedAt", "payload");
  const cashAvailable = numOrNull(root, "cashAvailable", "payload");
  const positions = list(root, "positions", "payload").map((v, i) => readPosition(v, `payload.positions[${i}]`, issues));
  const transactions = list(root, "executions", "payload").map((v, i) =>
    readExecution(v, `payload.executions[${i}]`, accountId),
  );
  return { accounts, fetchedAt, cashAvailable, positions, transactions, issues };
}
```

`-quantity * price * 1` pour une quantité positive donne un nombre négatif ; pour `quantity = -1`, `-(-1) * 2.5 * 100 = 250`. `-0` n'apparaît que pour une quantité nulle, que TWS ne rapporte pas.

- [x] **Étape 6 : lancer, voir passer, typecheck, committer**

```bash
pnpm --filter @ib/ib-parsers test
pnpm --filter @ib/ib-parsers typecheck
git add -A
git commit -m "feat(ib-parsers): parseAgentSnapshot, la troisième source"
```

Si `typecheck` refuse l'import JSON avec `with { type: "json" }` dans le test, remplacer par `import sample from "../tests/fixtures/agent_snapshot_sample.json";` (`resolveJsonModule` est actif dans `tsconfig.base.json`).

---

# Palier C — le navigateur

## Tâche 6 : schéma Dexie, règle de remplacement du snapshot, port TWS

**Files:**
- Modify: `apps/web/src/db/schema.ts`, `apps/web/src/db/accounts.ts`, `apps/web/src/db/importFile.ts`, `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`
- Create: `apps/web/src/db/snapshot.ts`, `apps/web/src/db/snapshot.test.ts`, `apps/web/src/db/twsPort.test.ts`

**Interfaces:**
- Consumes: `AccountRecord`, `SnapshotRecord`, `ImportRecord`, `AccountError`, `dayOf` (`@ib/ledger`).
- Produces:
  ```ts
  type AgentSyncCode = "agent-unreachable" | "tws-unreachable" | "agent-error" | "account-mismatch" | "parse-error";
  // AccountRecord: twsPort?: number; lastAgentSyncAt?: string; lastAgentSyncStatus?: { at: string; ok: boolean; code?: AgentSyncCode }
  // SnapshotRecord.source: "flex" | "agent" ; ImportRecord.source: Exclude<TransactionSource, "agent">
  function shouldReplaceSnapshot(current: SnapshotRecord | undefined, incoming: Pick<SnapshotRecord, "source" | "asOf">): boolean
  function setTwsPort(db: AppDatabase, accountId: string, port: number | null): Promise<void>  // AccountError("tws-port-invalid")
  const TWS_PORT_MIN = 1, TWS_PORT_MAX = 65535
  ```

- [x] **Étape 1 : les tests (échec attendu)**

`apps/web/src/db/snapshot.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { SnapshotRecord } from "./schema";
import { shouldReplaceSnapshot } from "./snapshot";

const flex = (asOf: string): SnapshotRecord => ({ accountId: "a", source: "flex", asOf, importedAt: "", positions: [], cashAvailable: null });
const agent = (asOf: string): SnapshotRecord => ({ accountId: "a", source: "agent", asOf, importedAt: "", positions: [], cashAvailable: null });

describe("shouldReplaceSnapshot", () => {
  it("writes when there is nothing yet", () => {
    expect(shouldReplaceSnapshot(undefined, { source: "flex", asOf: "2026-09-05" })).toBe(true);
  });

  it("lets an agent snapshot replace anything: it is live by definition", () => {
    expect(shouldReplaceSnapshot(flex("2026-09-06"), { source: "agent", asOf: "2026-09-06T13:02:00.000Z" })).toBe(true);
    expect(shouldReplaceSnapshot(agent("2026-09-06T15:00:00.000Z"), { source: "agent", asOf: "2026-09-06T13:02:00.000Z" })).toBe(true);
  });

  it("lets the morning Flex sync (yesterday's close) replace yesterday's agent snapshot", () => {
    expect(shouldReplaceSnapshot(agent("2026-09-05T15:00:00.000Z"), { source: "flex", asOf: "2026-09-05" })).toBe(true);
  });

  it("never lets an older file replace today's agent snapshot", () => {
    expect(shouldReplaceSnapshot(agent("2026-09-06T15:00:00.000Z"), { source: "flex", asOf: "2026-09-05" })).toBe(false);
  });

  it("keeps the file-vs-file rule: same or newer day replaces, older does not", () => {
    expect(shouldReplaceSnapshot(flex("2026-09-05"), { source: "flex", asOf: "2026-09-05" })).toBe(true);
    expect(shouldReplaceSnapshot(flex("2026-09-05"), { source: "flex", asOf: "2026-09-04" })).toBe(false);
  });
});
```

`apps/web/src/db/twsPort.test.ts` :

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { AccountError, setTwsPort } from "./accounts";
import { db } from "./schema";

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.accounts.put({ id: "beta", label: "Beta", ibAccountId: "U1234567", createdAt: "2026-09-01T00:00:00.000Z", warnedDroppedKinds: [] });
});

describe("setTwsPort", () => {
  it("stores the port", async () => {
    await setTwsPort(db, "beta", 7502);
    expect((await db.accounts.get("beta"))?.twsPort).toBe(7502);
  });

  it("clears it on null", async () => {
    await setTwsPort(db, "beta", 7502);
    await setTwsPort(db, "beta", null);
    expect((await db.accounts.get("beta"))?.twsPort).toBeUndefined();
  });

  it.each([0, 65536, 7502.5, Number.NaN])("refuses %s without touching the record", async (port) => {
    await setTwsPort(db, "beta", 7502);
    await expect(setTwsPort(db, "beta", port)).rejects.toMatchObject({ name: "AccountError", code: "tws-port-invalid" });
    expect((await db.accounts.get("beta"))?.twsPort).toBe(7502);
  });

  it("leaves the Flex fields and the agent sync state alone", async () => {
    await db.accounts.update("beta", { flexToken: "tok", lastAgentSyncAt: "2026-09-06T13:00:00.000Z" });
    await setTwsPort(db, "beta", 7502);
    expect(await db.accounts.get("beta")).toMatchObject({ flexToken: "tok", lastAgentSyncAt: "2026-09-06T13:00:00.000Z" });
  });
});
```

Et dans `apps/web/src/db/importFile.test.ts`, ajouter au `describe("importFile")` (le fichier définit déjà `db`, `account` — id `test` — et `file(content, name)` ; la fixture Flex a ses Open Positions au `2026-09-02`) :

```ts
  it("lets a Flex file of the same day replace an agent snapshot, whatever the asOf string order says", async () => {
    // "2026-09-02" < "2026-09-02T15:00:00.000Z" as strings: only the day rule lets the file in.
    await db.snapshots.put({ accountId: "test", source: "agent", asOf: "2026-09-02T15:00:00.000Z", importedAt: "", positions: [], cashAvailable: null });
    const report = await importFile(db, account, file(flexXml, "flex.xml"));
    expect(report).toMatchObject({ status: "ok", staleSnapshot: false });
    expect((await db.snapshots.get("test"))?.source).toBe("flex");
  });

  it("never lets a file older than the agent snapshot's day replace it", async () => {
    await db.snapshots.put({ accountId: "test", source: "agent", asOf: "2026-09-03T15:00:00.000Z", importedAt: "", positions: [], cashAvailable: null });
    const report = await importFile(db, account, file(flexXml, "flex.xml"));
    expect(report).toMatchObject({ status: "ok", staleSnapshot: true, positions: null });
    expect((await db.snapshots.get("test"))?.source).toBe("agent");
  });
```

- [x] **Étape 2 : lancer, voir échouer**

```bash
pnpm --filter web test src/db
```

- [x] **Étape 3 : le schéma**

Dans `schema.ts` :

```ts
export type AgentSyncCode = "agent-unreachable" | "tws-unreachable" | "agent-error" | "account-mismatch" | "parse-error";

export interface AccountRecord {
  // … champs existants …
  /** Port of this account's TWS API on the user's own machine. Absent: the agent is never called. */
  twsPort?: number;
  /** ISO timestamp of the last successful agent pass; absent means never. */
  lastAgentSyncAt?: string;
  /** Outcome of the last agent pass, for the Sources page and the pages' status badge. */
  lastAgentSyncStatus?: { at: string; ok: boolean; code?: AgentSyncCode };
}

export interface ImportRecord {
  // …
  /** The agent never writes an ImportRecord: a pass every five minutes would drown the table. */
  source: Exclude<TransactionSource, "agent">;
  // …
}

export interface SnapshotRecord {
  accountId: string;
  source: "flex" | "agent";
  /** Flex: YYYY-MM-DD of the close. Agent: the full ISO instant of the pass. */
  asOf: string;
  // …
}
```

Aucune nouvelle version Dexie : rien de tout cela n'est indexé.

- [x] **Étape 4 : `snapshot.ts`**

```ts
import { dayOf } from "@ib/ledger";
import type { SnapshotRecord } from "./schema";

/**
 * An agent snapshot always replaces the current one: it is live by definition. A file
 * (Flex, statement) replaces if its day reaches the *day* of the current one, so that the
 * morning Flex sync, as of yesterday's close, replaces yesterday's agent snapshot, and the
 * first agent pass of the day replaces it back. Comparing the raw strings would let a
 * "2026-09-05" file lose against "2026-09-05T15:00Z" for ever.
 */
export function shouldReplaceSnapshot(
  current: SnapshotRecord | undefined,
  incoming: Pick<SnapshotRecord, "source" | "asOf">,
): boolean {
  if (!current) return true;
  if (incoming.source === "agent") return true;
  return incoming.asOf >= dayOf(current.asOf);
}
```

Dans `importFile.ts`, remplacer `if (!current || snapshot.asOf >= current.asOf) {` par :

```ts
      if (shouldReplaceSnapshot(current, { source: "flex", asOf: snapshot.asOf })) {
```

avec l'import `import { shouldReplaceSnapshot } from "./snapshot";`.

- [x] **Étape 5 : `setTwsPort`**

Dans `accounts.ts`, étendre `AccountErrorCode` de `| "tws-port-invalid"` et ajouter :

```ts
export const TWS_PORT_MIN = 1;
export const TWS_PORT_MAX = 65535;

/** `null` clears the port, which is the one way to stop calling the agent for this account. */
export async function setTwsPort(db: AppDatabase, accountId: string, port: number | null): Promise<void> {
  if (port !== null && (!Number.isInteger(port) || port < TWS_PORT_MIN || port > TWS_PORT_MAX)) {
    throw new AccountError("tws-port-invalid");
  }
  await db.accounts.update(accountId, { twsPort: port ?? undefined });
}
```

- [x] **Étape 6 : i18n**

Dans `fr.json`, sous `sources.issues`, ajouter `"multiplier-missing": "Multiplicateur absent"` ; dans `en.json`, `"multiplier-missing": "Missing multiplier"`.

- [x] **Étape 7 : lancer, voir passer, committer**

```bash
pnpm --filter web test src/db
pnpm --filter web typecheck
git add -A
git commit -m "feat(web): port TWS et état agent sur le compte, règle de remplacement du snapshot"
```

---

## Tâche 7 : le verrou d'import scopé par compte

**Files:**
- Modify: `apps/web/src/db/importLock.ts`, `apps/web/src/db/importLock.test.ts`, `apps/web/src/flex/sync.ts`, `apps/web/src/pages/SourcesPage.tsx`

**Interfaces:**
- Produces: `withImportLock<T>(accountId: string, run: () => Promise<T>): Promise<T>` — une file par compte.

- [x] **Étape 1 : les tests (échec attendu)**

Réécrire `apps/web/src/db/importLock.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { withImportLock } from "./importLock";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("withImportLock", () => {
  it("never lets two imports of the same account overlap", async () => {
    const events: string[] = [];
    const first = deferred<void>();

    const a = withImportLock("beta", async () => {
      events.push("a:start");
      await first.promise;
      events.push("a:end");
    });
    const b = withImportLock("beta", async () => {
      events.push("b:start");
      events.push("b:end");
    });

    expect(events).toEqual(["a:start"]);
    first.resolve();
    await Promise.all([a, b]);
    expect(events).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("lets two accounts import at the same time", async () => {
    const events: string[] = [];
    const first = deferred<void>();

    const a = withImportLock("beta", async () => {
      events.push("beta:start");
      await first.promise;
      events.push("beta:end");
    });
    const b = withImportLock("alpha", async () => {
      events.push("alpha:start");
      events.push("alpha:end");
    });

    await Promise.resolve();
    expect(events).toEqual(["beta:start", "alpha:start", "alpha:end"]);
    first.resolve();
    await Promise.all([a, b]);
  });

  it("lets a queue carry on after a failure", async () => {
    const failing = withImportLock("beta", async () => {
      throw new Error("boom");
    });
    await expect(failing).rejects.toThrow("boom");
    await expect(withImportLock("beta", async () => "next")).resolves.toBe("next");
  });
});
```

- [x] **Étape 2 : lancer, voir échouer**

```bash
pnpm --filter web test src/db/importLock.test.ts
```

- [x] **Étape 3 : `importLock.ts`**

```ts
/**
 * One import at a time *per account*, whatever its origin: a background Flex sync, a manual
 * file drop and an agent pass must not compute their plans against the same stale view of
 * that account's ledger. Two accounts never wait for each other: a slow statement import on
 * one must not delay the five-minute agent cadence of another.
 *
 * An uncontended call starts `run` synchronously, like acquiring a free lock. A contended
 * call is queued and started once every earlier one of the same account has settled, success
 * or failure alike, so one throwing import never wedges the ones behind it.
 */
interface Lane {
  queue: Array<() => void>;
  running: boolean;
}

const lanes = new Map<string, Lane>();

function drain(lane: Lane) {
  const task = lane.queue.shift();
  if (task) {
    task();
  } else {
    lane.running = false;
  }
}

export function withImportLock<T>(accountId: string, run: () => Promise<T>): Promise<T> {
  let lane = lanes.get(accountId);
  if (!lane) {
    lane = { queue: [], running: false };
    lanes.set(accountId, lane);
  }
  const current = lane;
  return new Promise<T>((resolve, reject) => {
    current.queue.push(() => {
      run().then(resolve, reject).finally(() => drain(current));
    });
    if (!current.running) {
      current.running = true;
      drain(current);
    }
  });
}
```

- [x] **Étape 4 : les appelants**

`flex/sync.ts` : `withImportLock(account.id, () => importFile(deps.db, fresh, file))`.
`pages/SourcesPage.tsx`, `handleFile` : `withImportLock(account.id, () => importFile(db, account, file))`.
`db/importFile.test.ts`, « two concurrent imports of the same account agree on one ledger » : `withImportLock("test", () => …)` sur ses deux appels.

- [x] **Étape 5 : lancer, voir passer, committer**

```bash
pnpm --filter web test
pnpm --filter web typecheck
git add -A
git commit -m "refactor(web): verrou d'import scopé par compte"
```

---

## Tâche 8 : `agent/client.ts`, la frontière réseau

**Files:**
- Create: `apps/web/src/agent/client.ts`, `apps/web/src/agent/client.test.ts`

**Interfaces:**
- Produces:
  ```ts
  const AGENT_URL = "http://127.0.0.1:8100";
  const AGENT_PROBE_TIMEOUT_MS = 2_000;
  const AGENT_FETCH_TIMEOUT_MS = 15_000;
  type AgentFetchCode = "agent-unreachable" | "tws-unreachable" | "agent-error";
  type AgentFetchResult = { ok: true; payload: unknown } | { ok: false; code: AgentFetchCode };
  interface AgentInfo { version: string }
  function probeAgent(): Promise<AgentInfo | null>
  function fetchSnapshot(port: number): Promise<AgentFetchResult>
  ```

- [x] **Étape 1 : les tests (échec attendu)**

`apps/web/src/agent/client.test.ts` :

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_FETCH_TIMEOUT_MS, AGENT_PROBE_TIMEOUT_MS, AGENT_URL, fetchSnapshot, probeAgent } from "./client";

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    return handler(url, init);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("probeAgent", () => {
  it("calls /health with a short timeout and reads the version", async () => {
    const spy = mockFetch(() => new Response(JSON.stringify({ version: "0.1.0" }), { status: 200 }));
    expect(await probeAgent()).toEqual({ version: "0.1.0" });
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toBe(`${AGENT_URL}/health`);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(AGENT_PROBE_TIMEOUT_MS).toBe(2_000);
  });

  it("is null when the agent is not there (fetch rejects)", async () => {
    mockFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await probeAgent()).toBeNull();
  });

  it("is null on a body that is not a health answer", async () => {
    mockFetch(() => new Response("<html>", { status: 200 }));
    expect(await probeAgent()).toBeNull();
    mockFetch(() => new Response(JSON.stringify({ hello: 1 }), { status: 200 }));
    expect(await probeAgent()).toBeNull();
  });

  it("is null on a non-2xx answer", async () => {
    mockFetch(() => new Response("{}", { status: 500 }));
    expect(await probeAgent()).toBeNull();
  });
});

describe("fetchSnapshot", () => {
  it("calls /snapshot with the port and hands the raw payload back", async () => {
    const payload = { accounts: ["U1"], positions: [] };
    const spy = mockFetch(() => new Response(JSON.stringify(payload), { status: 200 }));
    expect(await fetchSnapshot(7502)).toEqual({ ok: true, payload });
    expect(String(spy.mock.calls[0][0])).toBe(`${AGENT_URL}/snapshot?port=7502`);
    expect(AGENT_FETCH_TIMEOUT_MS).toBe(15_000);
  });

  it("names the agent's absence", async () => {
    mockFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await fetchSnapshot(7502)).toEqual({ ok: false, code: "agent-unreachable" });
  });

  it("names a TWS that the agent could not reach", async () => {
    mockFetch(() => new Response(JSON.stringify({ code: "tws-unreachable", detail: "x" }), { status: 503 }));
    expect(await fetchSnapshot(7502)).toEqual({ ok: false, code: "tws-unreachable" });
  });

  it("names any other failure of the agent, including an unreadable body", async () => {
    mockFetch(() => new Response("{}", { status: 422 }));
    expect(await fetchSnapshot(7502)).toEqual({ ok: false, code: "agent-error" });
    mockFetch(() => new Response("not json", { status: 200 }));
    expect(await fetchSnapshot(7502)).toEqual({ ok: false, code: "agent-error" });
  });
});
```

- [x] **Étape 2 : lancer, voir échouer**

```bash
pnpm --filter web test src/agent/client.test.ts
```

- [x] **Étape 3 : `client.ts`**

```ts
/**
 * The network boundary with the local agent (apps/tws-agent). Nothing here interprets the
 * payload: that is `parseAgentSnapshot`'s job (packages/ib-parsers). `AGENT_URL` is the
 * user's own machine, never a domain name.
 */
export const AGENT_URL = "http://127.0.0.1:8100";
/** A ping must be cheap: the agent is absent far more often than present. */
export const AGENT_PROBE_TIMEOUT_MS = 2_000;
/** A pass opens a TWS connection (5 s ceiling agent-side) and reads a whole portfolio. */
export const AGENT_FETCH_TIMEOUT_MS = 15_000;

export type AgentFetchCode = "agent-unreachable" | "tws-unreachable" | "agent-error";
export type AgentFetchResult = { ok: true; payload: unknown } | { ok: false; code: AgentFetchCode };

export interface AgentInfo {
  version: string;
}

export async function probeAgent(): Promise<AgentInfo | null> {
  try {
    const response = await fetch(`${AGENT_URL}/health`, { signal: AbortSignal.timeout(AGENT_PROBE_TIMEOUT_MS) });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return null;
    const version = (body as { version?: unknown }).version;
    return typeof version === "string" ? { version } : null;
  } catch {
    // Absent, refused, timed out, not JSON: all the same thing, the agent is not usable now.
    return null;
  }
}

export async function fetchSnapshot(port: number): Promise<AgentFetchResult> {
  let response: Response;
  try {
    response = await fetch(`${AGENT_URL}/snapshot?port=${port}`, { signal: AbortSignal.timeout(AGENT_FETCH_TIMEOUT_MS) });
  } catch {
    return { ok: false, code: "agent-unreachable" };
  }
  // 503 is the agent's one documented failure: it answered, TWS did not (spec §3.5).
  if (response.status === 503) return { ok: false, code: "tws-unreachable" };
  if (!response.ok) return { ok: false, code: "agent-error" };
  try {
    return { ok: true, payload: await response.json() };
  } catch {
    return { ok: false, code: "agent-error" };
  }
}
```

- [x] **Étape 4 : lancer, voir passer, committer**

```bash
pnpm --filter web test src/agent
git add -A
git commit -m "feat(web): client de l'agent local"
```

---

## Tâche 9 : `agent/sync.ts`, un passage complet en une transaction

**Files:**
- Create: `apps/web/src/agent/sync.ts`, `apps/web/src/agent/sync.test.ts`

**Interfaces:**
- Consumes: `AgentFetchResult` (tâche 8), `parseAgentSnapshot`, `NormalizationError` (`@ib/ib-parsers`), `planImport` (`@ib/ledger`), `withImportLock` (tâche 7), `shouldReplaceSnapshot` (tâche 6), `AccountRecord`, `AppDatabase`, `AgentSyncCode`.
- Produces:
  ```ts
  interface AgentSyncDeps { db: AppDatabase; fetchSnapshot: (port: number) => Promise<AgentFetchResult>; now: () => Date }
  type AgentSyncOutcome =
    | { status: "ok"; transactions: number; positions: number }
    | { status: "skipped"; code: "no-port" }
    | { status: "failed"; code: AgentSyncCode };
  function syncAgent(deps: AgentSyncDeps, account: AccountRecord): Promise<AgentSyncOutcome>
  ```

- [x] **Étape 1 : les tests (échec attendu)**

`apps/web/src/agent/sync.test.ts` :

```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentSnapshotPayload } from "@ib/ib-parsers";
import { db, type AccountRecord } from "@/db/schema";
import type { AgentFetchResult } from "./client";
import { syncAgent } from "./sync";

const NOW = new Date("2026-09-06T13:05:00.000Z");
const ACCOUNT: AccountRecord = {
  id: "beta",
  label: "Beta",
  ibAccountId: "U1234567",
  createdAt: "2026-09-01T00:00:00.000Z",
  warnedDroppedKinds: [],
  twsPort: 7502,
};

const CONTRACT = {
  conId: 265598, symbol: "SYMA", localSymbol: "SYMA", secType: "STK", right: "", strike: 0,
  lastTradeDateOrContractMonth: "", multiplier: "", currency: "USD",
};

function payload(overrides: Partial<AgentSnapshotPayload> = {}): AgentSnapshotPayload {
  return {
    accounts: ["U1234567"],
    fetchedAt: "2026-09-06T13:02:11.482Z",
    cashAvailable: 16284.37,
    positions: [{ ...CONTRACT, position: 100, averageCost: 150.25, marketPrice: 172.1, marketValue: 17210, unrealizedPNL: 2185 }],
    executions: [
      {
        execId: "e1", time: "2026-09-06T14:31:02+00:00", acctNumber: "U1234567", side: "BOT", shares: 10, price: 172,
        cumQty: 10, avgPrice: 172, orderRef: "", contract: CONTRACT, commission: null, commissionCurrency: null,
      },
    ],
    ...overrides,
  };
}

const answer = (result: AgentFetchResult) => ({ db, fetchSnapshot: async () => result, now: () => NOW });
const ok = (body: AgentSnapshotPayload) => answer({ ok: true, payload: body });

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.accounts.put(ACCOUNT);
});

describe("syncAgent", () => {
  it("skips an account without a port and touches nothing", async () => {
    const calls: number[] = [];
    const deps = { db, fetchSnapshot: async (port: number) => (calls.push(port), { ok: false as const, code: "agent-error" as const }), now: () => NOW };
    expect(await syncAgent(deps, { ...ACCOUNT, twsPort: undefined })).toEqual({ status: "skipped", code: "no-port" });
    expect(calls).toEqual([]);
    expect((await db.accounts.get("beta"))?.lastAgentSyncStatus).toBeUndefined();
  });

  it("asks the agent for the account's port", async () => {
    const calls: number[] = [];
    const deps = { db, fetchSnapshot: async (port: number) => (calls.push(port), { ok: true as const, payload: payload() }), now: () => NOW };
    await syncAgent(deps, ACCOUNT);
    expect(calls).toEqual([7502]);
  });

  it("writes the transactions, the live snapshot and the account state in one go", async () => {
    const outcome = await syncAgent(ok(payload()), ACCOUNT);
    expect(outcome).toEqual({ status: "ok", transactions: 1, positions: 1 });

    const rows = await db.transactions.where("accountId").equals("beta").toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ externalId: "agent:e1", source: "agent", quantity: 10, amount: -1720, commission: null });

    const snapshot = await db.snapshots.get("beta");
    expect(snapshot).toMatchObject({ source: "agent", asOf: "2026-09-06T13:02:11.482Z", importedAt: NOW.toISOString(), cashAvailable: 16284.37 });
    expect(snapshot?.positions).toHaveLength(1);

    expect(await db.accounts.get("beta")).toMatchObject({
      lastAgentSyncAt: NOW.toISOString(),
      lastAgentSyncStatus: { at: NOW.toISOString(), ok: true },
    });
    expect(await db.imports.count()).toBe(0);
  });

  it("writes only after Flex's newest row", async () => {
    await db.transactions.put({
      accountId: "beta", externalId: "flex:trade:1", source: "flex", kind: "trade", symbol: "SYMA", secType: "STK", right: "",
      strike: null, expiry: null, quantity: 1, price: 1, amount: -1, commission: null, currency: "USD",
      when: "2026-09-06T15:00:00.000Z", description: "",
    });
    const outcome = await syncAgent(ok(payload()), ACCOUNT);
    expect(outcome).toEqual({ status: "ok", transactions: 0, positions: 1 });
    expect(await db.transactions.where("accountId").equals("beta").count()).toBe(1);
  });

  it("replaces a Flex snapshot of the same day", async () => {
    await db.snapshots.put({ accountId: "beta", source: "flex", asOf: "2026-09-06", importedAt: "", positions: [], cashAvailable: null });
    await syncAgent(ok(payload()), ACCOUNT);
    expect((await db.snapshots.get("beta"))?.source).toBe("agent");
  });

  it("refuses a TWS that manages another account, and writes nothing but the failure", async () => {
    await db.snapshots.put({ accountId: "beta", source: "flex", asOf: "2026-09-05", importedAt: "", positions: [], cashAvailable: null });
    const outcome = await syncAgent(ok(payload({ accounts: ["U7654321"] })), ACCOUNT);
    expect(outcome).toEqual({ status: "failed", code: "account-mismatch" });
    expect(await db.transactions.count()).toBe(0);
    expect((await db.snapshots.get("beta"))?.source).toBe("flex");
    expect(await db.accounts.get("beta")).toMatchObject({ lastAgentSyncStatus: { at: NOW.toISOString(), ok: false, code: "account-mismatch" } });
    expect((await db.accounts.get("beta"))?.lastAgentSyncAt).toBeUndefined();
  });

  it("records the agent's own failure codes", async () => {
    expect(await syncAgent(answer({ ok: false, code: "tws-unreachable" }), ACCOUNT)).toEqual({ status: "failed", code: "tws-unreachable" });
    expect((await db.accounts.get("beta"))?.lastAgentSyncStatus).toEqual({ at: NOW.toISOString(), ok: false, code: "tws-unreachable" });
  });

  it("records an unreadable payload as parse-error", async () => {
    expect(await syncAgent(answer({ ok: true, payload: { nope: 1 } }), ACCOUNT)).toEqual({ status: "failed", code: "parse-error" });
    expect((await db.accounts.get("beta"))?.lastAgentSyncStatus?.code).toBe("parse-error");
  });

  it("keeps lastAgentSyncAt from the last success when a later pass fails", async () => {
    await syncAgent(ok(payload()), ACCOUNT);
    await syncAgent(answer({ ok: false, code: "agent-unreachable" }), ACCOUNT);
    expect(await db.accounts.get("beta")).toMatchObject({
      lastAgentSyncAt: NOW.toISOString(),
      lastAgentSyncStatus: { ok: false, code: "agent-unreachable" },
    });
  });

  it("is idempotent, and a later pass fills in a commission", async () => {
    await syncAgent(ok(payload()), ACCOUNT);
    const withCommission = payload();
    withCommission.executions[0].commission = 1.5;
    withCommission.executions[0].commissionCurrency = "USD";
    await syncAgent(ok(withCommission), ACCOUNT);
    const rows = await db.transactions.where("accountId").equals("beta").toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].commission).toBe(-1.5);
  });
});
```

- [x] **Étape 2 : lancer, voir échouer**

```bash
pnpm --filter web test src/agent/sync.test.ts
```

- [x] **Étape 3 : `sync.ts`**

```ts
import { NormalizationError, parseAgentSnapshot, type AgentSnapshot } from "@ib/ib-parsers";
import { planImport, type ImportPlan } from "@ib/ledger";
import { withImportLock } from "@/db/importLock";
import type { AccountRecord, AgentSyncCode, AppDatabase } from "@/db/schema";
import { shouldReplaceSnapshot } from "@/db/snapshot";
import type { AgentFetchResult } from "./client";

export interface AgentSyncDeps {
  db: AppDatabase;
  fetchSnapshot: (port: number) => Promise<AgentFetchResult>;
  now: () => Date;
}

export type AgentSyncOutcome =
  | { status: "ok"; transactions: number; positions: number }
  | { status: "skipped"; code: "no-port" }
  | { status: "failed"; code: AgentSyncCode };

async function fail(deps: AgentSyncDeps, accountId: string, code: AgentSyncCode): Promise<AgentSyncOutcome> {
  // Only the outcome of *this* attempt: `lastAgentSyncAt` keeps pointing at the last success.
  await deps.db.accounts.update(accountId, { lastAgentSyncStatus: { at: deps.now().toISOString(), ok: false, code } });
  return { status: "failed", code };
}

/**
 * One agent pass: call, parse, check the account, then a single IndexedDB transaction. No
 * ImportRecord — the account carries the state — and nothing is ever deleted (`planAgent`).
 * Serialized per account behind the import lock like every other writer of the ledger.
 */
export async function syncAgent(deps: AgentSyncDeps, account: AccountRecord): Promise<AgentSyncOutcome> {
  const port = account.twsPort;
  if (port === undefined) return { status: "skipped", code: "no-port" };

  const fetched = await deps.fetchSnapshot(port);
  if (!fetched.ok) return fail(deps, account.id, fetched.code);

  let parsed: AgentSnapshot;
  try {
    parsed = parseAgentSnapshot(fetched.payload, account.id);
  } catch (e) {
    if (e instanceof NormalizationError) return fail(deps, account.id, "parse-error");
    throw e;
  }
  // A port pointing at the wrong TWS must never overwrite this account with another's data.
  if (!parsed.accounts.includes(account.ibAccountId)) return fail(deps, account.id, "account-mismatch");

  const at = deps.now().toISOString();
  let plan!: ImportPlan;
  await withImportLock(account.id, () =>
    deps.db.transaction("rw", deps.db.transactions, deps.db.snapshots, deps.db.accounts, async () => {
      const existing = await deps.db.transactions.where("accountId").equals(account.id).toArray();
      plan = planImport(existing, { source: "agent", transactions: parsed.transactions, period: null });
      await deps.db.transactions.bulkPut(plan.upsert);
      const current = await deps.db.snapshots.get(account.id);
      // Always true for an agent snapshot; called anyway so there is exactly one rule.
      if (shouldReplaceSnapshot(current, { source: "agent", asOf: parsed.fetchedAt })) {
        await deps.db.snapshots.put({
          accountId: account.id,
          source: "agent",
          asOf: parsed.fetchedAt,
          importedAt: at,
          positions: parsed.positions,
          cashAvailable: parsed.cashAvailable,
        });
      }
      await deps.db.accounts.update(account.id, { lastAgentSyncAt: at, lastAgentSyncStatus: { at, ok: true } });
    }),
  );
  return { status: "ok", transactions: plan.upsert.length, positions: parsed.positions.length };
}
```

- [x] **Étape 4 : lancer, voir passer, committer**

```bash
pnpm --filter web test src/agent
pnpm --filter web typecheck
git add -A
git commit -m "feat(web): syncAgent, un passage de l'agent en une transaction"
```

---

## Tâche 10 : `useAgentSync`, présence et cadence de cinq minutes

**Files:**
- Create: `apps/web/src/agent/useAgentSync.ts`, `apps/web/src/agent/useAgentSync.test.tsx`
- Modify: `apps/web/src/routes/AppLayout.tsx`

**Interfaces:**
- Consumes: `probeAgent`, `fetchSnapshot` (tâche 8), `syncAgent` (tâche 9), `useDb`.
- Produces:
  ```ts
  const AGENT_POLL_MS = 5 * 60 * 1000;
  type AgentPresence = { status: "unknown" } | { status: "absent" } | { status: "present"; version: string };
  function refreshPresence(): Promise<AgentPresence>
  function resetAgentState(): void                       // test seam
  function useAgentPresence(): AgentPresence
  function useAgentSync(accountId: string): { presence: AgentPresence; state: "idle" | "running"; run: () => Promise<void> }
  function useAgentPolling(accountId: string): void      // monté une fois par AppLayout
  ```

- [x] **Étape 1 : les tests (échec attendu)**

`apps/web/src/agent/useAgentSync.test.tsx` :

```tsx
import { render, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, type AccountRecord } from "@/db/schema";
import { AGENT_POLL_MS, resetAgentState, useAgentPolling, useAgentSync } from "./useAgentSync";

const ACCOUNT: AccountRecord = {
  id: "beta",
  label: "Beta",
  ibAccountId: "U1234567",
  createdAt: "2026-09-01T00:00:00.000Z",
  warnedDroppedKinds: [],
  twsPort: 7502,
};

const PAYLOAD = { accounts: ["U1234567"], fetchedAt: "2026-09-06T13:02:11.482Z", cashAvailable: 1, positions: [], executions: [] };

/** Routes the two agent URLs; every other call is a 200 `{}`. */
function mockAgent(present = true) {
  const calls = { health: 0, snapshot: 0 };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/health")) {
      calls.health += 1;
      return present ? new Response(JSON.stringify({ version: "0.1.0" }), { status: 200 }) : Promise.reject(new TypeError("Failed to fetch"));
    }
    if (url.includes("/snapshot")) {
      calls.snapshot += 1;
      return new Response(JSON.stringify(PAYLOAD), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  return calls;
}

let runHandle: () => Promise<void>;
let lastPresence: string;

function Probe({ accountId = "beta" }: { accountId?: string }) {
  useAgentPolling(accountId);
  const { run, presence } = useAgentSync(accountId);
  runHandle = run;
  lastPresence = presence.status;
  return null;
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(async () => {
  // `shouldAdvanceTime`: Testing Library's `waitFor` polls with the (faked) timers and would
  // otherwise never tick; letting the fake clock follow real time keeps `waitFor` alive while
  // `advanceTimersByTimeAsync` still jumps the five-minute cadence at will.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  resetAgentState();
  setVisibility("visible");
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.accounts.put(ACCOUNT);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("useAgentPolling", () => {
  it("probes at account open and passes at once when the agent is present and a port is set", async () => {
    const calls = mockAgent();
    render(<Probe />);
    await waitFor(() => expect(calls.snapshot).toBe(1));
    expect(calls.health).toBe(1);
    expect(lastPresence).toBe("present");
    expect((await db.accounts.get("beta"))?.lastAgentSyncStatus?.ok).toBe(true);
  });

  it("does nothing at all without a port", async () => {
    await db.accounts.update("beta", { twsPort: undefined });
    const calls = mockAgent();
    render(<Probe />);
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_POLL_MS);
    });
    expect(calls).toEqual({ health: 0, snapshot: 0 });
    expect(lastPresence).toBe("unknown");
  });

  it("marks the agent absent, never passes, and probes again at the next tick", async () => {
    const calls = mockAgent(false);
    render(<Probe />);
    await waitFor(() => expect(lastPresence).toBe("absent"));
    expect(calls.snapshot).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_POLL_MS);
    });
    expect(calls.health).toBe(2);
    expect(calls.snapshot).toBe(0);
  });

  it("passes every five minutes while the tab is visible", async () => {
    const calls = mockAgent();
    render(<Probe />);
    await waitFor(() => expect(calls.snapshot).toBe(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_POLL_MS - 1);
    });
    expect(calls.snapshot).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await waitFor(() => expect(calls.snapshot).toBe(2));
  });

  it("skips ticks while the tab is hidden and passes at once when it comes back after more than five minutes", async () => {
    const calls = mockAgent();
    render(<Probe />);
    await waitFor(() => expect(calls.snapshot).toBe(1));
    setVisibility("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_POLL_MS * 2);
    });
    expect(calls.snapshot).toBe(1);
    setVisibility("visible");
    await waitFor(() => expect(calls.snapshot).toBe(2));
  });

  it("does not pass on a short absence", async () => {
    const calls = mockAgent();
    render(<Probe />);
    await waitFor(() => expect(calls.snapshot).toBe(1));
    setVisibility("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    setVisibility("visible");
    await settle();
    expect(calls.snapshot).toBe(1);
  });

  it("a manual run resets the five-minute countdown", async () => {
    const calls = mockAgent();
    render(<Probe />);
    await waitFor(() => expect(calls.snapshot).toBe(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_POLL_MS / 2);
    });
    await act(async () => {
      await runHandle();
    });
    expect(calls.snapshot).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_POLL_MS / 2);
    });
    expect(calls.snapshot).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_POLL_MS / 2);
    });
    await waitFor(() => expect(calls.snapshot).toBe(3));
  });

  it("starts as soon as a port is saved", async () => {
    await db.accounts.update("beta", { twsPort: undefined });
    const calls = mockAgent();
    render(<Probe />);
    await settle();
    expect(calls.snapshot).toBe(0);
    await db.accounts.update("beta", { twsPort: 7502 });
    await waitFor(() => expect(calls.snapshot).toBe(1));
  });

  it("stops polling the previous account on a switch", async () => {
    await db.accounts.put({ ...ACCOUNT, id: "alpha", ibAccountId: "U7654321", twsPort: undefined });
    const calls = mockAgent();
    const view = render(<Probe />);
    await waitFor(() => expect(calls.snapshot).toBe(1));
    view.rerender(<Probe accountId="alpha" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_POLL_MS * 2);
    });
    expect(calls.snapshot).toBe(1);
  });
});

describe("useAgentSync", () => {
  it("never runs two passes of one account at once", async () => {
    const calls = mockAgent();
    render(<Probe />);
    await waitFor(() => expect(calls.snapshot).toBe(1));
    await act(async () => {
      await Promise.all([runHandle(), runHandle()]);
    });
    expect(calls.snapshot).toBe(2);
  });
});
```

- [x] **Étape 2 : lancer, voir échouer**

```bash
pnpm --filter web test src/agent/useAgentSync.test.tsx
```

- [x] **Étape 3 : `useAgentSync.ts`**

```ts
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useDb } from "@/db/DbProvider";
import { fetchSnapshot, probeAgent } from "./client";
import { syncAgent } from "./sync";

/** Five minutes: TWS reconnects on every pass, and a hidden tab never opens one for nothing. */
export const AGENT_POLL_MS = 5 * 60 * 1000;

export type AgentPresence = { status: "unknown" } | { status: "absent" } | { status: "present"; version: string };

// Module-level state, shared by every hook instance of the tab, for the same reasons as
// `useFlexAutoSync`'s `runningAccounts`: AppLayout drives the cadence, pages read the presence
// and press the button, and none of them may see a different "running" than the others.
let presence: AgentPresence = { status: "unknown" };
const runningAccounts = new Set<string>();
const lastRunAt = new Map<string, number>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function refreshPresence(): Promise<AgentPresence> {
  const info = await probeAgent();
  presence = info ? { status: "present", version: info.version } : { status: "absent" };
  notify();
  return presence;
}

/** Test seam: forget everything between tests. */
export function resetAgentState(): void {
  presence = { status: "unknown" };
  runningAccounts.clear();
  lastRunAt.clear();
  notify();
}

export function useAgentPresence(): AgentPresence {
  return useSyncExternalStore(subscribe, () => presence);
}

export function useAgentSync(accountId: string) {
  const db = useDb();
  // Read through a ref: see useFlexAutoSync for why `useDb()` may change under a running hook.
  const dbRef = useRef(db);
  useEffect(() => {
    dbRef.current = db;
  }, [db]);
  const running = useSyncExternalStore(subscribe, () => runningAccounts.has(accountId));
  const agentPresence = useAgentPresence();

  const run = useCallback(async () => {
    // Check-then-add with no `await` in between: two callers in one tick cannot both pass.
    if (!accountId || runningAccounts.has(accountId)) return;
    runningAccounts.add(accountId);
    lastRunAt.set(accountId, Date.now());
    notify();
    try {
      const account = await dbRef.current.accounts.get(accountId);
      if (!account) return;
      await syncAgent({ db: dbRef.current, fetchSnapshot, now: () => new Date() }, account);
    } finally {
      runningAccounts.delete(accountId);
      notify();
    }
  }, [accountId]);

  return { presence: agentPresence, state: running ? ("running" as const) : ("idle" as const), run };
}

/**
 * Mounted once, by AppLayout, for the account currently open (spec §6.5): probe at open,
 * a pass at once when the agent is present and a port is set, then one every five minutes
 * while the tab is visible. A hidden tab skips its ticks; coming back after more than five
 * minutes passes at once. A manual `run` restarts the countdown. Without a port nothing is
 * even probed: the Sources page says so.
 */
export function useAgentPolling(accountId: string): void {
  const db = useDb();
  const twsPort = useLiveQuery(
    async () => (accountId ? (await db.accounts.get(accountId))?.twsPort : undefined),
    [db, accountId],
  );
  const { run } = useAgentSync(accountId);

  useEffect(() => {
    if (!accountId || twsPort === undefined) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const due = () => Date.now() - (lastRunAt.get(accountId) ?? 0) >= AGENT_POLL_MS;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void tick(), AGENT_POLL_MS);
    };
    const tick = async () => {
      if (cancelled) return;
      if (document.visibilityState === "visible") {
        const found = await refreshPresence();
        if (cancelled) return;
        if (found.status === "present") await run();
      }
      if (!cancelled) arm();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible" && due()) void tick();
    };
    // A manual run (the button) moved `lastRunAt`: restart the countdown from it.
    let seen = lastRunAt.get(accountId);
    const unsubscribe = subscribe(() => {
      const now = lastRunAt.get(accountId);
      if (now !== seen) {
        seen = now;
        if (!cancelled) arm();
      }
    });

    void tick();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [accountId, twsPort, run]);
}
```

- [x] **Étape 4 : le montage dans `AppLayout`**

```ts
import { useAgentPolling } from "@/agent/useAgentSync";
// … à côté de useFlexAutoSync(scoped ?? "") :
  useAgentPolling(scoped ?? "");
```

- [x] **Étape 5 : lancer, voir passer, committer**

Vérifier aussi que `AppLayout.test.tsx` reste vert : sans `twsPort` sur ses comptes semés, le hook ne fait rien.

```bash
pnpm --filter web test
pnpm --filter web typecheck
git add -A
git commit -m "feat(web): présence de l'agent et cadence de cinq minutes"
```

---

## Tâche 11 : la page Aujourd'hui disparaît

**Files:**
- Modify: `apps/web/src/routes/router.tsx`, `apps/web/src/lib/navigation.ts`, `apps/web/src/routes/AppLayout.test.tsx`, `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`

- [x] **Étape 1 : le test (échec attendu)**

Dans `AppLayout.test.tsx`, retirer la ligne `"/accounts/beta/today",` de la liste attendue par « shows the nav entry for every screen ». Ajouter dans `apps/web/src/App.test.tsx` (ou créer `apps/web/src/routes/router.test.tsx` si `App.test.tsx` ne rend pas le routeur) :

```tsx
it("has no route for the former Today page", () => {
  const paths = router.routes
    .flatMap((route) => route.children ?? [])
    .map((child) => child.path)
    .filter((path): path is string => typeof path === "string");
  expect(paths).not.toContain("today");
});
```

avec `import { router } from "@/routes/router";`.

- [x] **Étape 2 : lancer, voir échouer**

```bash
pnpm --filter web test src/routes
```

- [x] **Étape 3 : la suppression**

- `router.tsx` : retirer la ligne `{ path: "today", element: <PlaceholderPage titleKey="nav.today" /> },`.
- `navigation.ts` : retirer `{ labelKey: "nav.today", icon: CalendarClock, to: accountPath("today") },` et l'import `CalendarClock`.
- `fr.json` et `en.json` : retirer la clé `nav.today`.

```bash
grep -rn "today" apps/web/src --include=*.ts --include=*.tsx --include=*.json
```

doit ne plus rien trouver.

- [x] **Étape 4 : lancer, voir passer, committer**

```bash
pnpm --filter web test
pnpm --filter web typecheck
git add -A
git commit -m "feat(web): la page Aujourd'hui disparaît, ses données vont dans les pages existantes"
```

---

## Tâche 12 : `SnapshotStatus`, l'en-tête partagé de Positions, Dashboard et Historique

**Files:**
- Create: `apps/web/src/components/SnapshotStatus.tsx`, `apps/web/src/components/SnapshotStatus.test.tsx`
- Modify: `apps/web/src/pages/PositionsPage.tsx`, `apps/web/src/pages/DashboardPage.tsx`, `apps/web/src/pages/HistoryPage.tsx`, `apps/web/src/lib/format.ts`, `apps/web/src/lib/format.test.ts`, `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`

**Interfaces:**
- Consumes: `useSnapshot`, `useAccount` (`@/db/hooks`), `useAgentSync` (tâche 10), `Badge`, `Button`.
- Produces: `SnapshotStatus({ accountId, showAsOf = true })`, `formatClockTime(isoString: string): string`, clés i18n `snapshot.live`, `snapshot.refresh`, `agent.errors.*`.

- [x] **Étape 1 : i18n**

`fr.json`, nouvelles clés de premier niveau (l'objet `agent` sera complété à la tâche 13) :

```json
  "snapshot": {
    "live": "En direct, {{time}}",
    "refresh": "Actualiser"
  },
  "agent": {
    "errors": {
      "agent-unreachable": "Agent absent",
      "tws-unreachable": "TWS injoignable",
      "agent-error": "Erreur de l'agent",
      "account-mismatch": "Compte différent",
      "parse-error": "Réponse illisible"
    }
  },
```

`en.json` :

```json
  "snapshot": {
    "live": "Live, {{time}}",
    "refresh": "Refresh"
  },
  "agent": {
    "errors": {
      "agent-unreachable": "Agent not running",
      "tws-unreachable": "TWS unreachable",
      "agent-error": "Agent error",
      "account-mismatch": "Different account",
      "parse-error": "Unreadable answer"
    }
  },
```

- [x] **Étape 2 : les tests (échec attendu)**

Dans `apps/web/src/lib/format.test.ts` :

```ts
import { formatClockTime } from "./format";

describe("formatClockTime", () => {
  it("shows the wall-clock time of the viewer, on 24 hours, two digits each", () => {
    const iso = "2026-09-06T13:02:00.000Z";
    const local = new Date(iso);
    const expected = `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`;
    expect(formatClockTime(iso)).toBe(expected);
    expect(formatClockTime("2026-09-06T00:05:00.000Z")).toMatch(/^\d{2}:\d{2}$/);
  });
});
```

`apps/web/src/components/SnapshotStatus.test.tsx` :

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { refreshPresence, resetAgentState } from "@/agent/useAgentSync";
import { SnapshotStatus } from "@/components/SnapshotStatus";
import { db, type AccountRecord, type SnapshotRecord } from "@/db/schema";
import { formatClockTime } from "@/lib/format";

const ACCOUNT: AccountRecord = { id: "alpha", label: "alpha", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [], twsPort: 7502 };
const flexSnapshot: SnapshotRecord = { accountId: "alpha", source: "flex", asOf: "2026-09-05", importedAt: "", positions: [], cashAvailable: null };
const agentSnapshot: SnapshotRecord = { ...flexSnapshot, source: "agent", asOf: "2026-09-06T13:02:00.000Z" };

function mockAgent(present: boolean) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/health")) {
      return present ? new Response(JSON.stringify({ version: "0.1.0" }), { status: 200 }) : Promise.reject(new TypeError("Failed to fetch"));
    }
    return new Response(JSON.stringify({ accounts: ["U0000001"], fetchedAt: "2026-09-06T13:10:00.000Z", cashAvailable: 1, positions: [], executions: [] }), { status: 200 });
  });
}

function renderStatus(showAsOf = true) {
  return render(
    <MemoryRouter>
      <SnapshotStatus accountId="alpha" showAsOf={showAsOf} />
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  resetAgentState();
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.accounts.put(ACCOUNT);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SnapshotStatus", () => {
  it("dates a Flex snapshot, in the warning tone, like before", async () => {
    await db.snapshots.put(flexSnapshot);
    renderStatus();
    expect(await screen.findByText("Données du 2026-09-05")).toBeInTheDocument();
  });

  it("says live with the clock time for an agent snapshot", async () => {
    await db.snapshots.put(agentSnapshot);
    renderStatus();
    expect(await screen.findByText(`En direct, ${formatClockTime(agentSnapshot.asOf)}`)).toBeInTheDocument();
  });

  it("hides the date badge when asked, for History", async () => {
    await db.snapshots.put(flexSnapshot);
    renderStatus(false);
    await waitFor(() => expect(screen.queryByText("Données du 2026-09-05")).not.toBeInTheDocument());
  });

  it("shows no button while the agent is not detected", async () => {
    mockAgent(false);
    await refreshPresence();
    renderStatus();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Actualiser" })).not.toBeInTheDocument());
  });

  it("shows no button without a port even when the agent is there", async () => {
    mockAgent(true);
    await refreshPresence();
    await db.accounts.update("alpha", { twsPort: undefined });
    renderStatus();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Actualiser" })).not.toBeInTheDocument());
  });

  it("shows the button once the agent is present, and a click runs a pass", async () => {
    mockAgent(true);
    await refreshPresence();
    renderStatus();
    const button = await screen.findByRole("button", { name: "Actualiser" });
    await userEvent.setup().click(button);
    await waitFor(async () => expect((await db.snapshots.get("alpha"))?.source).toBe("agent"));
    expect(await screen.findByText(`En direct, ${formatClockTime("2026-09-06T13:10:00.000Z")}`)).toBeInTheDocument();
  });

  it("names the cause of the last failed pass, and drops it once a pass succeeds", async () => {
    await db.accounts.update("alpha", { lastAgentSyncStatus: { at: "", ok: false, code: "tws-unreachable" } });
    renderStatus();
    expect(await screen.findByText("TWS injoignable")).toBeInTheDocument();
    await db.accounts.update("alpha", { lastAgentSyncStatus: { at: "", ok: true } });
    await waitFor(() => expect(screen.queryByText("TWS injoignable")).not.toBeInTheDocument());
  });
});
```

- [x] **Étape 3 : lancer, voir échouer**

```bash
pnpm --filter web test src/components/SnapshotStatus.test.tsx src/lib/format.test.ts
```

- [x] **Étape 4 : `formatClockTime`**

Dans `lib/format.ts` :

```ts
// Unlike every other formatter here, this one is in the *viewer's* zone: an agent snapshot's
// `asOf` is a true UTC instant taken seconds ago, and "live, 15:02" must read as the clock on
// the wall. Flex/statement timestamps are stamped as UTC without conversion (see ib-parsers'
// common.ts) and are shown in UTC for that reason; this is the opposite case.
const CLOCK_FORMATTER = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function formatClockTime(isoString: string): string {
  return CLOCK_FORMATTER.format(new Date(isoString));
}
```

- [x] **Étape 5 : `SnapshotStatus.tsx`**

```tsx
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@ib/ui/badge";
import { Button } from "@ib/ui/button";
import { useAgentSync } from "@/agent/useAgentSync";
import { useAccount, useSnapshot } from "@/db/hooks";
import { formatClockTime } from "@/lib/format";

interface SnapshotStatusProps {
  accountId: string;
  /** History has no snapshot date to show, only the failure badge and the button. */
  showAsOf?: boolean;
}

/**
 * The shared header piece of Positions, Dashboard and History (spec §7.1): what the data is
 * as of, why the last agent pass failed if it did, and the Refresh button — shown only when
 * the agent is detected and a port is set, so that paliers 1 and 2 never see a dead button.
 */
export function SnapshotStatus({ accountId, showAsOf = true }: SnapshotStatusProps) {
  const { t } = useTranslation();
  const snapshot = useSnapshot(accountId);
  const account = useAccount(accountId);
  const { presence, state, run } = useAgentSync(accountId);
  const status = account?.lastAgentSyncStatus;
  const canRefresh = presence.status === "present" && account?.twsPort !== undefined;

  return (
    <div className="flex items-center gap-2">
      {showAsOf &&
        snapshot &&
        (snapshot.source === "agent" ? (
          <Badge variant="success">{t("snapshot.live", { time: formatClockTime(snapshot.asOf) })}</Badge>
        ) : (
          // Flex positions are always as of the previous close: the date is always shown.
          <Badge variant="warning">{t("positions.asOf", { date: snapshot.asOf })}</Badge>
        ))}
      {status && !status.ok && status.code && <Badge variant="secondary">{t(`agent.errors.${status.code}`)}</Badge>}
      {canRefresh && (
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={t("snapshot.refresh")}
          disabled={state === "running"}
          onClick={() => void run()}
        >
          <RefreshCw className={state === "running" ? "animate-spin" : undefined} />
        </Button>
      )}
    </div>
  );
}
```

- [x] **Étape 6 : les trois pages**

`PositionsPage.tsx`, dans l'en-tête de la vue principale (ligne 50 environ), remplacer le `Badge` et son commentaire par `<SnapshotStatus accountId={accountId} />` ; retirer l'import `Badge` s'il ne sert plus ailleurs dans le fichier. L'état vide garde son `h1` seul.

`DashboardPage.tsx`, dans la vue principale (ligne 101 environ) :

```tsx
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-lg font-semibold tracking-tight">{t("nav.dashboard")}</h1>
        <SnapshotStatus accountId={accountId} />
      </div>
```

`HistoryPage.tsx` (ligne 68 environ) :

```tsx
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-lg font-semibold tracking-tight">{t("nav.history")}</h1>
        <SnapshotStatus accountId={accountId} showAsOf={false} />
      </div>
```

Import commun : `import { SnapshotStatus } from "@/components/SnapshotStatus";`.

- [x] **Étape 7 : les tests de pages**

`PositionsPage.test.tsx`, « dates the data by the snapshot's asOf », reste vert. Y ajouter :

```tsx
  it("says live when the snapshot comes from the agent", async () => {
    await db.snapshots.put({ ...SAMPLE_SNAPSHOT, source: "agent", asOf: "2026-09-06T13:02:00.000Z" });
    renderPositions();
    expect(await screen.findByText(/^En direct, \d{2}:\d{2}$/)).toBeInTheDocument();
    expect(screen.queryByText(/^Données du/)).not.toBeInTheDocument();
  });
```

Les tests de Positions et Dashboard rendent la page sans `<DbProvider>` ni compte semé : `useAccount` rend `null`, `useAgentSync` lit une présence `unknown`, aucun bouton n'apparaît. Vérifier que `DashboardPage.test.tsx` et `HistoryPage.test.tsx` passent sans modification.

- [x] **Étape 8 : lancer, voir passer, capturer, committer**

```bash
pnpm --filter web test
pnpm --filter web typecheck
node .claude/skills/run-frontend/driver.mjs /accounts/alpha/positions /accounts/alpha/dashboard /accounts/alpha/history --seed
```

Ouvrir les trois PNG avec l'outil Read : le badge orange est à sa place, aucun bouton n'apparaît (pas d'agent), rien d'autre n'a bougé.

```bash
git add -A
git commit -m "feat(web): en-tête SnapshotStatus, badge en direct et bouton Actualiser"
```

---

## Tâche 13 : carte « Agent local » dans Sources de données

**Files:**
- Modify: `apps/web/src/pages/SourcesPage.tsx`, `apps/web/src/pages/SourcesPage.test.tsx`, `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`

**Interfaces:**
- Consumes: `setTwsPort`, `AccountError` (tâche 6), `useAgentSync` (tâche 10), `formatDateTime`.

- [x] **Étape 1 : i18n**

Compléter l'objet `agent` de `fr.json` :

```json
  "agent": {
    "title": "Agent local",
    "hint": "L'agent lit TWS sur cette machine et ne parle qu'à ce site : positions, cash et exécutions du jour restent chez vous. Renseignez le port de l'API TWS de ce compte.",
    "port": "Port TWS",
    "savePort": "Enregistrer",
    "portSaved": "Port enregistré.",
    "portInvalid": "Le port doit être un entier entre 1 et 65535.",
    "portMissing": "Renseignez le port pour activer les données en direct.",
    "unknown": "Recherche de l'agent…",
    "detected": "Agent détecté, version {{version}}.",
    "absent": "Agent non détecté sur cette machine.",
    "helpLink": "Installer l'agent",
    "never": "Aucun passage pour l'instant.",
    "lastSync": "Dernier passage réussi : {{date}}",
    "lastFailed": "Dernier passage en échec : {{reason}}",
    "refresh": "Actualiser",
    "refreshing": "Actualisation…",
    "errors": { "…": "inchangé" }
  },
```

`en.json` :

```json
  "agent": {
    "title": "Local agent",
    "hint": "The agent reads TWS on this machine and talks to this site only: positions, cash and today's fills stay with you. Fill in the port of this account's TWS API.",
    "port": "TWS port",
    "savePort": "Save",
    "portSaved": "Port saved.",
    "portInvalid": "The port must be an integer between 1 and 65535.",
    "portMissing": "Fill in the port to enable live data.",
    "unknown": "Looking for the agent…",
    "detected": "Agent detected, version {{version}}.",
    "absent": "No agent detected on this machine.",
    "helpLink": "Install the agent",
    "never": "No pass yet.",
    "lastSync": "Last successful pass: {{date}}",
    "lastFailed": "Last pass failed: {{reason}}",
    "refresh": "Refresh",
    "refreshing": "Refreshing…",
    "errors": { "…": "inchangé" }
  },
```

- [x] **Étape 2 : les tests (échec attendu)**

Ajouter à `SourcesPage.test.tsx` un `describe` (reprendre la fonction de rendu et le semis de compte du fichier, et le `mockAgent` de `SnapshotStatus.test.tsx` en l'important ou en le recopiant) :

```tsx
describe("Agent card", () => {
  it("asks for the port and says nothing is called without it", async () => {
    renderSources();
    expect(await screen.findByText("Agent local")).toBeInTheDocument();
    expect(screen.getByText("Renseignez le port pour activer les données en direct.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actualiser" })).toBeDisabled();
  });

  it("saves a port and refuses one out of range without touching the stored one", async () => {
    renderSources();
    const user = userEvent.setup();
    const input = await screen.findByLabelText("Port TWS");
    await user.type(input, "7502");
    await user.click(screen.getByRole("button", { name: "Enregistrer", exact: true }));
    expect(await screen.findByText("Port enregistré.")).toBeInTheDocument();
    expect((await db.accounts.get("alpha"))?.twsPort).toBe(7502);

    await user.clear(input);
    await user.type(input, "70000");
    await user.click(screen.getByRole("button", { name: "Enregistrer", exact: true }));
    expect(await screen.findByText("Le port doit être un entier entre 1 et 65535.")).toBeInTheDocument();
    expect((await db.accounts.get("alpha"))?.twsPort).toBe(7502);
  });

  it("clears the port when the field is emptied", async () => {
    await db.accounts.update("alpha", { twsPort: 7502 });
    renderSources();
    const user = userEvent.setup();
    const input = await screen.findByLabelText("Port TWS");
    expect(input).toHaveValue(7502);
    await user.clear(input);
    await user.click(screen.getByRole("button", { name: "Enregistrer", exact: true }));
    await waitFor(async () => expect((await db.accounts.get("alpha"))?.twsPort).toBeUndefined());
  });

  it("links to the Help page when the agent is absent", async () => {
    mockAgent(false);
    await refreshPresence();
    await db.accounts.update("alpha", { twsPort: 7502 });
    renderSources();
    expect(await screen.findByText("Agent non détecté sur cette machine.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Installer l'agent" })).toHaveAttribute("href", "/help");
    expect(screen.getByRole("button", { name: "Actualiser" })).toBeDisabled();
  });

  it("shows the version, the last pass, and runs one on the button", async () => {
    mockAgent(true);
    await refreshPresence();
    await db.accounts.update("alpha", { twsPort: 7502, lastAgentSyncStatus: { at: "2026-09-06T13:00:00.000Z", ok: false, code: "tws-unreachable" } });
    renderSources();
    expect(await screen.findByText("Agent détecté, version 0.1.0.")).toBeInTheDocument();
    expect(screen.getByText("Dernier passage en échec : TWS injoignable")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Actualiser" }));
    expect(await screen.findByText(/^Dernier passage réussi : /)).toBeInTheDocument();
  });
});
```

Le compte semé par le fichier doit porter `ibAccountId: "U0000001"` (celui que `mockAgent` rend) ; sinon adapter `mockAgent`.

- [x] **Étape 3 : lancer, voir échouer**

```bash
pnpm --filter web test src/pages/SourcesPage.test.tsx
```

- [x] **Étape 4 : `AgentCard`**

Dans `SourcesPage.tsx`, insérer `<AgentCard account={account} />` juste après `<SyncCard … />`, et ajouter le composant :

```tsx
import { useAgentSync } from "@/agent/useAgentSync";
import { AccountError, clearFlexCredentials, deleteAccount, setFlexCredentials, setTwsPort } from "@/db/accounts";

/**
 * Like SyncCard: explanations, never errors. The agent is optional (spec fondateur §2 and §8);
 * absent, or without a port, the card says what would make live data appear, and the button
 * stays disabled instead of failing.
 */
function AgentCard({ account }: { account: AccountRecord }) {
  const { t } = useTranslation();
  const db = useDb();
  const { presence, state, run } = useAgentSync(account.id);
  const [port, setPort] = useState(account.twsPort?.toString() ?? "");
  const [notice, setNotice] = useState<"saved" | "invalid" | null>(null);

  // The form follows the route's account, not this component instance (see the Flex form above).
  useEffect(() => {
    setPort(account.twsPort?.toString() ?? "");
    setNotice(null);
  }, [account.id, account.twsPort]);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    const trimmed = port.trim();
    try {
      await setTwsPort(db, account.id, trimmed === "" ? null : Number(trimmed));
      setNotice("saved");
    } catch (e) {
      if (e instanceof AccountError && e.code === "tws-port-invalid") setNotice("invalid");
      else throw e;
    }
  }

  const status = account.lastAgentSyncStatus;
  const hasPort = account.twsPort !== undefined;
  let presenceLine: ReactNode;
  if (!hasPort) presenceLine = t("agent.portMissing");
  else if (presence.status === "unknown") presenceLine = t("agent.unknown");
  else if (presence.status === "absent") presenceLine = t("agent.absent");
  else presenceLine = t("agent.detected", { version: presence.version });

  let passLine: string;
  if (!status) passLine = t("agent.never");
  else if (status.ok) passLine = t("agent.lastSync", { date: account.lastAgentSyncAt ? formatDateTime(account.lastAgentSyncAt) : "—" });
  else passLine = t("agent.lastFailed", { reason: status.code ? t(`agent.errors.${status.code}`) : "—" });

  const canRun = hasPort && presence.status === "present";

  return (
    <Card data-testid="agent-card">
      <CardHeader>
        <CardTitle>{t("agent.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form onSubmit={handleSave} className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t("agent.hint")}</p>
          <label className="flex flex-col gap-1 text-sm">
            {t("agent.port")}
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => {
                setPort(e.target.value);
                setNotice(null);
              }}
              className="max-w-40"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit">{t("agent.savePort")}</Button>
            {notice === "saved" && <p className="text-sm text-muted-foreground">{t("agent.portSaved")}</p>}
            {notice === "invalid" && <p className="text-sm text-destructive">{t("agent.portInvalid")}</p>}
          </div>
        </form>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{presenceLine}</p>
          {hasPort && presence.status === "absent" && (
            <Link to="/help" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              {t("agent.helpLink")}
            </Link>
          )}
        </div>
        {hasPort && <p className="text-sm text-muted-foreground">{passLine}</p>}
        <div>
          <Button onClick={() => void run()} disabled={!canRun || state === "running"}>
            {t(state === "running" ? "agent.refreshing" : "agent.refresh")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

La carte Flex Query a déjà un bouton « Enregistrer » : le test cible `{ name: "Enregistrer", exact: true }` et prend le premier résultat s'il y en a deux ; utiliser `within(screen.getByTestId("agent-card"))` pour lever l'ambiguïté.

- [x] **Étape 5 : lancer, voir passer, capturer, committer**

```bash
pnpm --filter web test
pnpm --filter web typecheck
node .claude/skills/run-frontend/driver.mjs /accounts/alpha/sources --seed
```

Ouvrir le PNG : la carte est entre Synchronisation et Importer un fichier.

```bash
git add -A
git commit -m "feat(web): carte Agent local dans Sources de données, port TWS par compte"
```

---

## Tâche 14 : page Aide, commandes construites depuis l'origine

**Files:**
- Create: `apps/web/src/agent/agentIndex.ts`, `apps/web/src/agent/agentIndex.test.ts`, `apps/web/src/pages/HelpPage.tsx`, `apps/web/src/pages/HelpPage.test.tsx`
- Modify: `apps/web/src/routes/router.tsx`, `apps/web/src/lib/navigation.ts`, `apps/web/src/routes/AppLayout.test.tsx`, `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`

**Interfaces:**
- Produces:
  ```ts
  interface AgentIndex { version: string; filename: string }
  function fetchAgentIndex(origin: string): Promise<AgentIndex | null>
  function useAgentIndex(origin: string): { status: "loading" } | { status: "ok"; index: AgentIndex } | { status: "unavailable" }
  ```
  route `/help`, entrée `nav.help`, page `HelpPage`.

- [x] **Étape 1 : i18n**

`fr.json` :

```json
  "nav": { "…": "…", "help": "Aide" },
  "help": {
    "title": "Aide",
    "what": {
      "title": "L'agent local",
      "text": "L'agent lit TWS sur votre machine et ne parle qu'à ce site. Il ne stocke rien : positions, cash et exécutions du jour ne quittent jamais votre ordinateur. Sans lui, l'application fonctionne avec Flex Query et les relevés, aux données de la veille."
    },
    "uv": {
      "title": "1. Installer uv",
      "text": "uv installe l'agent et l'interpréteur Python qu'il lui faut.",
      "macLinux": "macOS et Linux",
      "windows": "Windows"
    },
    "install": {
      "title": "2. Installer l'agent",
      "text": "La commande installe la version que ce site sert. Relancez-la après une mise à jour du site.",
      "unavailable": "Ce serveur ne sert pas le paquet de l'agent : en développement, lancez pnpm build:agent."
    },
    "configure": {
      "title": "3. Le configurer et le lancer",
      "text": "La première commande enregistre l'adresse de ce site, la seule à laquelle l'agent répondra. La seconde le lance ; laissez-la tourner pendant que vous utilisez le site."
    },
    "tws": {
      "title": "4. Régler l'API de TWS",
      "text": "Dans TWS : Configuration › API › Settings.",
      "items": [
        "Cocher « Enable ActiveX and Socket Clients ».",
        "Noter le « Socket port » : un port par compte, chaque TWS a le sien.",
        "Ajouter 127.0.0.1 dans « Trusted IPs ».",
        "« Read-Only API » peut rester coché : l'agent ne passe aucun ordre."
      ]
    },
    "chrome": {
      "title": "5. La permission du navigateur",
      "text": "La première fois, Chrome demande si ce site peut accéder à votre réseau local : c'est l'agent sur votre machine. Accepter."
    },
    "port": {
      "title": "6. Renseigner le port",
      "text": "Dans Sources de données, carte Agent local, saisissez le port TWS du compte.",
      "link": "Ouvrir Sources de données"
    }
  },
```

`en.json` :

```json
  "nav": { "…": "…", "help": "Help" },
  "help": {
    "title": "Help",
    "what": {
      "title": "The local agent",
      "text": "The agent reads TWS on your machine and talks to this site only. It stores nothing: positions, cash and today's fills never leave your computer. Without it, the app works from Flex Query and statements, as of the previous close."
    },
    "uv": {
      "title": "1. Install uv",
      "text": "uv installs the agent and the Python it needs.",
      "macLinux": "macOS and Linux",
      "windows": "Windows"
    },
    "install": {
      "title": "2. Install the agent",
      "text": "The command installs the version this site serves. Run it again after the site is updated.",
      "unavailable": "This server does not serve the agent package: in development, run pnpm build:agent."
    },
    "configure": {
      "title": "3. Configure and start it",
      "text": "The first command records this site's address, the only one the agent will answer. The second starts it; leave it running while you use the site."
    },
    "tws": {
      "title": "4. Set up the TWS API",
      "text": "In TWS: Configuration › API › Settings.",
      "items": [
        "Tick \"Enable ActiveX and Socket Clients\".",
        "Note the \"Socket port\": one port per account, each TWS has its own.",
        "Add 127.0.0.1 to \"Trusted IPs\".",
        "\"Read-Only API\" can stay ticked: the agent never places an order."
      ]
    },
    "chrome": {
      "title": "5. The browser's permission",
      "text": "The first time, Chrome asks whether this site may reach your local network: that is the agent on your machine. Accept."
    },
    "port": {
      "title": "6. Fill in the port",
      "text": "In Data sources, Local agent card, type the account's TWS port.",
      "link": "Open Data sources"
    }
  },
```

- [x] **Étape 2 : les tests (échec attendu)**

`apps/web/src/agent/agentIndex.test.ts` :

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAgentIndex } from "./agentIndex";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchAgentIndex", () => {
  it("reads /agent/index.json of the given origin", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ version: "0.1.0", filename: "ib_tws_agent-0.1.0-py3-none-any.whl" }), { status: 200 }),
    );
    expect(await fetchAgentIndex("https://app.example")).toEqual({ version: "0.1.0", filename: "ib_tws_agent-0.1.0-py3-none-any.whl" });
    expect(String(spy.mock.calls[0][0])).toBe("https://app.example/agent/index.json");
  });

  it("is null on 404, on a rejection, and on a body that is not an index", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>", { status: 404 }));
    expect(await fetchAgentIndex("https://app.example")).toBeNull();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("x"));
    expect(await fetchAgentIndex("https://app.example")).toBeNull();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ version: 1 }), { status: 200 }));
    expect(await fetchAgentIndex("https://app.example")).toBeNull();
  });
});
```

`apps/web/src/pages/HelpPage.test.tsx` :

```tsx
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { HelpPage } from "@/pages/HelpPage";
import { setLastAccountId } from "@/lib/accountStorage";

function mockIndex(body: Response | Promise<Response>) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => body);
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ORIGIN = window.location.origin; // jsdom: http://localhost:3000

describe("HelpPage", () => {
  it("builds the install and init commands from the current origin and the served index", async () => {
    mockIndex(new Response(JSON.stringify({ version: "0.1.0", filename: "ib_tws_agent-0.1.0-py3-none-any.whl" }), { status: 200 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    expect(await screen.findByText(`uv tool install ${ORIGIN}/agent/ib_tws_agent-0.1.0-py3-none-any.whl`)).toBeInTheDocument();
    expect(screen.getByText(`ib-tws-agent init --origin ${ORIGIN}`)).toBeInTheDocument();
    expect(screen.getByText("ib-tws-agent", { selector: "code" })).toBeInTheDocument();
  });

  it("says when this server does not serve the package", async () => {
    mockIndex(new Response("", { status: 404 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    expect(await screen.findByText("Ce serveur ne sert pas le paquet de l'agent : en développement, lancez pnpm build:agent.")).toBeInTheDocument();
    expect(screen.queryByText(/uv tool install/)).not.toBeInTheDocument();
  });

  it("lists the four TWS settings and the uv commands for both platforms", async () => {
    mockIndex(new Response("", { status: 404 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    expect(await screen.findByText(/Enable ActiveX and Socket Clients/)).toBeInTheDocument();
    expect(screen.getByText(/Trusted IPs/)).toBeInTheDocument();
    expect(screen.getByText("curl -LsSf https://astral.sh/uv/install.sh | sh")).toBeInTheDocument();
    expect(screen.getByText(/irm https:\/\/astral.sh\/uv\/install.ps1/)).toBeInTheDocument();
  });

  it("links to the Sources page of the last opened account", async () => {
    mockIndex(new Response("", { status: 404 }));
    setLastAccountId("beta");
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    expect(await screen.findByRole("link", { name: "Ouvrir Sources de données" })).toHaveAttribute("href", "/accounts/beta/sources");
  });
});
```

Dans `AppLayout.test.tsx`, la liste attendue des liens se termine désormais par `"/settings", "/help"`.

- [x] **Étape 3 : lancer, voir échouer**

```bash
pnpm --filter web test src/agent/agentIndex.test.ts src/pages/HelpPage.test.tsx src/routes
```

- [x] **Étape 4 : `agentIndex.ts`**

```ts
import { useEffect, useState } from "react";

/** Written next to the wheel by apps/tws-agent/scripts/write_index.py at image build time. */
export interface AgentIndex {
  version: string;
  filename: string;
}

export async function fetchAgentIndex(origin: string): Promise<AgentIndex | null> {
  try {
    const response = await fetch(`${origin}/agent/index.json`, { cache: "no-cache" });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return null;
    const { version, filename } = body as { version?: unknown; filename?: unknown };
    return typeof version === "string" && typeof filename === "string" ? { version, filename } : null;
  } catch {
    return null;
  }
}

export type AgentIndexState = { status: "loading" } | { status: "ok"; index: AgentIndex } | { status: "unavailable" };

export function useAgentIndex(origin: string): AgentIndexState {
  const [state, setState] = useState<AgentIndexState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    void fetchAgentIndex(origin).then((index) => {
      if (!cancelled) setState(index ? { status: "ok", index } : { status: "unavailable" });
    });
    return () => {
      cancelled = true;
    };
  }, [origin]);
  return state;
}
```

- [x] **Étape 5 : `HelpPage.tsx`**

```tsx
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { buttonVariants } from "@ib/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { cn } from "@ib/ui/lib/utils";
import { useAgentIndex } from "@/agent/agentIndex";
import { getLastAccountId } from "@/lib/accountStorage";

// Astral's own documented installers. Not our domain: fine in a versioned file.
const UV_INSTALL_UNIX = "curl -LsSf https://astral.sh/uv/install.sh | sh";
const UV_INSTALL_WINDOWS = 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"';

function Command({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
      <code>{children}</code>
    </pre>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">{children}</CardContent>
    </Card>
  );
}

/**
 * Every command is built from `window.location.origin` and from the index the site serves
 * next to the agent's wheel: no domain name, no version, no file name in this code
 * (spec §8). Reading the origin at render time is what keeps CLAUDE.md's rule true.
 */
export function HelpPage() {
  const { t } = useTranslation();
  const origin = window.location.origin;
  const index = useAgentIndex(origin);
  const lastAccountId = getLastAccountId();
  const twsItems = t("help.tws.items", { returnObjects: true }) as string[];

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="font-heading text-lg font-semibold tracking-tight">{t("help.title")}</h1>

      <Section title={t("help.what.title")}>
        <p className="text-muted-foreground">{t("help.what.text")}</p>
      </Section>

      <Section title={t("help.uv.title")}>
        <p className="text-muted-foreground">{t("help.uv.text")}</p>
        <p>{t("help.uv.macLinux")}</p>
        <Command>{UV_INSTALL_UNIX}</Command>
        <p>{t("help.uv.windows")}</p>
        <Command>{UV_INSTALL_WINDOWS}</Command>
      </Section>

      <Section title={t("help.install.title")}>
        <p className="text-muted-foreground">{t("help.install.text")}</p>
        {index.status === "ok" && <Command>{`uv tool install ${origin}/agent/${index.index.filename}`}</Command>}
        {index.status === "unavailable" && <p className="text-muted-foreground">{t("help.install.unavailable")}</p>}
      </Section>

      <Section title={t("help.configure.title")}>
        <p className="text-muted-foreground">{t("help.configure.text")}</p>
        <Command>{`ib-tws-agent init --origin ${origin}`}</Command>
        <Command>ib-tws-agent</Command>
      </Section>

      <Section title={t("help.tws.title")}>
        <p className="text-muted-foreground">{t("help.tws.text")}</p>
        <ul className="list-disc space-y-1 pl-5">
          {twsItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Section>

      <Section title={t("help.chrome.title")}>
        <p className="text-muted-foreground">{t("help.chrome.text")}</p>
      </Section>

      <Section title={t("help.port.title")}>
        <p className="text-muted-foreground">{t("help.port.text")}</p>
        {lastAccountId && (
          <div>
            <Link to={`/accounts/${lastAccountId}/sources`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              {t("help.port.link")}
            </Link>
          </div>
        )}
      </Section>
    </div>
  );
}
```

- [x] **Étape 6 : route et navigation**

`router.tsx` :

```tsx
import { HelpPage } from "@/pages/HelpPage";
// …
  {
    path: "/help",
    element: <AppLayout />,
    children: [{ index: true, element: <HelpPage /> }],
  },
```

`navigation.ts`, dernière entrée de la section Configuration, icône `CircleQuestionMark` (le nom de cette version de `lucide-react`) :

```ts
      { labelKey: "nav.help", icon: CircleQuestionMark, to: () => "/help" },
```

- [x] **Étape 7 : lancer, voir passer, capturer, committer**

```bash
pnpm --filter web test
pnpm --filter web typecheck
node .claude/skills/run-frontend/driver.mjs /help --seed
```

Ouvrir le PNG : sept cartes, l'entrée Aide en bas du menu, le bloc d'installation dit que ce serveur ne sert pas le paquet (normal en développement avant la tâche 15).

```bash
git add -A
git commit -m "feat(web): page Aide, installation de l'agent depuis l'origine courante"
```

---

# Palier D — distribution et bout en bout

## Tâche 15 : la roue servie par le site

**Files:**
- Create: `apps/tws-agent/scripts/write_index.py`, `apps/tws-agent/tests/test_write_index.py`
- Modify: `apps/web/Dockerfile`, `apps/web/nginx.conf`, `package.json` (racine), `.gitignore`

**Interfaces:**
- Produces: `/agent/<roue>` et `/agent/index.json` servis par l'image `web` ; `pnpm build:agent` produit les mêmes fichiers dans `apps/web/public/agent/`.

- [x] **Étape 1 : le test (échec attendu)**

`apps/tws-agent/tests/test_write_index.py` :

```python
from __future__ import annotations

import json
import runpy
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "write_index.py"


def write_index(out_dir: Path) -> Path:
    module = runpy.run_path(str(SCRIPT))
    return module["main"](out_dir)


def test_index_names_the_one_wheel_and_its_version(tmp_path):
    (tmp_path / "ib_tws_agent-0.1.0-py3-none-any.whl").write_bytes(b"")

    index = write_index(tmp_path)

    assert index == tmp_path / "index.json"
    assert json.loads(index.read_text(encoding="utf-8")) == {
        "version": "0.1.0",
        "filename": "ib_tws_agent-0.1.0-py3-none-any.whl",
    }


@pytest.mark.parametrize("names", [[], ["ib_tws_agent-0.1.0-py3-none-any.whl", "ib_tws_agent-0.2.0-py3-none-any.whl"]])
def test_anything_but_exactly_one_wheel_is_refused(tmp_path, names):
    for name in names:
        (tmp_path / name).write_bytes(b"")

    with pytest.raises(SystemExit):
        write_index(tmp_path)
```

- [x] **Étape 2 : lancer, voir échouer**

```bash
pnpm test:agent
```

- [x] **Étape 3 : `write_index.py`**

```python
"""Write index.json next to the agent's wheel, for the site's Help page.

The page reads `{ version, filename }` and builds `uv tool install <origin>/agent/<filename>`
from it: neither the version nor the file name is ever in the web app's code.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main(out_dir: Path) -> Path:
    wheels = sorted(out_dir.glob("ib_tws_agent-*.whl"))
    if len(wheels) != 1:
        raise SystemExit(f"expected exactly one ib_tws_agent wheel in {out_dir}, found {len(wheels)}")
    filename = wheels[0].name
    version = filename.split("-")[1]
    index = out_dir / "index.json"
    index.write_text(json.dumps({"version": version, "filename": filename}, indent=2) + "\n", encoding="utf-8")
    return index


if __name__ == "__main__":
    print(main(Path(sys.argv[1])))
```

- [x] **Étape 4 : l'image, nginx, le script de développement**

`apps/web/Dockerfile` :

```dockerfile
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile
RUN pnpm --filter web build

# The agent's wheel, served by the site: a user needs uv and this site, nothing else
# (spec sous-projet 4 §9). Built standalone from its own pyproject: no workspace, no lock.
FROM ghcr.io/astral-sh/uv:python3.14-bookworm-slim AS agent
WORKDIR /repo
COPY apps/tws-agent ./apps/tws-agent
RUN uv build --wheel --out-dir /out apps/tws-agent \
 && python apps/tws-agent/scripts/write_index.py /out

FROM nginx:alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY --from=agent /out /usr/share/nginx/html/agent
```

`apps/web/nginx.conf`, avant `location /` :

```nginx
    # The agent's wheel and its index: the file name changes with every version, the index
    # must never be served stale.
    location /agent/ {
        add_header Cache-Control "no-cache";
    }
```

`package.json` racine, `scripts` :

```json
"build:agent": "rm -rf apps/web/public/agent && uv build --wheel --out-dir apps/web/public/agent --package ib-tws-agent && uv run --project apps/tws-agent python apps/tws-agent/scripts/write_index.py apps/web/public/agent",
```

`.gitignore`, sous `# Node` :

```
# Roue de l'agent construite par `pnpm build:agent` pour la page Aide en développement
apps/web/public/agent/
```

- [x] **Étape 5 : vérifier**

```bash
pnpm test:agent
pnpm build:agent
ls apps/web/public/agent/
cat apps/web/public/agent/index.json
docker build -f apps/web/Dockerfile -t ib-web-agent-check . && docker run --rm ib-web-agent-check cat /usr/share/nginx/html/agent/index.json
node .claude/skills/run-frontend/driver.mjs /help --seed
```

Le PNG de la page Aide montre désormais la commande `uv tool install http://127.0.0.1:5173/agent/ib_tws_agent-0.1.0-py3-none-any.whl`. Si Docker n'est pas utilisable sur cette machine, le dire dans le commit et laisser la vérification de l'image à la tâche 18.

- [x] **Étape 6 : committer**

```bash
git add -A
git commit -m "feat(web): la roue de l'agent construite dans l'image et servie sous /agent/"
```

---

## Tâche 16 : `--agent` dans le pilote, charge utile de démonstration

**Files:**
- Create: `apps/web/src/mocks/agent-snapshot.json`
- Modify: `.claude/skills/run-frontend/driver.mjs`, `.claude/skills/run-frontend/SKILL.md`

- [x] **Étape 1 : la charge utile**

`apps/web/src/mocks/agent-snapshot.json`, cohérente avec `seedDemo` (`alpha` = `U0000001`) et avec le snapshot semé (`SAMPLE_POSITIONS`, que la charge utile remplace par ses deux positions) :

```json
{
  "accounts": ["U0000001"],
  "fetchedAt": "2026-09-06T13:02:11.482Z",
  "cashAvailable": 25000,
  "positions": [
    {
      "conId": 265598, "symbol": "AAPL", "localSymbol": "AAPL", "secType": "STK", "right": "", "strike": 0.0,
      "lastTradeDateOrContractMonth": "", "multiplier": "", "currency": "USD",
      "position": 200.0, "averageCost": 140.0, "marketPrice": 151.2, "marketValue": 30240.0, "unrealizedPNL": 2240.0
    },
    {
      "conId": 700000002, "symbol": "AAPL", "localSymbol": "AAPL  260116C00150000", "secType": "OPT", "right": "C",
      "strike": 150.0, "lastTradeDateOrContractMonth": "20260116", "multiplier": "100", "currency": "USD",
      "position": -1.0, "averageCost": 200.0, "marketPrice": 1.2, "marketValue": -120.0, "unrealizedPNL": 80.0
    }
  ],
  "executions": [
    {
      "execId": "0000e1a7.68bc1234.01.09", "time": "2026-09-06T14:31:02+00:00", "acctNumber": "U0000001",
      "side": "SLD", "shares": 1.0, "price": 2.5, "cumQty": 1.0, "avgPrice": 2.5, "orderRef": "",
      "contract": {
        "conId": 700000002, "symbol": "AAPL", "localSymbol": "AAPL  260116C00150000", "secType": "OPT", "right": "C",
        "strike": 150.0, "lastTradeDateOrContractMonth": "20260116", "multiplier": "100", "currency": "USD"
      },
      "commission": 1.05, "commissionCurrency": "USD"
    }
  ]
}
```

- [x] **Étape 2 : le pilote**

Dans l'en-tête de `driver.mjs`, ajouter la ligne d'aide :

```js
//   --agent           stub the local agent (127.0.0.1:8100) with src/mocks/agent-snapshot.json and set a TWS port on the first route's account
```

Après les imports existants :

```js
import agentSnapshot from "../../../apps/web/src/mocks/agent-snapshot.json" with { type: "json" };
```

Dans la boucle, juste après le bloc `if (ibAccount) { … }` et avant les imports de fichiers :

```js
    if (has("agent")) {
      if (!account) throw new Error(`--agent needs the first route to be /accounts/<id>/..., got "${routes[0]}"`);
      // Playwright answers instead of a real agent. The Allow-Origin header matters: a
      // fulfilled cross-origin response still goes through the browser's CORS check.
      await page.route("http://127.0.0.1:8100/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify(path === "/health" ? { version: "0.1.0" } : agentSnapshot),
        });
      });
      await page.goto(BASE, { waitUntil: "domcontentloaded" });
      await page.evaluate(
        ([id]) => import("/src/db/schema.ts").then((m) => m.db.accounts.update(id, { twsPort: 7502 })),
        [account],
      );
    }
```

Le texte existant qui vérifie `--ib-account/--import/--sectors` avec `account` reste tel quel.

- [x] **Étape 3 : le skill**

Dans `SKILL.md`, ajouter à la table des options :

```
| `--agent` | Intercepte l'agent local (`127.0.0.1:8100`) avec `src/mocks/agent-snapshot.json` et pose un port TWS sur le compte de la première route : les pages passent « en direct » sans TWS ni agent |
```

et un paragraphe sous « Positions et Dashboard » :

```
## Agent local

Cette machine n'a ni TWS ni agent. `--agent` fait répondre Playwright à leur place :

    node .claude/skills/run-frontend/driver.mjs /accounts/alpha/positions /accounts/alpha/history /accounts/alpha/sources --seed --agent

Positions montre le badge vert « En direct », Historique la vente d'option du jour, Sources de
données la carte Agent local avec « Agent détecté ». Sans `--agent`, aucun bouton Actualiser
n'apparaît : c'est le comportement voulu aux paliers 1 et 2.
```

- [x] **Étape 4 : vérifier, committer**

```bash
node .claude/skills/run-frontend/driver.mjs /accounts/alpha/positions /accounts/alpha/history /accounts/alpha/sources /accounts/alpha/dashboard --seed --agent
```

Ouvrir les quatre PNG : badge vert et bouton sur Positions et Dashboard, bouton seul sur Historique avec la ligne `AAPL` du jour en tête, carte Agent local « détecté » sur Sources. Aucune erreur console.

```bash
git add -A
git commit -m "feat(run-frontend): --agent, l'agent intercepté par Playwright"
```

---

## Tâche 17 : bout en bout Playwright

**Files:**
- Create: `apps/web/e2e/agent.spec.ts`

- [x] **Étape 1 : le scénario**

```ts
import { expect, test } from "@playwright/test";
import fr from "../src/i18n/fr.json" with { type: "json" };
import agentSnapshot from "../src/mocks/agent-snapshot.json" with { type: "json" };

/**
 * No server, no session: the agent path needs neither (spec fondateur §2). Playwright plays the
 * agent; the app is seeded like the run-frontend driver does. The stack still has Django and
 * Postgres up for the other spec files, and SessionProvider's probe simply finds them.
 */
test("a seeded account goes live, finds today's fill in History, and names a TWS outage", async ({ page }) => {
  let twsUp = true;
  await page.route("http://127.0.0.1:8100/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/health") {
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ version: "0.1.0" }) });
    }
    return route.fulfill({
      status: twsUp ? 200 : 503,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(twsUp ? agentSnapshot : { code: "tws-unreachable", detail: "ConnectionRefusedError" }),
    });
  });

  await page.goto("/");
  await page.evaluate(() => import("/src/mocks/seed.ts").then((m) => m.seedDemo()));
  await page.evaluate(() => import("/src/db/schema.ts").then((m) => m.db.accounts.update("alpha", { twsPort: 7502 })));

  await page.goto("/accounts/alpha/positions");
  await expect(page.getByText(/^En direct, \d{2}:\d{2}$/)).toBeVisible();
  await expect(page.getByText("AAPL 2026-01-16 C 150")).toBeVisible();

  await page.getByRole("link", { name: fr.nav.history }).click();
  await expect(page).toHaveURL(/\/history$/);
  const firstRow = page.getByRole("row").nth(1);
  await expect(firstRow).toContainText("AAPL");
  await expect(firstRow).toContainText("-1");

  twsUp = false;
  await page.getByRole("button", { name: fr.snapshot.refresh }).click();
  await expect(page.getByText(fr.agent.errors["tws-unreachable"])).toBeVisible();

  await page.getByRole("link", { name: fr.nav.sources }).click();
  await expect(page.getByText(fr.agent.detected.replace("{{version}}", "0.1.0"))).toBeVisible();
  await expect(page.getByText(fr.agent.lastFailed.replace("{{reason}}", fr.agent.errors["tws-unreachable"]))).toBeVisible();
});
```

- [x] **Étape 2 : lancer**

Avec Django et PostgreSQL démarrés comme pour les deux autres fichiers (`apps/api/README.md`) :

```bash
pnpm --filter web e2e -- agent.spec.ts
```

Si la ligne d'Historique n'est pas la première (ordre de référence `when` puis `externalId`), lire la table avec `page.getByRole("row").filter({ hasText: "AAPL" })` et affirmer la présence de la quantité `-1` et de l'heure du jour.

- [x] **Étape 3 : committer**

```bash
git add -A
git commit -m "test(web): bout en bout, l'agent intercepté fait passer un compte en direct"
```

---

# Palier E — documents, dette, merge

## Tâche 18 : documents, dette, revue et merge

**Files:**
- Create: `apps/tws-agent/README.md`
- Modify: `CLAUDE.md`, `docs/specs/2026-09-03-architecture-design.md`, `docs/points-reportes.md`, `docs/specs/2026-09-06-agent-local-design.md` (si un écart est apparu)

- [x] **Étape 1 : `apps/tws-agent/README.md`**

```markdown
# ib-tws-agent

Agent local d'IB Options Analyzer 2 : lit TWS sur la machine de l'utilisateur, ne stocke rien,
ne répond qu'aux origines de son `config.toml`. Spec : `docs/specs/2026-09-06-agent-local-design.md`.

## Utilisateur

La page Aide du site donne les commandes exactes. En résumé :

    uv tool install <origine>/agent/<roue>
    ib-tws-agent init --origin <origine>
    ib-tws-agent

Réglages TWS : Enable ActiveX and Socket Clients, un port par compte, `127.0.0.1` dans Trusted
IPs, Read-Only API acceptée. Le port se renseigne ensuite dans Sources de données.

## Développeur

    pnpm test:agent                       # pytest sur un FakeIB, jamais un vrai TWS
    uv run --project apps/tws-agent ib-tws-agent init --origin http://localhost:5173
    uv run --project apps/tws-agent ib-tws-agent
    pnpm build:agent                      # roue + index.json dans apps/web/public/agent/

Deux endpoints : `GET /health` (gratuit) et `GET /snapshot?port=<port TWS>` (une connexion
TWS en `clientId 0`, refermée aussitôt). Données brutes, noms `ib_async` ; toute conversion
vit dans `packages/ib-parsers/src/agent.ts`.

## Validation contre un vrai TWS

Impossible depuis la machine de développement. Sur une machine où TWS tourne avec l'API
activée :

    curl -i http://127.0.0.1:8100/health
    curl -i "http://127.0.0.1:8100/snapshot?port=7502"
    curl -i -H "Origin: https://autre-site" http://127.0.0.1:8100/health    # sans Allow-Origin

Puis dans l'application : port renseigné, badge « En direct », et le lendemain la ligne du
jour remplacée par sa jumelle Flex après la synchro du matin.
```

- [x] **Étape 2 : `CLAUDE.md`**

- Supprimer la section « Dépôt de référence (lecture seule, en voie d'extinction) » **jusqu'à la sous-section « Quarantaine » exclue** : la table « reste à copier », la phrase « Cette ligne épuise… » et le paragraphe « Déjà copié… ». Les remplacer par deux phrases : l'ancien dépôt `/home/seb/IA/IB_Analyzer` n'a plus rien à nous donner, ne jamais le modifier, et le rendu visuel de son frontend reste la maquette.
- Garder « Quarantaine » et « État de l'ancienne application » ; dans cette dernière, la ligne « Aujourd'hui, Journaux, Portefeuilles » devient « Journaux, Portefeuilles ».
- Tableau des sous-projets : ligne 4 → « Agent local, positions intraday, exécutions du jour | fait (2026-09-06) ».
- « Règles qui mordent », ajouter :
  - **L'agent n'écrit qu'après `max(when)` Flex, strictement, et ne supprime jamais.** Un snapshot `agent` remplace toujours le courant ; un fichier remplace si son `asOf` atteint le jour du courant (`db/snapshot.ts`).
  - **Aucun `ImportRecord` pour l'agent** : l'état vit sur le compte (`twsPort`, `lastAgentSyncAt`, `lastAgentSyncStatus`).
  - **Il n'y a pas de page Aujourd'hui** : Historique, Positions et Dashboard portent les données intraday.
  - Compléter la règle du nom de domaine : l'agent le reçoit par `ib-tws-agent init --origin`, la page Aide le lit dans `window.location.origin`, jamais dans le code.
- « Outillage » : `pnpm test:agent`, `pnpm build:agent`, membre `apps/tws-agent` du workspace uv, option `--agent` du pilote.
- « Tests » : « pytest sur `apps/api` et `apps/tws-agent` (`FakeIB`) ».
- Fin de « VPS » : le paragraphe sur l'ancienne topologie reste vrai ; ajouter que l'image `web` sert la roue de l'agent sous `/agent/`.

- [x] **Étape 3 : le spec fondateur**

Quatre notes datées, en tête des sections, sans réécrire le texte d'origine :

- §2, après le tableau : « **Note du 2026-09-06** : il n'y a plus de page Aujourd'hui ; le palier 3 ajoute positions intraday et exécutions du jour dans Historique, Positions et Dashboard (`2026-09-06-agent-local-design.md` §2.1). »
- §8, en tête : « **Note du 2026-09-06** : deux endpoints, `GET /health` et `GET /snapshot?port=` ; le port TWS est un paramètre de requête saisi dans le navigateur ; le fichier de configuration ne porte que les origines et le port d'écoute ; le paquet est servi par le site (`2026-09-06-agent-local-design.md` §3, §9). »
- §9, après le tableau : « **Note du 2026-09-06** : la ligne Aujourd'hui disparaît ; une page Aide, `/help`, hors compte, s'ajoute à la section Configuration. »
- §12, point 4 : « **Fait (2026-09-06)**, sans page Aujourd'hui. »

- [x] **Étape 4 : `docs/points-reportes.md`**

En tête, avant « À traiter au sous-projet 4 ou plus tard », nouvelle rubrique :

```markdown
## Avant la publication du dépôt sur une forge

Décidé au brainstorming du sous-projet 4 : le dépôt sera public. Rien ici n'est traité ; tout
doit l'être avant la première poussée.

- **L'identifiant de compte IB réel figure dans `CLAUDE.md`, les specs et l'historique git.**
  Nettoyer les fichiers ne suffit pas : l'historique le porte aussi.
- **Les fixtures anonymisées divulguent l'ordre de rang et les magnitudes réelles à ±10 %**
  (dette du sous-projet 2, « Fixture anonymisée »). À accepter en connaissance de cause ou à
  refaire.
- **L'intégration continue**, écartée faute de forge, redevient possible. À rouvrir à part.
- **La règle « aucun nom de domaine dans un fichier versionné » devient une protection
  réelle**, plus seulement une convention : la relire avant publication, `deploy/` compris.
```

Renommer « À traiter au sous-projet 4 ou plus tard » en « Reporté par les sous-projets 3 et 4 », et y :

- supprimer les quatre entrées fermées : `ImportRecord.source` accepte `agent`, `planImport` refuse `agent`, `SnapshotRecord.source` n'accepte que `flex`, le verrou d'import global ;
- laisser `SourcesPage.handleFile` avec une phrase : l'agent n'emprunte pas ce chemin, la troisième source n'a rien changé ici ;
- ajouter les reports du sous-projet 4 : consulter les données live depuis un autre appareil (spec fondateur §13, relais par le serveur) ; un TWS gérant plusieurs comptes (l'agent rend la liste, le navigateur vérifie l'appartenance, rien de plus) ; l'agent en service système (lancement automatique) ; exercices, assignations et dividendes du jour, absents des fills TWS, qui n'arrivent qu'avec Flex ; et tout ce que la revue de branche aura relevé.

- [x] **Étape 5 : la revue de branche**

```bash
pnpm check
pnpm test:agent
git log --oneline main..agent-local
```

Skill `superpowers:requesting-code-review` sur la branche entière. Traiter ce qui bloque, reporter le reste dans `docs/points-reportes.md`, committer.

- [x] **Étape 6 : merge**

```bash
git add -A
git commit -m "docs: sous-projet 4 livré, dette reportée, ancien dépôt épuisé"
```

Skill `superpowers:finishing-a-development-branch` : merge sur `main`, suppression du worktree.

---

## Ce qui est délibéré

- **Pas de page Aujourd'hui**, décision de l'utilisateur au brainstorming : les pages existantes suffisent.
- **`/snapshot` unique** au lieu des trois endpoints du spec fondateur : une connexion TWS par passage.
- **Middleware CORS maison** : `Access-Control-Allow-Private-Network` est inconnu de Starlette.
- **`commission` positive côté Python** : donnée brute ; le parseur la négative. Un test de chaque côté épingle le signe.
- **`cashAvailable` calculé côté Python** : l'unique exception à « données brutes », pour ne pas transporter toutes les valeurs de compte.
- **`formatClockTime` en heure locale** alors que tout le reste est en UTC : un instant vivant se lit à l'heure du mur.
- **Le verrou d'import scopé par compte** paie une dette du sous-projet 3 au moment prévu.
- **Fixture JSON en double** (`packages/ib-parsers/tests/fixtures/` et `apps/web/src/mocks/`) : la première épingle les conversions, la seconde est une démonstration cohérente avec `seedDemo` ; les partager lierait le paquet aux tests d'un autre.
