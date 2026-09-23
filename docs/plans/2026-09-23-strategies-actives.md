# Sous-projet 30 — Les stratégies actives d'un compte : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal :** chaque compte choisit ses stratégies actives parmi Wheel, LEAPS et Condors (défaut :
Wheel seule) ; une stratégie inactive disparaît du menu, et ce qu'elle aurait pris va dans Autres.

**Architecture :** le moteur `buildJournals` reçoit la liste active et `classify.ts` ne propose
une ouverture qu'aux stratégies actives ; la portée `portfolio` lit la même liste. Dans
`packages/coverage`, Autres possède les sources de couverture des stratégies inactives. Dans
`apps/web`, la fiche du compte porte le réglage, lu par une seule fonction, `activeStrategies` ;
le fournisseur de données du compte le passe au moteur et l'expose aux pages, au menu, au garde
des routes et aux graphes. Rien n'est stocké hors du réglage, ni table ni migration Dexie.

**Tech Stack :** TypeScript, React 19, react-router, react-i18next, Dexie, Vitest, Testing
Library, `fake-indexeddb`.

**Spec :** `docs/specs/2026-09-23-strategies-actives-design.md`

## Global Constraints

- **Rien dans `apps/api`, aucune table Dexie, aucune version Dexie, aucune migration.** Une
  tâche qui semble en réclamer une est un **signal d'arrêt** : s'arrêter et demander.
- **Le moteur appelé sans liste active garde son comportement d'avant** : `active` absent vaut
  `ACTIVABLE_STRATEGIES`. Aucun test existant de `packages/ledger` ni de `packages/coverage` ne
  doit changer d'attente ; l'oracle `flex_journals_corpus.xml` reste à zéro écart.
- **Le défaut « Wheel seule » vit dans l'application** (`DEFAULT_ACTIVE_STRATEGIES`,
  `apps/web/src/lib/strategies.ts`), jamais dans le moteur.
- **Le réglage se lit par `activeStrategies(account)` seul**, jamais en lisant
  `account.strategies` ailleurs.
- **Autres est toujours visible et n'est jamais une stratégie « activable ».**
- **Le tableau de bord ne compte que les stratégies actives** ; Autres n'y entre jamais.
- **Textes** : aucune chaîne visible en dur dans un composant ; `fr.json` **et** `en.json` dans
  le même commit.
- **Un test doit échouer si le comportement change.** Aucun hook moqué : les tests de page
  sèment `fake-indexeddb` et rendent le vrai composant.
