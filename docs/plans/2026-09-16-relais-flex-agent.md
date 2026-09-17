# Sous-projet 19 — L'agent local relaie Flex : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Les cases `- [ ]` suivent l'avancement : **elles se cochent dans le worktree, au fur et à
> mesure, dans le même commit que la tâche.** Une reprise de session part de la première case
> non cochée.

**Goal:** L'agent local relaie les deux appels Flex comme le proxy Django, et chaque compte choisit « agent local seulement » (défaut) ou « agent local et serveur ».

**Architecture:** Côté agent, un module `flex.py` jumeau de `apps/api/ib/flex.py` et deux routes `POST` protégées par le contrôle d'origine strict. Côté navigateur, une fonction pure `pickFlexRelay` choisit le relais au début de chaque synchro ; `flex/proxy.ts` sait parler aux deux relais avec le même contrat ; `sync.ts` ne change que pour tracer le relais. La page Sources porte le choix et explique chaque état.

**Tech Stack:** Python 3.14, FastAPI, httpx, pytest (`pnpm test:agent`) ; TypeScript 6, React 19, Dexie 4, Vitest 4 (`fake-indexeddb`), shadcn base-ui ; Playwright.

**Spec:** `docs/specs/2026-09-16-relais-flex-agent-design.md`. Lire aussi `docs/specs/2026-09-06-agent-local-design.md` §3.3 et §3.6, `apps/api/ib/flex.py`, `apps/api/ib/api.py` et `CLAUDE.md`.

## Global Constraints

- **Le jeton ne figure jamais dans une URL de l'agent** ni dans un journal : corps JSON en `POST`, loggers `httpx` et `httpcore` au niveau `WARNING`.
- **L'URL d'IB est codée en dur** : `https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService`, `v=3`.
- **Corps d'erreur identiques à Django** : `{"code": "flex-timeout", "detail": "Interactive Brokers did not answer in time."}` (504), `{"code": "flex-unreachable", "detail": "Interactive Brokers could not be reached."}` (502).
- **`flexRelay` absent vaut `"agent"`** ; la seule lecture du défaut est `flexRelayMode(account)`.
- **Agent d'abord, aucun repli sur le serveur** quand l'agent présent échoue.
- **Aucune compatibilité avec un agent antérieur**, aucune détection de version.
- **Aucune version Dexie** : `flexRelay` et `lastFlexSyncStatus.relay` ne sont pas indexés.
- **L'agent écoute sur `127.0.0.1`**, `TrustedHostMiddleware` inchangé.
- **Aucun nom de domaine du site dans un fichier versionné.**
- shadcn ici est **base-ui** : `onValueChange` typé `T | null` selon la primitive ; imports `@/` réécrits en relatifs dans `packages/ui`.
- **Un test doit échouer si le comportement change.** Chaque test neuf est lancé avant l'implémentation et doit échouer pour la raison annoncée ; un test qui passe déjà est signalé comme garde-fou.
- `apps/web` teste sur `fake-indexeddb`, jamais en moquant les hooks de données.
- Code et commentaires en anglais ; documentation, textes français de l'interface et messages de commit en français.
- Chaque commit se termine par :
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```
- Le travail se fait dans le worktree `.claude/worktrees/relais-flex-agent` (skill `superpowers:using-git-worktrees`), branche `relais-flex-agent`, mergé sur `main` après revue.
- Avant chaque commit d'une tâche agent : `pnpm test:agent`. D'une tâche web : `pnpm --filter web test` et `pnpm --filter web typecheck`.

---

## Structure des fichiers

```
apps/tws-agent/
  pyproject.toml              httpx en dépendance de production, description
  ib_tws_agent/flex.py        NOUVEAU : call_flex, FlexTimeout, FlexUnreachable, loggers tenus
  ib_tws_agent/main.py        + get_flex_caller, POST /flex/send-request, /flex/get-statement
  ib_tws_agent/cors.py        ACTING_PATHS, preflight GET, POST + content-type
  tests/test_flex_client.py   NOUVEAU : call_flex sur MockTransport
  tests/test_flex_relay.py    NOUVEAU : routes, 422, 403, journaux
  tests/test_cors.py          preflight amendé
uv.lock                       httpx passe en dépendance de production

apps/web/src/
  db/schema.ts                AccountRecord.flexRelay, lastFlexSyncStatus.relay
  db/accounts.ts (+ test)     setFlexRelay
  flex/relay.ts (+ test)      NOUVEAU : pickFlexRelay, flexRelayMode, types
  flex/proxy.ts (+ test)      relais en premier argument, codes agent
  flex/sync.ts (+ test)       FlexSyncDeps.relay, tracé dans lastFlexSyncStatus
  flex/useFlexAutoSync.ts (+ test)  ping, choix, déclenchement sans session
  pages/SourcesPage.tsx (+ test)    choix du relais, SyncCard à huit états
  pages/HelpPage.tsx (+ test)       relais Flex mentionné
  i18n/fr.json, i18n/en.json
  e2e/sync.spec.ts            mode « agent et serveur », + scénario agent

packages/ui/src/components/ui/radio-group.tsx   NOUVEAU (shadcn)

docs/specs/2026-09-03-architecture-design.md, docs/specs/2026-09-06-agent-local-design.md,
docs/specs/2026-09-16-relais-flex-agent-design.md, CLAUDE.md, docs/points-reportes.md
```

---

### Task 1: `flex.py` dans l'agent

**Files:**
- Create: `apps/tws-agent/ib_tws_agent/flex.py`
- Create: `apps/tws-agent/tests/test_flex_client.py`
- Modify: `apps/tws-agent/pyproject.toml`, `uv.lock`

**Interfaces:**
- Produces: `FLEX_BASE: str`, `FLEX_VERSION = "3"`, `class FlexTimeout(Exception)`, `class FlexUnreachable(Exception)`, `async def call_flex(endpoint: str, params: dict[str, str], transport: httpx.AsyncBaseTransport | None = None) -> tuple[bytes, str]`.

- [x] **Step 1: Passer httpx en dépendance de production**

Dans `apps/tws-agent/pyproject.toml` : ajouter `"httpx>=0.27,<1",` à `dependencies`, retirer `"httpx>=0.27"` de `[dependency-groups] dev`, et remplacer la description par
`"Agent local d'IB Options Analyzer 2 : lit TWS sur cette machine, ne stocke rien, ne parle qu'au site et à Interactive Brokers."`.

Run: `uv lock` puis `git diff uv.lock`
Expected: `httpx` apparaît sous `ib-tws-agent` → `dependencies`, plus sous `dev`.

- [x] **Step 2: Écrire les tests qui échouent**

`apps/tws-agent/tests/test_flex_client.py` :

```python
from __future__ import annotations

import asyncio

import httpx
import pytest

from ib_tws_agent.flex import FLEX_BASE, FlexTimeout, FlexUnreachable, call_flex


def run(coro):
    return asyncio.run(coro)


def test_call_flex_hits_the_endpoint_with_the_params_and_version_and_returns_bytes_untouched():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, content=b"<FlexStatementResponse/>", headers={"content-type": "text/xml"})

    content, content_type = run(call_flex("SendRequest", {"t": "tok", "q": "42"}, transport=httpx.MockTransport(handler)))

    assert content == b"<FlexStatementResponse/>"
    assert content_type == "text/xml"
    assert len(seen) == 1
    assert seen[0].method == "GET"
    assert str(seen[0].url).startswith(f"{FLEX_BASE}/SendRequest?")
    assert dict(seen[0].url.params) == {"t": "tok", "q": "42", "v": "3"}


def test_call_flex_defaults_the_content_type_to_xml():
    transport = httpx.MockTransport(lambda request: httpx.Response(200, content=b"<x/>"))

    _, content_type = run(call_flex("GetStatement", {"t": "tok", "q": "REF"}, transport=transport))

    assert content_type == "application/xml"


def test_a_non_200_answer_from_ib_is_still_relayed():
    transport = httpx.MockTransport(lambda request: httpx.Response(500, content=b"oops", headers={"content-type": "text/plain"}))

    assert run(call_flex("GetStatement", {"t": "tok", "q": "REF"}, transport=transport)) == (b"oops", "text/plain")


def test_a_timeout_becomes_flex_timeout():
    def handler(request):
        raise httpx.ReadTimeout("slow", request=request)

    with pytest.raises(FlexTimeout):
        run(call_flex("SendRequest", {"t": "tok", "q": "42"}, transport=httpx.MockTransport(handler)))


def test_a_network_error_becomes_flex_unreachable():
    def handler(request):
        raise httpx.ConnectError("refused", request=request)

    with pytest.raises(FlexUnreachable):
        run(call_flex("SendRequest", {"t": "tok", "q": "42"}, transport=httpx.MockTransport(handler)))
```

- [x] **Step 3: Vérifier l'échec**

Run: `uv run --project apps/tws-agent pytest apps/tws-agent/tests/test_flex_client.py -v`
Expected: FAIL à la collecte, `ModuleNotFoundError: No module named 'ib_tws_agent.flex'`.

- [x] **Step 4: Écrire `flex.py`**

```python
"""Outbound call to the Flex Web Service, twin of apps/api/ib/flex.py.

The body that comes back is never read, parsed or logged here: it belongs to the browser.
This module only knows how to reach IB and how to fail.
"""

from __future__ import annotations

import logging

import httpx

FLEX_BASE = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService"
FLEX_VERSION = "3"
FLEX_TIMEOUT = httpx.Timeout(30.0, connect=10.0)

