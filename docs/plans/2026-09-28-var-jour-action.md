# Var. jour action — plan d'implémentation (sous-projet 35)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** une colonne « Var. jour action » — la variation du jour du sous-jacent, cotée par l'agent local — en première colonne de tous les tableaux de positions et de la Suggestion de position.

**Architecture:** l'agent gagne `GET /quotes` (`reqMktData` en flux, données différées, patron de `collect_pnl`) ; `packages/ib-parsers` lit sa réponse (`parseAgentQuotes`) ; `apps/web` garde les variations dans un magasin en mémoire au niveau du module (jamais IndexedDB), rafraîchi par `useUnderlyingQuotes` monté dans `AccountDataProvider` à chaque passe de l'agent ; une file `exclusiveTws` empêche deux connexions TWS `clientId 0` simultanées. Les tableaux lisent le magasin par ticker, XSP via SPY (`chartProxyOf`).

**Tech Stack:** Python 3.14 / FastAPI / ib_async (agent, pytest + `FakeIB`), TypeScript / Vitest (`ib-parsers`), React 19 / Dexie / base-ui / i18next (`apps/web`, Vitest + `fake-indexeddb`).

**Spec:** `docs/specs/2026-09-28-var-jour-action-design.md`

## Global Constraints

- Worktree `.claude/worktrees/var-jour-action`, branche `var-jour-action` ; toutes les commandes s'y lancent.
- La cotation n'est **jamais** stockée : ni IndexedDB, ni `localStorage`, ni serveur. `apps/api` n'est pas touché.
- L'agent ne calcule rien : il rend `last` et `close` bruts ; la variation se calcule dans `parseAgentQuotes`.
- Une valeur absente reste `null`, jamais `0`, et s'affiche « — » (`formatDayChange(null)`).
- `dayChange`, `dailyPnl` et la colonne « Var. jour » ne changent ni de valeur ni de place.
- `underlyingDayChange` est **la première colonne** de `POSITION_COLUMNS`, de `WHEEL_SHARE_COLUMNS` et de la Suggestion de position ; toutes les autres gardent leur ordre.
- Tri signé, possible, **jamais actif par défaut** ; la Suggestion de position ne se trie pas et garde l'ordre de `positionSuggestions`.
- XSP est coté par SPY : `chartProxyOf` (`apps/web/src/lib/chartProxies.ts`) est la seule table de substituts.
- `QUOTES_MAX_SYMBOLS = 90` côté agent **et** côté navigateur (même valeur, écrite deux fois : un langage chacun).
- Agent sur `127.0.0.1` uniquement, `clientId 0`, `readonly=True` — comme `/snapshot` et `/bars`.
- Libellés : fr « Var. jour action », en « Stock day chg. » ; infobulle `quotes.proxy`.
- Ne jamais committer un identifiant de compte, un jeton, un montant réel ni la liste des tickers détenus (la sonde n'écrit que des agrégats).
- `pnpm check` une seule fois à la fin (tâche 9) ; pendant l'itération, les tests ciblés (`npx vitest run <motif>` depuis le paquet, `uv run --project apps/tws-agent pytest apps/tws-agent/tests/<fichier>`).
- Chaque tâche coche ses cases dans ce fichier, dans le même commit que son code.

## Review Focus

1. **Deux connexions TWS simultanées** (passe de snapshot + cotations, ou graphe ouvert) : la seconde doit attendre la première, jamais échouer en « client id already in use » — test dans la tâche 4.
2. **Un ticker que TWS ne cote pas** (inconnu, `.OLD`, sans données) : la ligne montre « — », les autres tickers du même appel gardent leur valeur — tests tâches 2 et 3.
3. **Plus de 90 sous-jacents** : découpage en lots séquentiels, aucun ticker perdu — test tâche 4.
4. **Réponse `/quotes` mal formée ou 503 après une passe réussie** : les valeurs déjà affichées restent — test tâche 4.
5. **Page rechargée, agent absent** : la colonne montre « — » partout, aucune erreur, aucun appel `/quotes` — test tâche 4.

---

### Task 0: Worktree

- [x] **Step 1:** depuis la racine du dépôt, sur `main` propre : `git worktree add .claude/worktrees/var-jour-action -b var-jour-action`
- [x] **Step 2:** `cd .claude/worktrees/var-jour-action && pnpm install --frozen-lockfile && uv sync --all-packages`
- [x] **Step 3:** `npx vitest run src/lib/positionColumns` depuis `apps/web` → PASS (base saine).

---

### Task 1: La sonde (script, lancé par l'utilisateur)

TWS ne tourne pas sur la machine de développement : le script est écrit ici et **lancé par Seb** sur son TWS. Les tâches 2 à 8 n'en dépendent pas — leurs constantes ont une valeur par défaut que la tâche 9 ajuste d'après le résultat.

**Files:**
- Create: `private/probe_quotes.py` (dossier ignoré par git : le script lit les positions réelles)

- [x] **Step 1: Écrire le script**

```python
"""Sonde du sous-projet 35 : que rend reqMktData sans abonnement temps réel ?

uv run --project apps/tws-agent python private/probe_quotes.py <port> [SYMBOLE ...]
Sans symboles : les sous-jacents du portefeuille plus SPY. N'imprime que des agrégats et, pour
SPY seulement, les valeurs — rien de ce qui sort n'identifie le portefeuille.
"""

import asyncio
import sys
from math import isnan
from time import monotonic

from ib_async import IB, Stock


def ok(v):
    return v is not None and not isnan(v) and 0 < v < 1e300


async def probe(port: int, symbols: list[str], data_type: int) -> None:
    ib = IB()
    await ib.connectAsync("127.0.0.1", port, clientId=0, timeout=5, readonly=True)
    try:
        if not symbols:
            symbols = sorted({p.contract.symbol for p in ib.portfolio()} | {"SPY"})
        ib.reqMarketDataType(data_type)
        start = monotonic()
        tickers = {s: ib.reqMktData(Stock(s, "SMART", "USD"), "", False, False) for s in symbols}
        filled_at: dict[str, float] = {}
        while monotonic() - start < 15 and len(filled_at) < len(tickers):
            for s, t in tickers.items():
                if s not in filled_at and ok(t.last) and ok(t.close):
                    filled_at[s] = monotonic() - start
            await asyncio.sleep(0.05)
        for t in tickers.values():
            ib.cancelMktData(t.contract)
        times = sorted(filled_at.values())
        spy = tickers.get("SPY")
        print(f"type={data_type} symbols={len(symbols)} filled={len(filled_at)}")
        if times:
            print(f"  first={times[0]:.2f}s median={times[len(times) // 2]:.2f}s last={times[-1]:.2f}s")
        if spy is not None:
            print(f"  SPY last={spy.last} close={spy.close} marketDataType={spy.marketDataType}")
        print(f"  last-only={sum(ok(t.last) and not ok(t.close) for t in tickers.values())}"
              f" close-only={sum(ok(t.close) and not ok(t.last) for t in tickers.values())}"
              f" none={sum(not ok(t.close) and not ok(t.last) for t in tickers.values())}")
    finally:
        ib.disconnect()


async def main() -> None:
    port = int(sys.argv[1])
    symbols = [s.upper() for s in sys.argv[2:]]
    for data_type in (3, 4):
        await probe(port, symbols, data_type)


asyncio.run(main())
```

- [x] **Step 2:** vérifier qu'il s'importe : `uv run --project apps/tws-agent python -c "import ast,sys; ast.parse(open('private/probe_quotes.py').read())"` → aucune sortie.
- [ ] **Step 3:** le contrôleur demande à Seb de lancer, **en séance puis après la clôture ou le week-end** : `! uv run --project apps/tws-agent python private/probe_quotes.py <port TWS>` et recopie la sortie. Rien n'est committé à ce stade (le script est dans `private/`) ; la tâche 9 reporte le verdict dans la spec §9.

---

### Task 2: L'agent — `GET /quotes`

**Files:**
- Modify: `apps/tws-agent/ib_tws_agent/main.py` (constantes en tête, `clean_quote`, `collect_quotes`, route dans `create_app`, docstring du module)
- Modify: `apps/tws-agent/tests/conftest.py` (`FakeTicker`, `FakeIB.reqMarketDataType/reqMktData/cancelMktData`)
- Create: `apps/tws-agent/tests/test_quotes.py`

**Interfaces:**
- Produces: `GET /quotes?port=<int>&symbols=<A,B,…>` → 200 `{"fetchedAt": str, "quotes": [{"symbol": str, "last": float|null, "close": float|null}]}` (un élément par symbole demandé, dédoublonné, majuscules, dans l'ordre de la requête) ; 422 `{"code": "bad-symbols"}` ; 503 `{"code": "tws-unreachable", "detail": …}`.
- Constantes : `QUOTES_TIMEOUT_S = 5`, `QUOTES_POLL_S = 0.05`, `QUOTES_MAX_SYMBOLS = 90`, `MARKET_DATA_TYPE = 4` (défaut ; la tâche 9 le fixe d'après la sonde).

- [x] **Step 1: Étendre `FakeIB`** dans `conftest.py` :

```python
@dataclass
class FakeTicker:
    """ib_async's Ticker: nan until TWS fills it in. Only the fields /quotes reads."""

    contract: Any = None
    last: float = nan
    close: float = nan
```

(ajouter `from typing import Any` aux imports.) Dans `FakeIB.__init__`, nouveaux paramètres `quotes=None` (symbole → `FakeTicker` déjà rempli) et `quotes_error: Exception | None = None`, et :

```python
        self._quotes = quotes if quotes is not None else {}
        self._quotes_error = quotes_error
        self.market_data_types: list[int] = []
        self.mkt_subscribed: list[Any] = []
        self.mkt_cancelled: list[Any] = []
```

Méthodes :

```python
    def reqMarketDataType(self, marketDataType):
        self.market_data_types.append(marketDataType)

    def reqMktData(self, contract, genericTickList="", snapshot=False, regulatorySnapshot=False, mktDataOptions=None):
        if self._quotes_error is not None:
            raise self._quotes_error
        self.mkt_subscribed.append(contract)
        ticker = self._quotes.get(contract.symbol, FakeTicker())
        ticker.contract = contract
        return ticker

    def cancelMktData(self, contract):
        self.mkt_cancelled.append(contract)
```

- [x] **Step 2: Écrire les tests** `apps/tws-agent/tests/test_quotes.py` :

```python
"""`/quotes`: last and close of each underlying, straight out of reqMktData."""

from __future__ import annotations

from math import nan

import pytest

from .conftest import CONFIG, ORIGIN, FakeIB, FakeTicker


@pytest.fixture(autouse=True)
def fast(monkeypatch):
    monkeypatch.setattr("ib_tws_agent.main.QUOTES_TIMEOUT_S", 0.05)


def get(client, query):
    return client.get(f"/quotes?port=7496&{query}", headers={"Origin": ORIGIN})


def test_one_quote_per_symbol_raw(make_client):
    ib = FakeIB(quotes={"AAPL": FakeTicker(last=231.4, close=228.9)})
    body = get(make_client(ib), "symbols=AAPL").json()
    assert body["quotes"] == [{"symbol": "AAPL", "last": 231.4, "close": 228.9}]
    assert isinstance(body["fetchedAt"], str)


def test_a_silent_symbol_comes_back_null_and_never_holds_the_others(make_client):
    ib = FakeIB(quotes={"AAPL": FakeTicker(last=231.4, close=228.9), "MSFT": FakeTicker(last=nan, close=410.0)})
    body = get(make_client(ib), "symbols=AAPL,MSFT,ZZZZ").json()
    assert body["quotes"] == [
        {"symbol": "AAPL", "last": 231.4, "close": 228.9},
        {"symbol": "MSFT", "last": None, "close": 410.0},
        {"symbol": "ZZZZ", "last": None, "close": None},
    ]


@pytest.mark.parametrize("raw", [nan, 1.7976931348623157e308, -1.0, 0.0])
def test_ib_no_value_markers_become_null(make_client, raw):
    ib = FakeIB(quotes={"AAPL": FakeTicker(last=raw, close=228.9)})
    assert get(make_client(ib), "symbols=AAPL").json()["quotes"][0]["last"] is None


def test_symbols_are_upper_cased_and_deduplicated_in_order(make_client):
    ib = FakeIB()
    body = get(make_client(ib), "symbols=spy,AAPL,SPY,%20aapl%20").json()
    assert [q["symbol"] for q in body["quotes"]] == ["SPY", "AAPL"]
    assert [c.symbol for c in ib.mkt_subscribed] == ["SPY", "AAPL"]


def test_asks_for_the_market_data_type_then_smart_usd_stocks(make_client):
    from ib_tws_agent.main import MARKET_DATA_TYPE

    ib = FakeIB()
    get(make_client(ib), "symbols=AAPL")
    assert ib.market_data_types == [MARKET_DATA_TYPE]
    contract = ib.mkt_subscribed[0]
    assert (contract.symbol, contract.secType, contract.exchange, contract.currency) == ("AAPL", "STK", "SMART", "USD")


def test_every_subscription_is_cancelled_and_tws_disconnected(make_client):
    ib = FakeIB(quotes={"AAPL": FakeTicker(last=1.0, close=1.0)})
    get(make_client(ib), "symbols=AAPL,MSFT")
    assert [c.symbol for c in ib.mkt_cancelled] == ["AAPL", "MSFT"]
    assert ib.disconnected


def test_a_failing_subscription_never_fails_the_answer(make_client):
    ib = FakeIB(quotes_error=RuntimeError("boom"))
    response = get(make_client(ib), "symbols=AAPL")
    assert response.status_code == 200
    assert response.json()["quotes"] == [{"symbol": "AAPL", "last": None, "close": None}]
    assert ib.disconnected


def test_more_than_the_ceiling_is_refused_before_connecting(make_client):
    from ib_tws_agent.main import QUOTES_MAX_SYMBOLS

    ib = FakeIB()
    symbols = ",".join(f"T{i}" for i in range(QUOTES_MAX_SYMBOLS + 1))
    response = get(make_client(ib), f"symbols={symbols}")
    assert response.status_code == 422
    assert response.json()["code"] == "bad-symbols"
    assert ib.connected_to is None


@pytest.mark.parametrize("symbols", ["", ",,", "A" * 25])
def test_empty_or_oversized_symbols_are_refused(make_client, symbols):
    response = get(make_client(FakeIB()), f"symbols={symbols}")
    assert response.status_code == 422


def test_tws_unreachable_is_a_503(make_client):
    ib = FakeIB(connect_error=ConnectionRefusedError("no TWS"))
    response = get(make_client(ib), "symbols=AAPL")
    assert response.status_code == 503
    assert response.json()["code"] == "tws-unreachable"


def test_the_query_is_read_only_client_zero(make_client):
    ib = FakeIB()
    get(make_client(ib), "symbols=AAPL")
    assert ib.connected_to[0] == "127.0.0.1" and ib.connected_to[2] == 0
    assert ib.readonly is True
```

Note : `symbols=` vide peut être refusé par la validation de FastAPI (`min_length=1`) en 422 sans `code` ; le test paramétré ne vérifie que le statut.

- [x] **Step 3:** `uv run --project apps/tws-agent pytest apps/tws-agent/tests/test_quotes.py -q` → FAIL (404 sur `/quotes`, `market_data_types` absent).

- [x] **Step 4: Implémenter** dans `main.py`. Constantes, après `BARS_WHAT_TO_SHOW` :

```python
# /quotes: how long it waits, in all, for every symbol's last and close; the ceiling of one call,
# under IB's ~100 simultaneous market data lines; and the market data type asked of TWS — 4,
# delayed frozen: the user has no real-time subscription, and frozen keeps the last session's
# values once the market is closed. TWS serves real time instead whenever it is subscribed.
# Fixed by the sub-project 35 probe (spec §9).
QUOTES_TIMEOUT_S = 5
QUOTES_POLL_S = 0.05
QUOTES_MAX_SYMBOLS = 90
QUOTES_SYMBOL_MAX_LENGTH = 24
MARKET_DATA_TYPE = 4
```

Fonctions, après `collect_pnl` :

```python
def clean_quote(value: float | None) -> float | None:
    """A price IB does not have is `None`: nan, DBL_MAX, and the -1 or 0 TWS sends for "no price"."""
    if value is None or isnan(value) or abs(value) >= UNSET_THRESHOLD or value <= 0:
        return None
    return value


async def collect_quotes(ib: IB, symbols: list[str]) -> dict[str, Any]:
    """Subscribe to each symbol, wait for its last and close, cancel, and hand the tickers back.

    Never raises, like collect_pnl: a symbol TWS stays silent about (unknown, no data) is simply
    absent from the result, and the answer still goes out.
    """
    tickers: dict[str, Any] = {}
    try:
        ib.reqMarketDataType(MARKET_DATA_TYPE)
        for symbol in symbols:
            tickers[symbol] = ib.reqMktData(Stock(symbol, "SMART", "USD"), "", False, False)
        deadline = monotonic() + QUOTES_TIMEOUT_S
        while monotonic() < deadline and any(
            clean_quote(t.last) is None or clean_quote(t.close) is None for t in tickers.values()
        ):
            await asyncio.sleep(QUOTES_POLL_S)
    except Exception:  # noqa: BLE001 - whatever ib_async raises, the answer is still due
        logger.warning("quotes unavailable; /quotes answers without them", exc_info=True)
    finally:
        for ticker in tickers.values():
            with suppress(Exception):
                ib.cancelMktData(ticker.contract)
    return tickers
```

Route, dans `create_app`, après `/bars` :

```python
    @app.get("/quotes")
    async def quotes(
        port: Annotated[int, Query(ge=1, le=65535)],
        symbols: Annotated[str, Query(min_length=1, max_length=4096)],
        ib_factory: Callable[[], IB] = Depends(get_ib_factory),
    ):
        """Last and close of each underlying, raw: the browser derives the day's move."""
        wanted = list(dict.fromkeys(s.strip().upper() for s in symbols.split(",") if s.strip()))
        if not wanted or len(wanted) > QUOTES_MAX_SYMBOLS or any(len(s) > QUOTES_SYMBOL_MAX_LENGTH for s in wanted):
            return JSONResponse(status_code=422, content={"code": "bad-symbols"})
        ib = ib_factory()
        try:
            await ib.connectAsync(IB_HOST, port, clientId=CLIENT_ID, timeout=CONNECT_TIMEOUT_S, readonly=True)
        except Exception as exc:  # noqa: BLE001 - whatever ib_async raises, the answer is the same
            ib.disconnect()
            return JSONResponse(
                status_code=503,
                content={"code": "tws-unreachable", "detail": f"{type(exc).__name__}: {exc}"},
            )
        try:
            tickers = await collect_quotes(ib, wanted)
            return {
                "fetchedAt": utc_now_iso(),
                "quotes": [
                    {
                        "symbol": symbol,
                        "last": clean_quote(getattr(tickers.get(symbol), "last", None)),
                        "close": clean_quote(getattr(tickers.get(symbol), "close", None)),
                    }
                    for symbol in wanted
                ],
            }
        finally:
            ib.disconnect()
```

Docstring du module : ajouter une phrase après celle du `pnl` — « `/quotes` is the same story: `last` and `close` pass through as the ib_async `Ticker` names them, and the browser derives the underlying's day move. »

- [x] **Step 5:** `uv run --project apps/tws-agent pytest apps/tws-agent -q` → PASS (toute la suite de l'agent).
- [x] **Step 6: Commit**

```bash
git add apps/tws-agent docs/plans/2026-09-28-var-jour-action.md
git commit -m "Agent : /quotes, dernier prix et clôture des sous-jacents, données différées"
```

---

### Task 3: Le parseur — `parseAgentQuotes`

**Files:**
- Modify: `packages/ib-parsers/src/agent.ts` (à la fin, après `parseAgentSnapshot`)
- Test: `packages/ib-parsers/src/agent.test.ts` (nouveau `describe`)

**Interfaces:**
- Produces: `export function parseAgentQuotes(payload: unknown): Map<string, number | null>` — ticker en majuscules → `(last − close) / close`, `null` si `last`/`close` manque ou si `close` vaut 0 ; lève `NormalizationError` sur un payload mal formé. Exporté par `@ib/ib-parsers` (déjà `export * from "./agent.ts"`).

- [x] **Step 1: Tests**

```ts
describe("parseAgentQuotes", () => {
  it("derives each underlying's day move from last and close", () => {
    const quotes = parseAgentQuotes({
      fetchedAt: "2026-09-28T14:00:00.000Z",
      quotes: [
        { symbol: "aapl", last: 110, close: 100 },
        { symbol: "MSFT", last: 95, close: 100 },
      ],
    });
    expect(quotes.get("AAPL")).toBeCloseTo(0.1, 10);
    expect(quotes.get("MSFT")).toBeCloseTo(-0.05, 10);
  });

  it("keeps a symbol TWS said nothing about, as null", () => {
    const quotes = parseAgentQuotes({
      fetchedAt: "2026-09-28T14:00:00.000Z",
      quotes: [
        { symbol: "A", last: null, close: 100 },
        { symbol: "B", last: 100, close: null },
        { symbol: "C", last: 100, close: 0 },
      ],
    });
    expect([...quotes.entries()]).toEqual([["A", null], ["B", null], ["C", null]]);
  });

  it.each([
    ["no quotes array", { fetchedAt: "x" }],
    ["a symbol that is not a string", { fetchedAt: "x", quotes: [{ symbol: 1, last: 1, close: 1 }] }],
    ["a price that is not a number", { fetchedAt: "x", quotes: [{ symbol: "A", last: "1", close: 1 }] }],
    ["not an object", null],
  ])("refuses %s", (_, payload) => {
    expect(() => parseAgentQuotes(payload)).toThrow(NormalizationError);
  });
});
```

(importer `parseAgentQuotes` à côté de `parseAgentSnapshot` ; `NormalizationError` est déjà importé par ce fichier de test ou s'importe de `./common.ts` — vérifier l'import existant.)

- [x] **Step 2:** `npx vitest run src/agent.test.ts` depuis `packages/ib-parsers` → FAIL (`parseAgentQuotes` n'existe pas).
- [x] **Step 3: Implémenter**

```ts
/**
 * The underlyings' day moves from `/quotes` (spec of sub-project 35, §3): `(last − close) / close`.
 * A distinct notion from a position's `dayChange`, which only `reqPnLSingle` gives: an option's last
 * trade follows its mark badly, a stock's last trade is its price. `null` when TWS gave either term
 * no value or the close is 0 — never 0 itself.
 */
export function parseAgentQuotes(payload: unknown): Map<string, number | null> {
  const root = obj(payload, "payload");
  const quotes = new Map<string, number | null>();
  list(root, "quotes", "payload").forEach((value, i) => {
    const path = `payload.quotes[${i}]`;
    const o = obj(value, path);
    const last = numOrNull(o, "last", path);
    const close = numOrNull(o, "close", path);
    quotes.set(str(o, "symbol", path).toUpperCase(), last === null || close === null || close === 0 ? null : (last - close) / close);
  });
  return quotes;
}
```

- [x] **Step 4:** `npx vitest run src/agent.test.ts` → PASS.
- [x] **Step 5: Commit** — `git add packages/ib-parsers docs/plans/2026-09-28-var-jour-action.md && git commit -m "Parseur : parseAgentQuotes, la variation du jour des sous-jacents"`

---

### Task 4: Le navigateur — client, file TWS, magasin, déclenchement

**Files:**
- Modify: `apps/web/src/agent/client.ts` (`exclusiveTws`, `fetchQuotes`, `QUOTES_MAX_SYMBOLS`)
- Create: `apps/web/src/agent/quotes.ts` (magasin et `refreshQuotes`)
- Create: `apps/web/src/agent/useUnderlyingQuotes.ts` (`quoteTickers`, `useUnderlyingQuotes`)
- Modify: `apps/web/src/db/AccountDataProvider.tsx` (monte `useUnderlyingQuotes`)
- Test: `apps/web/src/agent/client.test.ts`, `apps/web/src/agent/quotes.test.ts`, `apps/web/src/agent/useUnderlyingQuotes.test.tsx`

**Interfaces:**
- Consumes: `parseAgentQuotes` (tâche 3) ; `GET /quotes` (tâche 2).
- Produces:
  - `client.ts` : `export const QUOTES_MAX_SYMBOLS = 90;` `export function exclusiveTws<T>(call: () => Promise<T>): Promise<T>;` `export async function fetchQuotes(port: number, symbols: readonly string[]): Promise<AgentFetchResult>;` — `fetchSnapshot` et `fetchBars` passent désormais par `exclusiveTws`.
  - `quotes.ts` : `export type QuoteMap = ReadonlyMap<string, number | null>;` `export function quotedTicker(ticker: string): string;` `export function underlyingDayChangeOf(quotes: QuoteMap, ticker: string): number | null;` `export function useUnderlyingQuotesMap(): QuoteMap;` `export function mergeQuotes(entries: ReadonlyMap<string, number | null>): void;` `export function resetQuotes(): void;` `export async function refreshQuotes(port: number, tickers: readonly string[]): Promise<void>;`
  - `useUnderlyingQuotes.ts` : `export function quoteTickers(report: RiskReport | null, sectors: readonly SectorRecord[]): string[];` `export function useUnderlyingQuotes(accountId: string, report: RiskReport | null): void;`

- [x] **Step 1: Tests du client** (dans `client.test.ts`, à côté des tests existants, même style de `vi.spyOn(globalThis, "fetch")`) :

```ts
describe("exclusiveTws", () => {
  it("never lets two agent calls that open a TWS connection overlap", async () => {
    const order: string[] = [];
    let release!: () => void;
    const first = exclusiveTws(async () => {
      order.push("first:start");
      await new Promise<void>((resolve) => (release = resolve));
      order.push("first:end");
    });
    const second = exclusiveTws(async () => {
      order.push("second:start");
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("runs the next call after one that failed", async () => {
    await expect(exclusiveTws(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(exclusiveTws(async () => 42)).resolves.toBe(42);
  });
});

describe("fetchQuotes", () => {
  it("asks /quotes for the symbols, comma-separated and encoded", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ fetchedAt: "x", quotes: [] })));
    const result = await fetchQuotes(7496, ["AAPL", "BRK B"]);
    expect(String(spy.mock.calls[0][0])).toBe("http://127.0.0.1:8100/quotes?port=7496&symbols=AAPL%2CBRK%20B");
    expect(result).toEqual({ ok: true, payload: { fetchedAt: "x", quotes: [] } });
  });

  it("maps a 503 to tws-unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 503 }));
    expect(await fetchQuotes(7496, ["AAPL"])).toEqual({ ok: false, code: "tws-unreachable" });
  });
});
```

- [x] **Step 2:** `npx vitest run src/agent/client` depuis `apps/web` → FAIL.
- [x] **Step 3: Implémenter dans `client.ts`**

```ts
/** Same ceiling as the agent's QUOTES_MAX_SYMBOLS (apps/tws-agent), one per language. */
export const QUOTES_MAX_SYMBOLS = 90;

// Every agent call that opens a TWS connection goes through here, one after the other: the agent
// connects with clientId 0 each time, and TWS refuses a second connection on the same clientId
// while the first lives (spec of sub-project 35, §4). A call's own timeout only starts on its turn.
let twsQueue: Promise<unknown> = Promise.resolve();

export function exclusiveTws<T>(call: () => Promise<T>): Promise<T> {
  const turn = twsQueue.then(call, call);
  twsQueue = turn.catch(() => undefined);
  return turn;
}

export function fetchQuotes(port: number, symbols: readonly string[]): Promise<AgentFetchResult> {
  return exclusiveTws(() => getAgentJson(`/quotes?port=${port}&symbols=${encodeURIComponent(symbols.join(","))}`));
}
```

Factoriser le corps de `fetchSnapshot` en `async function getAgentJson(path: string): Promise<AgentFetchResult>` (le `fetch` avec `AGENT_FETCH_TIMEOUT_MS`, 503 → `tws-unreachable`, non-ok → `agent-error`, JSON invalide → `agent-error`) ; `fetchSnapshot(port)` devient `exclusiveTws(() => getAgentJson(\`/snapshot?port=${port}\`))`. Envelopper le corps actuel de `fetchBars` dans `exclusiveTws(async () => { … })` sans en changer la logique. Les tests existants de `fetchSnapshot`/`fetchBars` doivent passer tels quels.

- [x] **Step 4:** `npx vitest run src/agent` → PASS (tests du client et de `useAgentSync`/`sync` existants inclus).

- [x] **Step 5: Tests du magasin** (`quotes.test.ts`) :

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeQuotes, quotedTicker, refreshQuotes, resetQuotes, underlyingDayChangeOf } from "./quotes";
import { QUOTES_MAX_SYMBOLS } from "./client";

afterEach(() => {
  resetQuotes();
  vi.restoreAllMocks();
});

function answer(symbols: string[]) {
  return new Response(JSON.stringify({ fetchedAt: "x", quotes: symbols.map((symbol) => ({ symbol, last: 101, close: 100 })) }));
}

/** The symbols a /quotes URL asked for. */
function asked(url: unknown): string[] {
  return decodeURIComponent(new URL(String(url)).searchParams.get("symbols") ?? "").split(",");
}

describe("quotes", () => {
  it("quotes XSP as SPY, case-insensitively", () => {
    expect(quotedTicker("xsp")).toBe("SPY");
    expect(quotedTicker("aapl")).toBe("AAPL");
    const quotes = new Map<string, number | null>([["SPY", 0.01]]);
    expect(underlyingDayChangeOf(quotes, "XSP")).toBe(0.01);
    expect(underlyingDayChangeOf(quotes, "AAPL")).toBeNull();
  });

  it("splits more than the ceiling into sequential calls and loses no ticker", async () => {
    const tickers = Array.from({ length: QUOTES_MAX_SYMBOLS + 5 }, (_, i) => `T${i}`);
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => answer(asked(url)));
    await refreshQuotes(7496, tickers);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(asked(spy.mock.calls[0][0])).toHaveLength(QUOTES_MAX_SYMBOLS);
    expect(asked(spy.mock.calls[1][0])).toHaveLength(5);
  });

  it("keeps the values already shown when a call fails or answers garbage", async () => {
    mergeQuotes(new Map([["AAPL", 0.02]]));
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 503 }));
    await refreshQuotes(7496, ["AAPL"]);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ quotes: [{ symbol: 1 }] })));
    await refreshQuotes(7496, ["AAPL"]);
    // Read through the hook's own snapshot function: see the component test for the rendering.
    const { getQuotesSnapshot } = await import("./quotes");
    expect(getQuotesSnapshot().get("AAPL")).toBe(0.02);
  });

  it("does not call the agent for an empty list", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await refreshQuotes(7496, []);
    expect(spy).not.toHaveBeenCalled();
  });
});
```

(`getQuotesSnapshot` est exporté par `quotes.ts` pour `useSyncExternalStore` et pour ce test ; l'importer statiquement en tête plutôt que par `await import`.)

- [x] **Step 6: Implémenter `quotes.ts`**

```ts
import { useSyncExternalStore } from "react";
import { NormalizationError, parseAgentQuotes } from "@ib/ib-parsers";
import { chartProxyOf } from "@/lib/chartProxies";
import { fetchQuotes, QUOTES_MAX_SYMBOLS } from "./client";