- **Commits en français**, sujet à l'impératif, terminés par
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`, et **la case du plan
  cochée dans le même commit que la tâche**.
- **Commandes de test ciblées** : depuis `packages/ledger`, `packages/coverage` ou `apps/web`,
  `npx vitest run <motif>`. La forme `pnpm --filter web test -- <motif>` **ne filtre pas**.
  Typage d'un paquet : `npx tsc --noEmit -p <dossier>`.
- **`pnpm check` une seule fois, à la fin** (tâche 7).

## Review Focus

1. **Comptes existants sans réglage** : ils deviennent « Wheel seule » d'un coup ; les tests web
   qui sèment un compte sans `strategies` et attendent des lignes LEAPS ou Condors doivent recevoir
   `strategies: [...ACTIVABLE_STRATEGIES]` sur leur compte semé — jamais une attente affaiblie
   (tâche 4, étape 6).
2. **Cocher une case recalcule tout de suite** : les journaux, le menu et la page affichée
   changent sans recharger (tâche 4 et tâche 5, test « décocher LEAPS vide le journal LEAPS »).
3. **Tout décocher** : menu réduit à Autres, tableau de bord vide, aucune erreur (tâche 1,
   test « aucune stratégie active » ; tâche 6, test du menu vide).
4. **Une URL mise en favori vers une stratégie inactive** : redirection vers le tableau de bord,
   pas une page vide ni une erreur ; pendant le chargement de la fiche, aucune redirection
   prématurée (tâche 6).
5. **Un call couvert dans Autres** : badge de la source réelle, `UNCOVERED` pour le seul reste,
   et la part nue d'une stratégie active qui migre n'en est pas réduite (tâches 2 et 3).

## Structure des fichiers

| Fichier | Responsabilité | Tâches |
|---|---|---|
| `packages/ledger/src/journals/types.ts` | `ACTIVABLE_STRATEGIES`, `ActivableStrategy`, `scopeStrategies` | 1 |
| `packages/ledger/src/journals/context.ts` | `ReplayContext.active` | 1 |
| `packages/ledger/src/journals/classify.ts` | classement selon la liste active | 1 |
| `packages/ledger/src/journals/replay.ts` | `buildJournals(…, active)`, stats et capital par liste active | 1 |
| `packages/ledger/src/journals/active.test.ts` (nouveau) | tests du classement par liste active | 1 |
| `packages/coverage/src/strategy.ts` | `strategyCoverSources`, `migratedContracts`, `strategyPositions(…, active)` | 2 |
| `packages/coverage/src/strategy.test.ts` | tests d'Autres couvert | 2 |
| `apps/web/src/lib/riskReport.ts` | badges et filtre Couverture d'Autres | 3 |
| `apps/web/src/lib/riskReport.test.ts` | tests | 3 |
| `apps/web/src/db/schema.ts` | `AccountRecord.strategies` | 4 |
| `apps/web/src/lib/strategies.ts` (nouveau) | `DEFAULT_ACTIVE_STRATEGIES`, `activeStrategies` | 4 |
| `apps/web/src/db/accounts.ts` | `setActiveStrategies` | 4 |
| `apps/web/src/db/hooks.ts` | `useActiveStrategies`, `useJournals(accountId, active)` | 4 |
| `apps/web/src/db/AccountDataProvider.tsx` | `useAccountStrategies` | 4 |
| `apps/web/src/pages/StrategyPositionsPage.tsx` | passe `active` à `strategyPositions` | 4 |
| `apps/web/src/components/PositionGroupCard.tsx`, `PositionSuggestionsCard.tsx` | graphes : actives + Autres | 4 |
| `apps/web/src/mocks/seed.ts` | démo avec les trois stratégies | 4 |
| `apps/web/src/components/StrategiesCard.tsx` (nouveau) | carte « Stratégies actives » | 5 |
| `apps/web/src/pages/SourcesPage.tsx` | monte la carte | 5 |
| `apps/web/src/i18n/{fr,en}.json` | libellés de la carte, Aide | 5 |
| `apps/web/src/lib/navigation.ts` | `NavSection.strategy` | 6 |
| `apps/web/src/components/app-sidebar.tsx` | masque les sections inactives | 6 |
| `apps/web/src/routes/StrategyRoute.tsx` (nouveau) | garde des routes de stratégie | 6 |
| `apps/web/src/routes/router.tsx` | pose le garde | 6 |
| `CLAUDE.md`, spec | documentation | 7 |

---

### Task 1: Le moteur classe selon les stratégies actives

**Files:**
- Modify: `packages/ledger/src/journals/types.ts:1-20`
- Modify: `packages/ledger/src/journals/context.ts` (`ReplayContext`, `newContext`)
- Modify: `packages/ledger/src/journals/classify.ts` (`openSingle`, `classifyOpenings`)
- Modify: `packages/ledger/src/journals/replay.ts:136-196` (`buildJournals`)
- Create: `packages/ledger/src/journals/active.test.ts`

**Interfaces:**
- Produces (exportés depuis `@ib/ledger` par le `export *` existant de `types.ts` — vérifier
  `packages/ledger/src/index.ts` et `journals/index.ts`, ajouter l'export s'il manque) :
  - `ACTIVABLE_STRATEGIES: readonly ["wheel", "leaps", "condors"]`
  - `type ActivableStrategy = "wheel" | "leaps" | "condors"`
  - `STRATEGIES = [...ACTIVABLE_STRATEGIES, "others"] as const` (inchangé en valeur)
  - `type StatsStrategy = ActivableStrategy`
  - `scopeStrategies(scope: CapitalScope, active: readonly ActivableStrategy[]): readonly ActivableStrategy[]`
  - `buildJournals(transactions, snapshot?, identities = NO_IDENTITIES, active: readonly ActivableStrategy[] = ACTIVABLE_STRATEGIES): JournalsReport`
  - `SCOPE_STRATEGIES` est **supprimé** (son seul lecteur est `replay.ts`).

- [x] **Step 1: Write the failing tests**

Create `packages/ledger/src/journals/active.test.ts` :

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { deliver, option, resetIds, stock } from "./fixtures.ts";
import { buildJournals } from "./replay.ts";
import { ACTIVABLE_STRATEGIES, scopeStrategies, type JournalsReport } from "./types.ts";

beforeEach(resetIds);

const D1 = "2026-08-01T14:30:00.000Z";
const D2 = "2026-08-10T15:00:00.000Z";
const D3 = "2026-08-20T15:00:00.000Z";
const PUT = { right: "P" as const, strike: 17, expiry: "2026-10-02" };
const CALL = { right: "C" as const, strike: 20, expiry: "2026-11-20" };
const LEAPS = { right: "C" as const, strike: 15, expiry: "2027-06-18" };
const SPY = { ticker: "SPY", expiry: "2026-08-29" };

/** id -> "strategy:quantity", for the rows opened by the transaction `externalId`. */
function placed(report: JournalsReport, externalId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of report.rows) if (row.openIds[0] === externalId) out[row.id] = `${row.strategy}:${row.quantity}`;
  return out;
}

function condor() {
  return [
    option({ ...SPY, right: "P", strike: 620, quantity: 1, price: 0.3, when: D1 }),
    option({ ...SPY, right: "P", strike: 625, quantity: -1, price: 0.6, when: D1 }),
    option({ ...SPY, right: "C", strike: 660, quantity: -1, price: 0.5, when: D1 }),
    option({ ...SPY, right: "C", strike: 665, quantity: 1, price: 0.3, when: D1 }),
  ];
}

describe("buildJournals — active strategies", () => {
  it("keeps every strategy when no list is given", () => {
    const explicit = buildJournals([option({ ...PUT, quantity: -1, price: 0.2, when: D1 })], undefined, undefined, ACTIVABLE_STRATEGIES);
    resetIds();
    const implicit = buildJournals([option({ ...PUT, quantity: -1, price: 0.2, when: D1 })]);
    expect(implicit).toEqual(explicit);
  });

  it("files a sold put in Others without the Wheel", () => {
    const report = buildJournals([option({ ...PUT, quantity: -1, price: 0.2, when: D1 })], undefined, undefined, ["leaps", "condors"]);
    expect(placed(report, "flex:trade:1")).toEqual({ "flex:trade:1#1": "others:-1" });
  });

  it("keeps the shares an Others put delivers in Others", () => {
    const report = buildJournals(
      [option({ ...PUT, quantity: -1, price: 0.2, when: D1 }), ...deliver({ ...PUT, quantity: 1 })],
      undefined,
      undefined,
      [],
    );
    expect(placed(report, "flex:trade:3")).toEqual({ "flex:trade:3#1": "others:100" });
  });

  it("never takes shares over without the Wheel: a call sold on held shares goes to Others, no integrated exit", () => {
    const report = buildJournals(
      [stock({ ticker: "ZZZ", quantity: 100, price: 10, when: D1 }), option({ ...CALL, ticker: "ZZZ", quantity: -1, price: 0.5, when: D2 })],
      undefined,
      undefined,
      ["leaps", "condors"],
    );
    expect(placed(report, "flex:trade:2")).toEqual({ "flex:trade:2#1": "others:-1" });
    expect(report.rows.some((row) => row.event === "integrated")).toBe(false);
    expect(report.rows.every((row) => row.strategy === "others")).toBe(true);
  });

  it("still gives a call sold against a LEAPS to the LEAPS without the Wheel", () => {
    const report = buildJournals(
      [option({ ...LEAPS, quantity: 1, price: 3, when: D1 }), option({ ...CALL, quantity: -1, price: 0.5, when: D2 })],
      undefined,
      undefined,
      ["leaps"],
    );
    expect(placed(report, "flex:trade:2")).toEqual({ "flex:trade:2#1": "leaps:-1" });
  });

  it("files a long call and the call sold against it in Others without the LEAPS", () => {
    const report = buildJournals(
      [option({ ...LEAPS, quantity: 1, price: 3, when: D1 }), option({ ...CALL, quantity: -1, price: 0.5, when: D2 })],
      undefined,
      undefined,
      ["wheel"],
    );
    expect(placed(report, "flex:trade:1")).toEqual({ "flex:trade:1#1": "others:1" });
    expect(placed(report, "flex:trade:2")).toEqual({ "flex:trade:2#1": "others:-1" });
  });

  it("files a condor's four legs whole in Others without the Condors, none in the Wheel", () => {
    const report = buildJournals(condor(), undefined, undefined, ["wheel"]);
    expect(report.rows).toHaveLength(4);
    expect(report.rows.map((row) => row.strategy)).toEqual(["others", "others", "others", "others"]);
  });

  it("files everything in Others with no strategy active, and leaves every scope empty", () => {
    const report = buildJournals(
      [option({ ...PUT, quantity: -1, price: 0.2, when: D1 }), option({ ...LEAPS, ticker: "ZZZ", quantity: 1, price: 3, when: D2 }), ...condor()],
      undefined,
      undefined,
      [],
    );
    expect(report.rows.every((row) => row.strategy === "others")).toBe(true);
    expect(report.stats).toEqual({ wheel: [], leaps: [], condors: [], portfolio: [] });
    expect(report.capital).toEqual({ wheel: [], leaps: [], condors: [], portfolio: [] });
  });

  it("gives the portfolio the active strategies only, and an inactive strategy nothing", () => {
    const ledger = [
      option({ ...PUT, quantity: -1, price: 0.2, when: D1 }),
      option({ ...LEAPS, ticker: "ZZZ", quantity: 1, price: 3, when: D2 }),
      option({ ...LEAPS, ticker: "ZZZ", quantity: -1, price: 4, when: D3 }),
    ];
    const all = buildJournals(ledger);
    resetIds();
    const wheelOnly = buildJournals(ledger, undefined, undefined, ["wheel"]);
    expect(wheelOnly.stats.leaps).toEqual([]);
    expect(wheelOnly.capital.leaps).toEqual([]);
    expect(wheelOnly.stats.wheel).toEqual(all.stats.wheel);
    expect(wheelOnly.stats.portfolio).toEqual(all.stats.wheel);
    expect(all.stats.portfolio[0].total).toBe(all.stats.wheel[0].total + all.stats.leaps[0].total);
  });
});

describe("scopeStrategies", () => {
  it("reads a strategy only while it is active, and the portfolio as the active list", () => {
    expect(scopeStrategies("leaps", ["wheel", "leaps"])).toEqual(["leaps"]);
    expect(scopeStrategies("condors", ["wheel", "leaps"])).toEqual([]);
    expect(scopeStrategies("portfolio", ["wheel", "condors"])).toEqual(["wheel", "condors"]);
    expect(scopeStrategies("portfolio", [])).toEqual([]);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run (depuis `packages/ledger`) : `npx vitest run active`
Expected: FAIL — `ACTIVABLE_STRATEGIES` / `scopeStrategies` introuvables, puis attentes de
classement fausses.

- [x] **Step 3: Declare the list once (`types.ts`)**

Remplacer les lignes 4-20 de `packages/ledger/src/journals/types.ts` par :

```ts
/**
 * The strategies a user may turn on or off for an account (spec of sub-project 30, §7), in the
 * order every list of them is shown. Others is never one of them: it is where what no active
 * strategy takes goes.
 */