# The token is a query parameter of IB's URL: httpx logs that full URL at INFO and httpcore
# repeats it at DEBUG. Held at WARNING here, whatever level uvicorn or the root logger runs at,
# exactly as apps/api/config/settings.py does for the server's proxy.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)


class FlexTimeout(Exception):
    pass


class FlexUnreachable(Exception):
    pass


async def call_flex(
    endpoint: str,
    params: dict[str, str],
    transport: httpx.AsyncBaseTransport | None = None,
) -> tuple[bytes, str]:
    """`endpoint` is "SendRequest" or "GetStatement". `transport` exists for tests only."""
    try:
        async with httpx.AsyncClient(timeout=FLEX_TIMEOUT, transport=transport) as client:
            response = await client.get(f"{FLEX_BASE}/{endpoint}", params={**params, "v": FLEX_VERSION})
    except httpx.TimeoutException as error:
        raise FlexTimeout from error
    except httpx.RequestError as error:
        raise FlexUnreachable from error
    return response.content, response.headers.get("content-type", "application/xml")
```

- [x] **Step 5: Vérifier le succès**

Run: `pnpm test:agent`
Expected: tout passe, dont les 5 tests neufs.

- [x] **Step 6: Commit** (cocher les cases de la tâche 1 dans ce plan)

```bash
git add apps/tws-agent/pyproject.toml uv.lock apps/tws-agent/ib_tws_agent/flex.py apps/tws-agent/tests/test_flex_client.py docs/plans/2026-09-16-relais-flex-agent.md
git commit -m "feat(agent): appel sortant vers le Flex Web Service"
```

---

### Task 2: Les routes de relais et le contrôle d'origine

**Files:**
- Modify: `apps/tws-agent/ib_tws_agent/main.py`, `apps/tws-agent/ib_tws_agent/cors.py`
- Create: `apps/tws-agent/tests/test_flex_relay.py`
- Modify: `apps/tws-agent/tests/test_cors.py`

**Interfaces:**
- Consumes: `call_flex`, `FlexTimeout`, `FlexUnreachable` (tâche 1).
- Produces: `get_flex_caller() -> Callable[[str, dict[str, str]], Awaitable[tuple[bytes, str]]]` (dépendance FastAPI) ; routes `POST /flex/send-request` (`{"token", "queryId"}`) et `POST /flex/get-statement` (`{"token", "referenceCode"}`) ; `cors.ACTING_PATHS`.

- [x] **Step 1: Écrire les tests qui échouent**

`apps/tws-agent/tests/test_flex_relay.py` :

```python
from __future__ import annotations

import logging

import httpx
import pytest

from ib_tws_agent.flex import FlexTimeout, FlexUnreachable, call_flex
from ib_tws_agent.main import create_app, get_flex_caller
from fastapi.testclient import TestClient
from tests.conftest import CONFIG, ORIGIN

HEADERS = {"Origin": ORIGIN}
TOKEN = "a-very-recognisable-flex-token"


class Recorder:
    def __init__(self, answer=(b"<FlexStatementResponse/>", "text/xml"), error: Exception | None = None):
        self.calls: list[tuple[str, dict[str, str]]] = []
        self.answer = answer
        self.error = error

    async def __call__(self, endpoint: str, params: dict[str, str]):
        self.calls.append((endpoint, params))
        if self.error is not None:
            raise self.error
        return self.answer


def client_with(caller) -> TestClient:
    app = create_app(CONFIG)
    app.dependency_overrides[get_flex_caller] = lambda: caller
    return TestClient(app, base_url="http://127.0.0.1")


def test_send_request_relays_ib_bytes_and_content_type_untouched():
    fail = b"<FlexStatementResponse><Status>Fail</Status><ErrorCode>1012</ErrorCode></FlexStatementResponse>"
    recorder = Recorder(answer=(fail, "text/xml"))

    response = client_with(recorder).post("/flex/send-request", json={"token": TOKEN, "queryId": "42"}, headers=HEADERS)

    assert response.status_code == 200
    assert response.content == fail
    assert response.headers["content-type"] == "text/xml"
    assert recorder.calls == [("SendRequest", {"t": TOKEN, "q": "42"})]


def test_get_statement_passes_the_reference_code_as_q():
    recorder = Recorder()

    response = client_with(recorder).post("/flex/get-statement", json={"token": TOKEN, "referenceCode": "REF1"}, headers=HEADERS)

    assert response.status_code == 200
    assert recorder.calls == [("GetStatement", {"t": TOKEN, "q": "REF1"})]


def test_a_timeout_is_a_504_with_the_servers_body():
    response = client_with(Recorder(error=FlexTimeout())).post(
        "/flex/send-request", json={"token": TOKEN, "queryId": "42"}, headers=HEADERS
    )

    assert response.status_code == 504
    assert response.json() == {"code": "flex-timeout", "detail": "Interactive Brokers did not answer in time."}


def test_an_unreachable_ib_is_a_502_with_the_servers_body():
    response = client_with(Recorder(error=FlexUnreachable())).post(
        "/flex/get-statement", json={"token": TOKEN, "referenceCode": "REF1"}, headers=HEADERS
    )

    assert response.status_code == 502
    assert response.json() == {"code": "flex-unreachable", "detail": "Interactive Brokers could not be reached."}


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/flex/send-request", {"token": TOKEN}),
        ("/flex/send-request", {"token": "", "queryId": "42"}),
        ("/flex/send-request", {"token": TOKEN, "queryId": 42}),
        ("/flex/get-statement", {"token": TOKEN, "referenceCode": ""}),
    ],
)
def test_an_incomplete_body_is_a_422_and_never_reaches_ib(path, body):
    recorder = Recorder()

    response = client_with(recorder).post(path, json=body, headers=HEADERS)

    assert response.status_code == 422
    assert recorder.calls == []


@pytest.mark.parametrize("headers", [{}, {"Origin": "https://evil.example"}])
@pytest.mark.parametrize("path", ["/flex/send-request", "/flex/get-statement"])
def test_an_absent_or_unknown_origin_is_refused_before_reaching_ib(path, headers):
    recorder = Recorder()

    response = client_with(recorder).post(path, json={"token": TOKEN, "queryId": "42", "referenceCode": "R"}, headers=headers)

    assert response.status_code == 403
    assert response.json() == {"code": "origin-refused"}
    assert recorder.calls == []


def test_the_token_appears_in_no_log_record(caplog):
    # A real httpx.AsyncClient on a MockTransport: httpx and httpcore really emit their
    # records, so this bites if flex.py stops holding their loggers at WARNING.
    transport = httpx.MockTransport(lambda request: httpx.Response(200, content=b"<x/>", headers={"content-type": "text/xml"}))

    async def caller(endpoint, params):
        return await call_flex(endpoint, params, transport=transport)

    with caplog.at_level(logging.DEBUG):
        response = client_with(caller).post("/flex/send-request", json={"token": TOKEN, "queryId": "42"}, headers=HEADERS)

    assert response.status_code == 200
    assert TOKEN not in caplog.text
    for record in caplog.records:
        assert TOKEN not in str(record.args)