/**
 * The underlyings' day moves, as the last /quotes pass left them (spec of sub-project 35, §4):
 * module state, shared by every account and every page of the tab, never written to IndexedDB nor
 * to localStorage — a reload empties it, and the column shows "—" until the next pass.
 */
export type QuoteMap = ReadonlyMap<string, number | null>;

let quotes: QuoteMap = new Map();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getQuotesSnapshot(): QuoteMap {
  return quotes;
}

/** The ticker the agent is asked for: XSP is quoted as SPY (chartProxies.ts). */
export function quotedTicker(ticker: string): string {
  return chartProxyOf(ticker) ?? ticker.toUpperCase();
}

export function underlyingDayChangeOf(table: QuoteMap, ticker: string): number | null {
  return table.get(quotedTicker(ticker)) ?? null;
}

export function useUnderlyingQuotesMap(): QuoteMap {
  return useSyncExternalStore(subscribe, getQuotesSnapshot);
}

export function mergeQuotes(entries: ReadonlyMap<string, number | null>): void {
  if (entries.size === 0) return;
  quotes = new Map([...quotes, ...entries]);
  for (const listener of listeners) listener();
}

/** Test seam: forget every quote between tests. */
export function resetQuotes(): void {
  quotes = new Map();
  for (const listener of listeners) listener();
}