export const ACTIVABLE_STRATEGIES = ["wheel", "leaps", "condors"] as const;
export type ActivableStrategy = (typeof ACTIVABLE_STRATEGIES)[number];
export const STRATEGIES = [...ACTIVABLE_STRATEGIES, "others"] as const;
export type Strategy = (typeof STRATEGIES)[number];
/** Others has no statistics: it is where what fits nowhere else goes. */
export type StatsStrategy = ActivableStrategy;

/** A statistics page, or the active strategies at once for the dashboard. */
export type CapitalScope = StatsStrategy | "portfolio";

/**
 * The strategies whose lines a scope reads: a strategy's own while it is active, nothing once it
 * is not, and every active one for the dashboard. The dashboard's figures are the same
 * computation over more lines, never a sum of the strategies' results (spec of sub-project 14,
 * §3; sub-project 30, §4).
 */
export function scopeStrategies(scope: CapitalScope, active: readonly ActivableStrategy[]): readonly ActivableStrategy[] {
  if (scope === "portfolio") return active;
  return active.includes(scope) ? [scope] : [];
}
```

- [x] **Step 4: Carry the list in the replay context (`context.ts`)**

Dans `ReplayContext`, ajouter le champ, et dans `newContext` le paramètre :

```ts
import type { ActivableStrategy, JournalRow, RowKind } from "./types.ts";
import { ACTIVABLE_STRATEGIES } from "./types.ts";

export interface ReplayContext {
  // … champs existants inchangés …
  /** The strategies an opening may be offered to (spec of sub-project 30, §3). */
  active: ReadonlySet<ActivableStrategy>;
}

export function newContext(
  fills: Map<Transaction, string[]> = new Map(),
  active: readonly ActivableStrategy[] = ACTIVABLE_STRATEGIES,
): ReplayContext {
  return { book: new LotBook(), rows: [], composites: [], delivered: new Map(), settlements: new Map(), fills, ids: new Map(), active: new Set(active) };
}
```

Chercher les autres appels de `newContext` (`grep -rn "newContext(" packages/ledger/src`) : le
défaut les laisse inchangés.

- [x] **Step 5: Offer openings to the active strategies only (`classify.ts`)**

Dans `openSingle`, remplacer le corps après le test `opening.orphan` par :

```ts
  const { active } = ctx;
  if (tx.right === "P") {
    openLot(ctx, opening, opening.quantity < 0 && active.has("wheel") ? "wheel" : "others", null);
    return;
  }
  if (opening.quantity > 0) {
    const leaps =
      active.has("leaps") && contract.expiry !== null && isAtLeastMonthsAway(dayOf(tx.when), contract.expiry, LEAPS_MIN_MONTHS);
    openLot(ctx, opening, leaps ? "leaps" : "others", null);
    return;
  }
  const covered = state.coveredCalls(contract);
  // An inactive strategy offers no capacity: splitShortCall then sends the sale to whichever
  // active cover is left, or to Others (spec of sub-project 30, §3).
  const parts = splitShortCall(
    Math.abs(opening.quantity),
    active.has("wheel") ? state.wheelCapacity(contract) : 0,
    active.has("leaps") ? state.leapsCapacity(contract) : 0,
    contract.strike,
    state.averageSharePrice(contract),
  );
```

(le reste de `openSingle`, la boucle `for (const part of parts)`, est inchangé).

Dans `classifyOpenings`, remplacer `const condor = detectCondor(group);` par :

```ts
      // Without the Condors, a combination goes whole to Others like any combination that is
      // not a condor — never leg by leg into the Wheel (spec of sub-project 30, §3).
      const condor = ctx.active.has("condors") ? detectCondor(group) : null;