```

Dans `apps/tws-agent/tests/test_cors.py`, remplacer le test de preflight admis par :

```python
def test_preflight_for_an_allowed_origin_allows_get_post_json_and_the_private_network(make_client):
    response = make_client().options("/flex/send-request", headers={**PREFLIGHT, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"})

    assert response.status_code == 204
    assert response.headers["Access-Control-Allow-Origin"] == ORIGIN
    assert response.headers["Access-Control-Allow-Methods"] == "GET, POST"
    assert response.headers["Access-Control-Allow-Headers"] == "content-type"
    assert response.headers["Access-Control-Allow-Private-Network"] == "true"
    assert response.headers["Access-Control-Max-Age"] == "600"
    assert "Access-Control-Allow-Credentials" not in response.headers
```

et ajouter à `test_preflight_for_an_unknown_origin_carries_nothing` :

```python
    assert "Access-Control-Allow-Methods" not in response.headers
    assert "Access-Control-Allow-Headers" not in response.headers
```

- [x] **Step 2: Vérifier l'échec**

Run: `uv run --project apps/tws-agent pytest apps/tws-agent/tests/test_flex_relay.py apps/tws-agent/tests/test_cors.py -v`
Expected: `ImportError: cannot import name 'get_flex_caller'` pour `test_flex_relay.py` ; le preflight échoue sur `Access-Control-Allow-Methods == "GET"`.

Note : le test des journaux vérifie aussi la tâche 1 ; retirer temporairement les deux `setLevel` de `flex.py`, constater qu'il échoue (le jeton apparaît dans `HTTP Request: GET …`), puis les remettre.

- [x] **Step 3: Implémenter `cors.py`**

Remplacer le bloc `TWS_TOUCHING_PATHS` et son commentaire par :

```python
# Endpoints that make the agent act - open a TWS connection, or call Interactive Brokers with a
# Flex token - rather than merely answer. An unknown *or absent* Origin is refused before the
# handler runs: a same-origin request carries no Origin header at all (a DNS-rebinding page, or
# a plain <img src=…>), so "Origin present and unknown" is not strong enough - only "Origin
# present, present in the list" is.
ACTING_PATHS = frozenset({"/snapshot", "/flex/send-request", "/flex/get-statement"})
```

Dans `dispatch`, remplacer `"Access-Control-Allow-Methods": "GET",` par :

```python
                        "Access-Control-Allow-Methods": "GET, POST",
                        # The Flex relay posts JSON, which always triggers a preflight.
                        "Access-Control-Allow-Headers": "content-type",
```

et `TWS_TOUCHING_PATHS` par `ACTING_PATHS`. Mettre à jour la docstring du module : « `/snapshot` is different (see `TWS_TOUCHING_PATHS` below): it may open a TWS connection » → « `/snapshot` and the Flex relay are different (see `ACTING_PATHS` below): they make the agent act ».

- [x] **Step 4: Implémenter les routes dans `main.py`**

Imports à ajouter :

```python
from collections.abc import Awaitable, Callable, Iterable
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from .flex import FlexTimeout, FlexUnreachable, call_flex
```

(fusionner avec les imports existants `Callable, Iterable` et `JSONResponse`).

Au niveau du module, après `get_ib_factory` :

```python
FlexCaller = Callable[[str, dict[str, str]], Awaitable[tuple[bytes, str]]]

TIMEOUT_BODY = {"code": "flex-timeout", "detail": "Interactive Brokers did not answer in time."}
UNREACHABLE_BODY = {"code": "flex-unreachable", "detail": "Interactive Brokers could not be reached."}


def get_flex_caller() -> FlexCaller:
    """Overridden in tests: no test ever reaches Interactive Brokers."""
    return call_flex


class SendRequestIn(BaseModel):
    token: str = Field(min_length=1)
    queryId: str = Field(min_length=1)  # noqa: N815 - the browser's and IB's own naming


class GetStatementIn(BaseModel):
    token: str = Field(min_length=1)
    referenceCode: str = Field(min_length=1)  # noqa: N815


async def relay_flex(caller: FlexCaller, endpoint: str, params: dict[str, str]) -> Response:
    """IB's bytes and content-type pass through untouched, `Fail` answers included: the browser
    parses them. The token travels in the request body, never in this agent's URL, because
    uvicorn's access log writes the query string."""
    try:
        content, content_type = await caller(endpoint, params)
    except FlexTimeout:
        return JSONResponse(status_code=504, content=TIMEOUT_BODY)
    except FlexUnreachable:
        return JSONResponse(status_code=502, content=UNREACHABLE_BODY)
    # A `content-type` header, not `media_type`: Starlette would append a charset to text/*.
    return Response(content=content, headers={"content-type": content_type})
```

Dans `create_app`, après `/snapshot` :

```python
    @app.post("/flex/send-request")
    async def flex_send_request(payload: SendRequestIn, caller: FlexCaller = Depends(get_flex_caller)) -> Response:
        return await relay_flex(caller, "SendRequest", {"t": payload.token, "q": payload.queryId})

    @app.post("/flex/get-statement")
    async def flex_get_statement(payload: GetStatementIn, caller: FlexCaller = Depends(get_flex_caller)) -> Response:
        return await relay_flex(caller, "GetStatement", {"t": payload.token, "q": payload.referenceCode})
```

Mettre à jour la docstring du module `main.py` : ajouter « It also relays the two Flex Web Service calls, bytes untouched. »

- [x] **Step 5: Vérifier le succès**

Run: `pnpm test:agent`
Expected: tout passe.

- [x] **Step 6: Commit** (cocher les cases de la tâche 2)

```bash
git add apps/tws-agent docs/plans/2026-09-16-relais-flex-agent.md
git commit -m "feat(agent): relais des appels Flex, origine exigée"
```

---

### Task 3: Réglage du compte et choix du relais

**Files:**
- Modify: `apps/web/src/db/schema.ts`, `apps/web/src/db/accounts.ts`, `apps/web/src/db/accounts.test.ts`
- Create: `apps/web/src/flex/relay.ts`, `apps/web/src/flex/relay.test.ts`

**Interfaces:**
- Produces:
  - `AccountRecord.flexRelay?: FlexRelayMode` ; `lastFlexSyncStatus?: { at: string; ok: boolean; code?: string; relay?: FlexRelay }`
  - `export type FlexRelayMode = "agent" | "agent-and-server"` et `export type FlexRelay = "agent" | "server"` (dans `flex/relay.ts`)
  - `export type FlexRelayUnavailable = "agent-absent" | "needs-agent-or-account" | "server-unreachable" | "session-loading"`
  - `export type FlexRelayChoice = { relay: FlexRelay } | { relay: null; reason: FlexRelayUnavailable }`
  - `export function flexRelayMode(account: Pick<AccountRecord, "flexRelay">): FlexRelayMode`
  - `export function pickFlexRelay(mode: FlexRelayMode, agentPresent: boolean, session: SessionState["status"]): FlexRelayChoice`
  - `export async function setFlexRelay(db: AppDatabase, accountId: string, relay: FlexRelayMode): Promise<void>`

- [x] **Step 1: Écrire les tests qui échouent**

`apps/web/src/flex/relay.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { flexRelayMode, pickFlexRelay } from "./relay";

const SESSIONS = ["loading", "anonymous", "unreachable", "authenticated"] as const;

describe("flexRelayMode", () => {
  it("reads an absent choice as agent only", () => {
    expect(flexRelayMode({})).toBe("agent");
  });

  it("returns a stored choice as is", () => {
    expect(flexRelayMode({ flexRelay: "agent" })).toBe("agent");
    expect(flexRelayMode({ flexRelay: "agent-and-server" })).toBe("agent-and-server");
  });
});

describe("pickFlexRelay", () => {
  it.each(SESSIONS)("takes the agent whenever it is present, in either mode, session %s", (session) => {
    expect(pickFlexRelay("agent", true, session)).toEqual({ relay: "agent" });
    expect(pickFlexRelay("agent-and-server", true, session)).toEqual({ relay: "agent" });
  });

  it.each(SESSIONS)("never falls back on the server in agent-only mode, session %s", (session) => {
    expect(pickFlexRelay("agent", false, session)).toEqual({ relay: null, reason: "agent-absent" });
  });

  it("falls back on the server only with an open session", () => {
    expect(pickFlexRelay("agent-and-server", false, "authenticated")).toEqual({ relay: "server" });
    expect(pickFlexRelay("agent-and-server", false, "anonymous")).toEqual({ relay: null, reason: "needs-agent-or-account" });
    expect(pickFlexRelay("agent-and-server", false, "unreachable")).toEqual({ relay: null, reason: "server-unreachable" });
    expect(pickFlexRelay("agent-and-server", false, "loading")).toEqual({ relay: null, reason: "session-loading" });
  });
});
```

Dans `apps/web/src/db/accounts.test.ts` (base neuve par test, `db` du fichier ; ajouter `clearFlexCredentials` et `setFlexRelay` à l'import de `@/db/accounts`) :

```ts
describe("setFlexRelay", () => {
  it("stores the chosen relay, and clearing the credentials keeps it", async () => {
    await createAccount(db, { label: "Beta", ibAccountId: "U1234567" });
    expect((await db.accounts.get("beta"))?.flexRelay).toBeUndefined();

    await setFlexRelay(db, "beta", "agent-and-server");
    expect((await db.accounts.get("beta"))?.flexRelay).toBe("agent-and-server");

    await setFlexRelay(db, "beta", "agent");
    expect((await db.accounts.get("beta"))?.flexRelay).toBe("agent");

    await setFlexRelay(db, "beta", "agent-and-server");
    await clearFlexCredentials(db, "beta");
    expect((await db.accounts.get("beta"))?.flexRelay).toBe("agent-and-server");
  });
});
```

- [x] **Step 2: Vérifier l'échec**

Run: `pnpm --filter web exec vitest run src/flex/relay.test.ts src/db/accounts.test.ts`
Expected: FAIL, `Failed to resolve import "./relay"` et `setFlexRelay` non exporté.

- [x] **Step 3: Implémenter**

`apps/web/src/flex/relay.ts` :

```ts
import type { SessionState } from "@/api/session";
import type { AccountRecord } from "@/db/schema";

/** Who may relay an account's Flex calls (spec sous-projet 19 §2.2). */
export type FlexRelayMode = "agent" | "agent-and-server";
/** Who actually relayed one sync. */
export type FlexRelay = "agent" | "server";
export type FlexRelayUnavailable = "agent-absent" | "needs-agent-or-account" | "server-unreachable" | "session-loading";
export type FlexRelayChoice = { relay: FlexRelay } | { relay: null; reason: FlexRelayUnavailable };

/** The one place that reads the default: an account that never chose relays through the agent only. */
export function flexRelayMode(account: Pick<AccountRecord, "flexRelay">): FlexRelayMode {
  return account.flexRelay ?? "agent";
}

/**
 * Agent first, whatever the mode: when it is there, the token has no reason to cross the
 * server. The server is only ever a fallback for an absent agent, never for a failing one.
 */
export function pickFlexRelay(mode: FlexRelayMode, agentPresent: boolean, session: SessionState["status"]): FlexRelayChoice {
  if (agentPresent) return { relay: "agent" };
  if (mode === "agent") return { relay: null, reason: "agent-absent" };
  switch (session) {
    case "authenticated":
      return { relay: "server" };
    case "anonymous":
      return { relay: null, reason: "needs-agent-or-account" };
    case "unreachable":
      return { relay: null, reason: "server-unreachable" };
    case "loading":
      return { relay: null, reason: "session-loading" };
  }
}
```

`apps/web/src/db/schema.ts`, dans `AccountRecord` (import de type depuis `@/flex/relay`) :

```ts
  /** Who may relay this account's Flex calls. Absent: "agent" — read it through `flexRelayMode`. */
  flexRelay?: FlexRelayMode;
```

et remplacer le type de `lastFlexSyncStatus` par :

```ts
  /** Outcome of the last attempt, for the Sources page. `relay` is absent on attempts older than sub-project 19. */
  lastFlexSyncStatus?: { at: string; ok: boolean; code?: string; relay?: FlexRelay };
```

Mettre à jour le commentaire de `flexToken` : « Leaves the browser only for the relay: the local agent, or the server's proxy when the account allows it. »

`apps/web/src/db/accounts.ts`, après `clearFlexCredentials` :

```ts
/** Saved on its own, the moment it changes: it is not part of the credentials form. */
export async function setFlexRelay(db: AppDatabase, accountId: string, relay: FlexRelayMode): Promise<void> {
  await db.accounts.update(accountId, { flexRelay: relay });
}
```

- [x] **Step 4: Vérifier le succès**

Run: `pnpm --filter web exec vitest run src/flex/relay.test.ts src/db/accounts.test.ts && pnpm --filter web typecheck`
Expected: PASS, aucune erreur de type.

- [x] **Step 5: Commit** (cocher les cases de la tâche 3)

```bash
git add apps/web/src/flex/relay.ts apps/web/src/flex/relay.test.ts apps/web/src/db/schema.ts apps/web/src/db/accounts.ts apps/web/src/db/accounts.test.ts docs/plans/2026-09-16-relais-flex-agent.md
git commit -m "feat(web): réglage du relais Flex par compte et choix du relais"
```

---

### Task 4: `proxy.ts` parle aux deux relais, `sync.ts` trace le relais

**Files:**
- Modify: `apps/web/src/flex/proxy.ts`, `apps/web/src/flex/proxy.test.ts`, `apps/web/src/flex/sync.ts`, `apps/web/src/flex/sync.test.ts`

**Interfaces:**
- Consumes: `FlexRelay` (tâche 3), `AGENT_URL` (`@/agent/client`).
- Produces:
  - `ProxyErrorCode` gagne `"agent-unreachable" | "agent-origin-refused"`
  - `export function sendRequest(relay: FlexRelay, input: { token: string; queryId: string }): Promise<ProxyResult>`
  - `export function getStatement(relay: FlexRelay, input: { token: string; referenceCode: string }): Promise<ProxyResult>`
  - `FlexSyncDeps.relay: FlexRelay` ; `sendRequest`/`getStatement` de `FlexSyncDeps` gardent leur signature à un argument
  - `lastFlexSyncStatus` écrit `{ at, ok, relay }` ou `{ at, ok, code, relay }`

- [x] **Step 1: Écrire les tests qui échouent**

Dans `proxy.test.ts` : chaque appel existant prend `"server"` en premier argument (`sendRequest("server", { … })`, `getStatement("server", { … })`), et le `describe` existant est renommé `"proxy, server relay"`. Ajouter au test « relays a successful send-request » :

```ts
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${window.location.origin}/api/ib/flex/send-request`);
    expect(init.credentials).toBe("same-origin");
```

Ajouter :

```ts
describe("proxy, agent relay", () => {
  beforeEach(() => {
    clearCookies();
    vi.restoreAllMocks();
  });

  it("posts the same body to the agent, without cookie or CSRF, and returns the raw XML", async () => {
    document.cookie = "csrftoken=abc123; path=/";
    const fetchSpy = mockFetchOnce(200, "<x/>");
    expect(await sendRequest("agent", { token: "tok", queryId: "123" })).toEqual({ ok: true, xml: "<x/>" });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${AGENT_URL}/flex/send-request`);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(new Headers(init.headers).has("X-CSRFToken")).toBe(false);
    expect(JSON.parse(String(init.body))).toEqual({ token: "tok", queryId: "123" });
  });

  it("targets get-statement on the agent", async () => {
    const fetchSpy = mockFetchOnce(200, "<x/>");
    await getStatement("agent", { token: "tok", referenceCode: "REF1" });
    expect((fetchSpy.mock.calls[0] as [string])[0]).toBe(`${AGENT_URL}/flex/get-statement`);
  });

  it("maps a thrown fetch to agent-unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await sendRequest("agent", { token: "tok", queryId: "1" })).toEqual({ ok: false, code: "agent-unreachable" });
  });

  it("maps 403 to agent-origin-refused, never to unauthenticated", async () => {
    mockFetchOnce(403);
    expect(await sendRequest("agent", { token: "tok", queryId: "1" })).toEqual({ ok: false, code: "agent-origin-refused" });
  });

  it("maps 504 to flex-timeout and any other non-ok status to flex-unreachable", async () => {
    mockFetchOnce(504);
    expect(await getStatement("agent", { token: "tok", referenceCode: "R" })).toEqual({ ok: false, code: "flex-timeout" });
    mockFetchOnce(502);
    expect(await getStatement("agent", { token: "tok", referenceCode: "R" })).toEqual({ ok: false, code: "flex-unreachable" });
    mockFetchOnce(422);
    expect(await getStatement("agent", { token: "tok", referenceCode: "R" })).toEqual({ ok: false, code: "flex-unreachable" });
  });
});
```

(import `AGENT_URL` depuis `@/agent/client`).

Dans `sync.test.ts` : `deps()` ajoute `relay: "server" as const,` ; le test « records the outcome on the account » attend désormais `{ at: "2026-09-04T12:00:00.000Z", ok: true, relay: "server" }` et, pour l'échec, le même objet qu'aujourd'hui avec `relay: "server"`. Ajouter :

```ts
  it("records which relay carried the sync", async () => {
    await syncAccount(deps({ relay: "agent" }), ACCOUNT);
    expect((await db.accounts.get("beta"))?.lastFlexSyncStatus).toEqual({ at: "2026-09-04T12:00:00.000Z", ok: true, relay: "agent" });
  });