/**
 * Asks the agent for `tickers`, in batches of QUOTES_MAX_SYMBOLS one after the other. A batch that
 * fails or answers garbage writes nothing: what is already shown stays.
 */
export async function refreshQuotes(port: number, tickers: readonly string[]): Promise<void> {
  const wanted = [...new Set(tickers.map(quotedTicker))];
  for (let start = 0; start < wanted.length; start += QUOTES_MAX_SYMBOLS) {
    const result = await fetchQuotes(port, wanted.slice(start, start + QUOTES_MAX_SYMBOLS));
    if (!result.ok) continue;
    try {
      mergeQuotes(parseAgentQuotes(result.payload));
    } catch (error) {
      if (!(error instanceof NormalizationError)) throw error;
    }
  }
}
```

(Vérifier que `NormalizationError` est exporté par `@ib/ib-parsers` : `grep -n NormalizationError packages/ib-parsers/src/index.ts packages/ib-parsers/src/common.ts` ; sinon l'importer d'où `agent.ts` l'importe.)

- [x] **Step 7:** `npx vitest run src/agent/quotes` → PASS.

- [x] **Step 8: Tests du déclenchement** (`useUnderlyingQuotes.test.tsx`), sur `fake-indexeddb` comme `useAgentSync.test.tsx` (en reprendre `ACCOUNT`, le nettoyage de la base et `resetAgentState`) :

```tsx
// quoteTickers, pure:
it("asks for every underlying of the report and every suggestion, XSP as SPY, once each", () => {
  const report = { positions: [{ symbol: "AAPL" }, { symbol: "AAPL" }, { symbol: "XSP" }] } as unknown as RiskReport;
  const sectors = [sectorRow({ ticker: "MSFT", category: "Tech", score: 8, status: "on" })];
  expect(quoteTickers(report, sectors)).toEqual(["AAPL", "MSFT", "SPY"]);
});

