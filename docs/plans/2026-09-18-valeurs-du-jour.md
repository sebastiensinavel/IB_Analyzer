# Sous-projet 23 — Valeurs du jour : P&L du jour et variation par position

> **Pour un agent d'exécution :** SOUS-SKILL OBLIGATOIRE — `superpowers:subagent-driven-development`
> (recommandé) ou `superpowers:executing-plans`, tâche par tâche. Les étapes sont des cases à
> cocher (`- [ ]`), **cochées dans le worktree au fur et à mesure, dans le commit de la tâche**.

**But :** chaque position montre le P&L du jour que TWS calcule et la variation du jour qui
l'explique, relayés par l'agent local, sans aucun abonnement de données de marché.

**Architecture :** l'agent souscrit `reqPnLSingle` pour chaque position sur la connexion déjà
ouverte par `/snapshot`, attend au plus cinq secondes, annule, et rend un objet `pnl` brut par
position. Le navigateur en tire `dailyPnl` tel quel et déduit `dayChange = dailyPnL / (value −
dailyPnL)`, annulé pour un contrat mouvementé le jour même. `Position` porte les deux valeurs,
les pages de stratégie en montrent la part de la stratégie, et deux colonnes de plus s'ajoutent
aux tableaux partagés.

**Pile :** Python 3.14, FastAPI, ib_async 2.1, pytest ; TypeScript, Vitest, React 19, Testing
Library, fake-indexeddb, Dexie, pnpm workspaces.

**Spec :** `docs/specs/2026-09-18-valeurs-du-jour-design.md` — à lire avec ce plan.

## Contraintes globales

- **Le serveur ne voit jamais ces valeurs.** `apps/api` n'est pas modifié. Une tâche qui semble
  réclamer un endpoint, un modèle ou une migration Django est un **signal d'arrêt** : ce sont des
  données de portefeuille, elles s'arrêtent au navigateur.
- **L'agent sort du brut.** `apps/tws-agent` ne convertit rien et ne calcule rien : il rend les
  attributs d'ib_async sous leurs propres noms. `dayChange` se déduit dans
  `packages/ib-parsers/src/agent.ts`, jamais côté Python.
- **Une valeur absente reste `null`**, jamais `0`, et s'affiche « — ». Côté Python : `nan` et la
  sentinelle `DBL_MAX` d'IB sortent en `None`.
- **L'agent est optionnel et sa version peut être en retard.** Un `pnl` absent du JSON donne deux
  `null`, jamais une `NormalizationError`. L'étape PnL ne fait **jamais** échouer `/snapshot`.
- **`packages/coverage` se teste à la main**, jamais contre un oracle Python.
- **Constantes** : `PNL_TIMEOUT_S` vit une seule fois, dans `apps/tws-agent/ib_tws_agent/main.py`.
  Aucune constante métier nouvelle côté TypeScript.
- **Un réglage visuel se mesure d'abord.** Les largeurs de colonnes se prennent en **une passe**,
  par le script de la tâche 6, l'instance de dev laissée en marche. Aucune itération sur des
  captures.
- **Travailler dans un worktree** `.claude/worktrees/valeurs-du-jour`
  (`superpowers:using-git-worktrees`), sur sa propre paire de ports (`tools/dev-env/ports.mjs`).
  `pnpm check` **une seule fois, à la fin** (tâche 8) ; pendant l'itération, des tests ciblés.
  `pnpm check` **ne lance pas Python** : `pnpm test:agent` se lance à part, à la tâche 2 et à la
  tâche 8.
- **Commit après chaque tâche**, la case du plan cochée dans le même commit. Attribution :
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `packages/ledger/src/types.ts` | **Modifié.** `Position` gagne `dailyPnl` et `dayChange`. |
| `packages/ledger/src/journals/replay.test.ts`, `reconcile.test.ts` | **Modifiés.** Littéraux `Position` complétés (le typage les nomme). |
| `packages/coverage/src/fixtures.ts` | **Modifié.** `option()` et `stock()` posent les deux champs. |
| `packages/ib-parsers/src/flex.ts`, `statement.ts` | **Modifiés.** Écrivent `null` pour les deux. |
| `packages/ib-parsers/src/agent.ts` | **Modifié.** `AgentPosition.pnl`, lecture et dérivation. |
| `apps/tws-agent/ib_tws_agent/main.py` | **Modifié.** `PNL_TIMEOUT_S`, `collect_pnl`, `clean_pnl`, `serialize_position(item, pnl)`. |
| `apps/tws-agent/tests/conftest.py` | **Modifié.** `FakePnLSingle`, et `FakeIB` gagne les trois membres PnL. |
| `apps/tws-agent/tests/test_snapshot.py` | **Modifié.** Les cas de la §9 de la spec. |
| `apps/tws-agent/pyproject.toml` | **Modifié.** Version mineure. |
| `apps/web/src/db/schema.ts` | **Modifié.** Version Dexie 9. |
| `packages/coverage/src/types.ts` | **Modifié.** `AnalyzedPosition` — plate, pas une extension de `Position` — gagne les deux champs. |
| `packages/coverage/src/classify.ts` | **Modifié.** Les recopie depuis la `Position`. |
| `packages/coverage/src/strategy.ts` | **Modifié.** `StrategyLine` et `WheelShareLine` portent la part du jour. |
| `apps/web/src/lib/format.ts` | **Modifié.** `formatDayChange`. |
| `apps/web/src/lib/positionColumns.ts` | **Modifié.** Douze colonnes, largeurs re-mesurées, deux specs de plus. |
| `apps/web/src/lib/strategyColumns.ts` | **Modifié.** Les mêmes deux specs sur `StrategyLine`, deux de plus sur `WheelShareLine`. |
| `apps/web/src/components/PositionRow.tsx` | **Modifié.** Deux cellules de plus. |
| `apps/web/src/pages/StrategyPositionsPage.tsx` | **Modifié.** `WheelShareRow` et les deux valeurs passées à `PositionRow`. |
| `apps/web/src/components/PositionGroupCard.tsx` | **Modifié.** Les deux valeurs passées à `PositionRow`. |
| `apps/web/src/i18n/fr.json`, `en.json` | **Modifiés.** Quatre clés de colonne, une phrase d'aide. |
| `apps/web/src/mocks/agent-snapshot.json` | **Modifié.** `pnl` sur les deux positions. |
| `apps/web/src/pages/HelpPage.tsx` | **Modifié.** Une phrase sur l'origine des deux colonnes. |
| `CLAUDE.md`, `docs/points-reportes.md` | **Modifiés** à la dernière tâche. |

Aucun fichier créé dans le dépôt. Le script de mesure de la tâche 6 vit dans le répertoire
scratchpad, pas dans le dépôt : il sert une fois.

**Ce que la carte Cash n'a pas à faire.** `CashBalancesCard` rend ses cellules en bouclant sur
`POSITION_COLUMNS` et pose un `<TableCell aria-hidden />` sur toute clé qu'elle ne connaît pas.
Les deux colonnes neuves y arrivent donc vides **sans une ligne de code** ; la tâche 6 le vérifie
par un test, elle ne le programme pas.

---

## Tâche 1 : `Position` porte les deux valeurs du jour, `null` partout

**Fichiers :**
- Modifier : `packages/ledger/src/types.ts:66-87`
- Modifier : `packages/coverage/src/fixtures.ts:16`, `:37`
- Modifier : `packages/ib-parsers/src/flex.ts:346`, `packages/ib-parsers/src/statement.ts:588`,
  `packages/ib-parsers/src/agent.ts:250`
- Modifier : `packages/ledger/src/journals/replay.test.ts`,
  `packages/ledger/src/journals/reconcile.test.ts`
- Test : `packages/ib-parsers/src/flex.test.ts`, `packages/ib-parsers/src/statement.test.ts`,
  `packages/ib-parsers/src/agent.test.ts`