```

- [x] **Step 2: Vérifier l'échec**

Run: `pnpm --filter web exec vitest run src/flex/proxy.test.ts src/flex/sync.test.ts`
Expected: FAIL — les appels à deux arguments frappent l'URL serveur, le statut ne porte pas `relay`.

- [x] **Step 3: Implémenter `proxy.ts`**

```ts
import { AGENT_URL } from "@/agent/client";
import { csrfToken } from "@/api/csrf";
import type { FlexRelay } from "./relay";

export type ProxyErrorCode =
  | "unauthenticated"
  | "rate-limited"
  | "flex-timeout"
  | "flex-unreachable"
  | "network"
  | "agent-unreachable"
  | "agent-origin-refused";
```

(le reste des types et `retryAfterMs` inchangés). Remplacer `relay`, `sendRequest` et `getStatement` par :

```ts
type FlexPath = "send-request" | "get-statement";

async function relayThroughServer(path: FlexPath, body: unknown): Promise<ProxyResult> {
  // …corps actuel de `relay`, avec l'URL `${window.location.origin}/api/ib/flex/${path}`…
}

/**
 * The agent answers with the very same contract as the server's proxy (apps/tws-agent, spec
 * sous-projet 19 §2.1). No cookie and no CSRF: the agent knows no session, it checks the
 * Origin. It has no rate limit either, so no 429 to read here.
 */
async function relayThroughAgent(path: FlexPath, body: unknown): Promise<ProxyResult> {
  let response: Response;
  try {
    response = await fetch(`${AGENT_URL}/flex/${path}`, {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, code: "agent-unreachable" };
  }
  // 403 is the agent refusing this site's origin: its configuration lacks it.
  if (response.status === 403) return { ok: false, code: "agent-origin-refused" };
  if (response.status === 504) return { ok: false, code: "flex-timeout" };
  if (!response.ok) return { ok: false, code: "flex-unreachable" };
  return { ok: true, xml: await response.text() };
}

function relay(via: FlexRelay, path: FlexPath, body: unknown): Promise<ProxyResult> {
  return via === "agent" ? relayThroughAgent(path, body) : relayThroughServer(path, body);
}

export function sendRequest(via: FlexRelay, input: { token: string; queryId: string }): Promise<ProxyResult> {
  return relay(via, "send-request", input);
}

export function getStatement(via: FlexRelay, input: { token: string; referenceCode: string }): Promise<ProxyResult> {
  return relay(via, "get-statement", input);
}
```

Dans `relayThroughServer`, garder à l'identique le commentaire existant et le `fetch` actuel, seule l'URL change (`/api/ib/flex/${path}`).

- [x] **Step 4: Implémenter `sync.ts`**

`FlexSyncDeps` gagne, en premier champ après `db` :

```ts
  /** Who carries this sync, chosen once by `useFlexAutoSync` (flex/relay.ts). Recorded, never used to route. */
  relay: FlexRelay;
```

(`import type { FlexRelay } from "./relay";`). Dans `record` :

```ts
    lastFlexSyncStatus:
      outcome.status === "ok" ? { at, ok, relay: deps.relay } : { at, ok, code: outcome.code, relay: deps.relay },
```

Compléter le commentaire d'en-tête du calendrier : « The local agent has no rate limit of its own; the same schedule keeps it inside IB's. »

- [x] **Step 5: Vérifier le succès**

Run: `pnpm --filter web exec vitest run src/flex && pnpm --filter web typecheck`
Expected: `proxy.test.ts` et `sync.test.ts` passent ; `useFlexAutoSync.ts` ne compile plus (`sendRequest` attend deux arguments, `relay` manque). Pour garder la branche verte jusqu'à la tâche 5, lier le hook au serveur, comportement actuel, dans l'appel à `syncAccount` :

```ts
      await syncAccount(
        {
          db: runDb,
          relay: "server",
          sendRequest: (input) => sendRequest("server", input),
          getStatement: (input) => getStatement("server", input),
          sleep,
          now: () => new Date(),
        },
        account,
      );
```

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: PASS.

- [x] **Step 6: Commit** (cocher les cases de la tâche 4)

```bash
git add apps/web/src/flex docs/plans/2026-09-16-relais-flex-agent.md
git commit -m "feat(web): le client Flex parle à l'agent ou au serveur, le relais est tracé"
```

---

### Task 5: `useFlexAutoSync` choisit le relais

**Files:**
- Modify: `apps/web/src/flex/useFlexAutoSync.ts`, `apps/web/src/flex/useFlexAutoSync.test.tsx`

**Interfaces:**
- Consumes: `pickFlexRelay`, `flexRelayMode` (tâche 3) ; `sendRequest(relay, input)`, `getStatement(relay, input)`, `FlexSyncDeps.relay` (tâche 4) ; `refreshPresence`, `useAgentPresence` (`@/agent/useAgentSync`).
- Produces: `useFlexAutoSync(accountId)` rend toujours `{ state: "running" | "idle"; run: () => Promise<void> }`.

- [x] **Step 1: Écrire les tests qui échouent**

Dans `useFlexAutoSync.test.tsx` :

1. Le mock de `./sync` exécute le vrai premier appel pour qu'on voie où il part :

```ts
vi.mock("./sync", () => ({
  syncAccount: vi.fn(async (deps: { sendRequest: (input: { token: string; queryId: string }) => Promise<unknown> }) => {
    await deps.sendRequest({ token: "tok", queryId: "123" });
    return { status: "ok", report: {} };
  }),
}));
```

2. `mockSession` devient `mockWorld({ loggedIn, agent })` :

```ts
/** Session `authenticated`/`anonymous`, agent present or absent; every Flex call answers `<x/>`. */
function mockWorld({ loggedIn, agent }: { loggedIn: boolean; agent: boolean }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/auth/session")) {
      return loggedIn
        ? new Response(JSON.stringify({ data: { user: { id: 7, email: "a@example.com" } } }), { status: 200 })
        : new Response("{}", { status: 401 });
    }
    if (url === `${AGENT_URL}/health`) {
      if (!agent) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ version: "0.1.0" }), { status: 200 });
    }
    return new Response("<x/>", { status: 200 });
  });
}