```

Mettre à jour le commentaire de `classifyOpenings` pour dire que le classement ne propose une
ouverture qu'aux stratégies actives.

- [x] **Step 6: Pass the list through `buildJournals` (`replay.ts`)**

```ts
export function buildJournals(
  transactions: readonly Transaction[],
  snapshot?: JournalSnapshot,
  identities: ContractIdentities = NO_IDENTITIES,
  active: readonly ActivableStrategy[] = ACTIVABLE_STRATEGIES,
): JournalsReport {
```

`const ctx = newContext(ids, active);` et, en bas :

```ts
  const statsOf = (scope: CapitalScope) => computeStats(rows, scopeStrategies(scope, active), lastWhen);
  const stats = { wheel: statsOf("wheel"), leaps: statsOf("leaps"), condors: statsOf("condors"), portfolio: statsOf("portfolio") };
  const capitalOf = (scope: CapitalScope) => computeCapital(rows, scopeStrategies(scope, active), stats[scope]);
```

Remplacer l'import de `SCOPE_STRATEGIES` par `ACTIVABLE_STRATEGIES, scopeStrategies, type ActivableStrategy`.
Vérifier `grep -rn "SCOPE_STRATEGIES" packages apps` : plus aucune occurrence hors commentaires
à mettre à jour (le commentaire de `computeStats` « all three for the dashboard » devient « the
active ones for the dashboard »).

- [x] **Step 7: Run the tests**

Run (depuis `packages/ledger`) : `npx vitest run` puis `npx tsc --noEmit -p .`
Expected: PASS, tous les tests existants inchangés, l'oracle des journaux compris.

- [x] **Step 8: Commit**

```bash
git add packages/ledger docs/plans/2026-09-23-strategies-actives.md
git commit -m "Classe les ouvertures selon les stratégies actives du compte

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Autres possède les sources des stratégies inactives

**Files:**
- Modify: `packages/coverage/src/strategy.ts:84-130` (constantes, `migratedContracts`),
  `migratedByContract`, `linesByGroup`, `strategyPositions`
- Modify: `packages/coverage/src/strategy.test.ts`

**Interfaces:**
- Consumes: `ACTIVABLE_STRATEGIES`, `type ActivableStrategy` de `@ib/ledger` (tâche 1).
- Produces:
  - `strategyCoverSources(strategy: PositionsStrategy, active?: readonly ActivableStrategy[]): readonly CoverSource[]`
  - `migratedContracts(shorts, allocations, uncoveredQuantity, active?: readonly ActivableStrategy[]): Map<PositionsStrategy, number>`
  - `strategyPositions(rows, strategy, snapshot, active?: readonly ActivableStrategy[]): StrategyPositions`
  - `STRATEGY_COVER_SOURCES` est **supprimé** (remplacé par `strategyCoverSources`) ;
    `COVERED_STRATEGIES` devient `ACTIVABLE_STRATEGIES`.
  - Tous les `active` absents valent `ACTIVABLE_STRATEGIES` : comportement d'avant.

- [x] **Step 1: Write the failing tests**

Ajouter à `packages/coverage/src/strategy.test.ts` (les helpers `row`, `opt`, `priced`,
`option`, `alloc`, `shortsOf` existent déjà dans le fichier ; vérifier la signature de `alloc`
et `shortsOf` vers la ligne 496 et s'y conformer) :

```ts
describe("strategyCoverSources", () => {
  it("gives each strategy its own sources, and Others those of the inactive strategies", () => {
    expect(strategyCoverSources("wheel")).toEqual(["cash", "stock"]);
    expect(strategyCoverSources("leaps", ["wheel"])).toEqual(["leaps"]);
    expect(strategyCoverSources("others")).toEqual([]);
    expect(strategyCoverSources("others", ["wheel"])).toEqual(["leaps", "spread"]);
    expect(strategyCoverSources("others", [])).toEqual(["cash", "stock", "leaps", "spread"]);
  });
});

describe("migratedContracts — Others covered", () => {
  it("only counts Others' naked part against what may migrate", () => {
    // Wheel holds 1 naked call, Others 1 call its (inactive) LEAPS cover: the engine calls 1 naked.
    expect(
      migratedContracts(shortsOf([["wheel", 1], ["others", 1]]), [alloc("leaps", 1)], 1, ["wheel"]),
    ).toEqual(new Map([["wheel", 1]]));
  });

  it("still counts every Others sale as naked when every strategy is active", () => {
    expect(migratedContracts(shortsOf([["wheel", 1], ["others", 1]]), [alloc("leaps", 1)], 1)).toEqual(new Map());
  });
});

describe("strategyPositions — Others reads the cover of an inactive strategy", () => {
  const LONG = opt("MQZA", "C", 15, "2027-06-18");
  const SHORT = opt("MQZA", "C", 20, "2026-10-16");
  const rows = [
    row({ id: "l#1", strategy: "others", contract: LONG, kind: "long_call", quantity: 1, openPrice: 3 }),
    row({ id: "s#1", strategy: "others", contract: SHORT, kind: "short_call", quantity: -1, openPrice: 0.5 }),
  ];
  const snapshot = priced([
    option({ symbol: "MQZA", right: "C", strike: 15, expiry: "2027-06-18", quantity: 1, avgPrice: 3, marketPrice: 4, marketValue: 400 }),
    option({ symbol: "MQZA", right: "C", strike: 20, expiry: "2026-10-16", quantity: -1, avgPrice: 0.5, marketPrice: 0.4, marketValue: -40 }),
  ]);

  it("puts the leaps allocation on the sold call once the LEAPS are inactive", () => {
    const sold = strategyPositions(rows, "others", snapshot, ["wheel"]).groups.optionSells[0];
    expect(sold.coverage.map((allocation) => [allocation.source, allocation.quantity])).toEqual([["leaps", 1]]);
  });

  it("puts none on it while the LEAPS are active", () => {
    expect(strategyPositions(rows, "others", snapshot).groups.optionSells[0].coverage).toEqual([]);
  });
});
```

Importer `strategyCoverSources` en tête du fichier. Si `buildRiskReport` n'alloue pas `leaps`
sur ce couple (vérifier en lançant le test), ajuster **les contrats de la fixture** — jamais
l'attente — jusqu'à ce que `snapshot.report.positions[1].allocations` porte `leaps ×1`, et le
dire dans le commentaire de la fixture.

- [x] **Step 2: Run tests to verify they fail**

Run (depuis `packages/coverage`) : `npx vitest run strategy`
Expected: FAIL — `strategyCoverSources` introuvable.

- [x] **Step 3: Implement**

Remplacer `STRATEGY_COVER_SOURCES` et `COVERED_STRATEGIES` par :

```ts
/**
 * The cover each strategy owns on a sold option: the Wheel's calls lean on its shares and its puts
 * on cash, the LEAPS' calls on the LEAPS, a condor's legs on the other legs of the structure.
 */
const OWN_COVER_SOURCES: Record<ActivableStrategy, readonly CoverSource[]> = {
  wheel: ["cash", "stock"],
  leaps: ["leaps"],
  condors: ["spread"],
};

/**
 * What a strategy's page reads of the IB cover. Others owns the sources of the inactive
 * strategies, whose sales it now holds (spec of sub-project 30, §5); with every strategy active it
 * owns none — what is left there is then precisely what nothing covers. UNCOVERED is never an
 * allocation: the page shows it from the line's own quantity.
 */
export function strategyCoverSources(strategy: PositionsStrategy, active: readonly ActivableStrategy[] = ACTIVABLE_STRATEGIES): readonly CoverSource[] {
  if (strategy !== "others") return OWN_COVER_SOURCES[strategy];
  return ACTIVABLE_STRATEGIES.filter((s) => !active.includes(s)).flatMap((s) => OWN_COVER_SOURCES[s]);
}

/** The strategies that own a cover, in the order the pages are served when the cap bites. */
const COVERED_STRATEGIES: readonly ActivableStrategy[] = ACTIVABLE_STRATEGIES;

/** Σ allocations whose source is in `sources`. */
function ownCover(allocations: readonly CoverageAllocation[], sources: readonly CoverSource[]): number {
  return allocations.reduce((sum, a) => (sources.includes(a.source) ? sum + a.quantity : sum), 0);
}
```

`migratedContracts` devient :

```ts
export function migratedContracts(
  shorts: ReadonlyMap<PositionsStrategy, number>,
  allocations: readonly CoverageAllocation[],
  uncoveredQuantity: number,
  active: readonly ActivableStrategy[] = ACTIVABLE_STRATEGIES,
): Map<PositionsStrategy, number> {
  const taken = new Map<PositionsStrategy, number>();
  const othersHeld = shorts.get("others") ?? 0;
  const othersNaked = othersHeld - Math.min(othersHeld, ownCover(allocations, strategyCoverSources("others", active)));
  let migrable = Math.max(0, uncoveredQuantity - othersNaked);
  for (const strategy of COVERED_STRATEGIES) {
    if (migrable <= 0) break;
    if (!active.includes(strategy)) continue;
    const held = shorts.get(strategy) ?? 0;
    if (held <= 0) continue;
    const own = ownCover(allocations, strategyCoverSources(strategy, active));
    const take = Math.min(held - Math.min(held, own), migrable);
    if (take > 0) {
      taken.set(strategy, take);
      migrable -= take;
    }
  }
  return taken;
}
```

Mettre à jour son commentaire : « minus Others' own naked part — what its sources, the inactive
strategies' covers, do not cover ». Faire suivre `active` : `migratedByContract(open, priced,
active)` → `migratedContracts(…, active)` ; `linesByGroup(open, strategy, priced, taken, active)`
→ `line(…, strategyCoverSources(strategy, active))` ; `strategyPositions(rows, strategy,
snapshot, active = ACTIVABLE_STRATEGIES)`. Le commentaire du test existant vers la ligne 474
(« STRATEGY_COVER_SOURCES.others is empty ») devient « strategyCoverSources("others") is empty
with every strategy active ». Importer `ACTIVABLE_STRATEGIES, type ActivableStrategy` de
`@ib/ledger`. Vérifier `grep -rn "STRATEGY_COVER_SOURCES\|COVERED_STRATEGIES" packages apps` :
plus aucun usage hors de ce fichier ; retirer les exports correspondants de
`packages/coverage/src/index.ts` s'ils y sont, et exporter `strategyCoverSources`.

- [x] **Step 4: Run the tests**

Run (depuis `packages/coverage`) : `npx vitest run` puis `npx tsc --noEmit -p .`
Expected: PASS, tests existants inchangés.

- [x] **Step 5: Commit**

```bash
git add packages/coverage docs/plans/2026-09-23-strategies-actives.md
git commit -m "Donne à Autres les couvertures des stratégies inactives

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Badges et filtre Couverture d'Autres lus sur la ligne

**Files:**
- Modify: `apps/web/src/lib/riskReport.ts:100-125` (`strategyCoverageBadges`, `strategyCoverageValues`)
- Test: `apps/web/src/lib/riskReport.test.ts` (créer le `describe` s'il n'existe pas ; vérifier
  d'abord `ls apps/web/src/lib/riskReport*.test.ts`)

**Interfaces:**
- Consumes: `StrategyLine.coverage` qui, pour Autres, porte désormais les allocations de ses
  sources (tâche 2).
- Produces: signatures inchangées — `strategyCoverageBadges(line, strategy)`,
  `strategyCoverageValues(line, strategy)`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import type { StrategyLine } from "@ib/coverage";
import { strategyCoverageBadges, strategyCoverageValues } from "@/lib/riskReport";

/** A sold call of `quantity` contracts, its strategy's cover already on it. */
function soldCall(quantity: number, coverage: StrategyLine["coverage"]): StrategyLine {
  return {
    contract: { ticker: "MQZA", secType: "OPT", right: "C", strike: 20, expiry: "2026-10-16", currency: "USD" },
    kind: "short_call", label: "Short Call", quantity, avgPrice: 0.5, lastPrice: 0.4, marketValue: -40 * Math.abs(quantity),
    unrealizedPnl: null, dailyPnl: null, dayChange: null, decision: null, position: null, coverage, used: null,
  };
}

const leaps = (quantity: number) => ({ source: "leaps" as const, quantity, detail: "" });

describe("strategyCoverageBadges — Others", () => {
  it("shows the cover Others holds, then UNCOVERED for the rest only", () => {
    expect(strategyCoverageBadges(soldCall(-3, [leaps(2)]), "others").map((b) => b.label)).toEqual(["leaps ×2", "UNCOVERED ×1"]);
    expect(strategyCoverageValues(soldCall(-3, [leaps(2)]), "others")).toEqual(["leaps", "UNCOVERED"]);
  });

  it("shows no UNCOVERED badge when Others' cover holds the whole line", () => {
    expect(strategyCoverageBadges(soldCall(-2, [leaps(2)]), "others").map((b) => b.label)).toEqual(["leaps ×2"]);
    expect(strategyCoverageValues(soldCall(-2, [leaps(2)]), "others")).toEqual(["leaps"]);
  });

  it("keeps UNCOVERED ×n on a line without any cover, as before", () => {
    expect(strategyCoverageBadges(soldCall(-2, []), "others").map((b) => b.label)).toEqual(["UNCOVERED ×2"]);
    expect(strategyCoverageValues(soldCall(-2, []), "others")).toEqual(["UNCOVERED"]);
  });
});
```

Adapter la forme de `CoverageAllocation` (`detail` et tout autre champ requis) à son type réel
dans `packages/coverage/src/types.ts`.

- [ ] **Step 2: Run tests to verify they fail**

Run (depuis `apps/web`) : `npx vitest run riskReport`
Expected: FAIL — la première attente rend `["UNCOVERED ×3"]`.

- [ ] **Step 3: Implement**

```ts
/** What of a sold line its strategy's cover leaves naked. */
function nakedQuantity(line: StrategyLine): number {
  return Math.max(0, Math.abs(line.quantity) - line.coverage.reduce((n, allocation) => n + allocation.quantity, 0));
}

export function strategyCoverageBadges(line: StrategyLine, strategy: PositionsStrategy): CoverageBadge[] {
  if (line.kind === "short_call" || line.kind === "short_put") {
    const badges = allocationBadges(line.coverage);
    if (strategy !== "others") return badges;
    const naked = nakedQuantity(line);
    if (naked > 0) badges.push({ variant: COVERAGE_SOURCE_VARIANT[COVER_NONE], label: `${COVER_NONE} ×${naked}`, tooltip: null });
    return badges;
  }
  // … branche des options achetées inchangée …
}

export function strategyCoverageValues(line: StrategyLine, strategy: PositionsStrategy): string[] {
  if (line.kind === "short_call" || line.kind === "short_put") {
    const sources = new Set<string>(line.coverage.map((allocation) => allocation.source));
    if (strategy === "others" && nakedQuantity(line) > 0) sources.add(COVER_NONE);
    return [...sources];
  }
  // … inchangé …
}
```

Réécrire le paragraphe « Others is the exception » du commentaire : Autres montre la couverture
de ses sources — celles des stratégies inactives — puis `UNCOVERED` pour le reste.

- [ ] **Step 4: Run the tests**

Run (depuis `apps/web`) : `npx vitest run riskReport StrategyPositions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib docs/plans/2026-09-23-strategies-actives.md
git commit -m "Lit la couverture d'Autres sur la ligne, UNCOVERED pour le seul reste

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Le réglage du compte alimente le moteur et les pages

**Files:**
- Modify: `apps/web/src/db/schema.ts:11-35` (`AccountRecord`)
- Create: `apps/web/src/lib/strategies.ts`, `apps/web/src/lib/strategies.test.ts`
- Modify: `apps/web/src/db/accounts.ts` (`setActiveStrategies`), `apps/web/src/db/accounts.test.ts`
- Modify: `apps/web/src/db/hooks.ts:143-160` (`useActiveStrategies`, `useJournals`)
- Modify: `apps/web/src/db/AccountDataProvider.tsx` (`useAccountStrategies`)
- Modify: `apps/web/src/pages/StrategyPositionsPage.tsx:60-80`
- Modify: `apps/web/src/components/PositionGroupCard.tsx:78`, `apps/web/src/components/PositionSuggestionsCard.tsx:89`
- Modify: `apps/web/src/mocks/seed.ts` (`seedDemo`)
- Modify: tests web qui sèment un compte et attendent LEAPS ou Condors (étape 6)

**Interfaces:**
- Consumes: `buildJournals(…, active)` (tâche 1), `strategyPositions(…, active)` (tâche 2).
- Produces:
  - `AccountRecord.strategies?: ActivableStrategy[]`
  - `DEFAULT_ACTIVE_STRATEGIES: readonly ActivableStrategy[]` (= `["wheel"]`)
  - `activeStrategies(account: Pick<AccountRecord, "strategies"> | null | undefined): ActivableStrategy[]`
  - `setActiveStrategies(db: AppDatabase, accountId: string, strategies: readonly ActivableStrategy[]): Promise<void>`
  - `useActiveStrategies(accountId: string): readonly ActivableStrategy[] | undefined` (undefined = chargement)
  - `useJournals(accountId: string, active: readonly ActivableStrategy[] | undefined): JournalsView`
  - `useAccountStrategies(): readonly ActivableStrategy[] | undefined` (lève hors du fournisseur)

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/strategies.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { activeStrategies } from "@/lib/strategies";

describe("activeStrategies", () => {
  it("is the Wheel alone for an account that never chose", () => {
    expect(activeStrategies({})).toEqual(["wheel"]);
    expect(activeStrategies(null)).toEqual(["wheel"]);
  });

  it("keeps an empty choice empty: everything goes to Others", () => {
    expect(activeStrategies({ strategies: [] })).toEqual([]);
  });

  it("returns the canonical order, without duplicates nor values this browser does not know", () => {
    const written = ["condors", "future", "wheel", "condors"] as unknown as ("wheel" | "leaps" | "condors")[];
    expect(activeStrategies({ strategies: written })).toEqual(["wheel", "condors"]);
  });
});
```

Dans `apps/web/src/db/accounts.test.ts`, sur le modèle des tests de `setFlexRelay` :

```ts
it("writes the whole list of active strategies, in canonical order", async () => {
  await setActiveStrategies(db, "alpha", ["condors", "wheel"]);
  expect((await db.accounts.get("alpha"))?.strategies).toEqual(["wheel", "condors"]);
  await setActiveStrategies(db, "alpha", []);
  expect((await db.accounts.get("alpha"))?.strategies).toEqual([]);
});
```

(adapter l'id du compte semé au `beforeEach` du fichier).

Dans `apps/web/src/db/hooks.test.tsx` (ou un nouveau `AccountDataProvider.test.tsx` si le
fichier ne teste pas `useJournals`), un test qui sème un compte sans `strategies` et le ledger
`SAMPLE_JOURNAL_TRANSACTIONS` (`@/mocks/journals`, qui porte un LEAPS et des condors), rend
un composant sonde sous `<AccountDataProvider accountId=…>` affichant les stratégies des lignes
de `useAccountJournals()`, et vérifie :
1. aucune ligne `leaps` ni `condors` ;
2. après `await setActiveStrategies(db, id, ["wheel", "leaps", "condors"])`, des lignes `leaps`
   et `condors` apparaissent **sans remonter le composant** (`findByText`) ;
3. `useAccountStrategies()` rend `["wheel"]` puis `["wheel", "leaps", "condors"]`.

- [ ] **Step 2: Run tests to verify they fail**

Run (depuis `apps/web`) : `npx vitest run strategies accounts hooks AccountDataProvider`
Expected: FAIL — modules et fonctions introuvables.

- [ ] **Step 3: Implement the setting**

`schema.ts`, dans `AccountRecord` :

```ts
  /** The strategies this account follows (sub-project 30). Absent: the Wheel alone — read it through `activeStrategies`. */
  strategies?: ActivableStrategy[];
```

`apps/web/src/lib/strategies.ts` :

```ts
import { ACTIVABLE_STRATEGIES, type ActivableStrategy } from "@ib/ledger";
import type { AccountRecord } from "@/db/schema";

/** What an account that never chose follows: the application's default, never the engine's. */
export const DEFAULT_ACTIVE_STRATEGIES: readonly ActivableStrategy[] = ["wheel"];

/**
 * The only reader of `AccountRecord.strategies` (spec of sub-project 30, §2): the canonical
 * order, no duplicate, and a value this browser does not know — written by a newer one, restored
 * from its backup — ignored, never an error.
 */
export function activeStrategies(account: Pick<AccountRecord, "strategies"> | null | undefined): ActivableStrategy[] {
  const chosen: readonly string[] = account?.strategies ?? DEFAULT_ACTIVE_STRATEGIES;
  return ACTIVABLE_STRATEGIES.filter((strategy) => chosen.includes(strategy));
}
```

`accounts.ts` :

```ts
/** Saved on its own, the moment a box changes; always the whole list, never an absent field. */
export async function setActiveStrategies(db: AppDatabase, accountId: string, strategies: readonly ActivableStrategy[]): Promise<void> {
  await db.accounts.update(accountId, { strategies: ACTIVABLE_STRATEGIES.filter((strategy) => strategies.includes(strategy)) });
}
```

- [ ] **Step 4: Feed the engine and expose the list**

`hooks.ts` :

```ts
/** The account's active strategies, one stable array per distinct choice; `undefined` while loading. */
export function useActiveStrategies(accountId: string): readonly ActivableStrategy[] | undefined {
  const account = useAccount(accountId);
  const key = account === undefined ? null : activeStrategies(account).join(",");
  return useMemo(() => (key === null ? undefined : key === "" ? [] : (key.split(",") as ActivableStrategy[])), [key]);
}

export function useJournals(accountId: string, active: readonly ActivableStrategy[] | undefined): JournalsView {
  // … lectures existantes …
  return useMemo<JournalsView>(() => {
    if (ledger === undefined || snapshot === undefined || inputs === undefined || active === undefined) return { status: "loading" };
    // … inchangé jusqu'à l'appel …
      report: buildJournals(ledger, snapshot ? { asOf: snapshot.asOf, positions: snapshot.positions } : undefined, identities, active),
  }, [ledger, snapshot, inputs, active]);
}
```

`AccountDataProvider.tsx` : `AccountData` gagne `strategies: readonly ActivableStrategy[] | undefined` ;

```ts
  const strategies = useActiveStrategies(accountId);
  const journals = useJournals(accountId, strategies);
  // … value: { journals, risk: {…}, strategies }, dépendance ajoutée …

/** The account's active strategies, the list its journals were built with; `undefined` while loading. */
export function useAccountStrategies(): readonly ActivableStrategy[] | undefined {
  return useAccountData("useAccountStrategies").strategies;
}
```

Corriger tout autre appel de `useJournals` (`grep -rn "useJournals(" apps/web/src`).

- [ ] **Step 5: Use the list in the pages and charts**

`StrategyPositionsPage.tsx` : `const active = useAccountStrategies();` ; le `useMemo` des
encadrés attend `active !== undefined` dans `ready` et appelle
`strategyPositions(rows, strategy, pricedSnapshot(snapshot, report), active)`, `active` en
dépendance.

`PositionGroupCard.tsx` et `PositionSuggestionsCard.tsx` : remplacer `strategies={STRATEGIES}`
par une portée stable :

```ts
  const active = useAccountStrategies();
  // Stable, never a literal per render: PositionChartRow memoizes its levels on it.
  const chartStrategies = useMemo<readonly Strategy[]>(() => [...(active ?? []), "others"], [active]);
```

`mocks/seed.ts`, à la fin de `seedDemo` — la démo montre toutes les stratégies ; `seedAccounts`
(première visite, `--empty`) garde le défaut :

```ts
  // The demo shows every strategy; a first visit (`seedAccounts` alone) keeps the default.
  await db.accounts.bulkUpdate(["alpha", "beta"].map((key) => ({ key, changes: { strategies: [...ACTIVABLE_STRATEGIES] } })));
```

(si la version de Dexie n'a pas `bulkUpdate`, deux `db.accounts.update`).

- [ ] **Step 6: Fix the web tests the default changes — by the seeded account, never the expectations**

Run (depuis `apps/web`) : `npx vitest run`
Chaque test qui échoue parce qu'il attend des lignes, pages ou chiffres LEAPS ou Condors (ou un
tableau de bord qui les compte) sur un compte semé sans `strategies` : ajouter
`strategies: [...ACTIVABLE_STRATEGIES]` **au compte semé** de ce test (ou à la constante de compte
du fichier). Ne jamais modifier une valeur attendue ; un test dont l'échec ne s'explique pas par
ce défaut est un vrai bug, à signaler. Lister dans le message de commit les fichiers touchés.

- [ ] **Step 7: Run the tests**

Run (depuis `apps/web`) : `npx vitest run` puis `npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web docs/plans/2026-09-23-strategies-actives.md
git commit -m "Rejoue les journaux avec les stratégies actives du compte

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: La carte « Stratégies actives » de Sources de données

**Files:**
- Create: `apps/web/src/components/StrategiesCard.tsx`
- Modify: `apps/web/src/pages/SourcesPage.tsx:171-184` (monter la carte après celle du compte)
- Modify: `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`
- Test: `apps/web/src/pages/SourcesPage.test.tsx`

**Interfaces:**
- Consumes: `activeStrategies`, `setActiveStrategies` (tâche 4), `ACTIVABLE_STRATEGIES`.
- Produces: `StrategiesCard({ account }: { account: AccountRecord })`.

- [ ] **Step 1: Write the failing tests**

Dans `SourcesPage.test.tsx`, sur le modèle des tests existants (`renderSources`, compte `test`) :

```ts
describe("SourcesPage: active strategies", () => {
  it("shows one box per strategy, the Wheel alone checked by default", async () => {
    renderSources();
    const card = await screen.findByTestId("strategies-card");
    expect(within(card).getByRole("checkbox", { name: "Wheel" })).toBeChecked();
    expect(within(card).getByRole("checkbox", { name: "LEAPS" })).not.toBeChecked();
    expect(within(card).getByRole("checkbox", { name: "Condors" })).not.toBeChecked();
  });

  it("saves a box the moment it changes, and unchecking the last one leaves the list empty", async () => {
    const user = userEvent.setup();
    renderSources();
    const card = await screen.findByTestId("strategies-card");
    await user.click(within(card).getByRole("checkbox", { name: "LEAPS" }));
    await waitFor(async () => expect((await db.accounts.get("test"))?.strategies).toEqual(["wheel", "leaps"]));
    await user.click(within(card).getByRole("checkbox", { name: "Wheel" }));
    await user.click(within(card).getByRole("checkbox", { name: "LEAPS" }));
    await waitFor(async () => expect((await db.accounts.get("test"))?.strategies).toEqual([]));
  });
});
```

Si `toBeChecked` ne lit pas l'état du `Checkbox` base-ui, lire `aria-checked` (voir comment les
tests de `ColumnHeader` le font).

- [ ] **Step 2: Run tests to verify they fail**

Run (depuis `apps/web`) : `npx vitest run SourcesPage`
Expected: FAIL — `strategies-card` introuvable.

- [ ] **Step 3: Implement**

Clés i18n (fr ; en en miroir : « Active strategies », « What an unchecked strategy would have
taken goes to Others; the dashboard only counts the checked strategies. ») :

```json
"strategies": {
  "title": "Stratégies actives",
  "hint": "Ce qu'une stratégie décochée aurait pris va dans Autres ; le tableau de bord ne compte que les stratégies cochées.",
  "names": { "wheel": "Wheel", "leaps": "LEAPS", "condors": "Condors" }
}
```

sous `sources`. Et `help.app.text` gagne une phrase finale (fr : « Les stratégies suivies se
choisissent pour chaque compte dans Sources de données. » ; en : « The strategies followed are
chosen for each account in Data sources. » — reprendre le nom anglais réel de la page, `nav.sources`
dans `en.json`).

`StrategiesCard.tsx` :

```tsx
import { useTranslation } from "react-i18next";
import { ACTIVABLE_STRATEGIES } from "@ib/ledger";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { Checkbox } from "@ib/ui/checkbox";
import { setActiveStrategies } from "@/db/accounts";
import { db, type AccountRecord } from "@/db/schema";
import { activeStrategies } from "@/lib/strategies";

/** One box per strategy, saved the moment it changes (spec of sub-project 30, §6.1). */
export function StrategiesCard({ account }: { account: AccountRecord }) {
  const { t } = useTranslation();
  const active = activeStrategies(account);
  return (
    <Card data-testid="strategies-card">
      <CardHeader>
        <CardTitle>{t("sources.strategies.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-6">
          {ACTIVABLE_STRATEGIES.map((strategy) => (
            <label key={strategy} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={active.includes(strategy)}
                onCheckedChange={(on) =>
                  void setActiveStrategies(db, account.id, on === true ? [...active, strategy] : active.filter((s) => s !== strategy))
                }
                aria-label={t(`sources.strategies.names.${strategy}`)}
              />
              {t(`sources.strategies.names.${strategy}`)}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t("sources.strategies.hint")}</p>
      </CardContent>
    </Card>
  );
}
```

La monter dans `SourcesPage.tsx` juste après la carte `sources.account`, avec le compte déjà lu
par la page.

- [ ] **Step 4: Run the tests**

Run (depuis `apps/web`) : `npx vitest run SourcesPage HelpPage i18n`
Expected: PASS (un test de parité des clés fr/en, s'il existe, compris).

- [ ] **Step 5: Commit**

```bash
git add apps/web docs/plans/2026-09-23-strategies-actives.md
git commit -m "Ajoute la carte Stratégies actives à Sources de données

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Le menu et les routes suivent les stratégies actives

**Files:**
- Modify: `apps/web/src/lib/navigation.ts` (`NavSection.strategy`), `apps/web/src/lib/navigation.test.ts`
- Modify: `apps/web/src/components/app-sidebar.tsx:38-41`
- Create: `apps/web/src/routes/StrategyRoute.tsx`
- Modify: `apps/web/src/routes/router.tsx:35-47`
- Test: `apps/web/src/routes/AppLayout.test.tsx`, `apps/web/src/routes/StrategyRoute.test.tsx` (nouveau)

**Interfaces:**
- Consumes: `activeStrategies` (tâche 4), `useAccountStrategies` (tâche 4).
- Produces: `NavSection.strategy?: ActivableStrategy` ; `StrategyRoute({ strategy, children }: { strategy: Strategy; children: ReactNode })`.

- [ ] **Step 1: Write the failing tests**

`AppLayout.test.tsx` (helpers `renderAt`, `navHrefs`, `account` existants) :

```ts
describe("AppLayout: menu of the active strategies", () => {
  it("shows the Wheel and Others only for an account that never chose", async () => {
    await db.accounts.put(account("alpha", "U0000001"));
    renderAt("/accounts/alpha/dashboard");
    await screen.findByText("dashboard content");
    const hrefs = navHrefs();
    expect(hrefs).toContain("/accounts/alpha/journal/wheel");
    expect(hrefs).toContain("/accounts/alpha/journal/others");
    expect(hrefs.some((href) => href?.includes("leaps") || href?.includes("condors"))).toBe(false);
  });

  it("shows each account's own strategies", async () => {
    await db.accounts.bulkPut([
      { ...account("alpha", "U0000001"), strategies: ["leaps"] },
      { ...account("beta", "U0000002"), strategies: ["condors"] },
    ]);
    renderAt("/accounts/beta/dashboard");
    await screen.findByText("dashboard content");
    const hrefs = navHrefs();
    expect(hrefs).toContain("/accounts/beta/journal/condors");
    expect(hrefs.some((href) => href?.includes("wheel") || href?.includes("leaps"))).toBe(false);
  });

  it("keeps Others with no strategy active", async () => {
    await db.accounts.put({ ...account("alpha", "U0000001"), strategies: [] });
    renderAt("/accounts/alpha/dashboard");
    await screen.findByText("dashboard content");
    expect(navHrefs().filter((href) => href?.includes("/journal/"))).toEqual(["/accounts/alpha/journal/others"]);
  });
});
```

Les tests existants de `navHrefs` qui listent toutes les sections : donner au compte semé
`strategies: [...ACTIVABLE_STRATEGIES]`, sans changer la liste attendue.

`StrategyRoute.test.tsx` : un `MemoryRouter` sur `/accounts/alpha/journal/leaps`, route
`/accounts/:accountId` → `<WithAccountData><Outlet/></WithAccountData>`, enfants
`journal/leaps` → `<StrategyRoute strategy="leaps"><div>leaps journal</div></StrategyRoute>`,
`journal/others` → `<StrategyRoute strategy="others"><div>others journal</div></StrategyRoute>`,
`dashboard` → `<div>dashboard content</div>` :
1. compte sans `strategies` : `findByText("dashboard content")`, jamais « leaps journal » ;
2. compte `strategies: ["leaps"]` : « leaps journal » ;
3. Autres s'affiche avec `strategies: []` ;
4. pendant le chargement (compte absent de la base au rendu, ajouté ensuite avec
   `["leaps"]`), le test aboutit sur « leaps journal », preuve qu'aucune redirection n'est partie
   avant que la fiche soit lue.

- [ ] **Step 2: Run tests to verify they fail**

Run (depuis `apps/web`) : `npx vitest run AppLayout StrategyRoute navigation`
Expected: FAIL.

- [ ] **Step 3: Implement**

`navigation.ts` :

```ts
export interface NavSection {
  labelKey: string;
  /** The strategy the section serves: hidden while it is inactive (sub-project 30). Others has none, and always shows. */
  strategy?: ActivableStrategy;
  items: readonly NavItem[];
}
```

poser `strategy: "wheel"`, `"leaps"`, `"condors"` sur les trois sections de stratégie.

`app-sidebar.tsx` :

```ts
  const active = activeStrategies(accounts.find((account) => account.id === accountId));
  const visibleSections = NAV_SECTIONS.filter((section) => section.strategy === undefined || active.includes(section.strategy))
    .map((section) => ({ ...section, items: section.items.filter((item) => accountId !== null || !item.accountScoped) }))
    .filter((section) => section.items.length > 0);
```

(la barre latérale vit hors d'`AccountDataProvider` : elle lit la fiche dans `accounts`, déjà
reçue, par la même fonction.)

`StrategyRoute.tsx` :

```tsx
import type { ReactNode } from "react";
import { Navigate, useParams } from "react-router";
import type { Strategy } from "@ib/ledger";
import { useAccountStrategies } from "@/db/AccountDataProvider";

/**
 * A page of an inactive strategy sends to the account's dashboard (spec of sub-project 30, §6.3):
 * a bookmark never lands on an empty page. Nothing is decided while the account is still loading.
 */
export function StrategyRoute({ strategy, children }: { strategy: Strategy; children: ReactNode }) {
  const { accountId = "" } = useParams<{ accountId: string }>();
  const active = useAccountStrategies();
  if (strategy === "others") return children;
  if (active === undefined) return null;
  if (!active.includes(strategy)) return <Navigate to={`/accounts/${accountId}/dashboard`} replace />;
  return children;
}
```

`router.tsx` : envelopper chacune des onze routes `journal/*`, `positions/<stratégie>` et
`stats/*` — par exemple
`{ path: "journal/leaps", element: <StrategyRoute strategy="leaps"><JournalPage strategy="leaps" /></StrategyRoute> }`.
La redirection `premiums` → `../journal/wheel` reste ; si la Wheel est inactive, le garde
renvoie ensuite au tableau de bord.

- [ ] **Step 4: Run the tests**

Run (depuis `apps/web`) : `npx vitest run AppLayout StrategyRoute navigation router`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web docs/plans/2026-09-23-strategies-actives.md
git commit -m "Masque le menu et les routes des stratégies inactives

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Documentation, vérification finale, instance de relecture

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/specs/2026-09-23-strategies-actives-design.md` (statut)

- [ ] **Step 1: Update `CLAUDE.md`**

- Règle « Le tableau de bord est la portée `portfolio`… » : `scopeStrategies(scope, active)`
  remplace `SCOPE_STRATEGIES[scope]` ; la portée `portfolio` est la liste **active**, jamais les
  trois stratégies d'office ; Autres n'y entre jamais.
- Règle « Les positions d'une stratégie… » : `strategyCoverSources(strategy, active)` remplace
  `STRATEGY_COVER_SOURCES` ; Autres possède les sources des stratégies inactives, et
  `migratedContracts` ne retranche que sa part nue.
- Nouvelle règle, après « Comptes jamais combinés » : **Les stratégies actives sont un réglage du
  compte** — `AccountRecord.strategies`, lu par `activeStrategies` seul (`lib/strategies.ts`),
  absent = Wheel seule ; le moteur appelé sans liste garde les trois ; une ouverture n'est
  proposée qu'aux stratégies actives, sinon Autres, un groupe de plusieurs contrats sans les
  Condors allant tout entier dans Autres ; le menu masque les sections inactives, Autres
  toujours visible ; `StrategyRoute` renvoie une page inactive au tableau de bord ; les graphes
  de Positions et de Suggestion dessinent actives + Autres. Ajouter une stratégie : son entrée
  dans `ACTIVABLE_STRATEGIES`, sa règle dans `classify.ts`, ses sources, sa section, ses routes
  et ses libellés.
- Registre : ligne `| 30 | Les stratégies actives d'un compte | fait (<date>) |`.

- [ ] **Step 2: Mark the spec delivered**

`Statut : livré (<date>).` en tête de la spec.

- [ ] **Step 3: Run the whole check once**

Run (racine du worktree) : `pnpm check`
Expected: lint, typage, build et tous les tests verts.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs
git commit -m "Documente le sous-projet 30

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Start the review instance**

Run (racine du worktree) : `pnpm dev:start`, puis `pnpm dev:status` pour les deux URL, à
donner à Seb pour la relecture de la branche.