**Interfaces :**
- Produit : `Position.dailyPnl: number | null` et `Position.dayChange: number | null`, lus par
  les tâches 3, 4, 5, 6 et 7.

- [ ] **Étape 1 : écrire le test qui échoue**

Dans `packages/ib-parsers/src/flex.test.ts`, ajouter un test à côté de ceux qui portent déjà sur
les positions Flex (chercher `marketPrice` pour trouver le bloc) :

```ts
it("gives a Flex position no day values: a file has no today", () => {
  const { positions } = parseFlexStatement(FLEX_WITH_POSITIONS, "alpha");

  expect(positions[0].dailyPnl).toBeNull();
  expect(positions[0].dayChange).toBeNull();
});
```

Reprendre le nom de la fixture et de la fonction du test voisin du fichier — ne pas inventer
`FLEX_WITH_POSITIONS` s'il porte un autre nom. Écrire le test jumeau dans `statement.test.ts`
(« gives a statement position no day values ») et dans `agent.test.ts` (« gives a position
without `pnl` no day values », sur une charge utile dont les positions n'ont pas de `pnl`).

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Run : `pnpm --filter @ib/ib-parsers test`
Attendu : ÉCHEC — `Property 'dailyPnl' does not exist on type 'Position'`.

- [ ] **Étape 3 : ajouter les deux champs au type**

Dans `packages/ledger/src/types.ts`, juste après `unrealizedPnl` :

```ts
  unrealizedPnl: number | null;
  /**
   * Today's P&L as IB computes it, whole position. Agent snapshots only: a Flex response and a
   * statement have no "today", and write `null`.
   */
  dailyPnl: number | null;
  /**
   * Today's move of the mark price IB derives `dailyPnl` from, as a fraction (0.0215 for +2.15 %).
   * Derived by the agent parser, never TWS's own "Change %", which follows the last trade.
   */
  dayChange: number | null;
  currency: string;
```

- [ ] **Étape 4 : écrire `null` dans les trois parseurs et les deux fixtures**

Dans `packages/ib-parsers/src/flex.ts` et `statement.ts`, à côté de `unrealizedPnl` :

```ts
    // A file has no "today": only an agent pass carries the day's values.
    dailyPnl: null,
    dayChange: null,
```

Dans `packages/ib-parsers/src/agent.ts`, même chose pour l'instant — la tâche 3 les remplira.
Dans `packages/coverage/src/fixtures.ts`, `option()` et `stock()` posent `dailyPnl: null` et
`dayChange: null` avant le `...overrides`.

- [ ] **Étape 5 : compléter les littéraux que le typage nomme**

Run : `pnpm -r typecheck`
Cinq erreurs attendues, toutes dans `packages/ledger` :
`src/journals/reconcile.test.ts(10,3)` et `src/journals/replay.test.ts` lignes 349, 356, 357, 422.
Ajouter `dailyPnl: null, dayChange: null` à chaque littéral nommé. Ne rien changer d'autre : ces
tests ne portent pas sur le jour.

- [ ] **Étape 6 : lancer les tests, vérifier qu'ils passent**

Run : `pnpm --filter @ib/ledger test && pnpm --filter @ib/coverage test && pnpm --filter @ib/ib-parsers test`
Attendu : tout passe. Les assertions `toEqual` des parseurs qui décrivent une position entière
échouent d'abord : y ajouter les deux champs à `null`, c'est la sortie neuve et juste.

- [ ] **Étape 7 : commit**

```bash
git add -A
git commit -m "Position porte dailyPnl et dayChange, null hors agent

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Tâche 2 : l'agent souscrit le P&L du jour de chaque position

**Fichiers :**
- Modifier : `apps/tws-agent/ib_tws_agent/main.py:41` (constantes), `:150-158`
  (`serialize_position`), `:213-222` (le corps de `/snapshot`)
- Modifier : `apps/tws-agent/tests/conftest.py`
- Modifier : `apps/tws-agent/pyproject.toml` (version mineure)
- Test : `apps/tws-agent/tests/test_snapshot.py`

**Interfaces :**
- Produit : chaque position de `GET /snapshot` porte `"pnl": {"dailyPnL": …, "value": …} | null`,
  lu par la tâche 3.

**Ce qu'il faut savoir sur ib_async.** `ib.reqPnLSingle(account, modelCode, conId)` rend
aussitôt un objet `PnLSingle` mutable (champs `dailyPnL`, `unrealizedPnL`, `realizedPnL`,
`position`, `value`, initialisés à `nan`) et souscrit ; TWS le remplit un peu plus tard, en
émettant `ib.pnlSingleEvent`. `ib.cancelPnLSingle(account, modelCode, conId)` annule. Le
`modelCode` est `""`. Mesuré sur un vrai TWS : première valeur entre 0,65 s et 2,32 s.

- [ ] **Étape 1 : outiller le double**

Dans `apps/tws-agent/tests/conftest.py`, après `FakePortfolioItem` :

Le double reproduit la mécanique réelle : `reqPnLSingle` rend un objet **que TWS remplit plus
tard**. Un contrat dont TWS ne dit rien est donc un objet resté à ses valeurs par défaut, et ces
valeurs sont `nan` — jamais `0.0`, qui serait un P&L du jour nul, une vraie valeur.

```python
from math import nan


@dataclass
class FakePnLSingle:
    """ib_async's PnLSingle: nan until TWS fills it in, which the real one does asynchronously."""

    account: str = "U1234567"
    modelCode: str = ""
    conId: int = 0
    dailyPnL: float = nan
    unrealizedPnL: float = nan
    realizedPnL: float = nan
    position: int = 0
    value: float = nan
```

Dans `FakeIB.__init__`, deux paramètres nommés de plus, `pnl=None` et `pnl_error=None`, puis :

```python
        # conId -> the FakePnLSingle TWS has already filled in. A conId absent from this mapping
        # is a contract TWS stays silent about: it gets a default, all-nan object.
        self._pnl = pnl if pnl is not None else {}
        self._pnl_error = pnl_error
        self.pnl_subscribed: list[tuple[str, str, int]] = []
        self.pnl_cancelled: list[tuple[str, str, int]] = []
```

et deux méthodes :

```python
    def reqPnLSingle(self, account, modelCode, conId):
        if self._pnl_error is not None:
            raise self._pnl_error
        self.pnl_subscribed.append((account, modelCode, conId))
        return self._pnl.get(conId, FakePnLSingle(account=account, conId=conId))

    def cancelPnLSingle(self, account, modelCode, conId):
        self.pnl_cancelled.append((account, modelCode, conId))
```

Le `FakeIB` final n'a que ces membres neufs : `_pnl`, `_pnl_error`, `pnl_subscribed`,
`pnl_cancelled`, `reqPnLSingle`, `cancelPnLSingle`. Pas de `pnlSingleEvent` : l'agent lit les
objets rendus, il ne s'abonne pas à l'événement — un objet muté en place se relit sans lui, et
un événement de moins est un point de défaillance de moins.

- [ ] **Étape 2 : écrire les tests qui échouent**

Dans `apps/tws-agent/tests/test_snapshot.py` :

```python
def test_each_position_carries_the_day_pnl_and_the_subscriptions_are_cancelled(make_client):
    fake_ib = FakeIB(
        portfolio=[FakePortfolioItem(contract=STOCK, position=100.0, marketPrice=172.1)],
        pnl={265598: FakePnLSingle(conId=265598, dailyPnL=-38.4, value=3369.6)},
    )

    positions = make_client(fake_ib).get("/snapshot", params={"port": 7502}, headers=HEADERS).json()["positions"]

    assert positions[0]["pnl"] == {"dailyPnL": -38.4, "value": 3369.6}
    assert fake_ib.pnl_subscribed == [("U1234567", "", 265598)]
    # Cancelled whatever happens: a subscription left open outlives the connection's usefulness.
    assert fake_ib.pnl_cancelled == [("U1234567", "", 265598)]


def test_a_position_tws_never_answers_for_gets_a_null_pnl_and_never_holds_the_others(make_client):
    fake_ib = FakeIB(
        portfolio=[
            FakePortfolioItem(contract=STOCK, position=100.0),
            FakePortfolioItem(contract=OPTION, position=-1.0),
        ],
        pnl={265598: FakePnLSingle(conId=265598, dailyPnL=-38.4, value=3369.6)},
    )

    positions = make_client(fake_ib).get("/snapshot", params={"port": 7502}, headers=HEADERS).json()["positions"]

    assert positions[0]["pnl"] == {"dailyPnL": -38.4, "value": 3369.6}
    assert positions[1]["pnl"] is None
    assert len(fake_ib.pnl_cancelled) == 2


def test_a_value_ib_does_not_have_is_null_never_zero(make_client):
    # IB sends DBL_MAX for "no value", and ib_async leaves nan in an object it has not filled.
    fake_ib = FakeIB(
        portfolio=[FakePortfolioItem(contract=STOCK, position=100.0)],
        pnl={265598: FakePnLSingle(conId=265598, dailyPnL=-38.4, value=1.7976931348623157e308)},
    )

    positions = make_client(fake_ib).get("/snapshot", params={"port": 7502}, headers=HEADERS).json()["positions"]

    assert positions[0]["pnl"] == {"dailyPnL": -38.4, "value": None}


def test_the_pnl_step_never_fails_the_snapshot(make_client):
    fake_ib = FakeIB(
        portfolio=[FakePortfolioItem(contract=STOCK, position=100.0, marketPrice=172.1)],
        pnl_error=RuntimeError("boom"),
    )

    response = make_client(fake_ib).get("/snapshot", params={"port": 7502}, headers=HEADERS)

    assert response.status_code == 200
    position = response.json()["positions"][0]
    assert position["pnl"] is None
    # The rest of the position is untouched: only the day's values are missing.
    assert position["marketPrice"] == 172.1
    assert fake_ib.disconnected is True
```

Compléter aussi `test_positions_are_serialized_raw_stock_and_option_alike` : les deux
dictionnaires attendus portent désormais `"pnl": None` (aucun `pnl` n'est fourni au double).

- [ ] **Étape 3 : lancer les tests, vérifier qu'ils échouent**

Run : `pnpm test:agent`
Attendu : ÉCHEC — `KeyError: 'pnl'` ou `AttributeError: 'FakeIB' object has no attribute 'reqPnLSingle'`.

- [ ] **Étape 4 : implémenter dans l'agent**

Dans `apps/tws-agent/ib_tws_agent/main.py`, près de `CONNECT_TIMEOUT_S` :

```python
# How long /snapshot waits, in all, for TWS's first per-position P&L message. Measured against a
# real TWS: the last of 78 positions answered in 2.32 s. CONNECT_TIMEOUT_S + PNL_TIMEOUT_S stays
# under the browser's AGENT_FETCH_TIMEOUT_MS (15 s).
PNL_TIMEOUT_S = 5
PNL_POLL_S = 0.05
# IB's "no value": DBL_MAX, and the nan ib_async leaves in an object TWS has not filled yet.
UNSET_THRESHOLD = 1e300
```

Une fonction pure, testable à l'œil, au-dessus de `serialize_position` :

```python
def clean_pnl(value: float | None) -> float | None:
    """A value IB does not have is `None`, never 0.0 — and `nan` is not JSON anyway."""
    if value is None or isnan(value) or abs(value) >= UNSET_THRESHOLD:
        return None
    return value
```

(`from math import isnan` en tête de fichier.)

`serialize_position` prend la souscription en second argument :

```python
def serialize_position(item: Any, pnl: Any | None) -> dict[str, Any]:
    daily = clean_pnl(getattr(pnl, "dailyPnL", None)) if pnl is not None else None
    value = clean_pnl(getattr(pnl, "value", None)) if pnl is not None else None
    return {
        **serialize_contract(item.contract),
        "position": item.position,
        "averageCost": item.averageCost,
        "marketPrice": item.marketPrice,
        "marketValue": item.marketValue,
        "unrealizedPNL": item.unrealizedPNL,
        # Both from the same PnLSingle message, so their ratio is coherent — `marketValue` above
        # comes from updatePortfolio, at another instant. `None` when TWS said nothing in time.
        "pnl": None if daily is None else {"dailyPnL": daily, "value": value},
    }
```

`daily is None` décide seul : sans P&L du jour, il n'y a rien à rendre. Un `value` absent laisse
`{"dailyPnL": …, "value": None}`, ce que la tâche 3 traduira en `dayChange: null`.

La collecte, juste au-dessus de `create_app` :

```python
async def collect_pnl(ib: IB, items: Iterable[Any]) -> dict[int, Any]:
    """Subscribe to each position's P&L, wait for TWS's first values, cancel, and hand them back.

    Never raises: the day's values are a bonus, and the snapshot is due whatever TWS does with
    them. A contract TWS stays silent about is simply absent from the result.
    """
    keys = [(item.account, item.contract.conId) for item in items]
    if not keys:
        return {}
    entries: dict[int, Any] = {}
    try:
        for account, con_id in keys:
            entries[con_id] = ib.reqPnLSingle(account, "", con_id)
        deadline = monotonic() + PNL_TIMEOUT_S
        while monotonic() < deadline and any(clean_pnl(e.dailyPnL) is None for e in entries.values()):
            await asyncio.sleep(PNL_POLL_S)
    except Exception:  # noqa: BLE001 - whatever ib_async raises, the snapshot is still due
        logger.warning("per-position P&L unavailable; the snapshot goes out without it", exc_info=True)
    finally:
        for account, con_id in keys:
            with suppress(Exception):
                ib.cancelPnLSingle(account, "", con_id)
    return entries
```

(`import asyncio`, `from contextlib import suppress`, `from time import monotonic`, et
`logger = logging.getLogger(__name__)` s'il n'existe pas déjà dans le fichier — le vérifier
avant d'en ajouter un.)

Dans `/snapshot`, le bloc `try` final devient :

```python
        try:
            items = ib.portfolio()
            pnl = await collect_pnl(ib, items)
            return {
                "accounts": ib.managedAccounts(),
                "fetchedAt": utc_now_iso(),
                "cashAvailable": extract_usd_cash(ib.accountValues()),
                "positions": [serialize_position(item, pnl.get(item.contract.conId)) for item in items],
                "executions": [serialize_execution(fill) for fill in ib.fills()],
            }
        finally:
            ib.disconnect()
```

`ib.portfolio()` n'est appelé qu'une fois : deux appels donneraient deux listes et l'index ne
correspondrait plus.

- [ ] **Étape 5 : borner l'attente dans les tests**

Le test « TWS never answers » attendrait cinq vraies secondes. Le boucler n'est pas acceptable :
dans `test_snapshot.py`, poser `monkeypatch.setattr("ib_tws_agent.main.PNL_TIMEOUT_S", 0.05)`
sur ce seul test (et sur tout autre qui laisse une position muette), via la fixture
`monkeypatch` de pytest. Vérifier que la valeur est bien lue à l'exécution — `collect_pnl` lit
le module, donc le patch prend.

- [ ] **Étape 6 : lancer les tests, vérifier qu'ils passent**

Run : `pnpm test:agent`
Attendu : tout passe, en moins de deux secondes en tout.

- [ ] **Étape 7 : monter la version de l'agent**

Dans `apps/tws-agent/pyproject.toml`, monter le `version` d'un cran mineur (`0.2.0` →
`0.3.0` : lire la valeur courante, ne pas la deviner). `/health` la rend déjà, rien d'autre à
faire.

- [ ] **Étape 8 : commit**

```bash
git add -A
git commit -m "L'agent relaie le P&L du jour de chaque position

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Tâche 3 : le parseur de l'agent lit `pnl` et déduit la variation

**Fichiers :**
- Modifier : `packages/ib-parsers/src/agent.ts:21-28` (`AgentPosition`), `:228-254`
  (`readPosition`), `:296-310` (`parseAgentSnapshot`)
- Test : `packages/ib-parsers/src/agent.test.ts`

**Interfaces :**
- Consomme : `"pnl": {"dailyPnL": number|null, "value": number|null} | null` de la tâche 2 ;
  `Position.dailyPnl` / `dayChange` de la tâche 1.
- Produit : un `Position` d'agent dont les deux champs sont remplis ; lu par les tâches 5, 6, 7.

**Le point qui mord.** `parseAgentSnapshot` lit `positions` **avant** `executions`. Or
`dayChange` a besoin de savoir si le contrat a bougé aujourd'hui. Il faut donc relever les
`conId` des exécutions **avant** de mapper les positions, sur la charge utile brute — sans
valider deux fois. Un `conId` illisible n'est pas une erreur ici : `readExecution` la lèvera au
bon endroit, avec son propre chemin.

- [ ] **Étape 1 : écrire les tests qui échouent**

Dans `packages/ib-parsers/src/agent.test.ts`, en reprenant la façon dont le fichier construit
déjà une charge utile (un helper local existe sans doute — le réutiliser plutôt qu'en écrire un) :

```ts
it("derives the day's move from the P&L and the value of the same message", () => {
  const { positions } = parseAgentSnapshot(payloadWith({ pnl: { dailyPnL: 100, value: 5100 } }), "alpha");

  expect(positions[0].dailyPnl).toBe(100);
  // 5100 − 100 = 5000 at yesterday's close, so +2 %.
  expect(positions[0].dayChange).toBeCloseTo(0.02, 12);
});

it("gives a sold position the right sign: a short that loses shows a rise", () => {
  // −540 now, +60 of P&L today: the position was worth −600 at the close, so the option rose 10 %.
  const { positions } = parseAgentSnapshot(payloadWith({ pnl: { dailyPnL: 60, value: -540 } }), "alpha");

  expect(positions[0].dayChange).toBeCloseTo(-0.1, 12);
});

it("keeps the day's P&L of a contract traded today but never its move", () => {
  // IB still computes dailyPnL right, from the execution price; the formula no longer can.
  const payload = payloadWith({ pnl: { dailyPnL: 100, value: 5100 } }, { tradedConId: 265598 });

  const { positions } = parseAgentSnapshot(payload, "alpha");

  expect(positions[0].dailyPnl).toBe(100);
  expect(positions[0].dayChange).toBeNull();
});

it("takes an older agent's payload without a pnl field", () => {
  // The agent is optional, and so is its version: features missing, never a failed sync.
  const { positions } = parseAgentSnapshot(payloadWith({}), "alpha");

  expect(positions[0].dailyPnl).toBeNull();
  expect(positions[0].dayChange).toBeNull();
});

it.each([
  ["a null pnl", null],
  ["a pnl without a value", { dailyPnL: 100, value: null }],
  ["a value equal to the day's P&L", { dailyPnL: 100, value: 100 }],
])("gives no day move for %s", (_label, pnl) => {
  const { positions } = parseAgentSnapshot(payloadWith({ pnl }), "alpha");

  expect(positions[0].dayChange).toBeNull();
});
```

Le dernier cas — `value === dailyPnL` — est la division par zéro : la position valait 0 à la
clôture.

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Run : `cd packages/ib-parsers && npx vitest run src/agent.test.ts`
Attendu : ÉCHEC — `expected null to be 100`.

- [ ] **Étape 3 : implémenter**

Le type d'abord, dans `AgentPosition` :

```ts
  unrealizedPNL: number;
  /**
   * One `PnLSingle` message: the day's P&L and the position's value at the same instant, so
   * their ratio is coherent. Absent from an older agent, `null` when TWS said nothing in time.
   */
  pnl?: { dailyPnL: number | null; value: number | null } | null;
```

Une fonction pure, au-dessus de `readPosition` :

```ts
/**
 * Today's move of the mark price, from one PnLSingle message: `value − dailyPnL` is what the
 * position was worth at yesterday's close, so the ratio is `(price − close) / close` — right for
 * a long and for a short alike. `null` when either value is missing, when the position was worth
 * nothing at the close, or when the contract traded today: the day's P&L then starts from the
 * execution price, not from the close, and no ratio recovers the move. That repairs itself
 * tomorrow.
 */
function dayChangeOf(dailyPnL: number | null, value: number | null, tradedToday: boolean): number | null {
  if (tradedToday || dailyPnL === null || value === null) return null;
  const previous = value - dailyPnL;
  return previous === 0 ? null : dailyPnL / previous;
}
```

`readPosition` prend les `conId` mouvementés en argument et lit `pnl` :

```ts
function readPosition(value: unknown, path: string, collected: Collected, tradedToday: ReadonlySet<number>): Position {
  const o = obj(value, path);
  const contract = readContract(o, path);
  …
  const pnl = o["pnl"] === undefined || o["pnl"] === null ? null : obj(o["pnl"], `${path}.pnl`);
  const dailyPnl = pnl === null ? null : numOrNull(pnl, "dailyPnL", `${path}.pnl`);
  const pnlValue = pnl === null ? null : numOrNull(pnl, "value", `${path}.pnl`);
  return {
    …
    unrealizedPnl: num(o, "unrealizedPNL", path),
    dailyPnl,
    dayChange: dayChangeOf(dailyPnl, pnlValue, tradedToday.has(contract.conId)),
    currency: contract.currency,
    …
  };
}
```

Dans `parseAgentSnapshot`, avant la ligne qui mappe `positions` :

```ts
  const rawExecutions = list(root, "executions", "payload");
  // Which contracts moved today, read off the same response. A conId this loop cannot read is
  // left alone: readExecution below raises on it, at its own path.
  const tradedToday = new Set<number>(
    rawExecutions.flatMap((e) => {
      const conId = (e as Obj | null)?.["contract"] && ((e as Obj)["contract"] as Obj)["conId"];
      return typeof conId === "number" ? [conId] : [];
    }),
  );
  const positions = list(root, "positions", "payload").map((v, i) =>
    readPosition(v, `payload.positions[${i}]`, collected, tradedToday),
  );
  const transactions = rawExecutions.map((v, i) => readExecution(v, `payload.executions[${i}]`, accountId, collected));
```

`list(root, "executions", …)` n'est plus appelé deux fois.

- [ ] **Étape 4 : lancer les tests, vérifier qu'ils passent**

Run : `cd packages/ib-parsers && npx vitest run src/agent.test.ts`
Attendu : tout passe. Les assertions `toEqual` du fichier qui décrivent une position entière
gagnent les deux champs.

Puis : `pnpm --filter @ib/ib-parsers test` — le corpus d'oracle des journaux ne bouge pas, il est
Flex.

- [ ] **Étape 5 : commit**

```bash
git add -A
git commit -m "Le parseur de l'agent déduit la variation du jour

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Tâche 4 : les snapshots déjà en base reçoivent deux `null`

**Fichiers :**
- Modifier : `apps/web/src/db/schema.ts:172-188` (à la suite de la version 8)
- Test : `apps/web/src/db/schema.test.ts` (le créer s'il n'existe pas ; sinon, y ajouter le cas
  à côté de ceux de la version 8 — chercher `version(8)` dans les tests)

**Interfaces :**
- Consomme : `Position.dailyPnl` / `dayChange` de la tâche 1.

- [ ] **Étape 1 : écrire le test qui échoue**

Reprendre exactement la façon dont le fichier de test de la version 8 ouvre une base à l'ancienne
version, y écrit une ligne, puis rouvre à la version courante. Le cas :

```ts
it("gives a stored snapshot's positions the two day fields, at null", async () => {
  // A snapshot written before sub-project 23 has neither field; the types say they exist.
  await seedSnapshotWithoutDayFields();

  const snapshot = await db.snapshots.get("alpha");

  expect(snapshot?.positions[0]).toMatchObject({ dailyPnl: null, dayChange: null });
});
```

- [ ] **Étape 2 : lancer le test, vérifier qu'il échoue**

Run : `cd apps/web && npx vitest run src/db/schema.test.ts`
Attendu : ÉCHEC — les deux clés sont `undefined`.

- [ ] **Étape 3 : implémenter la version 9**

Dans `apps/web/src/db/schema.ts`, après le bloc de la version 8 :

```ts
    // Sub-project 23: a position carries the day's P&L and move. A snapshot written before it
    // has neither, and `undefined` is not `null`: every reader would have to second-guess the
    // type. No store changes — only the rows.
    this.version(9)
      .stores({})
      .upgrade((tx) =>
        tx
          .table("snapshots")
          .toCollection()
          .modify((row: { positions?: Record<string, unknown>[] }) => {
            for (const position of row.positions ?? []) {
              position.dailyPnl ??= null;
              position.dayChange ??= null;
            }
          }),
      );
```

- [ ] **Étape 4 : lancer les tests, vérifier qu'ils passent**

Run : `cd apps/web && npx vitest run src/db/`
Attendu : tout passe.

- [ ] **Étape 5 : commit**

```bash
git add -A
git commit -m "Dexie 9 : deux null sur les positions des snapshots stockés

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Tâche 5 : `coverage` porte le jour — position analysée et part de la stratégie

**Fichiers :**
- Modifier : `packages/coverage/src/types.ts:12-40` (`AnalyzedPosition`)
- Modifier : `packages/coverage/src/classify.ts:58-80` (le constructeur)
- Modifier : `packages/coverage/src/strategy.ts:17-49` (`StrategyLine`, `WheelShareLine`),
  `:181-211` (`line`), `:355-370` (les actions de la Wheel)
- Test : `packages/coverage/src/classify.test.ts`, `packages/coverage/src/strategy.test.ts`

**Interfaces :**
- Consomme : `Position.dailyPnl` / `dayChange`.
- Produit : `AnalyzedPosition.dailyPnl`, `AnalyzedPosition.dayChange`, `StrategyLine.dailyPnl`,
  `StrategyLine.dayChange`, `WheelShareLine.dailyPnl`, `WheelShareLine.dayChange` — tous
  `number | null`, lus par les tâches 6 et 7.

**Attention : `AnalyzedPosition` ne dérive pas de `Position`.** C'est une interface plate,
recopiée champ par champ dans `classify.ts`. Les deux valeurs n'arrivent donc pas toutes seules
sur la page Positions : il faut les recopier, comme `unrealizedPnl` l'est déjà.

- [ ] **Étape 0 : faire traverser `AnalyzedPosition`**

Le test d'abord, dans `packages/coverage/src/classify.test.ts` :

```ts
it("carries the day's values through to the analyzed position", () => {
  // AnalyzedPosition is a flat copy, not an extension of Position: what is not copied is lost.
  const analyzed = analyzePosition(stock({ dailyPnl: 550.45, dayChange: 0.0816 }));

  expect(analyzed.dailyPnl).toBe(550.45);
  expect(analyzed.dayChange).toBeCloseTo(0.0816, 12);
});
```

Reprendre le nom réel du constructeur exporté par `classify.ts` (chercher la fonction qui rend
un `AnalyzedPosition` ; `analyzePosition` est indicatif). Le lancer, le voir échouer, puis
ajouter à `AnalyzedPosition`, après `unrealizedPnl` :

```ts
  /** Today's P&L IB computes for the whole position; `null` outside an agent snapshot. */
  dailyPnl: number | null;
  /** Today's move of the mark price, as a fraction; `null` for a contract traded today. */
  dayChange: number | null;
```

et dans `classify.ts`, après `unrealizedPnl: pos.unrealizedPnl,` :

```ts
    dailyPnl: pos.dailyPnl,
    dayChange: pos.dayChange,
```

Le relancer, le voir passer.

- [ ] **Étape 1 : écrire les tests qui échouent**

Dans `packages/coverage/src/strategy.test.ts`, en reprenant les helpers du fichier
(`option()` / `stock()` de `fixtures.ts`, et la façon dont il sème des lignes de journal) :

```ts
it("prorates the day's P&L to the strategy's share and keeps the move whole", () => {
  // The Wheel holds 2 of the 5 contracts IB reports; the move does not depend on the quantity.
  const { groups } = strategyPositions("wheel", rowsHoldingShortCalls(2), pricedWith(
    option({ quantity: -5, dailyPnl: -250, dayChange: 0.08 }),
  ));

  expect(groups.sold[0].dailyPnl).toBeCloseTo(-100, 12);
  expect(groups.sold[0].dayChange).toBeCloseTo(0.08, 12);
});

it("gives a line no day values when the position's move is unknown", () => {
  // A contract traded today: IB's dailyPnL starts from the execution price, so the shares
  // entered this morning do not carry the same day's P&L per unit as those held since yesterday.
  const { groups } = strategyPositions("wheel", rowsHoldingShortCalls(2), pricedWith(
    option({ quantity: -5, dailyPnl: -250, dayChange: null }),
  ));

  expect(groups.sold[0].dailyPnl).toBeNull();
  expect(groups.sold[0].dayChange).toBeNull();
});

it("gives a line without a position in the snapshot no day values", () => {
  const { groups } = strategyPositions("wheel", rowsHoldingShortCalls(2), emptySnapshot());

  expect(groups.sold[0].dailyPnl).toBeNull();
  expect(groups.sold[0].dayChange).toBeNull();
});

it("prorates the day's P&L of the Wheel's shares too", () => {
  const { shares } = strategyPositions("wheel", rowsHoldingAssignedShares(100), pricedWith(
    stock({ quantity: 200, dailyPnl: 40, dayChange: 0.01 }),
  ));

  expect(shares[0].dailyPnl).toBeCloseTo(20, 12);
  expect(shares[0].dayChange).toBeCloseTo(0.01, 12);
});
```

Les noms `rowsHoldingShortCalls`, `pricedWith`, `emptySnapshot`,
`rowsHoldingAssignedShares` sont **indicatifs** : utiliser les helpers réels du fichier, qui
existent déjà pour les tests du sous-projet 22. Ne pas en créer de nouveaux si un équivalent
est là.

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Run : `cd packages/coverage && npx vitest run src/strategy.test.ts`
Attendu : ÉCHEC — `Property 'dailyPnl' does not exist on type 'StrategyLine'`.

- [ ] **Étape 3 : implémenter**

Une fonction pure, au-dessus de `line` :

```ts
/**
 * A strategy's share of the day. The move is the position's, whatever the quantity; the P&L is
 * prorated. Both are `null` as soon as the position's move is — a contract traded today: IB's
 * day P&L then starts from the execution price, and what entered this morning does not carry the
 * same day's P&L per unit as what was held yesterday, so no share of it can be cut (spec §6).
 */
function dayShare(position: Position | null, quantity: number): { dailyPnl: number | null; dayChange: number | null } {
  if (!position || position.dayChange === null || position.dailyPnl === null || position.quantity === 0) {
    return { dailyPnl: null, dayChange: null };
  }
  return { dailyPnl: (position.dailyPnl * quantity) / position.quantity, dayChange: position.dayChange };
}
```

Dans `line`, après le calcul de `quantity` et avant le `return` :

```ts
  const day = dayShare(priced?.position ?? null, quantity);
```

et dans l'objet rendu, juste après `unrealizedPnl` :

```ts
    dailyPnl: day.dailyPnl,
    dayChange: day.dayChange,
```

Dans `StrategyLine`, après `unrealizedPnl` :

```ts
  /** The strategy's prorated share of the IB position's day P&L; `null` with its dayChange. */
  dailyPnl: number | null;
  /** The IB position's move of the day, unprorated: it does not depend on the quantity. */
  dayChange: number | null;
```

Pour les actions de la Wheel, dans le `map` qui construit `WheelShareLine` : la position est
déjà cherchée par `priced.get(contractId(sharesContract(holding.ticker, holding.currency)))`.
Extraire cette recherche dans une constante et s'en servir deux fois :

```ts
    const share = priced.get(contractId(sharesContract(holding.ticker, holding.currency)));
    const lastPrice = share?.position.marketPrice ?? null;
    const day = dayShare(share?.position ?? null, holding.quantity);
```

puis `...day` dans l'objet rendu, et les deux champs déclarés sur `WheelShareLine` avec les mêmes
commentaires.

- [ ] **Étape 4 : lancer les tests, vérifier qu'ils passent**

Run : `pnpm --filter @ib/coverage test`
Attendu : tout passe.

- [ ] **Étape 5 : commit**

```bash
git add -A
git commit -m "Une ligne de stratégie porte sa part du jour

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Tâche 6 : les deux colonnes partagées, mesurées puis rendues

**Fichiers :**
- Modifier : `apps/web/src/lib/format.ts` (après `formatRate`)
- Modifier : `apps/web/src/lib/positionColumns.ts:20-56`
- Modifier : `apps/web/src/lib/strategyColumns.ts:13-27`
- Modifier : `apps/web/src/components/PositionRow.tsx`
- Modifier : `apps/web/src/components/PositionGroupCard.tsx:40-52`
- Modifier : `apps/web/src/pages/StrategyPositionsPage.tsx:150-163`
- Modifier : `apps/web/src/i18n/fr.json:90-100`, `apps/web/src/i18n/en.json` (mêmes clés)
- Test : `apps/web/src/lib/positionColumns.test.ts`, `apps/web/src/lib/format.test.ts`,
  `apps/web/src/pages/PositionsPage.test.tsx`,
  `apps/web/src/pages/StrategyPositionsPage.test.tsx`

**Interfaces :**
- Consomme : `AnalyzedPosition.dailyPnl` / `dayChange` (hérités de `Position`) et
  `StrategyLine.dailyPnl` / `dayChange` de la tâche 5.
- Produit : `POSITION_COLUMNS` à douze entrées, dans l'ordre
  `position, type, sector, marketValue, quantity, avgPrice, lastPrice, dayChange, dailyPnl,
  unrealizedPnl, decision, coverage` ; `formatDayChange(ratio: number | null): string`.

- [ ] **Étape 1 : préparer la mesure (l'instance et le script)**

Démarrer l'instance de dev du worktree, **une fois pour toute la tâche** — et la laisser tourner
jusqu'à la fin de la tâche 8 :

```bash
pnpm dev:start    # démarre Vite et Django détachés, sur les ports du worktree
pnpm dev:status   # rappelle ces ports
export SCRATCH=<le répertoire scratchpad indiqué par la session>
```

Écrire `$SCRATCH/measure-columns.mjs` — **hors du dépôt** : ce script sert une fois et n'est pas
un outil à maintenir. Il ne se lance qu'à l'étape 5, quand les colonnes existent : un script
écrit maintenant et lancé une seule fois plus tard, c'est bien **une** passe de mesure, ce
qu'exige CLAUDE.md. Ce qui est proscrit, c'est de régler les largeurs à l'œil sur des captures
successives.

```js
// Measures, in one pass, what each of the twelve columns really needs: its header label and the
// widest cell the fixture produces, in the real font, at the real size. Prints percentages that
// sum to 100. Run once; the numbers go into positionColumns.ts and the script is thrown away.
import { chromium } from "playwright";

const URL = process.argv[2]; // e.g. http://127.0.0.1:5174/accounts/alpha/positions
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("table");

const widths = await page.evaluate(() => {
  const table = document.querySelector("table");
  const headers = [...table.querySelectorAll("thead th")];
  const rows = [...table.querySelectorAll("tbody tr")];
  // Natural width = what the cell would take with no wrapping. Measured on a clone so the
  // live layout is never disturbed.
  const natural = (cell) => {
    const probe = cell.cloneNode(true);
    Object.assign(probe.style, { position: "absolute", visibility: "hidden", whiteSpace: "nowrap", width: "auto", maxWidth: "none" });
    document.body.append(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return w;
  };
  return headers.map((th, i) => ({
    header: th.innerText.trim().replace(/\s+/g, " "),
    headerWidth: natural(th),
    cellWidth: Math.max(0, ...rows.map((tr) => natural(tr.children[i]))),
  }));
});

const need = widths.map((w) => Math.max(w.headerWidth, w.cellWidth));
const total = need.reduce((a, b) => a + b, 0);
for (const [i, w] of widths.entries()) {
  console.log(
    `${String(i).padStart(2)} ${w.header.padEnd(22)} header ${w.headerWidth.toFixed(0).padStart(4)}px  ` +
      `cell ${w.cellWidth.toFixed(0).padStart(4)}px  →  ${((need[i] / total) * 100).toFixed(2)}%`,
  );
}
console.log(`total natural width: ${total.toFixed(0)}px at a 60rem minimum (960px)`);
await browser.close();
```

- [ ] **Étape 2 : écrire les tests qui échouent**

Dans `apps/web/src/lib/format.test.ts` :

```ts
describe("formatDayChange", () => {
  it.each([
    [0.0215, "+2.2%"],
    [-0.1, "-10.0%"],
    [0, "+0.0%"],
  ])("formats %s as %s", (ratio, expected) => {
    expect(formatDayChange(ratio)).toBe(expected);
  });

  it("shows an em dash for null", () => {
    expect(formatDayChange(null)).toBe("—");
  });
});
```

Dans `apps/web/src/lib/positionColumns.test.ts` :

```ts
it("declares the twelve shared columns in order, summing to 100", () => {
  expect(POSITION_COLUMNS.map((c) => c.key)).toEqual([
    "position", "type", "sector", "marketValue", "quantity", "avgPrice",
    "lastPrice", "dayChange", "dailyPnl", "unrealizedPnl", "decision", "coverage",
  ]);
  const total = POSITION_COLUMNS.reduce((n, c) => n + Number.parseFloat(c.width), 0);
  expect(total).toBeCloseTo(100, 6);
});

it("sorts and filters the day columns as numbers, the move in percent", () => {
  const specs = positionColumnSpecs(() => null);
  const byKey = Object.fromEntries(specs.map((s) => [s.key, s]));

  expect(byKey.dailyPnl.type).toBe("number");
  expect(byKey.dayChange.type).toBe("number");
  // Stored as a fraction, compared as a percentage: "> 5" has to mean +5 %.
  expect(byKey.dayChange.value(positionWith({ dayChange: 0.0215 }))).toBeCloseTo(2.15, 12);
  expect(byKey.dayChange.value(positionWith({ dayChange: null }))).toBeNull();
});
```

Dans `apps/web/src/pages/PositionsPage.test.tsx`, en reprenant la façon dont le fichier sème un
ledger et un snapshot :

```ts
it("shows the day's move and P&L of an agent snapshot, and an em dash without them", async () => {
  await seedPositions([
    stockPosition({ dailyPnl: 550.45, dayChange: 0.0816 }),
    stockPosition({ symbol: "ONDS", dailyPnl: null, dayChange: null }),
  ]);

  renderPositionsPage();

  expect(await screen.findByText("+8.2%")).toBeInTheDocument();
  expect(await screen.findByText("550.45")).toBeInTheDocument();
});

it("leaves the day columns of the cash table empty", async () => {
  // The cash card lays the twelve shared columns and fills only Position and Market value.
  await seedCashOnly();

  renderPositionsPage();

  const cashRow = await screen.findByRole("row", { name: /USD/ });
  expect(within(cashRow).getAllByRole("cell")).toHaveLength(POSITION_COLUMNS.length);
});
```

- [ ] **Étape 3 : lancer les tests, vérifier qu'ils échouent**

Run : `cd apps/web && npx vitest run src/lib/format.test.ts src/lib/positionColumns.test.ts`
Attendu : ÉCHEC — `formatDayChange is not a function`, puis dix colonnes au lieu de douze.

- [ ] **Étape 4 : implémenter, largeurs provisoires**

`apps/web/src/lib/format.ts`, après `formatRate` :

```ts
const DAY_CHANGE_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

/**
 * The day's move of a position: one decimal and always its sign, so a column of them reads at a
 * glance. `formatRate` is the return of a month and never signs a gain.
 */
export function formatDayChange(ratio: number | null): string {
  return ratio === null ? "—" : DAY_CHANGE_FORMATTER.format(ratio);
}
```

`signDisplay: "exceptZero"` donne « +2.2% », « -10.0% » et « 0.0% ». Le test ci-dessus attend
« +0.0% » pour zéro : corriger le test si `Intl` rend « 0.0% » — mesurer, ne pas deviner — et
noter le choix en commentaire.

`positionColumns.ts` : insérer les deux entrées aux bons rangs avec des largeurs **provisoires**
(prendre 7% chacune sur `position`, qui est la plus large), puis les deux specs :

```ts
    { key: "lastPrice", type: "number", sortable: true, value: (position) => position.lastPrice },
    // A fraction on the row, a percentage here: a filter typed "> 5" has to mean +5 %.
    { key: "dayChange", type: "number", sortable: true, value: (position) => (position.dayChange === null ? null : position.dayChange * 100) },
    { key: "dailyPnl", type: "number", sortable: true, value: (position) => position.dailyPnl },
    { key: "unrealizedPnl", type: "number", sortable: true, value: (position) => position.unrealizedPnl },
```

Les mêmes deux lignes dans `strategyColumns.ts`, sur `line` au lieu de `position`.

`PositionRow.tsx` : deux champs de plus sur `PositionRowValues` (`dayChange: number | null`,
`dailyPnl: number | null`) et deux cellules, entre `lastPrice` et `unrealizedPnl` :

```tsx
      <TableCell className={cn(NUMERIC, toneOf(values.dayChange))}>{formatDayChange(values.dayChange)}</TableCell>
      <TableCell className={cn(NUMERIC, toneOf(values.dailyPnl))}>{formatMoney(values.dailyPnl)}</TableCell>
```

Le fichier répète déjà `"text-right font-mono tabular-nums"` et la couleur du P&L : extraire les
deux et les **exporter** — la tâche 7 les importe depuis ici plutôt que de les recopier :

```tsx
export const NUMERIC = "text-right font-mono tabular-nums";

/** Green above zero, red below, nothing for an absent value: the tone every day or P&L cell takes. */
export const toneOf = (value: number | null) => value !== null && (value >= 0 ? "text-success" : "text-destructive");
```

S'en servir aussi pour la cellule `unrealizedPnl` existante, qui portait ce code en ligne, et
pour les cellules numériques voisines du fichier. `StrategyPositionsPage.tsx` déclare son propre
`NUMERIC` (chercher `const NUMERIC`) : le supprimer et importer celui-ci, une seule définition.

`PositionGroupCard.tsx` et `StrategyPositionsPage.tsx` : passer `dayChange: …` et
`dailyPnl: …` dans les deux objets `values`.

i18n, dans `positions.columns` de `fr.json`, entre `lastPrice` et `unrealizedPnl` :

```json
      "dayChange": "Var. jour",
      "dailyPnl": "P&L jour",
```

et dans `en.json` : `"dayChange": "Day chg"`, `"dailyPnl": "Daily P&L"`.

- [ ] **Étape 5 : mesurer et fixer les largeurs**

L'instance tourne depuis l'étape 1. Capturer la page avec la fixture d'agent — la tâche 8 ajoute
`pnl` à `agent-snapshot.json`, donc **le faire maintenant** si ce n'est pas fait : sans lui, les
deux colonnes mesurent « — » et la mesure est fausse. Puis :

```bash
node $SCRATCH/measure-columns.mjs "http://127.0.0.1:<port Vite du worktree>/accounts/<compte>/positions"
```

Reporter les douze pourcentages dans `POSITION_COLUMNS`, arrondis à 0,25 % près, ajustés pour
sommer exactement à 100. Mettre à jour le commentaire du fichier : il décrit la mesure, il doit
dire douze colonnes et rappeler que les deux neuves ne se coupent jamais (un montant et un
pourcentage ne s'enroulent pas). Re-lancer le script une fois pour vérifier qu'aucune en-tête ne
déborde sur sa voisine ; si la somme naturelle dépasse 960 px, monter `minWidth` de `60rem` à la
valeur mesurée arrondie au rem supérieur, **dans les trois endroits** qui la portent
(`PositionGroupCard`, `StrategyPositionsPage` ×2, `CashBalancesCard`).

- [ ] **Étape 6 : lancer les tests, vérifier qu'ils passent**

Run : `cd apps/web && npx vitest run src/lib/ src/components/ src/pages/PositionsPage.test.tsx src/pages/StrategyPositionsPage.test.tsx`
Attendu : tout passe.

- [ ] **Étape 7 : commit**

```bash
git add -A
git commit -m "Var. jour et P&L jour dans les douze colonnes partagées

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Tâche 7 : les mêmes deux colonnes sur « Actions assignées »

**Fichiers :**
- Modifier : `apps/web/src/lib/positionColumns.ts:60-70` (`WHEEL_SHARE_COLUMNS`)
- Modifier : `apps/web/src/lib/strategyColumns.ts:32-45` (`wheelShareColumnSpecs`)
- Modifier : `apps/web/src/pages/StrategyPositionsPage.tsx:196-225` (`WheelShareRow`)
- Modifier : `apps/web/src/i18n/fr.json`, `en.json` (`strategyPositions.columns`)
- Test : `apps/web/src/lib/strategyColumns.test.ts`,
  `apps/web/src/pages/StrategyPositionsPage.test.tsx`

**Interfaces :**
- Consomme : `WheelShareLine.dailyPnl` / `dayChange` de la tâche 5, `formatDayChange` de la
  tâche 6.
- Produit : `WHEEL_SHARE_COLUMNS` à onze entrées, dans l'ordre `position, sector, quantity,
  averageAssignmentPrice, averageCallStrike, assignedTotal, lastPrice, dayChange, dailyPnl,
  unrealizedPnl, coverage`.

- [ ] **Étape 1 : écrire les tests qui échouent**

```ts
it("declares the eleven columns of the Wheel's shares, summing to 100", () => {
  expect(WHEEL_SHARE_COLUMNS.map((c) => c.key)).toEqual([
    "position", "sector", "quantity", "averageAssignmentPrice", "averageCallStrike",
    "assignedTotal", "lastPrice", "dayChange", "dailyPnl", "unrealizedPnl", "coverage",
  ]);
  const total = WHEEL_SHARE_COLUMNS.reduce((n, c) => n + Number.parseFloat(c.width), 0);
  expect(total).toBeCloseTo(100, 6);
});
```

Et, dans `StrategyPositionsPage.test.tsx`, le cas rendu : des actions assignées dont la position
du snapshot porte `dailyPnl: 40, dayChange: 0.01` sur 200 titres dont la Wheel en tient 100
affichent « +1.0% » et « 20.00 ».

- [ ] **Étape 2 : lancer les tests, vérifier qu'ils échouent**

Run : `cd apps/web && npx vitest run src/lib/strategyColumns.test.ts`
Attendu : ÉCHEC — neuf clés au lieu de onze.

- [ ] **Étape 3 : implémenter**

Insérer les deux colonnes dans `WHEEL_SHARE_COLUMNS` (largeurs provisoires), les deux specs dans
`wheelShareColumnSpecs` (mêmes deux lignes que la tâche 6, sur `WheelShareLine`), les deux
cellules dans `WheelShareRow` entre `lastPrice` et `unrealizedPnl`, avec `NUMERIC` et `toneOf`
importés depuis `PositionRow.tsx` — les exporter là-bas plutôt que de les recopier —, et les
deux clés i18n dans `strategyPositions.columns`, mêmes libellés qu'à la tâche 6.

- [ ] **Étape 4 : mesurer les onze largeurs**

L'instance tourne encore. Même script, sur la page Wheel, en visant la deuxième table :

```bash
node $SCRATCH/measure-columns.mjs "http://127.0.0.1:<port Vite du worktree>/accounts/<compte>/positions/wheel" 1
```

Le script mesure `document.querySelector("table")`, la première. Lui passer un index en
troisième argument et remplacer cette ligne par `document.querySelectorAll("table")[index]` :
une modification d'une ligne dans un script jetable, pas un outil à généraliser. Reporter les
onze pourcentages, somme exactement 100.

- [ ] **Étape 5 : lancer les tests, vérifier qu'ils passent**

Run : `pnpm --filter web test`
Attendu : tout passe.

- [ ] **Étape 6 : commit**

```bash
git add -A
git commit -m "Var. jour et P&L jour sur les actions assignées de la Wheel

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Tâche 8 : fixture, captures, documentation, vérification finale

**Fichiers :**
- Modifier : `apps/web/src/mocks/agent-snapshot.json`
- Modifier : `apps/web/src/pages/HelpPage.tsx`, `apps/web/src/i18n/fr.json`, `en.json`
- Modifier : `CLAUDE.md`, `docs/points-reportes.md`,
  `docs/specs/2026-09-18-valeurs-du-jour-design.md` (statut)
- Test : `apps/web/src/pages/HelpPage.test.tsx`

- [ ] **Étape 1 : garnir la fixture de l'agent**

Dans `apps/web/src/mocks/agent-snapshot.json`, la position `265598` (AAPL, 200 titres) gagne :

```json
  "pnl": { "dailyPnL": 240.0, "value": 30240.0 }
```

30240 − 240 = 30000 à la clôture, soit +0,8 % : un nombre rond, vérifiable à l'œil. La position
`700000002` est celle que porte la seule exécution du fichier : elle gagne
`"pnl": { "dailyPnL": 15.0, "value": 315.0 }` et doit s'afficher « — » en Var. jour, ce qui
démontre le cas du contrat mouvementé sur une capture.

Si la tâche 6 a déjà fait cette étape pour mesurer, la vérifier et passer.

- [ ] **Étape 2 : une phrase sur la page Aide**

Dans `HelpPage.tsx`, à l'endroit qui décrit ce que l'agent apporte, une clé i18n neuve :

- fr : « Var. jour et P&L jour viennent de l'agent local : un portefeuille reconstruit depuis un
  relevé ou une réponse Flex les laisse à « — », comme un contrat acheté ou vendu le jour même. »
- en : « Day chg and Daily P&L come from the local agent: a portfolio rebuilt from a statement or
  a Flex response leaves them at "—", as does a contract bought or sold today. »

Ajouter l'assertion correspondante dans `HelpPage.test.tsx`, à côté de celles qui existent.

- [ ] **Étape 3 : CLAUDE.md**

Ajouter une puce à « Règles qui mordent si on les oublie », après celle qui parle des heures IB :

> - **Les valeurs du jour viennent de l'agent seul** : `dailyPnl` est le P&L du jour que
>   `reqPnLSingle` rend, sans abonnement ; `dayChange` est déduit dans
>   `packages/ib-parsers/src/agent.ts` par `dailyPnL / (value − dailyPnL)`, **jamais** le
>   *Change %* de TWS, qui suit le dernier échange quand celui-ci suit le prix de marque. Les
>   deux sont `null` pour un relevé et pour Flex, et `dayChange` l'est aussi pour un contrat
>   mouvementé le jour même — le P&L du jour part alors du prix d'exécution. Une page de
>   stratégie proratise `dailyPnl` et reprend `dayChange` tel quel, et abandonne les deux dès que
>   `dayChange` de la position est `null` (`dayShare`, `packages/coverage/src/strategy.ts`).
>   L'étape PnL de l'agent (`collect_pnl`, `PNL_TIMEOUT_S`) ne fait jamais échouer `/snapshot`.

Corriger les deux mentions de comptage dans la puce des colonnes partagées : « les dix colonnes »
devient « les douze colonnes », « ses neuf colonnes propres » devient « ses onze colonnes
propres ». Ajouter la ligne 23 au tableau des sous-projets : `| 23 | Valeurs du jour : P&L du
jour et variation par position | fait (2026-09-18) |`.

- [ ] **Étape 4 : points reportés**

Ajouter, dans la section de l'agent :

> - **La devise du `dailyPnL` d'une position hors USD n'est pas vérifiée** : la sonde du
>   sous-projet 23 n'a vu qu'un compte et des positions en USD. `dayChange` n'en dépend pas — ses
>   deux termes viennent du même message —, le montant affiché si.
> - **Une position a montré un `dailyPnL` nul en séance** pendant la même sonde, marché ouvert,
>   sur six cents titres. À comparer à ce qu'affiche TWS pour ce titre : si TWS montre zéro
>   aussi, fermer le point.
> - **Le « jour » est celui du réglage de TWS** (heure de remise à zéro du P&L dans Global
>   Configuration), pas nécessairement la clôture de New York. L'application ne le lit nulle part.

- [ ] **Étape 5 : passer la spec en implémenté**

`docs/specs/2026-09-18-valeurs-du-jour-design.md`, ligne 3 : `Statut : implémenté (2026-09-18).`

- [ ] **Étape 6 : vérification complète**

```bash
pnpm check       # lint, typage, fraîcheur du schéma d'API, build, tous les tests TS
pnpm test:agent  # pytest de l'agent : pnpm check ne lance jamais Python
```

Attendu : les deux verts. Ne rien déclarer avant d'avoir lu les deux sorties.

- [ ] **Étape 7 : deux captures, vérifiées différentes**

L'instance de dev tourne toujours. Capturer avec la fixture d'agent :

```bash
node .claude/skills/run-frontend/driver.mjs --agent /accounts/<compte>/positions
node .claude/skills/run-frontend/driver.mjs --agent /accounts/<compte>/positions/wheel
```

Vérifier que les deux fichiers diffèrent réellement (`cmp` ou leur taille), puis les lire : les
douze colonnes alignées, aucune en-tête coupée, « +0.8% » sur AAPL, « — » sur le contrat
mouvementé.

- [ ] **Étape 8 : commit**

```bash
git add -A
git commit -m "Documenter le sous-projet 23 et garnir la fixture de l'agent

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Étape 9 : laisser l'instance tournée pour la relecture**

`pnpm dev:start` si elle a été arrêtée, puis donner à Seb les deux URL (Vite et Django) du
worktree. **Ne pas merger** : il regarde la branche d'abord. Au merge seulement, `pnpm dev:stop`
dans le worktree **avant** `git merge` et `git worktree remove`.

---

## Revue de branche

Une fois les huit tâches faites, avant de proposer le merge : `superpowers:requesting-code-review`
sur la branche entière. Points que la revue doit regarder en priorité :

- l'étape PnL de l'agent ne peut-elle vraiment **jamais** faire échouer `/snapshot` ni laisser
  une souscription ouverte ? Chercher un chemin où `cancelPnLSingle` est sauté ;
- `dayChange` peut-il valoir `Infinity`, `-Infinity` ou `NaN` pour une entrée que l'agent peut
  réellement produire ?
- un `conId` présent deux fois dans `executions` ou dans `positions` casse-t-il quelque chose ?
- les douze largeurs somment-elles exactement à 100, et la somme naturelle mesurée tient-elle
  dans `minWidth` ?
- reste-t-il un endroit qui construit un `Position` sans les deux champs (un mock, une fixture
  de test web) et qui passerait par un `as Position` ?