function flexCalls(spy: ReturnType<typeof mockWorld>): string[] {
  return spy.mock.calls
    .map(([input]) => String(input instanceof Request ? input.url : input))
    .filter((url) => url.includes("/flex/"));
}
```

`beforeEach` ajoute `resetAgentState();` (import depuis `@/agent/useAgentSync`).

3. Les tests existants gardent leur intention avec le nouveau monde : ceux qui appelaient `mockSession(true)` passent à `mockWorld({ loggedIn: true, agent: false })` **et** semer `flexRelay: "agent-and-server"` ; le test « does not sync when nobody is logged in, however stale it is » devient « does not sync in agent-and-server mode when nobody is logged in and the agent is absent » (`mockWorld({ loggedIn: false, agent: false })`, `flexRelay: "agent-and-server"`) ; « run() syncs whatever the staleness, once logged in » idem avec `agent-and-server`.

4. Nouveaux tests :

```ts
  it("relays through the agent with no session at all, in the default mode, and never calls the server", async () => {
    await seed({ lastFlexSyncAt: undefined });
    const spy = mockWorld({ loggedIn: false, agent: true });
    renderProbe();
    await waitFor(() => expect(syncAccount).toHaveBeenCalledTimes(1));
    expect(vi.mocked(syncAccount).mock.calls[0]?.[0].relay).toBe("agent");
    await waitFor(() => expect(flexCalls(spy)).toEqual([`${AGENT_URL}/flex/send-request`]));
  });

  it("does not sync in the default mode when the agent is absent, even logged in, and records nothing", async () => {
    await seed({ lastFlexSyncAt: undefined });
    const spy = mockWorld({ loggedIn: true, agent: false });
    renderProbe();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(syncAccount).not.toHaveBeenCalled();
    expect(flexCalls(spy)).toEqual([]);
    expect((await db.accounts.get("beta"))?.lastFlexSyncStatus).toBeUndefined();
  });

  it("falls back on the server in agent-and-server mode when the agent is absent and a session is open", async () => {
    await seed({ lastFlexSyncAt: undefined, flexRelay: "agent-and-server" });
    const spy = mockWorld({ loggedIn: true, agent: false });
    renderProbe();
    await waitFor(() => expect(syncAccount).toHaveBeenCalledTimes(1));
    expect(vi.mocked(syncAccount).mock.calls[0]?.[0].relay).toBe("server");
    await waitFor(() => expect(flexCalls(spy)).toEqual([`${window.location.origin}/api/ib/flex/send-request`]));
  });

  it("prefers the agent in agent-and-server mode, session or not", async () => {
    await seed({ lastFlexSyncAt: undefined, flexRelay: "agent-and-server" });
    const spy = mockWorld({ loggedIn: true, agent: true });
    renderProbe();
    await waitFor(() => expect(syncAccount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(flexCalls(spy)).toEqual([`${AGENT_URL}/flex/send-request`]));
  });

  it("syncs once the agent shows up after the tab opened", async () => {
    await seed({ lastFlexSyncAt: undefined });
    let agentUp = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === `${AGENT_URL}/health`) {
        if (!agentUp) throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify({ version: "0.1.0" }), { status: 200 });
      }
      if (url.includes("/auth/session")) return new Response("{}", { status: 401 });
      return new Response("<x/>", { status: 200 });
    });
    renderProbe();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(syncAccount).not.toHaveBeenCalled();

    agentUp = true;
    await act(async () => {
      await refreshPresence(); // what useAgentPolling or the Sources page does
    });
    await waitFor(() => expect(syncAccount).toHaveBeenCalledTimes(1));
  });

  it("does not sync a fresh account even with the agent present", async () => {
    await seed({ lastFlexSyncAt: new Date(NOW - 60_000).toISOString() });
    mockWorld({ loggedIn: false, agent: true });
    renderProbe();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(syncAccount).not.toHaveBeenCalled();
  });
```

(imports : `AGENT_URL` depuis `@/agent/client`, `refreshPresence`, `resetAgentState` depuis `@/agent/useAgentSync`).

- [x] **Step 2: Vérifier l'échec**

Run: `pnpm --filter web exec vitest run src/flex/useFlexAutoSync.test.tsx`
Expected: FAIL — les tests agent ne synchronisent pas (le lien de la tâche 4 est `"server"` et exige une session).

- [x] **Step 3: Implémenter**

Dans `useFlexAutoSync.ts` :

```ts
import { useSession } from "@/api/session";
import { refreshPresence, useAgentPresence } from "@/agent/useAgentSync";
import { useDb } from "@/db/DbProvider";
import { getStatement, sendRequest } from "./proxy";
import { flexRelayMode, pickFlexRelay } from "./relay";
import { isFlexSyncStale } from "./stale";
import { syncAccount } from "./sync";
```

Dans le hook, après `dbRef` :

```ts
  const agentStatus = useAgentPresence().status;
  // Read at run time through a ref, like `db`: the session settling must re-evaluate the
  // auto-trigger (it is an effect dependency below), never change `run`'s identity.
  const sessionRef = useRef(session.status);
  useEffect(() => {
    sessionRef.current = session.status;
  }, [session.status]);
```

Le corps du `try` de `run` devient :

```ts
      const runDb = dbRef.current;
      const account = await runDb.accounts.get(accountId);
      if (!account?.flexToken || !account.flexQueryId) return;
      // A fresh ping on every sync: agent first, and the server only if the account allows it.
      const presence = await refreshPresence();
      const choice = pickFlexRelay(flexRelayMode(account), presence.status === "present", sessionRef.current);
      // No relay is not a failure: nothing is recorded, the Sources page explains why.
      if (choice.relay === null) return;
      const via = choice.relay;
      await syncAccount(
        {
          db: runDb,
          relay: via,
          sendRequest: (input) => sendRequest(via, input),
          getStatement: (input) => getStatement(via, input),
          sleep,
          now: () => new Date(),
        },
        account,
      );
```

L'effet automatique :

```ts
  useEffect(() => {
    // Never without credentials, never when fresh. No session required any more: the agent
    // relays without one, and `run` decides whether any relay is available.
    let cancelled = false;
    void (async () => {
      const account = await dbRef.current.accounts.get(accountId);
      if (cancelled || !account?.flexToken || !account.flexQueryId) return;
      if (!isFlexSyncStale(account.lastFlexSyncAt, Date.now())) return;
      await run();
    })();
    return () => {
      cancelled = true;
    };
    // `db` deliberately excluded: see the `dbRef` comment above. Entering an account, the
    // session settling, or the agent appearing or vanishing re-evaluates whether to auto-sync.
  }, [accountId, run, session.status, agentStatus]);