it("asks for nothing without a report nor a scored sector table", () => {
  expect(quoteTickers(null, [])).toEqual([]);
});
```

(`sectorRow` : fabrique locale d'un `SectorRecord` complet — lire son type dans `apps/web/src/db/schema.ts` et donner des valeurs par défaut à tous ses champs. Si `positionSuggestions` écarte un ticker déjà détenu à plus de `MAX_SUGGESTION_TICKER_SHARE`, garder `MSFT` hors du rapport comme ci-dessus.)

Puis, rendu d'une sonde `function Probe() { useUnderlyingQuotes("beta", REPORT); return null; }` avec `REPORT = { positions: [{ symbol: "AAPL" }] }` et un `fetch` qui route `/health` (200 `{version}`), `/quotes` (compte les appels, rend AAPL `last 101 close 100`) :

```tsx
it("does not call /quotes while the agent is absent", async () => { /* presence absent via /health rejeté + refreshPresence() */ });
it("quotes once the agent is present, and again after each agent pass", async () => {
  // 1. db.accounts.put(ACCOUNT) (twsPort 7502, lastAgentSyncAt "2026-09-28T13:00:00.000Z")
  // 2. await refreshPresence(); render(<Probe />) → waitFor: 1 appel /quotes, getQuotesSnapshot().get("AAPL") ≈ 0.01
  // 3. db.accounts.update("beta", { lastAgentSyncAt: "2026-09-28T13:05:00.000Z" }) → waitFor: 2 appels
});
it("does not call /quotes for an account without a TWS port", async () => { /* ACCOUNT sans twsPort → 0 appel */ });
```

Écrire ces trois tests en entier sur ce patron ; `afterEach` : `resetQuotes()`, `resetAgentState()`, `vi.restoreAllMocks()`.

- [x] **Step 9: Implémenter `useUnderlyingQuotes.ts`**

```ts
import { useEffect, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { positionSuggestions, type RiskReport } from "@ib/coverage";
import { tickerOf } from "@ib/ledger";
import { useDb } from "@/db/DbProvider";
import { useSectors } from "@/db/hooks";
import type { SectorRecord } from "@/db/schema";
import { refreshQuotes, quotedTicker } from "./quotes";
import { useAgentPresence } from "./useAgentSync";

/** The underlyings of the account's positions and of its suggestions, as the agent is asked for them. */
export function quoteTickers(report: RiskReport | null, sectors: readonly SectorRecord[]): string[] {
  const tickers = new Set<string>();
  for (const position of report?.positions ?? []) tickers.add(quotedTicker(tickerOf(position.symbol)));
  for (const suggestion of positionSuggestions(sectors, report)) tickers.add(quotedTicker(suggestion.ticker));
  return [...tickers].sort();
}

/**
 * Mounted once, by AccountDataProvider (spec of sub-project 35, §4): quotes the account's
 * underlyings when the agent turns present, after every agent pass (`lastAgentSyncAt` only moves
 * on a success) and when the list of tickers changes. Nothing without an agent or a TWS port.
 */
export function useUnderlyingQuotes(accountId: string, report: RiskReport | null): void {
  const db = useDb();
  const account = useLiveQuery(() => db.accounts.get(accountId), [db, accountId]);
  const presence = useAgentPresence().status;
  const sectors = useSectors();
  const key = useMemo(() => quoteTickers(report, sectors ? [...sectors.values()] : []).join(","), [report, sectors]);
  const port = account?.twsPort;
  const syncedAt = account?.lastAgentSyncAt;

  useEffect(() => {
    if (presence !== "present" || port === undefined || key === "") return;
    void refreshQuotes(port, key.split(","));
  }, [presence, port, syncedAt, key]);
}
```

(Vérifier le type d'entrée de `positionSuggestions` : il prend `readonly SectorEntry[]` ; `SectorRecord` le satisfait déjà puisque `PositionSuggestionsCard` lui passe `[...sectors.values()]`. Si `eslint` signale `syncedAt` comme dépendance inutile, garder la dépendance et ajouter un commentaire d'une ligne : « a pass that moved `lastAgentSyncAt` re-quotes, on purpose ».)

- [x] **Step 10: Monter le hook** dans `AccountDataProvider` : `const { snapshot, report, sectorOf } = useRiskReport(accountId);` puis `useUnderlyingQuotes(accountId, report);` juste en dessous. Compléter la docstring : « and quotes the account's underlyings for the Var. jour action column (spec of sub-project 35). »
- [x] **Step 11:** `npx vitest run src/agent src/db` → PASS.
- [x] **Step 12: Commit** — `git add apps/web/src/agent apps/web/src/db/AccountDataProvider.tsx docs/plans/2026-09-28-var-jour-action.md && git commit -m "Web : cotations des sous-jacents en mémoire, une connexion TWS à la fois"`

---

### Task 5: La colonne dans les tableaux de positions

**Files:**
- Modify: `apps/web/src/lib/positionColumns.ts` (`POSITION_COLUMNS`, `WHEEL_SHARE_COLUMNS`, `positionColumnSpecs`, constantes de plancher)
- Modify: `apps/web/src/lib/strategyColumns.ts`, `apps/web/src/lib/condorColumns.ts`
- Modify: `apps/web/src/components/PositionRow.tsx` (`UnderlyingDayChangeCell`, `PositionRowValues.ticker`)
- Modify: `apps/web/src/components/PositionGroupCard.tsx`, `apps/web/src/components/CondorRows.tsx`, `apps/web/src/components/CashBalancesCard.tsx`, `apps/web/src/pages/StrategyPositionsPage.tsx`, et la page Positions qui appelle `positionColumnSpecs` (`grep -rn "positionColumnSpecs(" apps/web/src`)
- Modify: `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`
- Test: `apps/web/src/lib/positionColumns.test.ts`, tests des pages existants (`grep -rln "StrategyPositionsPage\|PositionsPage" apps/web/src --include=*.test.tsx`)

**Interfaces:**
- Consumes: `useUnderlyingQuotesMap`, `underlyingDayChangeOf`, `mergeQuotes`, `resetQuotes` (tâche 4).
- Produces:
  - `export const POSITION_TABLE_MIN_WIDTH = "75rem"` et `export const WHEEL_SHARE_TABLE_MIN_WIDTH = "68rem"` (provisoires ; la tâche 6 les fixe), qui remplacent les littéraux `"70rem"`/`"63rem"` de `PositionGroupCard`, `CashBalancesCard` et `StrategyPositionsPage`.
  - `export type UnderlyingOf = (ticker: string) => number | null;` dans `positionColumns.ts` ; `positionColumnSpecs(sectorOf, underlyingOf)`, `strategyColumnSpecs(sectorOf, strategy, underlyingOf)`, `wheelShareColumnSpecs(sectorOf, underlyingOf)`, `condorColumnSpecs(sectorOf, underlyingOf)`.
  - `export function UnderlyingDayChangeCell({ ticker }: { ticker: string })` dans `PositionRow.tsx`.

- [x] **Step 1: Largeurs provisoires.** `POSITION_COLUMNS` à 75rem, chaque colonne gardant au moins ses pixels d'avant (ancienne part × 70/75, arrondie au 0,25 % supérieur), la nouvelle colonne en tête :

```ts
export const POSITION_COLUMNS = [
  { key: "underlyingDayChange", width: "6.75%", numeric: true },
  { key: "position", width: "10%", numeric: false },
  { key: "type", width: "5.5%", numeric: false },
  { key: "sector", width: "7%", numeric: false },
  { key: "marketValue", width: "9.25%", numeric: true },
  { key: "quantity", width: "5.75%", numeric: true },
  { key: "avgPrice", width: "8.5%", numeric: true },
  { key: "lastPrice", width: "8.5%", numeric: true },
  { key: "dayChange", width: "6.5%", numeric: true },
  { key: "dailyPnl", width: "8.5%", numeric: true },
  { key: "unrealizedPnl", width: "8.5%", numeric: true },
  { key: "decision", width: "7.5%", numeric: false },
  { key: "coverage", width: "7.75%", numeric: false },
] as const satisfies readonly { key: string; width: string; numeric: boolean }[];
```

`WHEEL_SHARE_COLUMNS` à 68rem, même règle (ancienne part × 63/68) :

```ts
export const WHEEL_SHARE_COLUMNS = [
  { key: "underlyingDayChange", width: "7%", numeric: true },
  { key: "position", width: "6.75%", numeric: false },
  { key: "sector", width: "7.75%", numeric: false },
  { key: "quantity", width: "8.25%", numeric: true },
  { key: "averageAssignmentPrice", width: "8%", numeric: true },
  { key: "averageCallStrike", width: "8%", numeric: true },
  { key: "assignedTotal", width: "10.25%", numeric: true },
  { key: "lastPrice", width: "9.5%", numeric: true },
  { key: "dayChange", width: "7%", numeric: true },
  { key: "dailyPnl", width: "9.5%", numeric: true },
  { key: "unrealizedPnl", width: "9.5%", numeric: true },
  { key: "coverage", width: "8.5%", numeric: false },
] as const satisfies readonly { key: string; width: string; numeric: boolean }[];
```

Les deux somment à 100. Les commentaires de tête (« twelve columns », « eleven », « 70rem », « 63rem ») sont réécrits par la tâche 6 avec les mesures ; ici, remplacer seulement les nombres de colonnes (« thirteen », « twelve ») et ajouter une ligne : « `underlyingDayChange` leads every table (spec of sub-project 35, §5); widths re-measured by task 6 of its plan. »

- [x] **Step 2: Tests des colonnes** (`positionColumns.test.ts`) — adapter « declares the twelve shared columns in order, summing to 100 » en treize colonnes, `underlyingDayChange` en tête ; même test pour `WHEEL_SHARE_COLUMNS` (douze, en tête) s'il existe, l'ajouter sinon. Ajouter :

```ts
it("reads the underlying's day move as a percentage, null when unquoted", () => {
  const specs = byKey(positionColumnSpecs(() => null, (ticker) => (ticker === "XOM" ? 0.0215 : null)));
  expect(specs.underlyingDayChange.value(put)).toBeCloseTo(2.15, 10); // `put` : l'option XOM du fichier
  expect(specs.underlyingDayChange.sortable).toBe(true);
  expect(specs.underlyingDayChange.type).toBe("number");
});
```

(`byKey` / `put` : reprendre les aides déjà présentes dans ce fichier de test ; si elles n'existent pas sous ces noms, utiliser celles qui y sont.) Même vérification pour `strategyColumnSpecs`, `wheelShareColumnSpecs` et `condorColumnSpecs` dans leurs tests respectifs (`grep -rln "strategyColumnSpecs\|condorColumnSpecs" apps/web/src --include=*.test.ts`) : chaque spec a `underlyingDayChange` en tête et lit le ticker de la ligne (`line.contract.ticker`, `line.ticker`).

- [x] **Step 3:** `npx vitest run src/lib` → FAIL.
- [x] **Step 4: Specs.** Dans `positionColumns.ts` :

```ts
/** The underlying's day move of a ticker, as the quotes store has it (spec of sub-project 35). */
export type UnderlyingOf = (ticker: string) => number | null;

/** A fraction on the row, a percentage in a spec: a filter typed "> 5" has to mean +5 %. */
export const asPercent = (ratio: number | null) => (ratio === null ? null : ratio * 100);
```

`positionColumnSpecs(sectorOf, underlyingOf: UnderlyingOf)` commence par `{ key: "underlyingDayChange", type: "number", sortable: true, value: (position) => asPercent(underlyingOf(position.symbol)) }` ; ses `dayChange` passent par `asPercent`. Même première entrée dans `strategyColumnSpecs(sectorOf, strategy, underlyingOf)` (`line.contract.ticker`), `wheelShareColumnSpecs(sectorOf, underlyingOf)` (`line.ticker`), `condorColumnSpecs(sectorOf, underlyingOf)` (`line.contract.ticker`, triable : un condor a un sous-jacent). Mettre à jour les docstrings (« thirteen », « twelve »).

- [x] **Step 5:** `npx vitest run src/lib` → PASS.

- [x] **Step 6: La cellule.** Dans `PositionRow.tsx` :

```tsx
/**
 * The underlying's day move (spec of sub-project 35, §5), read from the quotes store: every row
 * of one ticker shows the same value. XSP is quoted as SPY, and says so.
 */
export function UnderlyingDayChangeCell({ ticker }: { ticker: string }) {
  const { t } = useTranslation();
  const value = underlyingDayChangeOf(useUnderlyingQuotesMap(), ticker);
  const proxy = chartProxyOf(ticker);
  const text = formatDayChange(value);
  return (
    <TableCell className={cn(NUMERIC, toneOf(value))}>
      {proxy && value !== null ? (
        <Tooltip>
          <TooltipTrigger render={<span>{text}</span>} />
          <TooltipContent>{t("quotes.proxy", { proxy, ticker: ticker.toUpperCase() })}</TooltipContent>
        </Tooltip>
      ) : (
        text
      )}
    </TableCell>
  );
}
```

`PositionRowValues` gagne `/** The underlying's ticker, which the first column is quoted on. */ ticker: string;` et `PositionRow` rend `<UnderlyingDayChangeCell ticker={values.ticker} />` **avant** la cellule Position.

- [x] **Step 7: Les appelants.**
  - `PositionGroupCard` : `ticker: position.symbol` ; `minWidth={POSITION_TABLE_MIN_WIDTH}`.
  - `StrategyPositionsPage` / `LinesBox` : `ticker: line.contract.ticker` ; `minWidth={POSITION_TABLE_MIN_WIDTH}` (deux endroits) et `WHEEL_SHARE_TABLE_MIN_WIDTH` (un endroit).
  - `WheelShareRow` : `<UnderlyingDayChangeCell ticker={line.ticker} />` en première cellule.
  - `CondorRows` : `<UnderlyingDayChangeCell ticker={line.contract.ticker} />` en première cellule de la ligne du condor ; `LegRow` reçoit `ticker` et la rend aussi en première cellule (le chevron reste dans la cellule Position).
  - `CashBalancesCard` : `minWidth={POSITION_TABLE_MIN_WIDTH}` ; sa boucle sur `POSITION_COLUMNS` rend déjà une cellule vide pour toute clé autre que Position et Valeur de marché — vérifier que `underlyingDayChange` y tombe.
  - Chaque appel de `positionColumnSpecs`, `strategyColumnSpecs`, `wheelShareColumnSpecs`, `condorColumnSpecs` : `const quotes = useUnderlyingQuotesMap();` puis `const underlyingOf = useCallback((ticker: string) => underlyingDayChangeOf(quotes, ticker), [quotes]);` passé en dernier argument, et ajouté aux dépendances du `useMemo` qui construit les specs.
  - `pnpm --filter web exec tsc --noEmit` (ou `npx tsc --noEmit -p .` depuis `apps/web`) → aucune erreur : le typage trouve tout appelant oublié.

- [x] **Step 8: Textes.** `fr.json` : `positions.columns.underlyingDayChange: "Var. jour action"`, `strategyPositions.columns.underlyingDayChange: "Var. jour action"`, clé de tête `"quotes": { "proxy": "Variation de {{proxy}} : Interactive Brokers ne cote pas {{ticker}}." }`. `en.json` : `"Stock day chg."` aux deux endroits, `"quotes": { "proxy": "{{proxy}} change: Interactive Brokers does not quote {{ticker}}." }`. (Le test de parité des clés fr/en, s'il existe, doit passer.)

- [x] **Step 9: Tests de rendu.** Dans le test existant de la page Positions de stratégie (ledger semé sur `fake-indexeddb`, jamais de hook moqué), avec `mergeQuotes(new Map([["<ticker d'une vente de put semée>", -0.0312]]))` avant le rendu et `resetQuotes()` en `afterEach` :

```tsx
it("shows the underlying's day move first, on a put sold on a ticker not held", async () => {
  // … rendu de la page Wheel du compte semé …
  const row = await screen.findByRole("row", { name: /<libellé du put semé>/ });
  const cells = within(row).getAllByRole("cell");
  expect(cells[0]).toHaveTextContent("-3.1%"); // format de formatDayChange : vérifier le nombre de décimales
});

it("shows — before any quote", async () => {
  // même rendu sans mergeQuotes : cells[0] a le texte "—"
});

it("never sorts on it by default", async () => {
  // l'en-tête "Var. jour action" n'a pas l'état trié (aria-sort absent ou "none"), comme les autres
});
```

Et un test XSP : semer (ou reprendre de la fixture de démo) une position XSP, `mergeQuotes(new Map([["SPY", 0.004]]))`, la première cellule de sa ligne affiche `+0.4%` — la valeur de SPY. Un test de tri : deux tickers cotés `+2 %` et `-3 %`, clic sur l'en-tête → la ligne à `-3 %` passe en premier en ordre croissant.

Un test `CondorRows` (ou page Condors) : la ligne du condor et, dépliées, ses jambes montrent la variation du sous-jacent en première cellule.

- [x] **Step 10:** `npx vitest run src/components src/pages src/lib` depuis `apps/web` → PASS.
- [x] **Step 11: Commit** — `git add apps/web docs/plans/2026-09-28-var-jour-action.md && git commit -m "Tableaux de positions : Var. jour action en première colonne, triable, XSP via SPY"`

---

### Task 6: Mesurer les largeurs

Règle du dépôt : un réglage visuel se mesure, il ne s'itère pas sur des captures. Les arbitrages sont déjà tranchés : colonne en tête, contenu réaliste `-100.0%` comme `dayChange`, en-têtes repliables sur leurs mots, planchers relevés au besoin.

**Files:**
- Modify: `apps/web/src/lib/positionColumns.ts` (largeurs, planchers, commentaires de tête)
- Create (hors dépôt) : un script de mesure dans le dossier scratchpad de la session

- [x] **Step 1:** `pnpm dev:start` dans le worktree ; seeder avec le skill `run-frontend` (`--seed --agent`) et laisser l'instance tourner.
- [x] **Step 2:** écrire un script Playwright qui, sur la page Positions et sur la page Wheel du compte semé, mesure dans la police réelle : pour chaque en-tête de `POSITION_COLUMNS` et `WHEEL_SHARE_COLUMNS`, fr **et** en, la largeur du mot le plus large plus le chevron de tri ; pour chaque colonne numérique, la largeur de son contenu réaliste (les valeurs listées dans le commentaire de tête de `POSITION_COLUMNS` et de `WHEEL_SHARE_COLUMNS`, `-100.0%` pour `underlyingDayChange`) plus le remplissage de la cellule ; pour `position`, la largeur qui replie « AAPL Jan16'26 150 Call » sur exactement deux lignes (`Range.getClientRects().length`, recherche dichotomique). Le script sort, pour chaque plancher entier en rem à partir de 70 (resp. 63), les parts arrondies au 0,25 % supérieur et s'arrête au plus petit plancher où elles tiennent dans 100 % — `position` prenant le reste.
- [x] **Step 3:** reporter les parts et les deux planchers dans `positionColumns.ts` (`POSITION_TABLE_MIN_WIDTH`, `WHEEL_SHARE_TABLE_MIN_WIDTH`) et réécrire les deux commentaires de tête avec les nombres mesurés (colonnes, plancher, ce qui dépasse à 1280 px menu ouvert). Le défaut connu de `coverage` sur la Wheel (`docs/points-reportes.md`, sous-projet 23) reste hors périmètre : ne pas le corriger, ne pas l'aggraver.
- [x] **Step 4:** `npx vitest run src/lib/positionColumns` → PASS (sommes à 100).
- [x] **Step 5:** deux captures (`run-frontend`), Positions et Wheel à 1280 px, vérifiées : aucune cellule numérique ne déborde. Les joindre au rapport de la tâche, pas au dépôt.
- [x] **Step 6: Commit** — `git commit -am "Positions : largeurs remesurées avec Var. jour action"`

---

### Task 7: La Suggestion de position

**Files:**
- Modify: `apps/web/src/components/PositionSuggestionsCard.tsx`
- Modify: `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`
- Test: `apps/web/src/components/PositionSuggestionsCard.test.tsx`

**Interfaces:**
- Consumes: `UnderlyingDayChangeCell` (tâche 5), `mergeQuotes`/`resetQuotes` (tâche 4).

- [x] **Step 1: Test** (dans le fichier existant, même préparation que ses tests actuels, `resetQuotes()` en `afterEach`) :

```tsx
it("shows the underlying's day move first, and keeps the rank order", async () => {
  mergeQuotes(new Map([["<ticker classé 1er>", 0.01], ["<ticker classé 2e>", -0.05]]));
  // … rendu …
  const rows = (await screen.findAllByRole("row")).slice(1); // sans l'en-tête
  expect(within(rows[0]).getAllByRole("cell")[0]).toHaveTextContent("+1.0%");
  expect(within(rows[0]).getAllByRole("cell")[1]).toHaveTextContent("1"); // le rang reste en deuxième colonne
  expect(within(rows[1]).getAllByRole("cell")[0]).toHaveTextContent("-5.0%");
  expect(screen.getAllByRole("columnheader")[0]).toHaveTextContent("Var. jour action");
});
```

(Adapter le format exact de `formatDayChange` — lire `DAY_CHANGE_FORMATTER` dans `lib/format.ts`.)

- [x] **Step 2:** `npx vitest run src/components/PositionSuggestionsCard` → FAIL.
- [x] **Step 3: Implémenter.** `COLUMNS` gagne `{ key: "underlyingDayChange", numeric: true }` **en tête** ; la ligne rend `<UnderlyingDayChangeCell ticker={suggestion.ticker} />` en première cellule. L'ordre des lignes (`suggestions.map`) ne change pas, aucun tri n'est ajouté. `fr.json` `dashboard.suggestions.columns.underlyingDayChange: "Var. jour action"`, `en.json` `"Stock day chg."`.
- [x] **Step 4:** `npx vitest run src/components/PositionSuggestionsCard` → PASS.
- [x] **Step 5: Commit** — `git add apps/web docs/plans/2026-09-28-var-jour-action.md && git commit -m "Suggestion de position : Var. jour action en première colonne"`

---

### Task 8: Le driver `run-frontend --agent`

**Files:**
- Create: `apps/web/src/mocks/agent-quotes.json`
- Modify: `.claude/skills/run-frontend/driver.mjs` (route de l'agent), `.claude/skills/run-frontend/SKILL.md` (une ligne)

- [x] **Step 1:** `agent-quotes.json` : `{ "fetchedAt": "2026-09-28T14:00:00.000Z", "quotes": [ … ] }`, une entrée par sous-jacent de `apps/web/src/mocks/agent-snapshot.json` plus `SPY`, `last`/`close` inventés (mélange de hausses et de baisses, un `last: null` pour montrer « — »). Aucun montant réel.
- [x] **Step 2:** dans la route `http://127.0.0.1:${AGENT_PORT}/**` du driver, servir `agentQuotes` quand `path === "/quotes"`, `{version}` pour `/health`, le snapshot sinon.
- [x] **Step 3:** `SKILL.md` : « `--agent` sert aussi `/quotes` (`src/mocks/agent-quotes.json`) ».
- [x] **Step 4:** capture de la page Wheel avec `--seed --agent` : la première colonne est remplie. Vérifier la capture.
- [x] **Step 5: Commit** — `git add .claude/skills/run-frontend apps/web/src/mocks/agent-quotes.json docs/plans/2026-09-28-var-jour-action.md && git commit -m "run-frontend : l'agent simulé sert /quotes"`

---

### Task 9: Sonde, documentation, vérification finale

**Files:**
- Modify: `apps/tws-agent/ib_tws_agent/main.py` (constantes d'après la sonde, si elle les change)
- Modify: `docs/specs/2026-09-28-var-jour-action-design.md` (§9 : résultat de la sonde ; statut « livré »)
- Modify: `CLAUDE.md` (règle, registre), `docs/points-reportes.md`

- [x] **Step 1: Sonde.** Avec la sortie que Seb a recopiée (tâche 1) : fixer `MARKET_DATA_TYPE` (3 ou 4 : celui qui remplit `last` et `close` en séance **et** hors séance) et `QUOTES_TIMEOUT_S` (le « last » de la sonde arrondi au-dessus, `CONNECT_TIMEOUT_S + QUOTES_TIMEOUT_S` ≤ 10 s pour rester sous `AGENT_FETCH_TIMEOUT_MS`). Écrire le résultat dans la spec §9, en agrégats seulement. Si aucun type ne remplit `close` hors séance, ou si la variation hors séance est nulle ou décalée d'un jour : **s'arrêter et demander à Seb**. — fait en séance seulement (2026-09-28) : 43/43, 4,1 s, types 3 et 4 identiques, `QUOTES_TIMEOUT_S = 8`. La sonde a aussi révélé un défaut distinct dans `main.py` (`reqMktData` sur un contrat non qualifié), corrigé par la qualification avant souscription (§2). Le hors séance (point 2, `close`/`last` après la clôture et le week-end) reste à sonder — `docs/points-reportes.md`. Écart au plan : `QUOTES_TIMEOUT_S = 8` fait `CONNECT_TIMEOUT_S + QUOTES_TIMEOUT_S = 13 s`, au-delà des « ≤ 10 s » visés ici, mais toujours sous les 15 s d'`AGENT_FETCH_TIMEOUT_MS` du navigateur.
- [x] **Step 2: CLAUDE.md.** Ajouter, après la règle « Les valeurs du jour viennent de l'agent seul », une règle :

> - **La variation du jour du sous-jacent vient de `/quotes`, jamais stockée** (sous-projet 35) :
>   l'agent rend `last` et `close` bruts (`reqMktData`, `MARKET_DATA_TYPE` différé : pas
>   d'abonnement temps réel), `parseAgentQuotes` en déduit `(last − close) / close`. C'est une autre
>   notion que `dayChange` : le dernier échange d'une action est son prix, celui d'une option non.
>   Le magasin (`apps/web/src/agent/quotes.ts`) vit en mémoire, commun aux comptes, vidé au
>   rechargement ; `useUnderlyingQuotes`, monté par `AccountDataProvider`, le rafraîchit à chaque
>   passe de l'agent. « Var. jour action » est **la première colonne** de `POSITION_COLUMNS`, de
>   `WHEEL_SHARE_COLUMNS` et de la Suggestion de position, triable, jamais triée par défaut ; XSP
>   se cote par SPY (`chartProxyOf`). **Une connexion TWS à la fois** : `fetchSnapshot`,
>   `fetchBars` et `fetchQuotes` passent par `exclusiveTws` (`agent/client.ts`), parce que TWS
>   refuse deux connexions `clientId 0` simultanées.

Mettre à jour la règle « Les tableaux de la page Positions partagent leurs colonnes » : « treize colonnes », « douze colonnes » pour `WHEEL_SHARE_COLUMNS`. Mettre à jour la ligne de `run-frontend` (`--agent` sert aussi `/quotes`). Registre : `| 35 | Var. jour action : la variation du jour du sous-jacent | fait (<date>) |`.
- [x] **Step 3: points-reportes.md.** Section « Reporté par le sous-projet 35 » : ce que la revue aura jugé non bloquant ; au minimum, si la sonde l'a montré, le comportement en pré-ouverture (le `last` différé d'avant 9:30).
- [x] **Step 4:** `pnpm check` à la racine du worktree → vert. `pnpm test:agent` → vert.
- [x] **Step 5: Commit** — `git commit -am "Sous-projet 35 : sonde, CLAUDE.md, registre et statut de la spec"`
- [ ] **Step 6:** `pnpm dev:start` dans le worktree ; donner à Seb les deux URL, et lui rappeler `ib-tws-agent origin add http://127.0.0.1:<port Vite du worktree>` puis relancer l'agent pour voir la colonne avec son vrai TWS.