```

Mettre à jour le commentaire de `sessionRef` si besoin, et vérifier que `session.status` reste bien lu par `sessionRef` au moment du `run` (l'effet qui écrit la ref s'exécute avant l'effet automatique, ils sont déclarés dans cet ordre).

- [x] **Step 4: Vérifier le succès**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: PASS. Si un test d'une autre page casse parce que le déclenchement automatique sonde désormais l'agent sans session (ping `/health` non intercepté), le corriger dans ce test en ajoutant `resetAgentState()` au `beforeEach` et en interceptant `/health` — jamais en moquant `useFlexAutoSync`.

- [x] **Step 5: Commit** (cocher les cases de la tâche 5)

```bash
git add apps/web/src docs/plans/2026-09-16-relais-flex-agent.md
git commit -m "feat(web): la synchro Flex passe par l'agent d'abord, le serveur seulement si le compte l'autorise"
```

---

### Task 6: Le choix du relais sur la carte Flex Query

**Files:**
- Create: `packages/ui/src/components/ui/radio-group.tsx`
- Modify: `apps/web/src/pages/SourcesPage.tsx`, `apps/web/src/pages/SourcesPage.test.tsx`, `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`

**Interfaces:**
- Consumes: `setFlexRelay`, `flexRelayMode`, `FlexRelayMode` (tâche 3).
- Produces: `import { RadioGroup, RadioGroupItem } from "@ib/ui/radio-group"` ; clés i18n `sources.flexRelay.{legend,agent,agentHint,agentAndServer,agentAndServerHint}`.

- [x] **Step 1: Ajouter le composant shadcn**

Run (depuis `packages/ui`) : `pnpm dlx shadcn@latest add radio-group`
puis : `sed -i 's#from "@/lib/utils"#from "../../lib/utils"#; s#from "@/hooks/use-mobile"#from "../../hooks/use-mobile"#; s#from "@/components/ui/\([a-z-]*\)"#from "./\1"#' src/components/ui/radio-group.tsx`
Expected: `radio-group.tsx` importe `@base-ui/react/radio-group` et `@base-ui/react/radio`, aucun import `@/`. Lire le fichier généré pour noter le type exact de `onValueChange` (base-ui : `(value: unknown, eventDetails) => void`). `pnpm --filter @ib/ui typecheck` passe.

- [x] **Step 2: Écrire les tests qui échouent**

Dans `SourcesPage.test.tsx`, bloc `describe("SourcesPage: positions", …)` qui porte les tests du formulaire Flex (ou un nouveau `describe("Flex relay choice", …)`) :

```ts
describe("Flex relay choice", () => {
  it("selects agent only on an account that never chose, and explains both options", async () => {
    renderSources();
    const card = await screen.findByTestId("flex-query-card");
    expect(within(card).getByRole("radio", { name: "Agent local seulement" })).toBeChecked();
    expect(within(card).getByRole("radio", { name: "Agent local et serveur" })).not.toBeChecked();
    expect(within(card).getByText(/Rien ne passe par le serveur\./)).toBeInTheDocument();
    expect(within(card).getByText(/sans être journalisés ni conservés/)).toBeInTheDocument();
  });

  it("saves the choice the moment it changes, without the credentials button", async () => {
    renderSources();
    const card = await screen.findByTestId("flex-query-card");
    await userEvent.setup().click(within(card).getByRole("radio", { name: "Agent local et serveur" }));
    await waitFor(async () => expect((await db.accounts.get("test"))?.flexRelay).toBe("agent-and-server"));
    expect(within(card).getByRole("radio", { name: "Agent local et serveur" })).toBeChecked();
    expect((await db.accounts.get("test"))?.flexToken).toBeUndefined();
  });

  it("follows the account of the route", async () => {
    await db.accounts.update("test", { flexRelay: "agent-and-server" });
    await db.accounts.add({ id: "other", label: "Other", ibAccountId: "U0000002", createdAt: "", warnedDroppedKinds: [] });
    renderSources("other");
    const card = await screen.findByTestId("flex-query-card");
    await screen.findByText("U0000002");
    expect(within(card).getByRole("radio", { name: "Agent local seulement" })).toBeChecked();
  });
});
```

- [x] **Step 3: Vérifier l'échec**

Run: `pnpm --filter web exec vitest run src/pages/SourcesPage.test.tsx -t "Flex relay choice"`
Expected: FAIL, aucun `radio` trouvé.

- [x] **Step 4: Implémenter**

`fr.json`, sous `sources` :

```json
    "flexRelay": {
      "legend": "Qui relaie l'appel à Interactive Brokers",
      "agent": "Agent local seulement",
      "agentHint": "Le jeton et le relevé vont de ce navigateur à l'agent de cette machine, puis à Interactive Brokers. Rien ne passe par le serveur. Sans agent détecté, pas de synchronisation.",
      "agentAndServer": "Agent local et serveur",
      "agentAndServerHint": "L'agent relaie quand il est détecté. Sinon, et si vous êtes connecté, le serveur relaie l'appel : le jeton et le relevé le traversent sans être journalisés ni conservés. Permet de synchroniser depuis un autre appareil."
    },
```

et `sources.flexQuery.hint` : `"Le jeton et l'identifiant de requête de la Flex Query de ce compte, chez Interactive Brokers. Choisissez ci-dessous qui peut relayer l'appel."`

`en.json` :

```json
    "flexRelay": {
      "legend": "Who relays the call to Interactive Brokers",
      "agent": "Local agent only",
      "agentHint": "The token and the statement go from this browser to the agent on this machine, then to Interactive Brokers. Nothing goes through the server. Without a detected agent, no synchronization.",
      "agentAndServer": "Local agent and server",
      "agentAndServerHint": "The agent relays when it is detected. Otherwise, and if you are signed in, the server relays the call: the token and the statement pass through it without being logged or kept. Lets you synchronize from another device."
    },
```

et `sources.flexQuery.hint` : `"The token and query id of this account's Flex Query at Interactive Brokers. Choose below who may relay the call."`

`SourcesPage.tsx` : nouveau composant dans le fichier, rendu dans la carte Flex Query **après** le `</form>` (hors du formulaire, pour qu'aucun clic ne le soumette), dans le même `CardContent` enveloppé d'un `div className="flex flex-col gap-4"` :

```tsx
const FLEX_RELAY_OPTIONS: { value: FlexRelayMode; label: string; hint: string }[] = [
  { value: "agent", label: "sources.flexRelay.agent", hint: "sources.flexRelay.agentHint" },
  { value: "agent-and-server", label: "sources.flexRelay.agentAndServer", hint: "sources.flexRelay.agentAndServerHint" },
];

/**
 * Saved on change, on its own: it is not a credential, and the credentials form only ever
 * writes what is typed. Reads the stored account, so it follows the route's account by itself.
 */
function FlexRelayChoice({ account }: { account: AccountRecord }) {
  const { t } = useTranslation();
  const db = useDb();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{t("sources.flexRelay.legend")}</legend>
      <RadioGroup
        value={flexRelayMode(account)}
        onValueChange={(value) => {
          if (value === "agent" || value === "agent-and-server") void setFlexRelay(db, account.id, value);
        }}
        className="flex flex-col gap-3"
      >
        {FLEX_RELAY_OPTIONS.map((option) => {
          const id = `flex-relay-${option.value}`;
          return (
            <div key={option.value} className="flex items-start gap-2">
              <RadioGroupItem value={option.value} id={id} aria-describedby={`${id}-hint`} className="mt-0.5" />
              <div className="flex flex-col gap-0.5">
                <label htmlFor={id} className="text-sm">
                  {t(option.label)}
                </label>
                <p id={`${id}-hint`} className="text-xs text-muted-foreground">
                  {t(option.hint)}
                </p>
              </div>
            </div>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}
```

Imports : `RadioGroup, RadioGroupItem` depuis `@ib/ui/radio-group`, `setFlexRelay` depuis `@/db/accounts`, `flexRelayMode, type FlexRelayMode` depuis `@/flex/relay`. Si `RadioGroupItem` généré ne rend pas un élément associable par `htmlFor` (base-ui rend un `button role="radio"` : le nom accessible vient alors du `label htmlFor`, qui fonctionne sur un `button`), vérifier que `getByRole("radio", { name })` trouve l'option ; sinon passer `aria-labelledby` vers l'id du label.

- [x] **Step 5: Vérifier le succès**

Run: `pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter @ib/ui typecheck`
Expected: PASS.

- [x] **Step 6: Commit** (cocher les cases de la tâche 6)

```bash
git add packages/ui/src/components/ui/radio-group.tsx apps/web/src/pages/SourcesPage.tsx apps/web/src/pages/SourcesPage.test.tsx apps/web/src/i18n docs/plans/2026-09-16-relais-flex-agent.md
git commit -m "feat(web): choix du relais Flex sur la carte Flex Query"
```

---

### Task 7: La carte Synchronisation explique le relais

**Files:**
- Modify: `apps/web/src/pages/SourcesPage.tsx` (`SyncCard`), `apps/web/src/pages/SourcesPage.test.tsx`, `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`

**Interfaces:**
- Consumes: `pickFlexRelay`, `flexRelayMode` (tâche 3) ; `useAgentPresence`, `refreshPresence` ; `lastFlexSyncStatus.relay` (tâche 4).
- Produces: clés i18n `sync.agentUnknown`, `sync.needsAgent`, `sync.needsAgentOrAccount`, `sync.lastSyncVia`, `sync.lastFailedVia`, `sync.via.agent`, `sync.via.server`.

- [x] **Step 1: Écrire les tests qui échouent**

Dans `describe("SourcesPage: synchronization card", …)` :

- `authFetch` rend `{}` sur `/health`, donc l'agent est absent pour tous ces tests. Les tests existants « needs an account », « server unreachable », « credentials missing », « dash », « last successful sync », « raw code », « running » sèment désormais `flexRelay: "agent-and-server"` (dans un `db.accounts.update` avant le rendu), gardent leurs messages, et le test du code en échec attend `"Dernière tentative en échec (flex-timeout)."` sans relais (statut ancien, sans `relay`).
- Le message « needs an account » devient `"Démarrez l'agent local ou connectez-vous pour synchroniser ce compte."`.

Nouveaux tests :

```ts
  it("says the agent is needed in the default mode when it is absent, links to its installation, and disables the button", async () => {
    await db.accounts.update("test", { flexToken: "tok", flexQueryId: "123", lastFlexSyncAt: new Date().toISOString() });
    renderSourcesWithSession(authFetch(true));
    await screen.findByText("U0000001");
    expect(
      await screen.findByText("Agent non détecté : en mode agent local seulement, la synchronisation passe par lui."),
    ).toBeInTheDocument();
    const syncCard = screen.getByTestId("sync-card");
    expect(within(syncCard).getByRole("link", { name: "Installer l'agent" })).toHaveAttribute("href", "/help");
    expect(within(syncCard).getByRole("button", { name: "Synchroniser" })).toBeDisabled();
  });

  it("enables the button with the agent present and no session, and says the last sync went through it", async () => {
    await db.accounts.update("test", {
      flexToken: "tok",
      flexQueryId: "123",
      lastFlexSyncAt: "2026-09-16T08:00:00.000Z",
      lastFlexSyncStatus: { at: "2026-09-16T08:00:00.000Z", ok: true, relay: "agent" },
    });
    renderSourcesWithSession(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/health")) return jsonResponse({ version: "0.1.0" }, 200);
      if (url.includes("/auth/session")) return jsonResponse({}, 401);
      return jsonResponse({}, 200);
    });
    await screen.findByText("U0000001");
    expect(await screen.findByText(/^Dernière synchronisation réussie : .+, via l'agent local\.$/)).toBeInTheDocument();
    expect(within(screen.getByTestId("sync-card")).getByRole("button", { name: "Synchroniser" })).not.toBeDisabled();
  });

  it("names the relay of a failed attempt", async () => {
    await db.accounts.update("test", {
      flexToken: "tok",
      flexQueryId: "123",
      flexRelay: "agent-and-server",
      lastFlexSyncAt: new Date().toISOString(),
      lastFlexSyncStatus: { at: "2026-09-16T08:00:00.000Z", ok: false, code: "flex-timeout", relay: "server" },
    });
    renderSourcesWithSession(authFetch(true));
    await screen.findByText("U0000001");
    expect(await screen.findByText("Dernière tentative en échec (flex-timeout), via le serveur.")).toBeInTheDocument();
  });

  it("looks for the agent before saying anything else", async () => {
    await db.accounts.update("test", { flexToken: "tok", flexQueryId: "123" });
    let answerHealth: (() => void) | undefined;
    renderSourcesWithSession(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/health")) {
        return new Promise<Response>((resolve) => {
          answerHealth = () => resolve(jsonResponse({ version: "0.1.0" }, 200));
        });
      }
      return authFetch(true)(input);
    });
    await screen.findByText("U0000001");
    expect(await screen.findByText("Recherche de l'agent local…")).toBeInTheDocument();
    answerHealth?.();
    await waitFor(() => expect(screen.queryByText("Recherche de l'agent local…")).not.toBeInTheDocument());
  });
```

- [x] **Step 2: Vérifier l'échec**

Run: `pnpm --filter web exec vitest run src/pages/SourcesPage.test.tsx -t "synchronization card"`
Expected: FAIL — messages absents, pas de `data-testid="sync-card"`.

- [x] **Step 3: Implémenter**

`fr.json`, section `sync` : ajouter les clés suivantes, garder `lastSync` et `lastFailed` (statuts sans relais), et supprimer `needsAccount` à la fin de l'étape, une fois plus aucune référence :

```json
    "agentUnknown": "Recherche de l'agent local…",
    "needsAgent": "Agent non détecté : en mode agent local seulement, la synchronisation passe par lui.",
    "needsAgentOrAccount": "Démarrez l'agent local ou connectez-vous pour synchroniser ce compte.",
    "lastSyncVia": "Dernière synchronisation réussie : {{date}}, via {{relay}}.",
    "lastFailedVia": "Dernière tentative en échec ({{code}}), via {{relay}}.",
    "via": { "agent": "l'agent local", "server": "le serveur" },
```

`en.json` :

```json
    "agentUnknown": "Looking for the local agent…",
    "needsAgent": "Agent not detected: in local agent only mode, synchronization goes through it.",
    "needsAgentOrAccount": "Start the local agent or sign in to synchronize this account.",
    "lastSyncVia": "Last successful sync: {{date}}, via {{relay}}.",
    "lastFailedVia": "Last attempt failed ({{code}}), via {{relay}}.",
    "via": { "agent": "the local agent", "server": "the server" },
```

`SyncCard` :

```tsx
function SyncCard({ accountId, account }: { accountId: string; account: AccountRecord }) {
  const { t } = useTranslation();
  const session = useSession();
  const presence = useAgentPresence();
  const sync = useFlexAutoSync(accountId);
  const hasCredentials = Boolean(account.flexToken && account.flexQueryId);
  const status = account.lastFlexSyncStatus;
  const failed = status !== undefined && !status.ok;

  // Nobody may have probed yet (no TWS port, so no agent polling): this card needs to know.
  useEffect(() => {
    if (presence.status === "unknown") void refreshPresence();
  }, [presence.status]);

  const choice = pickFlexRelay(flexRelayMode(account), presence.status === "present", session.status);
  const via = status?.relay ? t(`sync.via.${status.relay}`) : null;

  let message: ReactNode;
  let showSignIn = false;
  let showInstall = false;
  let canRun = false;

  if (presence.status === "unknown") {
    message = t("sync.agentUnknown");
  } else if (choice.relay === null && choice.reason === "agent-absent") {
    message = t("sync.needsAgent");
    showInstall = true;
  } else if (choice.relay === null && choice.reason === "session-loading") {
    message = t("common.loading");
  } else if (choice.relay === null && choice.reason === "needs-agent-or-account") {
    message = t("sync.needsAgentOrAccount");
    showSignIn = true;
  } else if (choice.relay === null && choice.reason === "server-unreachable") {
    message = t("sync.serverUnreachable");
  } else if (!hasCredentials) {
    message = t("sync.needsCredentials");
  } else if (failed) {
    message = via ? t("sync.lastFailedVia", { code: status.code, relay: via }) : t("sync.lastFailed", { code: status.code });
    canRun = true;
  } else {
    const date = account.lastFlexSyncAt ? formatDateTime(account.lastFlexSyncAt) : "—";
    message = via ? t("sync.lastSyncVia", { date, relay: via }) : t("sync.lastSync", { date });
    canRun = true;
  }
```

Le JSX garde sa structure ; `<Card data-testid="sync-card">`, et à côté du lien de connexion :

```tsx
          {showInstall && (
            <Link to="/help" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              {t("agent.helpLink")}
            </Link>
          )}
```

Réécrire la docstring de `SyncCard` : huit états, tous des explications ; l'agent d'abord ; la session ne compte qu'en mode « agent local et serveur » sans agent (spec sous-projet 19 §5.2). Imports : `useAgentPresence, refreshPresence` depuis `@/agent/useAgentSync`, `pickFlexRelay, flexRelayMode` depuis `@/flex/relay`. Supprimer `sync.needsAccount` des deux fichiers i18n s'il n'est plus référencé (`grep -rn needsAccount apps/web`).

- [x] **Step 4: Vérifier le succès**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: PASS.

- [x] **Step 5: Commit** (cocher les cases de la tâche 7)

```bash
git add apps/web/src/pages/SourcesPage.tsx apps/web/src/pages/SourcesPage.test.tsx apps/web/src/i18n docs/plans/2026-09-16-relais-flex-agent.md
git commit -m "feat(web): la carte Synchronisation dit quel relais est disponible et lequel a servi"
```

---

### Task 8: Page Aide

**Files:**
- Modify: `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`, `apps/web/src/pages/HelpPage.test.tsx`

**Interfaces:** aucune nouvelle ; `help.what.text` et `help.port.text` changent.

- [x] **Step 1: Écrire le test qui échoue**

```ts
  it("says the agent also relays Flex Query, and that the port is only for live data", async () => {
    mockIndex(new Response("", { status: 404 }));
    render(<MemoryRouter><HelpPage /></MemoryRouter>);
    expect(await screen.findByText(/relaie aussi les appels Flex Query de ce site vers Interactive Brokers/)).toBeInTheDocument();
    expect(screen.getByText(/le jeton Flex ne passe jamais par le serveur/)).toBeInTheDocument();
    expect(screen.getByText(/pas pour relayer Flex Query/)).toBeInTheDocument();
  });
```

- [x] **Step 2: Vérifier l'échec**

Run: `pnpm --filter web exec vitest run src/pages/HelpPage.test.tsx`
Expected: FAIL, texte introuvable.

- [x] **Step 3: Implémenter**

`fr.json` :
- `help.what.text` : `"L'agent lit TWS sur votre machine et ne parle qu'à ce site et à Interactive Brokers. Il ne stocke rien : positions, cash et exécutions du jour ne quittent jamais votre ordinateur. Il relaie aussi les appels Flex Query de ce site vers Interactive Brokers, sans rien conserver : en mode « agent local seulement », le jeton Flex ne passe jamais par le serveur. Sans lui, l'application fonctionne avec les relevés, et avec Flex Query si vous autorisez le serveur à relayer."`
- `help.port.text` : `"Dans Sources de données, carte Agent local, saisissez le port TWS du compte. Il ne sert qu'aux données en direct, pas pour relayer Flex Query."`

`en.json` :
- `help.what.text` : `"The agent reads TWS on your machine and talks to this site and to Interactive Brokers only. It stores nothing: positions, cash and today's fills never leave your computer. It also relays this site's Flex Query calls to Interactive Brokers, keeping nothing: in \"local agent only\" mode, the Flex token never goes through the server. Without it, the application works with statements, and with Flex Query if you let the server relay."`
- `help.port.text` : `"In Data sources, Local agent card, enter the account's TWS port. It is only needed for live data, not to relay Flex Query."`

(La valeur anglaise actuelle de `help.what.text` finit par « Without it, the app works from Flex Query and statements, as of the previous close. » : garder « the app » plutôt que « the application » par cohérence. Lire `help.port.text` en anglais et reprendre son libellé de page exact au lieu de « Data sources » s'il diffère.)

- [x] **Step 4: Vérifier le succès**

Run: `pnpm --filter web test`
Expected: PASS.

- [x] **Step 5: Commit** (cocher les cases de la tâche 8)

```bash
git add apps/web/src/i18n apps/web/src/pages/HelpPage.test.tsx docs/plans/2026-09-16-relais-flex-agent.md
git commit -m "docs(web): la page Aide dit que l'agent relaie Flex"
```

---

### Task 9: Bout en bout

**Files:**
- Modify: `apps/web/e2e/sync.spec.ts`

**Interfaces:** aucune.

- [x] **Step 1: Adapter le scénario serveur**

Dans le test existant, juste après `credentialsSaved`, choisir le relais serveur :

```ts
  // The default relays through the local agent only (sous-projet 19): this scenario is the
  // server's proxy, so it opts in first. The agent is absent here — nothing listens on 8100.
  await page.getByRole("radio", { name: fr.sources.flexRelay.agentAndServer }).click();
  await expect(page.getByRole("radio", { name: fr.sources.flexRelay.agentAndServer })).toBeChecked();
```

et interdire tout appel à l'agent dans ce scénario, en tête de test :

```ts
  await page.route("http://127.0.0.1:8100/**", (route) => route.abort("connectionrefused"));
```

`neverSyncedMessage` reste `fr.sync.lastSync.replace("{{date}}", "—")` (aucun statut, donc aucun relais) et `lastSyncPrefix` reste le préfixe commun à `lastSync` et `lastSyncVia`. Ajouter à la fin des assertions de la synchro :

```ts
  await expect(page.getByText(/via le serveur\.$/)).toBeVisible();
```

- [x] **Step 2: Ajouter le scénario agent**

```ts
test("with the agent present, a sync goes through it and never reaches the server's proxy", async ({ page }) => {
  let serverCalls = 0;
  let getStatementCalls = 0;
  await page.route("**/api/ib/flex/**", (route) => {
    serverCalls += 1;
    return route.abort();
  });
  await page.route("http://127.0.0.1:8100/health", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ version: "0.1.0" }), headers: { "access-control-allow-origin": "*" } }),
  );
  await page.route("http://127.0.0.1:8100/flex/send-request", (route) =>
    route.fulfill({ contentType: "application/xml", body: SEND_REQUEST_SUCCESS, headers: { "access-control-allow-origin": "*" } }),
  );
  await page.route("http://127.0.0.1:8100/flex/get-statement", (route) => {
    getStatementCalls += 1;
    return route.fulfill({
      contentType: "application/xml",
      body: getStatementCalls === 1 ? GET_STATEMENT_NOT_READY : STATEMENT_XML,
      headers: { "access-control-allow-origin": "*" },
    });
  });

  // No sign-in at all: the agent needs no session.
  await page.goto("/accounts");
  await page.getByLabel(fr.accounts.label).fill("Agent relais");
  await page.getByLabel(fr.accounts.ibAccountId).fill(IB_ACCOUNT_ID);
  await page.getByRole("button", { name: fr.accounts.create }).click();
  await expect(page).toHaveURL(/\/accounts\/[^/]+\/sources$/);

  await page.getByLabel(fr.sources.flexToken).fill("fake-flex-token");
  await page.getByLabel(fr.sources.flexQueryId).fill("999999");
  await page.getByRole("button", { name: fr.sources.saveCredentials }).click();
  await expect(page.getByRole("radio", { name: fr.sources.flexRelay.agent })).toBeChecked();

  await page.getByRole("button", { name: fr.sync.run }).click();
  await expect(page.getByRole("button", { name: fr.sync.run })).toBeVisible({ timeout: 20_000 });
  expect(getStatementCalls).toBe(2);
  expect(serverCalls).toBe(0);
  await expect(page.getByText(/via l'agent local\.$/)).toBeVisible();
});
```

Note : `route.fulfill` ne passe pas par le réseau, le preflight n'a pas lieu ; si Chromium en exige un malgré tout pour le `POST` JSON, ajouter la gestion de `route.request().method() === "OPTIONS"` avec les en-têtes `access-control-allow-methods: POST` et `access-control-allow-headers: content-type`. Le compte créé ici l'est dans un contexte de navigateur neuf (Playwright isole chaque test) : aucune collision avec le compte du premier scénario. Vérifier que la page `/accounts` est accessible sans connexion (elle l'est, CLAUDE.md : aucune route protégée).

- [x] **Step 3: Lancer**

Run: `docker compose -f docker-compose.dev.yml up -d db`, puis `pnpm --filter web e2e -- sync.spec.ts` (le fichier `auth.spec.ts` doit tourner avant pour créer l'utilisateur : lancer `pnpm --filter web e2e` en entier si la base e2e est vide).
Expected: les deux scénarios passent.

- [x] **Step 4: Commit** (cocher les cases de la tâche 9)

```bash
git add apps/web/e2e/sync.spec.ts docs/plans/2026-09-16-relais-flex-agent.md
git commit -m "test(e2e): synchro Flex par le serveur sur choix, par l'agent sans session"
```

---

### Task 10: Documents, vérification complète, instance de relecture

**Files:**
- Modify: `docs/specs/2026-09-03-architecture-design.md`, `docs/specs/2026-09-06-agent-local-design.md`, `docs/specs/2026-09-16-relais-flex-agent-design.md`, `CLAUDE.md`, `docs/points-reportes.md`

- [x] **Step 1: Spec fondateur**

- §4, dans le schéma : la ligne de l'agent mentionne « + relais Flex » ; `api : Django mince` → `proxy Flex sans état, si le compte l'autorise`.
- §7.4 : ajouter en tête « **Note du 2026-09-16** : l'agent local relaie les mêmes deux appels (sous-projet 19, `2026-09-16-relais-flex-agent-design.md`). Ce proxy ne sert plus qu'aux comptes en mode « agent local et serveur », quand l'agent est absent. »
- §8 : ajouter à la note existante « ; `POST /flex/send-request` et `/flex/get-statement` relaient Flex (sous-projet 19) ».
- §10, ligne « Jeton et query id Flex » : « transitent par l'agent local, et par le proxy serveur en mode « agent local et serveur » quand l'agent est absent ; jamais journalisés ».
- §13 : ligne « L'agent fait toute la synchro Flex en un appel | La boucle d'attente existerait en Python et en TS, pour une requête HTTP de plus d'une minute (sous-projet 19) ».

- [x] **Step 2: Spec de l'agent**

Sous §3.3 et §3.6, une note « Amendement du 2026-09-16 (sous-projet 19) » : quatre endpoints ; preflight `GET, POST` et `content-type` ; `ACTING_PATHS` couvre `/snapshot` et les deux routes Flex ; `httpx` en dépendance de production, loggers tenus à `WARNING`.

- [x] **Step 3: Spec du sous-projet**

- Statut : « implémenté (date) ».
- §4.3 : `relay` vit dans `FlexSyncDeps`, pas en argument séparé de `syncAccount`.
- §4.4 : préciser qu'un agent démarré après l'ouverture est vu par la sonde de `useAgentPolling` (compte avec port TWS), par la carte Synchronisation au montage, ou par une synchro manuelle ; sans port TWS et hors de la page Sources, rien ne sonde : la synchro automatique attend la visite suivante.

- [x] **Step 4: `CLAUDE.md`**

- Règle « Le serveur ne voit jamais » : « sauf le jeton en transit par le proxy, en mode « agent local et serveur » quand l'agent est absent, jamais journalisé ».
- Règle « La connexion n'est jamais exigée » : « … ; elle ne l'est que pour appeler le proxy Flex. Une synchro relayée par l'agent n'en exige aucune. »
- Nouvelle règle après « L'agent local est optionnel » : « **L'agent relaie Flex, le serveur seulement si le compte l'autorise** : `AccountRecord.flexRelay` absent vaut `agent`, lu par `flexRelayMode` seul ; `pickFlexRelay` (`apps/web/src/flex/relay.ts`) choisit au début de chaque synchro, agent d'abord, et ne se replie jamais sur le serveur quand l'agent présent échoue. Pas de relais disponible n'est pas un échec : rien n'est écrit. Côté agent, le jeton voyage dans le corps, jamais dans l'URL, et `httpx`/`httpcore` restent à `WARNING`. »
- Tableau des sous-projets : ajouter les lignes manquantes jusqu'à `| 19 | L'agent local relaie Flex | fait (date) |` (vérifier dans `docs/specs/` le titre de 17 et 18 s'ils manquent).

- [x] **Step 5: `docs/points-reportes.md`**

Sous le sous-projet 19, ce que la revue aura laissé ; au minimum : « Sans port TWS, rien ne sonde l'agent hors de la page Sources : un agent démarré après l'ouverture de l'onglet n'est vu qu'à la visite suivante (spec §4.4). »

- [x] **Step 6: Vérification complète**

Run: `pnpm check && pnpm test:agent`
Expected: tout passe. Consigner la sortie finale dans le compte rendu.

- [x] **Step 7: Commit** (cocher les cases de la tâche 10 sauf la suivante)

```bash
git add docs CLAUDE.md
git commit -m "docs: sous-projet 19 livré, specs et règles à jour"
```

- [x] **Step 8: Instance de relecture**

Run: `pnpm dev:start` dans le worktree, puis `pnpm dev:status`.
Donner à Seb les deux URL (Vite et Django) et la procédure de validation manuelle du spec §6 : il doit mettre à jour son agent (`pnpm build:agent`, puis `uv tool install --force` de la roue servie) avant de tester. Ne pas merger : Seb décide après relecture ; `pnpm dev:stop` avant `git merge`.
