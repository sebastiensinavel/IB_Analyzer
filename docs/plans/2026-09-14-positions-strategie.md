# Sous-projet 16 — Positions par stratégie et Suggestion de Position : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une page « Positions » aux stratégies Wheel et LEAPS, qui ne montre que la part de la stratégie dans le portefeuille IB, et une carte « Suggestion de Position » au tableau de bord.

**Architecture:** (1) `packages/ledger` : chaque `JournalRow` porte sa clé de contrat (`contract`), et `wheelHoldings` agrège par ticker les actions Wheel ouvertes et les calls Wheel ouverts. (2) `packages/coverage` : `wheelPositions` et `leapsPositions` croisent les lignes de journal ouvertes avec le snapshot par `contractId` (prix, valeur, P&L, décision, badges de la position IB) ; `positionSuggestions` porte `select_put_sell_candidates` de l'ancien outil, sur la valeur de risque (`riskValue`). (3) `apps/web` : `StrategyPositionsPage` sous `positions/wheel` et `positions/leaps`, entrée de menu, `PositionRow` partagée avec la page Positions, `PositionSuggestionsCard` en bas du tableau de bord. Rien n'est stocké.

**Tech Stack:** TypeScript 6, Vitest 4, React 19, react-router 8, Dexie 4 (`fake-indexeddb` en test), react-i18next, shadcn base-ui, Testing Library. Node 22, pnpm.

**Spec:** `docs/specs/2026-09-14-positions-strategie-design.md` (lire aussi `CLAUDE.md`).

## Global Constraints

- **Rien dans `apps/api`**, aucun endpoint, aucune table, aucune migration Dexie : tout se calcule depuis les journaux, le snapshot et la table sectorielle déjà en IndexedDB.
- **Une ligne est ouverte selon `endWhen === null`, jamais selon `ongoing`.**
- **Appariement journal ↔ snapshot par `contractId(row.contract)` = `contractId(contractOf(position))`**, jamais par `conid`.
- **`BUYBACK_RATIO` et `DEFAULT_MULTIPLIER` ne sont jamais redéfinis** ; `MIN_SUGGESTION_SCORE = 6`, `MAX_SUGGESTIONS = 20` et `MAX_SUGGESTION_TICKER_SHARE = 0.05` sont définis une seule fois, dans `packages/coverage/src/constants.ts`.
- **Une valeur absente reste `null`**, jamais `0`, et s'affiche « — » (exception spécifiée : une valeur de risque inconnue compte pour 0 dans la suggestion).
- **Les comptes ne se combinent jamais** : la suggestion lit le rapport de risque du compte affiché ; la table sectorielle reste commune.
- **Aucune page n'appelle `useJournals` ni `useRiskReport`** : elles lisent `useAccountJournals` et `useAccountRiskReport`.
- **Toute phrase vit dans `apps/web/src/i18n/{fr,en}.json`, mêmes clés dans les deux.** Les libellés de type (`sell of call`…) et les badges de couverture du rapport (`stock ×1`, `used 1/1`) restent en anglais, comme sur Positions.
- **shadcn ici est base-ui** : `render={<X/>}`, jamais `asChild`. Aucun nouveau composant shadcn, aucune nouvelle dépendance.
- **Un test doit échouer si le comportement change.** `apps/web` teste sur `fake-indexeddb` avec une base semée, **jamais en moquant les hooks**.
- Code et commentaires en anglais ; documentation, i18n et messages de commit en français.
- Chaque commit se termine par les deux lignes :
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NACu2yrhhokgAokMgFU55P
  ```
- Le travail se fait dans un worktree `.claude/worktrees/positions-strategie` (skill `superpowers:using-git-worktrees`), branche `positions-strategie`, mergé sur `main` après revue. `private/` n'existe pas dans le worktree.
- **Les cases de ce plan se cochent dans le worktree au fur et à mesure, dans le même commit que la tâche.**
- Commandes lancées depuis la racine du worktree : `pnpm --filter @ib/ledger test <fichier>`, `pnpm --filter @ib/coverage test <fichier>`, `pnpm --filter web test <fichier>` ; typage par `pnpm --filter <paquet> typecheck`.

---

## Structure des fichiers

```
packages/ledger/src/journals/
  types.ts                 JournalRow.contract
  rows.ts                  buildRow copie lot.contract
  replay.ts                settlementRow porte contractOf(tx)
  holdings.ts              NOUVEAU  WheelHolding, wheelHoldings
  holdings.test.ts         NOUVEAU
  index.ts                 export * from "./holdings.ts"
  rows.test.ts, replay.test.ts, capital.test.ts, stats.test.ts   champ contract
packages/coverage/src/
  constants.ts             MIN_SUGGESTION_SCORE, MAX_SUGGESTIONS, MAX_SUGGESTION_TICKER_SHARE
  strategy.ts              NOUVEAU  StrategyLine, WheelShareLine, WheelPositions, LeapsPositions,
                                    PricedSnapshot, wheelPositions, leapsPositions
  strategy.test.ts         NOUVEAU
  suggestions.ts           NOUVEAU  SectorEntry, PositionSuggestion, positionSuggestions
  suggestions.test.ts      NOUVEAU
  index.ts                 exports
apps/web/src/
  lib/riskReport.ts (+ test)        decisionBadge(decision), coverageBadges(position | null)
  lib/businessConstants.test.ts     trois constantes de suggestion interdites dans apps/web
  lib/positionColumns.ts            WHEEL_SHARE_COLUMNS
  lib/navigation.ts (+ test)        entrée Positions dans Wheel et LEAPS
  components/PositionTable.tsx      PositionTableHeader
  components/PositionRow.tsx        NOUVEAU  ligne partagée (sortie de PositionsPage)
  components/PositionSuggestionsCard.tsx   NOUVEAU
  pages/PositionsPage.tsx           utilise PositionRow et PositionTableHeader
  pages/StrategyPositionsPage.tsx   NOUVEAU
  pages/StrategyPositionsPage.test.tsx     NOUVEAU
  pages/DashboardPage.tsx (+ test)  carte de suggestion
  routes/router.tsx (+ test)        positions/wheel, positions/leaps
  routes/AppLayout.test.tsx         liens du menu
  mocks/journals.ts                 call Wheel MQZA ouvert dans la graine
  mocks/seed.test.ts                holdings de la graine
  i18n/fr.json, en.json             strategyPositions.*, dashboard.suggestions.*
apps/web/e2e/corporate-actions.spec.ts   lien Positions désigné par son href
docs/specs/2026-09-14-positions-strategie-design.md   statut
docs/points-reportes.md
CLAUDE.md
```

---

### Task 1: `JournalRow.contract`

**Files:**
- Modify: `packages/ledger/src/journals/types.ts` (interface `JournalRow`)
- Modify: `packages/ledger/src/journals/rows.ts` (`buildRow`)
- Modify: `packages/ledger/src/journals/replay.ts` (`settlementRow`)
- Test: `packages/ledger/src/journals/replay.test.ts`, `packages/ledger/src/journals/rows.test.ts`, `packages/ledger/src/journals/capital.test.ts`, `packages/ledger/src/journals/stats.test.ts`, `apps/web/src/lib/journalTone.test.ts`

**Interfaces:**
- Produces: `JournalRow.contract: ContractKey` — `{ ticker, secType, right, strike, expiry, currency }`, le ticker canonique comme `row.ticker` ; la ligne composite d'un condor a `right: ""`, `strike: null` et l'échéance du condor.

- [x] **Step 1: Write the failing test**

Ajouter à la fin de `packages/ledger/src/journals/replay.test.ts` :

```ts
describe("buildJournals — the contract of each line", () => {
  it("carries the contract of an option, of delivered shares, of a condor composite and of a settlement", () => {
    const options = buildJournals([option({ ...PUT, quantity: -2, price: 0.21, when: D1 }), ...deliver({ ...PUT, quantity: 2 })]);
    expect(row(options, "flex:trade:1#1").contract).toEqual({ ticker: "MQZA", secType: "OPT", right: "P", strike: 17, expiry: "2026-10-02", currency: "USD" });
    expect(row(options, "flex:trade:3#1").contract).toEqual({ ticker: "MQZA", secType: "STK", right: "", strike: null, expiry: null, currency: "USD" });

    const when = "2026-08-03T14:30:00.000Z";
    const leg = (right: "C" | "P", strike: number, quantity: number) =>
      option({ ticker: "SPY", right, strike, expiry: "2026-08-29", quantity, price: 0.5, when });
    const condor = buildJournals([leg("P", 620, 1), leg("P", 625, -1), leg("C", 660, -1), leg("C", 665, 1)]);
    expect(condor.rows.find((r) => r.kind === "condor")?.contract).toEqual({
      ticker: "SPY", secType: "OPT", right: "", strike: null, expiry: "2026-08-29", currency: "USD",
    });

    const cash = buildJournals([settlement({ ticker: "SPX", right: "C", strike: 5000, expiry: "2026-08-21", amount: 150, when: "2026-08-21T00:00:00.000Z" })]);
    expect(cash.rows.find((r) => r.kind === "settlement")?.contract).toEqual({
      ticker: "SPX", secType: "OPT", right: "C", strike: 5000, expiry: "2026-08-21", currency: "USD",
    });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ib/ledger test src/journals/replay.test.ts`
Expected: FAIL — `expected undefined to deeply equal { ticker: 'MQZA', … }`.

- [x] **Step 3: Write minimal implementation**

`packages/ledger/src/journals/types.ts`, dans `JournalRow`, juste après `currency: string;` :

```ts
  /** The line's contract, its ticker canonical like `ticker`; a condor composite has no right nor strike. */
  contract: ContractKey;
```

`packages/ledger/src/journals/rows.ts`, dans l'objet rendu par `buildRow`, juste après `currency: lot.contract.currency,` :

```ts
    // A copy: a corporate action later moves the lot to another contract, never this row.
    contract: { ...lot.contract },
```

`packages/ledger/src/journals/replay.ts`, dans l'objet rendu par `settlementRow`, juste après `currency: tx.currency,` :

```ts
    contract,
```

- [x] **Step 4: Update the tests that build or compare whole rows**

`packages/ledger/src/journals/rows.test.ts`, dans le `expect(row).toEqual({…})` de « prorates the opening over the portion closed and nets the exit », après `currency: "USD",` :

```ts
      contract: { ticker: "MQZA", secType: "OPT", right: "P", strike: 17, expiry: "2026-10-02", currency: "USD" },
```

`packages/ledger/src/journals/replay.test.ts`, dans le `expect(row(report, "flex:trade:3#1")).toEqual({…})` de « reads an assignment from the share delivery at the strike… », après `currency: "USD",` :

```ts
      contract: { ticker: "MQZA", secType: "STK", right: "", strike: null, expiry: null, currency: "USD" },
```

Dans les fabriques `row()` de `packages/ledger/src/journals/capital.test.ts` et `packages/ledger/src/journals/stats.test.ts`, après `currency: "USD",` :

```ts
    contract: { ticker: "MQZA", secType: "OPT", right: "P", strike: 17, expiry: "2026-10-02", currency: "USD" },
```

Dans la fabrique `row()` de `apps/web/src/lib/journalTone.test.ts`, après `currency: "USD",` :

```ts
    contract: { ticker: "MQZA", secType: "OPT", right: "P", strike: null, expiry: null, currency: "USD" },
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @ib/ledger test && pnpm --filter @ib/ledger typecheck && pnpm --filter @ib/ib-parsers test src/journals.oracle.test.ts && pnpm --filter web test src/lib/journalTone.test.ts && pnpm --filter web typecheck`
Expected: PASS partout, oracle des journaux compris.

- [x] **Step 6: Commit**

```bash
git add packages/ledger/src/journals apps/web/src/lib/journalTone.test.ts docs/plans/2026-09-14-positions-strategie.md
git commit -m "feat(ledger): chaque ligne de journal porte la clé de son contrat

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NACu2yrhhokgAokMgFU55P"
```

---

### Task 2: `wheelHoldings`

**Files:**
- Create: `packages/ledger/src/journals/holdings.ts`
- Create: `packages/ledger/src/journals/holdings.test.ts`
- Modify: `packages/ledger/src/journals/index.ts`

**Interfaces:**
- Consumes: `JournalRow` (Task 1), `DEFAULT_MULTIPLIER` (`packages/ledger/src/constants.ts`).
- Produces, exportés par `@ib/ledger` :
  ```ts
  export interface WheelHolding {
    ticker: string;
    currency: string;
    quantity: number;
    averageAssignmentPrice: number | null;
    assignedTotal: number | null;
    openCallContracts: number;
    averageCallStrike: number | null;
    coveredShares: number;
  }
  export function wheelHoldings(rows: readonly JournalRow[]): WheelHolding[];
  ```

- [x] **Step 1: Write the failing test**

`packages/ledger/src/journals/holdings.test.ts` :

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { deliver, option, resetIds, stock } from "./fixtures.ts";
import { wheelHoldings } from "./holdings.ts";
import { buildJournals } from "./replay.ts";

beforeEach(resetIds);

const D1 = "2026-08-01T14:30:00.000Z";
const PUT = { right: "P" as const, strike: 17, expiry: "2026-10-02" };
const CALL = { right: "C" as const, strike: 20, expiry: "2026-11-20" };

describe("wheelHoldings", () => {
  it("reads an assigned put and the call sold on its shares", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -2, price: 0.21, when: D1 }),
      ...deliver({ ...PUT, quantity: 2 }),
      option({ ...CALL, quantity: -1, price: 0.5, when: "2026-10-05T14:30:00.000Z" }),
    ]);
    expect(wheelHoldings(report.rows)).toEqual([
      { ticker: "MQZA", currency: "USD", quantity: 200, averageAssignmentPrice: 17, assignedTotal: 3400, openCallContracts: 1, averageCallStrike: 20, coveredShares: 100 },
    ]);
  });

  it("averages two assignments at different strikes, the total equal to the Wheel's assigned capital", () => {
    const PUT15 = { right: "P" as const, strike: 15, expiry: "2026-10-16" };
    const report = buildJournals([
      option({ ...PUT, quantity: -1, price: 0.21, when: D1 }),
      ...deliver({ ...PUT, quantity: 1 }),
      option({ ...PUT15, quantity: -1, price: 0.3, when: "2026-10-05T14:30:00.000Z" }),
      ...deliver({ ...PUT15, quantity: 1 }),
    ]);
    const [holding] = wheelHoldings(report.rows);
    expect(holding).toMatchObject({ quantity: 200, averageAssignmentPrice: 16, assignedTotal: 3200, openCallContracts: 0, averageCallStrike: null, coveredShares: 0 });
    expect(report.capital.wheel[0].exposure[0].assigned).toBe(holding.assignedTotal);
  });

  it("reads shares taken over by a covered call at the call's strike", () => {
    const report = buildJournals([
      stock({ quantity: 100, price: 10, when: "2026-03-02T14:30:00.000Z" }),
      option({ right: "C", strike: 20, expiry: "2026-09-18", quantity: -1, price: 0.5, when: "2026-08-03T14:30:00.000Z" }),
    ]);
    expect(wheelHoldings(report.rows)).toEqual([
      { ticker: "MQZA", currency: "USD", quantity: 100, averageAssignmentPrice: 20, assignedTotal: 2000, openCallContracts: 1, averageCallStrike: 20, coveredShares: 100 },
    ]);
  });

  it("forgets a call bought back and averages the calls still open by contract", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -3, price: 0.21, when: D1 }),
      ...deliver({ ...PUT, quantity: 3 }),
      option({ right: "C", strike: 20, expiry: "2026-11-20", quantity: -1, price: 0.5, when: "2026-10-05T14:30:00.000Z" }),
      option({ right: "C", strike: 22, expiry: "2026-12-18", quantity: -1, price: 0.4, when: "2026-10-06T14:30:00.000Z" }),
      option({ right: "C", strike: 18, expiry: "2026-11-20", quantity: -1, price: 0.9, when: "2026-10-07T14:30:00.000Z" }),
      option({ right: "C", strike: 18, expiry: "2026-11-20", quantity: 1, price: 0.1, when: "2026-10-09T14:30:00.000Z" }),
    ]);
    expect(wheelHoldings(report.rows)).toEqual([
      { ticker: "MQZA", currency: "USD", quantity: 300, averageAssignmentPrice: 17, assignedTotal: 5100, openCallContracts: 2, averageCallStrike: 21, coveredShares: 200 },
    ]);
  });

  it("caps the covered shares at the shares still held when some were sold under open calls", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -2, price: 0.21, when: D1 }),
      ...deliver({ ...PUT, quantity: 2 }),
      option({ ...CALL, quantity: -2, price: 0.5, when: "2026-10-05T14:30:00.000Z" }),
      stock({ quantity: -100, price: 18, when: "2026-10-08T15:00:00.000Z" }),
    ]);
    expect(wheelHoldings(report.rows)).toEqual([
      { ticker: "MQZA", currency: "USD", quantity: 100, averageAssignmentPrice: 17, assignedTotal: 1700, openCallContracts: 2, averageCallStrike: 20, coveredShares: 100 },
    ]);
  });

  it("leaves out a ticker whose Wheel shares are all sold, even with a call still open", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -1, price: 0.21, when: D1 }),
      ...deliver({ ...PUT, quantity: 1 }),
      option({ ...CALL, quantity: -1, price: 0.5, when: "2026-10-05T14:30:00.000Z" }),
      stock({ quantity: -100, price: 18, when: "2026-10-08T15:00:00.000Z" }),
    ]);
    expect(wheelHoldings(report.rows)).toEqual([]);
  });

  it("counts the Wheel's shares only, never shares bought beside them", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -2, price: 0.21, when: D1 }),
      ...deliver({ ...PUT, quantity: 2 }),
      stock({ quantity: 50, price: 18, when: "2026-10-05T14:30:00.000Z" }),
    ]);
    expect(wheelHoldings(report.rows)).toEqual([
      { ticker: "MQZA", currency: "USD", quantity: 200, averageAssignmentPrice: 17, assignedTotal: 3400, openCallContracts: 0, averageCallStrike: null, coveredShares: 0 },
    ]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ib/ledger test src/journals/holdings.test.ts`
Expected: FAIL — `Failed to resolve import "./holdings.ts"`.

- [x] **Step 3: Write minimal implementation**

`packages/ledger/src/journals/holdings.ts` :

```ts
import { DEFAULT_MULTIPLIER } from "../constants.ts";
import type { JournalRow } from "./types.ts";

/** What the Wheel holds of one ticker now: its open shares and the calls sold on them (spec of sub-project 16, §2.2). */
export interface WheelHolding {
  ticker: string;
  currency: string;
  /** Shares of the open Wheel lots, never the whole IB position. */
  quantity: number;
  /** Σ openPrice × quantity ÷ quantity; `null` when a lot has no price. */
  averageAssignmentPrice: number | null;
  /** Σ openPrice × quantity: the Wheel's `assigned` capital for this ticker. */
  assignedTotal: number | null;
  /** Contracts of the Wheel calls still open on the ticker. */
  openCallContracts: number;
  /** Σ strike × contracts ÷ contracts; `null` without an open call. */
  averageCallStrike: number | null;
  /** min(quantity, openCallContracts × DEFAULT_MULTIPLIER). */
  coveredShares: number;
}

interface Group {
  ticker: string;
  currency: string;
  shares: JournalRow[];
  calls: JournalRow[];
}

/**
 * The open Wheel lines per ticker and currency, read off `endWhen`, never `ongoing`: an assigned put
 * stays ongoing until its shares are sold. A share line's `openPrice` is the strike of the put that
 * delivered it or of the call that took it over; both average together.
 */
export function wheelHoldings(rows: readonly JournalRow[]): WheelHolding[] {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    if (row.strategy !== "wheel" || row.endWhen !== null) continue;
    if (row.kind !== "shares" && row.kind !== "short_call") continue;
    const key = `${row.ticker}|${row.currency}`;
    const group = groups.get(key) ?? { ticker: row.ticker, currency: row.currency, shares: [], calls: [] };
    (row.kind === "shares" ? group.shares : group.calls).push(row);
    groups.set(key, group);
  }

  const holdings: WheelHolding[] = [];
  for (const { ticker, currency, shares, calls } of groups.values()) {
    const quantity = shares.reduce((n, row) => n + (row.quantity ?? 0), 0);
    if (quantity <= 0) continue;
    const unpriced = shares.some((row) => row.quantity === null || row.openPrice === null);
    const assignedTotal = unpriced ? null : shares.reduce((n, row) => n + (row.openPrice as number) * (row.quantity as number), 0);
    const openCallContracts = calls.reduce((n, row) => n + Math.abs(row.quantity ?? 0), 0);
    const unstruck = calls.some((row) => row.quantity === null || row.strike === null);
    const averageCallStrike =
      openCallContracts === 0 || unstruck
        ? null
        : calls.reduce((n, row) => n + (row.strike as number) * Math.abs(row.quantity as number), 0) / openCallContracts;
    holdings.push({
      ticker,
      currency,
      quantity,
      averageAssignmentPrice: assignedTotal === null ? null : assignedTotal / quantity,
      assignedTotal,
      openCallContracts,
      averageCallStrike,
      coveredShares: Math.min(quantity, openCallContracts * DEFAULT_MULTIPLIER),
    });
  }
  return holdings.sort((a, b) => (a.ticker === b.ticker ? compare(a.currency, b.currency) : compare(a.ticker, b.ticker)));
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
```

`packages/ledger/src/journals/index.ts`, ajouter la ligne :

```ts
export * from "./holdings.ts";
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ib/ledger test src/journals/holdings.test.ts && pnpm --filter @ib/ledger typecheck`
Expected: PASS (7 tests).

- [x] **Step 5: Commit**

```bash
git add packages/ledger/src/journals/holdings.ts packages/ledger/src/journals/holdings.test.ts packages/ledger/src/journals/index.ts docs/plans/2026-09-14-positions-strategie.md
git commit -m "feat(ledger): wheelHoldings, les actions Wheel détenues et les calls ouverts par ticker

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NACu2yrhhokgAokMgFU55P"
```

---

### Task 3: `wheelPositions` et `leapsPositions`

**Files:**
- Create: `packages/coverage/src/strategy.ts`
- Create: `packages/coverage/src/strategy.test.ts`
- Modify: `packages/coverage/src/index.ts`

**Interfaces:**
- Consumes: `JournalRow.contract` (Task 1), `wheelHoldings`, `WheelHolding` (Task 2), `contractId`, `contractOf`, `sharesContract`, `ContractKey`, `Position`, `RowKind`, `Strategy` (`@ib/ledger`), `contractMultiplier`, `evaluateBuyback` (`./classify.ts`), `KIND_LABELS`, `DEFAULT_MULTIPLIER`, `PositionKind` (`./constants.ts`), `AnalyzedPosition`, `RiskReport` (`./types.ts`).
- Produces, exportés par `@ib/coverage` :
  ```ts
  export interface StrategyLine {
    contract: ContractKey; kind: PositionKind; label: string; quantity: number;
    avgPrice: number | null; lastPrice: number | null; marketValue: number | null; unrealizedPnl: number | null;
    decision: "buy back" | "keep" | null; position: AnalyzedPosition | null;
  }
  export interface WheelShareLine extends WheelHolding { lastPrice: number | null; unrealizedPnl: number | null; callStrikeBelowAssignment: boolean }
  export interface WheelPositions { shares: WheelShareLine[]; optionSales: StrategyLine[] }
  export interface LeapsPositions { optionBuys: StrategyLine[]; optionSales: StrategyLine[]; shares: StrategyLine[] }
  export interface PricedSnapshot { positions: readonly Position[]; report: RiskReport }
  export function wheelPositions(rows: readonly JournalRow[], snapshot: PricedSnapshot | null): WheelPositions;
  export function leapsPositions(rows: readonly JournalRow[], snapshot: PricedSnapshot | null): LeapsPositions;
  ```

- [x] **Step 1: Write the failing test**

`packages/coverage/src/strategy.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { ContractKey, JournalRow, Position } from "@ib/ledger";
import { option, stock } from "./fixtures.ts";
import { buildRiskReport } from "./report.ts";
import { leapsPositions, wheelPositions, type PricedSnapshot } from "./strategy.ts";

/** An open Wheel put on `contract`, one contract sold at 2. */
function row(overrides: Partial<JournalRow> & Pick<JournalRow, "contract">): JournalRow {
  const { contract } = overrides;
  return {
    id: "x#1", strategy: "wheel", kind: "short_put", ticker: contract.ticker, label: "", currency: contract.currency,
    startWhen: "2026-08-03T14:30:00.000Z", quantity: -1, strike: contract.strike, openPrice: 2, openTotal: 200, openCommission: -1, openNet: 199,
    assigned: false, endWhen: null, closePrice: null, closeTotal: null, closeCommission: null, closeNet: null, pnl: null,
    ongoing: true, event: null, orphan: false, note: null, openIds: [], closeIds: [], ...overrides,
  };
}

const opt = (ticker: string, right: "C" | "P", strike: number, expiry: string): ContractKey => ({ ticker, secType: "OPT", right, strike, expiry, currency: "USD" });
const shares = (ticker: string): ContractKey => ({ ticker, secType: "STK", right: "", strike: null, expiry: null, currency: "USD" });

const MARA_CALL = opt("MQZA", "C", 20, "2026-11-20");
const XOM_PUT = opt("XOM", "P", 100, "2026-10-16");

function priced(positions: Position[]): PricedSnapshot {
  return { positions, report: buildRiskReport(positions, null) };
}

describe("buildRiskReport", () => {
  it("keeps the report's positions in the snapshot's order, which the pricing relies on", () => {
    const positions = [
      option({ symbol: "XYZ", right: "C", strike: 110, quantity: 1 }),
      stock({ symbol: "AAPL", quantity: 100 }),
      option({ symbol: "XYZ", right: "C", strike: 105, quantity: -1 }),
      option({ symbol: "AAPL", right: "C", strike: 150, quantity: -1 }),
      option({ symbol: "XOM", right: "P", strike: 100, quantity: -2 }),
    ];
    const report = buildRiskReport(positions, null);
    expect(report.positions.map((p) => [p.symbol, p.strike, p.quantity])).toEqual(positions.map((p) => [p.symbol, p.strike ?? 0, p.quantity]));
  });
});

describe("wheelPositions — option sales", () => {
  it("keeps only the Wheel's part of a call shared with Others, with the badges of the whole IB position", () => {
    const rows = [
      row({ contract: MARA_CALL, kind: "short_call", quantity: -1, openPrice: 0.5 }),
      row({ id: "y#1", contract: MARA_CALL, strategy: "others", kind: "short_call", quantity: -1, openPrice: 0.5 }),
    ];
    const snapshot = priced([
      stock({ symbol: "MQZA", quantity: 100, avgPrice: 17, marketPrice: 18, marketValue: 1800 }),
      option({ symbol: "MQZA", right: "C", strike: 20, expiry: "2026-11-20", quantity: -2, avgPrice: 0.5, marketPrice: 0.25, marketValue: -50 }),
    ]);
    const { optionSales } = wheelPositions(rows, snapshot);
    expect(optionSales).toHaveLength(1);
    expect(optionSales[0]).toMatchObject({
      contract: MARA_CALL, kind: "short_call", label: "sell of call", quantity: -1, avgPrice: 0.5,
      lastPrice: 0.25, marketValue: -25, unrealizedPnl: 25, decision: "buy back",
    });
    expect(optionSales[0].position).toMatchObject({ quantity: -2, uncoveredQuantity: 1 });
    expect(optionSales[0].position?.allocations).toEqual([expect.objectContaining({ source: "stock", quantity: 1 })]);
  });

  it("prices nothing the snapshot does not hold, with or without a snapshot", () => {
    const rows = [row({ contract: XOM_PUT, quantity: -1, openPrice: 1.25 })];
    const blank = { quantity: -1, avgPrice: 1.25, lastPrice: null, marketValue: null, unrealizedPnl: null, decision: null, position: null };
    expect(wheelPositions(rows, null).optionSales).toEqual([expect.objectContaining(blank)]);
    expect(wheelPositions(rows, priced([stock({ symbol: "AAPL" })])).optionSales).toEqual([expect.objectContaining(blank)]);
  });

  it("keeps a put sold at 2 that is worth 1.5 as a keep, and signs it like IB", () => {
    const rows = [row({ contract: XOM_PUT, quantity: -1, openPrice: 2 })];
    const snapshot = priced([option({ symbol: "XOM", right: "P", strike: 100, expiry: "2026-10-16", quantity: -1, marketPrice: 1.5, marketValue: -150 })]);
    expect(wheelPositions(rows, snapshot).optionSales[0]).toMatchObject({ marketValue: -150, unrealizedPnl: 50, decision: "keep" });
  });

  it("merges the open lines of one contract, the price weighted by quantity, and skips closed lines and bare settlements", () => {
    const rows = [
      row({ contract: XOM_PUT, quantity: -1, openPrice: 1 }),
      row({ id: "x#2", contract: XOM_PUT, quantity: -3, openPrice: 2 }),
      row({ id: "x#3", contract: XOM_PUT, quantity: -5, openPrice: 9, endWhen: "2026-09-01T14:30:00.000Z" }),
      row({ id: "x#4", contract: XOM_PUT, quantity: null, openPrice: null }),
    ];
    expect(wheelPositions(rows, null).optionSales).toEqual([expect.objectContaining({ quantity: -4, avgPrice: 1.75 })]);
  });

  it("sorts by ticker, expiry, right and strike", () => {
    const rows = [
      row({ contract: XOM_PUT }),
      row({ id: "a#1", contract: MARA_CALL, kind: "short_call" }),
      row({ id: "b#1", contract: opt("MQZA", "P", 17, "2026-10-16") }),
      row({ id: "c#1", contract: opt("MQZA", "C", 18, "2026-10-16"), kind: "short_call" }),
    ];
    expect(wheelPositions(rows, null).optionSales.map((line) => line.contract)).toEqual([
      opt("MQZA", "C", 18, "2026-10-16"),
      opt("MQZA", "P", 17, "2026-10-16"),
      MARA_CALL,
      XOM_PUT,
    ]);
  });
});

describe("wheelPositions — assigned shares", () => {
  const held = (callStrike: number | null) => [
    row({ contract: shares("MQZA"), kind: "shares", quantity: 200, openPrice: 17 }),
    ...(callStrike === null ? [] : [row({ id: "c#1", contract: opt("MQZA", "C", callStrike, "2026-11-20"), kind: "short_call", quantity: -1, openPrice: 0.5 })]),
  ];
  const snapshot = priced([stock({ symbol: "MQZA", quantity: 200, avgPrice: 16, marketPrice: 18, marketValue: 3600 })]);

  it("prices the holding from the IB shares at the assignment price, and flags a call struck below it", () => {
    expect(wheelPositions(held(15), snapshot).shares).toEqual([
      {
        ticker: "MQZA", currency: "USD", quantity: 200, averageAssignmentPrice: 17, assignedTotal: 3400, openCallContracts: 1,
        averageCallStrike: 15, coveredShares: 100, lastPrice: 18, unrealizedPnl: 200, callStrikeBelowAssignment: true,
      },
    ]);
  });

  it("never flags a call struck above the assignment price, nor a holding without a call", () => {
    expect(wheelPositions(held(20), snapshot).shares[0].callStrikeBelowAssignment).toBe(false);
    expect(wheelPositions(held(null), snapshot).shares[0].callStrikeBelowAssignment).toBe(false);
  });

  it("leaves the price and the P&L blank without the IB shares", () => {
    expect(wheelPositions(held(15), null).shares[0]).toMatchObject({ lastPrice: null, unrealizedPnl: null });
  });
});

describe("leapsPositions", () => {
  const LEAPS = opt("ZZZ", "C", 15, "2027-06-18");
  const SOLD = opt("ZZZ", "C", 20, "2026-09-18");
  const rows = [
    row({ contract: LEAPS, strategy: "leaps", kind: "long_call", quantity: 1, openPrice: 3 }),
    row({ id: "s#1", contract: SOLD, strategy: "leaps", kind: "short_call", quantity: -1, openPrice: 0.5 }),
    row({ id: "d#1", contract: shares("ZZZ"), strategy: "leaps", kind: "shares", quantity: 100, openPrice: 20 }),
    row({ id: "w#1", contract: XOM_PUT }),
  ];
  const snapshot = priced([
    option({ symbol: "ZZZ", right: "C", strike: 15, expiry: "2027-06-18", quantity: 1, avgPrice: 3, marketPrice: 4, marketValue: 400 }),
    option({ symbol: "ZZZ", right: "C", strike: 20, expiry: "2026-09-18", quantity: -1, avgPrice: 0.5, marketPrice: 0.25, marketValue: -25 }),
    stock({ symbol: "ZZZ", quantity: 100, multiplier: null, avgPrice: 20, marketPrice: 21, marketValue: 2100 }),
  ]);

  it("splits the LEAPS bought, the calls sold against them and the shares they delivered, leaving the Wheel out", () => {
    const { optionBuys, optionSales, shares: delivered } = leapsPositions(rows, snapshot);
    expect(optionBuys).toEqual([expect.objectContaining({ kind: "long_call", label: "buy of call", marketValue: 400, unrealizedPnl: 100, decision: null })]);
    expect(optionSales).toEqual([expect.objectContaining({ kind: "short_call", marketValue: -25, unrealizedPnl: 25, decision: "buy back" })]);
    // The whole IB position, whatever covers it there: the 100 ZZZ shares of this snapshot come first.
    expect(optionSales[0].position).toMatchObject({ symbol: "ZZZ", strike: 20, quantity: -1 });
    // Shares count one unit each, whatever multiplier the IB row carries or lacks.
    expect(delivered).toEqual([expect.objectContaining({ kind: "long_stock", label: "long position", quantity: 100, marketValue: 2100, unrealizedPnl: 100, decision: null })]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ib/coverage test src/strategy.test.ts`
Expected: FAIL — `Failed to resolve import "./strategy.ts"`.

- [x] **Step 3: Write minimal implementation**

`packages/coverage/src/strategy.ts` :

```ts
import {
  contractId,
  contractOf,
  sharesContract,
  wheelHoldings,
  type ContractKey,
  type JournalRow,
  type Position,
  type RowKind,
  type Strategy,
  type WheelHolding,
} from "@ib/ledger";
import { contractMultiplier, evaluateBuyback } from "./classify.ts";
import { DEFAULT_MULTIPLIER, KIND_LABELS, type PositionKind } from "./constants.ts";
import type { AnalyzedPosition, RiskReport } from "./types.ts";

/** A strategy's part of one IB contract: one line of the option or share tables (spec of sub-project 16, §3). */
export interface StrategyLine {
  contract: ContractKey;
  /** short_put, short_call, long_call or long_stock. */
  kind: PositionKind;
  /** KIND_LABELS[kind], the Type column of the Positions page. */
  label: string;
  /** Signed: the strategy's open journal lines on this contract, summed. */
  quantity: number;
  /** Σ openPrice × |quantity| ÷ Σ |quantity|; `null` when a line has no price. */
  avgPrice: number | null;
  /** Market price of the IB position on the same contract; `null` when the snapshot does not hold it. */
  lastPrice: number | null;
  /** lastPrice × quantity × multiplier */
  marketValue: number | null;
  /** (lastPrice − avgPrice) × quantity × multiplier */
  unrealizedPnl: number | null;
  /** Short options only: evaluateBuyback(avgPrice, lastPrice); `null` otherwise or without both prices. */
  decision: "buy back" | "keep" | null;
  /** The whole IB position, for its coverage badges; `null` when the snapshot does not hold the contract. */
  position: AnalyzedPosition | null;
}

export interface WheelShareLine extends WheelHolding {
  lastPrice: number | null;
  /** (lastPrice − averageAssignmentPrice) × quantity */
  unrealizedPnl: number | null;
  /** averageCallStrike < averageAssignmentPrice; `false` when either is `null`. */
  callStrikeBelowAssignment: boolean;
}

export interface WheelPositions {
  shares: WheelShareLine[];
  optionSales: StrategyLine[];
}

export interface LeapsPositions {
  optionBuys: StrategyLine[];
  optionSales: StrategyLine[];
  shares: StrategyLine[];
}

/** The snapshot's positions and the risk report built from them, index for index. */
export interface PricedSnapshot {
  positions: readonly Position[];
  report: RiskReport;
}

interface Priced {
  position: Position;
  analyzed: AnalyzedPosition;
}

const LINE_KIND: Partial<Record<RowKind, PositionKind>> = {
  short_put: "short_put",
  short_call: "short_call",
  long_call: "long_call",
  shares: "long_stock",
};

/**
 * The snapshot keyed like the journals' reconciliation. `buildRiskReport` returns
 * `positions.map(analyze)` and the coverage engine never reorders that array, so the report's
 * position at `i` is the snapshot's position at `i` (a test in strategy.test.ts holds it).
 */
function pricedByContract(snapshot: PricedSnapshot | null): Map<string, Priced> {
  const byId = new Map<string, Priced>();
  if (!snapshot) return byId;
  snapshot.positions.forEach((position, i) => {
    const id = contractId(contractOf(position));
    if (!byId.has(id)) byId.set(id, { position, analyzed: snapshot.report.positions[i] });
  });
  return byId;
}

function line(group: readonly JournalRow[], priced: Priced | null): StrategyLine {
  const first = group[0];
  const kind = LINE_KIND[first.kind] as PositionKind;
  const quantity = group.reduce((n, row) => n + (row.quantity as number), 0);
  const weight = group.reduce((n, row) => n + Math.abs(row.quantity as number), 0);
  const avgPrice =
    weight === 0 || group.some((row) => row.openPrice === null)
      ? null
      : group.reduce((n, row) => n + (row.openPrice as number) * Math.abs(row.quantity as number), 0) / weight;
  const multiplier = kind === "long_stock" ? 1 : priced ? contractMultiplier(priced.position) : DEFAULT_MULTIPLIER;
  const lastPrice = priced?.position.marketPrice ?? null;
  const sold = kind === "short_put" || kind === "short_call";
  return {
    contract: first.contract,
    kind,
    label: KIND_LABELS[kind],
    quantity,
    avgPrice,
    lastPrice,
    marketValue: lastPrice === null ? null : lastPrice * quantity * multiplier,
    unrealizedPnl: lastPrice === null || avgPrice === null ? null : (lastPrice - avgPrice) * quantity * multiplier,
    decision: sold && lastPrice !== null && avgPrice !== null ? evaluateBuyback(avgPrice, lastPrice) : null,
    position: priced?.analyzed ?? null,
  };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareLines(a: StrategyLine, b: StrategyLine): number {
  return (
    compareText(a.contract.ticker, b.contract.ticker) ||
    compareText(a.contract.expiry ?? "", b.contract.expiry ?? "") ||
    compareText(a.contract.right, b.contract.right) ||
    (a.contract.strike ?? 0) - (b.contract.strike ?? 0)
  );
}

/** The open lines of `strategy` whose kind is one of `kinds`, one line per contract. */
function strategyLines(rows: readonly JournalRow[], strategy: Strategy, kinds: readonly RowKind[], priced: Map<string, Priced>): StrategyLine[] {
  const groups = new Map<string, JournalRow[]>();
  for (const row of rows) {
    if (row.strategy !== strategy || row.endWhen !== null || row.quantity === null || !kinds.includes(row.kind)) continue;
    const id = contractId(row.contract);
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  return [...groups.entries()].map(([id, group]) => line(group, priced.get(id) ?? null)).sort(compareLines);
}

export function wheelPositions(rows: readonly JournalRow[], snapshot: PricedSnapshot | null): WheelPositions {
  const priced = pricedByContract(snapshot);
  const shares = wheelHoldings(rows).map((holding): WheelShareLine => {
    const lastPrice = priced.get(contractId(sharesContract(holding.ticker, holding.currency)))?.position.marketPrice ?? null;
    const { averageAssignmentPrice, averageCallStrike } = holding;
    return {
      ...holding,
      lastPrice,
      unrealizedPnl: lastPrice === null || averageAssignmentPrice === null ? null : (lastPrice - averageAssignmentPrice) * holding.quantity,
      callStrikeBelowAssignment: averageCallStrike !== null && averageAssignmentPrice !== null && averageCallStrike < averageAssignmentPrice,
    };
  });
  return { shares, optionSales: strategyLines(rows, "wheel", ["short_put", "short_call"], priced) };
}

export function leapsPositions(rows: readonly JournalRow[], snapshot: PricedSnapshot | null): LeapsPositions {
  const priced = pricedByContract(snapshot);
  return {
    optionBuys: strategyLines(rows, "leaps", ["long_call"], priced),
    optionSales: strategyLines(rows, "leaps", ["short_call"], priced),
    shares: strategyLines(rows, "leaps", ["shares"], priced),
  };
}
```

`packages/coverage/src/index.ts`, ajouter la ligne :

```ts
export * from "./strategy.ts";
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ib/coverage test && pnpm --filter @ib/coverage typecheck`
Expected: PASS, oracle et tests portés compris.

- [x] **Step 5: Commit**

```bash
git add packages/coverage/src/strategy.ts packages/coverage/src/strategy.test.ts packages/coverage/src/index.ts docs/plans/2026-09-14-positions-strategie.md
git commit -m "feat(coverage): positions Wheel et LEAPS, part de la stratégie croisée avec le snapshot

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NACu2yrhhokgAokMgFU55P"
```

---

### Task 4: `positionSuggestions`

**Files:**
- Create: `packages/coverage/src/suggestions.ts`
- Create: `packages/coverage/src/suggestions.test.ts`
- Modify: `packages/coverage/src/constants.ts`
- Modify: `packages/coverage/src/index.ts`
- Modify: `apps/web/src/lib/businessConstants.test.ts`

**Interfaces:**
- Consumes: `riskValue` (`./report.ts`), `RiskReport` (`./types.ts`), `tickerOf` (`@ib/ledger`).
- Produces, exportés par `@ib/coverage` :
  ```ts
  export const MIN_SUGGESTION_SCORE = 6;
  export const MAX_SUGGESTIONS = 20;
  export const MAX_SUGGESTION_TICKER_SHARE = 0.05;
  export interface SectorEntry { ticker: string; category: string; score: number | null; status: string }
  export interface PositionSuggestion { rank: number; ticker: string; sector: string; score: number; sectorShare: number; tickerShare: number }
  export function positionSuggestions(entries: readonly SectorEntry[], report: RiskReport | null): PositionSuggestion[];
  ```

- [x] **Step 1: Write the failing test**

`packages/coverage/src/suggestions.test.ts` (les huit premiers cas portent `test_html_report.py` de l'ancien outil) :

```ts
import { describe, expect, it } from "vitest";
import type { Position } from "@ib/ledger";
import { MAX_SUGGESTIONS } from "./constants.ts";
import { option, stock } from "./fixtures.ts";
import { buildRiskReport } from "./report.ts";
import { positionSuggestions, type PositionSuggestion, type SectorEntry } from "./suggestions.ts";

function entry(ticker: string, category: string, score: number | null, status = "on"): SectorEntry {
  return { ticker, category, score, status };
}

function report(...positions: Position[]) {
  return buildRiskReport(positions, null);
}

const tickers = (suggestions: PositionSuggestion[]) => suggestions.map((s) => s.ticker);

describe("positionSuggestions — ported from select_put_sell_candidates", () => {
  it("orders by sector exposure, then by score", () => {
    // Tech is held, Energy is not; PAD, without a sector, only keeps AAA under the 5% cap.
    const result = positionSuggestions(
      [entry("AAA", "Tech", 7), entry("BBB", "Tech", 6.5), entry("CCC", "Energy", 9)],
      report(stock({ symbol: "AAA", marketValue: 1000 }), stock({ symbol: "PAD", marketValue: 100_000 })),
    );
    expect(tickers(result)).toEqual(["CCC", "AAA", "BBB"]);
  });

  it("excludes scores below the minimum", () => {
    expect(tickers(positionSuggestions([entry("AAA", "Tech", 5.9), entry("BBB", "Tech", 6)], null))).toEqual(["BBB"]);
  });

  it("excludes an inactive status", () => {
    expect(tickers(positionSuggestions([entry("AAA", "Tech", 9, "off"), entry("BBB", "Tech", 6)], null))).toEqual(["BBB"]);
  });

  it("excludes a missing score or a missing sector", () => {
    expect(tickers(positionSuggestions([entry("AAA", "Tech", null), entry("BBB", "", 9), entry("CCC", "Tech", 6)], null))).toEqual(["CCC"]);
  });

  it("caps the list", () => {
    const entries = Array.from({ length: 25 }, (_, i) => entry(`T${String(i).padStart(2, "0")}`, "Tech", 7));
    expect(positionSuggestions(entries, null)).toHaveLength(MAX_SUGGESTIONS);
    expect(MAX_SUGGESTIONS).toBe(20);
  });

  it("puts the ticker least held first within one sector and one score", () => {
    const result = positionSuggestions(
      [entry("AAA", "Tech", 7), entry("BBB", "Tech", 7)],
      report(stock({ symbol: "AAA", marketValue: 200 }), stock({ symbol: "BBB", marketValue: 50 }), stock({ symbol: "PAD", marketValue: 100_000 })),
    );
    expect(tickers(result)).toEqual(["BBB", "AAA"]);
  });

  it("drops a ticker at exactly 5% of the risk, whatever its score", () => {
    const result = positionSuggestions(
      [entry("AAA", "Tech", 9.9), entry("BBB", "Tech", 6)],
      report(stock({ symbol: "AAA", marketValue: 5_000 }), stock({ symbol: "PAD", marketValue: 95_000 })),
    );
    expect(tickers(result)).toEqual(["BBB"]);
  });

  it("measures exposure in risk value: a sold put weighs its assignment amount, not its premium", () => {
    const result = positionSuggestions(
      [entry("AAA", "Tech", 9.9), entry("BBB", "Tech", 6)],
      report(option({ symbol: "AAA", right: "P", quantity: -1, strike: 100, marketValue: -200 }), stock({ symbol: "PAD", marketValue: 100_000 })),
    );
    expect(tickers(result)).toEqual(["BBB"]);
  });
});

describe("positionSuggestions — what the TypeScript port adds", () => {
  it("gives each suggestion its rank and the share of risk its sector and its ticker already carry", () => {
    const result = positionSuggestions(
      [entry("AAA", "Tech", 7), entry("BBB", "Tech", 8)],
      report(stock({ symbol: "AAA", marketValue: 1000 }), stock({ symbol: "PAD", marketValue: 99_000 })),
    );
    expect(result).toEqual([
      { rank: 1, ticker: "BBB", sector: "Tech", score: 8, sectorShare: 0.01, tickerShare: 0 },
      { rank: 2, ticker: "AAA", sector: "Tech", score: 7, sectorShare: 0.01, tickerShare: 0.01 },
    ]);
  });

  it("reads the status and the sector without case or surrounding spaces", () => {
    expect(positionSuggestions([entry(" aaa ", "  Tech ", 7, " On ")], null)).toEqual([
      { rank: 1, ticker: "AAA", sector: "Tech", score: 7, sectorShare: 0, tickerShare: 0 },
    ]);
  });

  it("counts an unknown risk value as nothing", () => {
    const result = positionSuggestions(
      [entry("AAA", "Tech", 7)],
      report(stock({ symbol: "AAA", marketValue: null }), stock({ symbol: "PAD", marketValue: 100 })),
    );
    expect(result).toEqual([{ rank: 1, ticker: "AAA", sector: "Tech", score: 7, sectorShare: 0, tickerShare: 0 }]);
  });

  it("still suggests without a snapshot, by score, every share at 0", () => {
    expect(positionSuggestions([entry("AAA", "Tech", 6), entry("BBB", "Energy", 9)], null)).toEqual([
      { rank: 1, ticker: "BBB", sector: "Energy", score: 9, sectorShare: 0, tickerShare: 0 },
      { rank: 2, ticker: "AAA", sector: "Tech", score: 6, sectorShare: 0, tickerShare: 0 },
    ]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ib/coverage test src/suggestions.test.ts`
Expected: FAIL — `Failed to resolve import "./suggestions.ts"`.

- [x] **Step 3: Write minimal implementation**

`packages/coverage/src/constants.ts`, à la suite de `MAX_STRUCTURE_LOSS` :

```ts
/** A sector-table ticker is suggested from this score up. */
export const MIN_SUGGESTION_SCORE = 6;

/** The dashboard suggests at most this many tickers. */
export const MAX_SUGGESTIONS = 20;

/** A ticker already weighing this share of the account's total risk value, or more, is never suggested. */
export const MAX_SUGGESTION_TICKER_SHARE = 0.05;
```

`packages/coverage/src/suggestions.ts` :

```ts
import { tickerOf } from "@ib/ledger";
import { MAX_SUGGESTION_TICKER_SHARE, MAX_SUGGESTIONS, MIN_SUGGESTION_SCORE } from "./constants.ts";
import { riskValue } from "./report.ts";
import type { RiskReport } from "./types.ts";

/** One row of the sector table, nothing of Dexie. */
export interface SectorEntry {
  ticker: string;
  category: string;
  score: number | null;
  status: string;
}

export interface PositionSuggestion {
  /** 1 for the first row. */
  rank: number;
  ticker: string;
  sector: string;
  score: number;
  /** Risk value of the sector ÷ total risk value; 0 when the total is 0. */
  sectorShare: number;
  /** Risk value of the ticker ÷ total risk value; 0 when the total is 0. */
  tickerShare: number;
}

interface Candidate {
  ticker: string;
  sector: string;
  score: number;
  sectorExposure: number;
  tickerExposure: number;
}

function tickerKey(text: string): string {
  return text.trim().toUpperCase();
}

/**
 * Where to open a position without concentrating the account, as `select_put_sell_candidates` of the
 * former Python report ranked it (spec of sub-project 16, §4): the least exposed sectors first, the
 * best score next, the ticker least held last, every exposure in risk value — a sold put weighs its
 * assignment amount, not the premium its market value shows.
 */
export function positionSuggestions(entries: readonly SectorEntry[], report: RiskReport | null): PositionSuggestion[] {
  const sectorOf = new Map<string, string>();
  for (const entry of entries) {
    const sector = entry.category.trim();
    if (sector) sectorOf.set(tickerKey(entry.ticker), sector);
  }

  const byTicker = new Map<string, number>();
  const bySector = new Map<string, number>();
  let total = 0;
  for (const position of report?.positions ?? []) {
    // An unknown market value weighs nothing: the Python never had one.
    const value = riskValue(position) ?? 0;
    const ticker = tickerKey(tickerOf(position.symbol));
    byTicker.set(ticker, (byTicker.get(ticker) ?? 0) + value);
    // A position without a sector counts in the total only: no candidate can carry an unclassified sector.
    const sector = sectorOf.get(ticker);
    if (sector !== undefined) bySector.set(sector, (bySector.get(sector) ?? 0) + value);
    total += value;
  }
  const share = (value: number) => (total > 0 ? value / total : 0);

  const candidates: Candidate[] = [];
  for (const entry of entries) {
    const ticker = tickerKey(entry.ticker);
    const sector = entry.category.trim();
    const { score } = entry;
    if (entry.status.trim().toLowerCase() !== "on" || !sector || score === null || score < MIN_SUGGESTION_SCORE) continue;
    const tickerExposure = byTicker.get(ticker) ?? 0;
    if (share(tickerExposure) >= MAX_SUGGESTION_TICKER_SHARE) continue;
    candidates.push({ ticker, sector, score, sectorExposure: bySector.get(sector) ?? 0, tickerExposure });
  }

  candidates.sort(
    (a, b) =>
      a.sectorExposure - b.sectorExposure ||
      b.score - a.score ||
      a.tickerExposure - b.tickerExposure ||
      (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0),
  );
  return candidates.slice(0, MAX_SUGGESTIONS).map((c, i) => ({
    rank: i + 1,
    ticker: c.ticker,
    sector: c.sector,
    score: c.score,
    sectorShare: share(c.sectorExposure),
    tickerShare: share(c.tickerExposure),
  }));
}
```

`packages/coverage/src/index.ts`, ajouter la ligne :

```ts
export * from "./suggestions.ts";
```

`apps/web/src/lib/businessConstants.test.ts`, remplacer la première expression de `FORBIDDEN` par :

```ts
  /\b(BUYBACK_RATIO|MAX_STRUCTURE_LOSS|DEFAULT_MULTIPLIER|MIN_SUGGESTION_SCORE|MAX_SUGGESTIONS|MAX_SUGGESTION_TICKER_SHARE)\s*=/,
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ib/coverage test && pnpm --filter @ib/coverage typecheck && pnpm --filter web test src/lib/businessConstants.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/coverage/src apps/web/src/lib/businessConstants.test.ts docs/plans/2026-09-14-positions-strategie.md
git commit -m "feat(coverage): positionSuggestions, portage de la sélection de l'ancien outil sur la valeur de risque

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NACu2yrhhokgAokMgFU55P"
```

---

### Task 5: une ligne de position partagée

**Files:**
- Create: `apps/web/src/components/PositionRow.tsx`
- Modify: `apps/web/src/components/PositionTable.tsx`
- Modify: `apps/web/src/lib/riskReport.ts`
- Modify: `apps/web/src/pages/PositionsPage.tsx`
- Test: `apps/web/src/lib/riskReport.test.ts`, `apps/web/src/pages/PositionsPage.test.tsx` (inchangé, doit rester vert)

**Interfaces:**
- Produces :
  ```ts
  // lib/riskReport.ts
  export function decisionBadge(decision: AnalyzedPosition["decision"]): DecisionBadge | null;
  export function coverageBadges(position: AnalyzedPosition | null): CoverageBadge[];
  // components/PositionTable.tsx
  export function PositionTableHeader(): JSX.Element;
  // components/PositionRow.tsx
  export interface PositionRowValues {
    contract: string; label: string; sector: string | null; marketValue: number | null; quantity: number;
    avgPrice: number | null; lastPrice: number | null; unrealizedPnl: number | null;
    decision: "buy back" | "keep" | null; position: AnalyzedPosition | null;
  }
  export function PositionRow({ values }: { values: PositionRowValues }): JSX.Element;
  ```

- [x] **Step 1: Write the failing test**

`apps/web/src/lib/riskReport.test.ts` : remplacer le bloc `describe("decisionBadge", …)` par

```ts
describe("decisionBadge", () => {
  it("maps 'keep' to a success badge", () => {
    expect(decisionBadge("keep")).toEqual({ variant: "success", label: "keep" });
  });

  it("maps 'buy back' to a destructive badge", () => {
    expect(decisionBadge("buy back")).toEqual({ variant: "destructive", label: "buy back" });
  });

  it("returns null when there is no decision", () => {
    expect(decisionBadge(null)).toBeNull();
  });
});
```

et ajouter à la fin du bloc `describe("coverageBadges", …)` :

```ts
  it("renders nothing without a position, for a line the snapshot does not hold", () => {
    expect(coverageBadges(null)).toEqual([]);
  });
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test src/lib/riskReport.test.ts`
Expected: FAIL — `decisionBadge("keep")` rend `null` et `coverageBadges(null)` lève `Cannot read properties of null`.

- [x] **Step 3: Write minimal implementation**

`apps/web/src/lib/riskReport.ts` : remplacer `decisionBadge` et la première ligne de `coverageBadges` :

```ts
export function decisionBadge(decision: AnalyzedPosition["decision"]): DecisionBadge | null {
  if (decision === "keep") return { variant: "success", label: "keep" };
  if (decision === "buy back") return { variant: "destructive", label: "buy back" };
  return null;
}
```

```ts
/** One badge per allocation, then the uncovered remainder; "used x/y" or "unused" for a long cover; nothing without a position. */
export function coverageBadges(position: AnalyzedPosition | null): CoverageBadge[] {
  if (position === null) return [];
```

(le reste du corps de `coverageBadges` ne change pas).

`apps/web/src/components/PositionTable.tsx` : ajouter les imports et le composant :

```tsx
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Table, TableHead, TableHeader, TableRow } from "@ib/ui/table";
import { POSITION_COLUMNS } from "@/lib/positionColumns";
import { cn } from "@/lib/utils";
```

```tsx
/** The header row of the ten shared columns. */
export function PositionTableHeader() {
  const { t } = useTranslation();
  return (
    <TableHeader>
      <TableRow>
        {POSITION_COLUMNS.map((column) => (
          <TableHead key={column.key} className={cn(column.numeric && "text-right")}>
            {t(`positions.columns.${column.key}`)}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
}
```

`apps/web/src/components/PositionRow.tsx` :

```tsx
import type { AnalyzedPosition } from "@ib/coverage";
import { Badge } from "@ib/ui/badge";
import { TableCell, TableRow } from "@ib/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ib/ui/tooltip";
import { formatMoney, formatPrice } from "@/lib/format";
import { coverageBadges, decisionBadge } from "@/lib/riskReport";
import { cn } from "@/lib/utils";

/** What one line of a position table shows, whatever computed it: an IB position, or a strategy's part of one. */
export interface PositionRowValues {
  contract: string;
  label: string;
  sector: string | null;
  marketValue: number | null;
  quantity: number;
  avgPrice: number | null;
  lastPrice: number | null;
  unrealizedPnl: number | null;
  decision: "buy back" | "keep" | null;
  /** The IB position whose coverage badges the line shows; `null` shows none. */
  position: AnalyzedPosition | null;
}

export function PositionRow({ values }: { values: PositionRowValues }) {
  const decision = decisionBadge(values.decision);
  const pnl = values.unrealizedPnl;
  return (
    <TableRow>
      <TableCell className="font-medium">{values.contract}</TableCell>
      <TableCell className="text-muted-foreground">{values.label}</TableCell>
      <TableCell>{values.sector && <Badge variant="outline">{values.sector}</Badge>}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">{formatMoney(values.marketValue)}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">{values.quantity}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">{formatPrice(values.avgPrice)}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">{formatPrice(values.lastPrice)}</TableCell>
      <TableCell className={cn("text-right font-mono tabular-nums", pnl !== null && (pnl >= 0 ? "text-success" : "text-destructive"))}>
        {formatMoney(pnl)}
      </TableCell>
      <TableCell>{decision && <Badge variant={decision.variant}>{decision.label}</Badge>}</TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {coverageBadges(values.position).map((badge, index) =>
            badge.tooltip ? (
              <Tooltip key={index}>
                <TooltipTrigger render={<Badge variant={badge.variant}>{badge.label}</Badge>} />
                <TooltipContent>{badge.tooltip}</TooltipContent>
              </Tooltip>
            ) : (
              <Badge key={index} variant={badge.variant}>
                {badge.label}
              </Badge>
            ),
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
```

`apps/web/src/pages/PositionsPage.tsx` :
- supprimer la fonction locale `PositionRow` et les imports devenus inutiles (`Badge`, `TableCell`, `TableHead`, `TableHeader`, `TableRow`, `Tooltip*`, `formatMoney`, `formatPrice`, `POSITION_COLUMNS`, `coverageBadges`, `decisionBadge`, `cn`, et `type AnalyzedPosition`) ;
- importer `import { PositionRow } from "@/components/PositionRow";` et `import { PositionTable, PositionTableHeader } from "@/components/PositionTable";` ;
- remplacer le contenu de `<PositionTable>` par :

```tsx
            <PositionTable>
              <PositionTableHeader />
              <TableBody>
                {group.positions.map((position) => (
                  <PositionRow
                    key={position.description}
                    values={{
                      contract: formatContract(position),
                      label: position.label,
                      sector: sectorOf(position.symbol),
                      marketValue: position.marketValue,
                      quantity: position.quantity,
                      avgPrice: position.avgPrice,
                      lastPrice: position.lastPrice,
                      unrealizedPnl: position.unrealizedPnl,
                      decision: position.decision,
                      position,
                    }}
                  />
                ))}
              </TableBody>
            </PositionTable>
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter web test src/lib/riskReport.test.ts src/pages/PositionsPage.test.tsx && pnpm --filter web typecheck`
Expected: PASS ; `PositionsPage.test.tsx` passe sans modification.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/components/PositionRow.tsx apps/web/src/components/PositionTable.tsx apps/web/src/lib/riskReport.ts apps/web/src/lib/riskReport.test.ts apps/web/src/pages/PositionsPage.tsx docs/plans/2026-09-14-positions-strategie.md
git commit -m "refactor(web): la ligne et l'en-tête des tableaux de positions deviennent des composants partagés

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NACu2yrhhokgAokMgFU55P"
```

---

### Task 6: la page Positions d'une stratégie

**Files:**
- Create: `apps/web/src/pages/StrategyPositionsPage.tsx`
- Create: `apps/web/src/pages/StrategyPositionsPage.test.tsx`
- Modify: `apps/web/src/lib/positionColumns.ts`
- Modify: `apps/web/src/lib/navigation.ts`, `apps/web/src/lib/navigation.test.ts`
- Modify: `apps/web/src/routes/router.tsx`, `apps/web/src/routes/router.test.tsx`
- Modify: `apps/web/src/routes/AppLayout.test.tsx`
- Modify: `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`
- Modify: `apps/web/e2e/corporate-actions.spec.ts`

**Interfaces:**
- Consumes: `wheelPositions`, `leapsPositions`, `PricedSnapshot`, `StrategyLine`, `WheelShareLine`, `RiskReport` (Task 3, `@ib/coverage`), `PositionRow` et `PositionTable`, `PositionTableHeader` (Task 5), `contractId`, `formatContractLabel`, `JournalRow` (`@ib/ledger`).
- Produces : `export type PositionsStrategy = "wheel" | "leaps"` et `export function StrategyPositionsPage({ strategy }: { strategy: PositionsStrategy })` ; `WHEEL_SHARE_COLUMNS` dans `lib/positionColumns.ts` ; routes `positions/wheel`, `positions/leaps`.

- [x] **Step 1: Write the failing tests**

`apps/web/src/pages/StrategyPositionsPage.test.tsx` :

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import type { Transaction } from "@ib/ledger";
import i18n from "@/i18n";
import { db, type SnapshotRecord } from "@/db/schema";
import { StrategyPositionsPage, type PositionsStrategy } from "@/pages/StrategyPositionsPage";
import { WithAccountData } from "@/test/WithAccountData";
import { SAMPLE_JOURNAL_SNAPSHOT, SAMPLE_JOURNAL_TRANSACTIONS } from "@/mocks/journals";

function renderPage(strategy: PositionsStrategy) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[`/accounts/beta/positions/${strategy}`]}>
        <Routes>
          <Route
            path="/accounts/:accountId/positions/:strategy"
            element={
              <WithAccountData>
                <StrategyPositionsPage strategy={strategy} />
              </WithAccountData>
            }
          />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

/** A MQZA 15 call sold on the 200 Wheel shares assigned at 17: struck below the assignment price. */
const MARA_CALL: Transaction = {
  ...SAMPLE_JOURNAL_TRANSACTIONS[0],
  externalId: "flex:trade:401",
  symbol: "MQZA  261016C00015000",
  right: "C",
  strike: 15,
  expiry: "2026-10-16",
  quantity: -1,
  price: 0.8,
  amount: 80,
  when: "2026-08-25T14:30:00.000Z",
};

/** An XOM 110 put sold on 2026-08-10, absent from the snapshot below. */
const XOM_PUT: Transaction = {
  ...SAMPLE_JOURNAL_TRANSACTIONS[0],
  externalId: "flex:trade:402",
  symbol: "XOM   261016P00110000",
  strike: 110,
  expiry: "2026-10-16",
  quantity: -1,
  price: 1.2,
  amount: 120,
  when: "2026-08-10T14:30:00.000Z",
};

const [maraShares, zzzLeaps, zzzCall, aapl] = SAMPLE_JOURNAL_SNAPSHOT.positions;

/** The sample snapshot, priced, with the MQZA call. */
const SNAPSHOT: SnapshotRecord = {
  ...SAMPLE_JOURNAL_SNAPSHOT,
  positions: [
    { ...maraShares, marketPrice: 18, marketValue: 3600 },
    { ...zzzLeaps, marketPrice: 4, marketValue: 400 },
    { ...zzzCall, marketPrice: 0.25, marketValue: -25 },
    aapl,
    { ...zzzLeaps, symbol: "MQZA", strike: 15, expiry: "2026-10-16", quantity: -1, marketPrice: 1, marketValue: -100, description: "MQZA 16OCT26 15 C" },
  ],
};

beforeEach(async () => {
  await Promise.all([db.transactions.clear(), db.snapshots.clear(), db.sectors.clear(), db.contracts.clear()]);
});

async function seed() {
  await db.transactions.bulkAdd([...SAMPLE_JOURNAL_TRANSACTIONS, MARA_CALL, XOM_PUT]);
  await db.snapshots.put(SNAPSHOT);
}

async function rowIn(card: string, text: string): Promise<HTMLElement> {
  const found = await within(await screen.findByLabelText(card)).findByText(text);
  return found.closest("tr") as HTMLElement;
}

function cells(row: HTMLElement): HTMLElement[] {
  return within(row).getAllByRole("cell");
}

function texts(row: HTMLElement): string[] {
  return cells(row).map((cell) => cell.textContent ?? "");
}

describe("StrategyPositionsPage — Wheel", () => {
  it("lists the assigned shares: assignment price, call strike in yellow below it, value and Wheel coverage", async () => {
    await seed();
    renderPage("wheel");
    expect(await screen.findByText("Positions Wheel")).toBeInTheDocument();
    const row = await rowIn("Actions assignées", "MQZA");
    expect(texts(row)).toEqual(["MQZA", "", "200", "17.00", "15.00", "$3,400.00", "18.00", "$200.00", "couvert 100/200"]);
    expect(cells(row)[4]).toHaveClass("bg-warning/25");
    expect(cells(row)[3]).not.toHaveClass("bg-warning/25");
  });

  it("lists the option sales: the Wheel's part priced from the snapshot, a line the snapshot lacks left blank", async () => {
    await seed();
    renderPage("wheel");
    const call = await rowIn("Ventes d'options", "MQZA Oct16'26 15 Call");
    expect(texts(call)).toEqual(["MQZA Oct16'26 15 Call", "sell of call", "", "-$100.00", "-1", "0.80", "1.00", "-$20.00", "keep", "stock ×1"]);
    const put = await rowIn("Ventes d'options", "XOM Oct16'26 110 Put");
    expect(texts(put)).toEqual(["XOM Oct16'26 110 Put", "sell of put", "", "—", "-1", "1.20", "—", "—", "", ""]);
    // The LEAPS call is not the Wheel's.
    expect(within(screen.getByLabelText("Ventes d'options")).queryByText("ZZZ Sep18'26 20 Call")).not.toBeInTheDocument();
  });

  it("says so in each card when the Wheel holds nothing open", async () => {
    renderPage("wheel");
    expect(await screen.findAllByText("Aucune position ouverte dans cette stratégie.")).toHaveLength(2);
  });
});

describe("StrategyPositionsPage — LEAPS", () => {
  it("lists the LEAPS bought and the calls sold against them, without a Shares card when none is held", async () => {
    await seed();
    renderPage("leaps");
    expect(await screen.findByText("Positions LEAPS")).toBeInTheDocument();
    const leaps = await rowIn("Achats d'options", "ZZZ Jun18'27 15 Call");
    expect(texts(leaps)).toEqual(["ZZZ Jun18'27 15 Call", "buy of call", "", "$400.00", "1", "3.00", "4.00", "$100.00", "", "used 1/1"]);
    const call = await rowIn("Ventes d'options", "ZZZ Sep18'26 20 Call");
    expect(texts(call)).toEqual(["ZZZ Sep18'26 20 Call", "sell of call", "", "-$25.00", "-1", "0.50", "0.25", "$25.00", "buy back", "leaps ×1"]);
    expect(screen.queryByLabelText("Actions")).not.toBeInTheDocument();
  });
});
```

`apps/web/src/lib/navigation.test.ts` : dans le premier test, renommer en `"groups each strategy's journal, then its positions and its statistics when it has them, in a section of its own"` et remplacer les deux premiers objets attendus par :

```ts
      {
        section: "nav.sections.strategyWheel",
        items: [
          ["nav.journal", "/accounts/beta/journal/wheel"],
          ["nav.positions", "/accounts/beta/positions/wheel"],
          ["nav.stats", "/accounts/beta/stats/wheel"],
        ],
      },
      {
        section: "nav.sections.strategyLeaps",
        items: [
          ["nav.journal", "/accounts/beta/journal/leaps"],
          ["nav.positions", "/accounts/beta/positions/leaps"],
          ["nav.stats", "/accounts/beta/stats/leaps"],
        ],
      },
```

`apps/web/src/routes/AppLayout.test.tsx`, dans « shows the nav entry for every screen, scoped to the current account », la liste attendue devient :

```ts
    expect(navHrefs()).toEqual([
      "/accounts/beta/dashboard",
      "/accounts/beta/positions",
      "/accounts/beta/history",
      "/accounts/beta/journal/wheel",
      "/accounts/beta/positions/wheel",
      "/accounts/beta/stats/wheel",
      "/accounts/beta/journal/leaps",
      "/accounts/beta/positions/leaps",
      "/accounts/beta/stats/leaps",
      "/accounts/beta/journal/condors",
      "/accounts/beta/stats/condors",
      "/accounts/beta/journal/others",
      "/accounts/beta/sources",
      "/accounts/beta/sectors",
      "/accounts/beta/consistency",
      "/settings",
      "/help",
    ]);
```

`apps/web/src/routes/router.test.tsx` : importer `import { StrategyPositionsPage } from "@/pages/StrategyPositionsPage";` et ajouter :

```ts
  it("routes the Wheel and LEAPS positions pages under the account", () => {
    const account = router.routes.find((r) => r.path === "/accounts/:accountId");
    for (const strategy of ["wheel", "leaps"] as const) {
      const route = (account?.children ?? []).find((c) => c.path === `positions/${strategy}`);
      const element = route?.element as ReactElement<{ strategy: string }>;
      expect(element.type).toBe(StrategyPositionsPage);
      expect(element.props.strategy).toBe(strategy);
    }
  });
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter web test src/pages/StrategyPositionsPage.test.tsx src/lib/navigation.test.ts src/routes/router.test.tsx src/routes/AppLayout.test.tsx`
Expected: FAIL — `Failed to resolve import "@/pages/StrategyPositionsPage"`, et les listes du menu sans `positions/wheel`.

- [x] **Step 3: Write the implementation**

`apps/web/src/lib/positionColumns.ts`, à la fin :

```ts
/** The nine columns of the Wheel's assigned shares, fixed widths like the Positions page. */
export const WHEEL_SHARE_COLUMNS = [
  { key: "position", width: "12%", numeric: false },
  { key: "sector", width: "11%", numeric: false },
  { key: "quantity", width: "8%", numeric: true },
  { key: "averageAssignmentPrice", width: "10%", numeric: true },
  { key: "averageCallStrike", width: "11%", numeric: true },
  { key: "assignedTotal", width: "12%", numeric: true },
  { key: "lastPrice", width: "10%", numeric: true },
  { key: "unrealizedPnl", width: "12%", numeric: true },
  { key: "coverage", width: "14%", numeric: false },
] as const satisfies readonly { key: string; width: string; numeric: boolean }[];
```

`apps/web/src/lib/navigation.ts` : le commentaire devient `// One section per strategy: its journal first, then its open positions and its statistics when the strategy has them.` et les deux sections :

```ts
  {
    labelKey: "nav.sections.strategyWheel",
    items: [
      { labelKey: "nav.journal", icon: Coins, to: accountPath("journal/wheel") },
      { labelKey: "nav.positions", icon: TrendingUp, to: accountPath("positions/wheel") },
      { labelKey: "nav.stats", icon: BarChart3, to: accountPath("stats/wheel") },
    ],
  },
  {
    labelKey: "nav.sections.strategyLeaps",
    items: [
      { labelKey: "nav.journal", icon: CalendarRange, to: accountPath("journal/leaps") },
      { labelKey: "nav.positions", icon: TrendingUp, to: accountPath("positions/leaps") },
      { labelKey: "nav.stats", icon: BarChart3, to: accountPath("stats/leaps") },
    ],
  },
```

`apps/web/src/routes/router.tsx` : importer `import { StrategyPositionsPage } from "@/pages/StrategyPositionsPage";` et ajouter, juste après la route `journal/others` :

```tsx
      { path: "positions/wheel", element: <StrategyPositionsPage strategy="wheel" /> },
      { path: "positions/leaps", element: <StrategyPositionsPage strategy="leaps" /> },
```

`apps/web/src/i18n/fr.json`, nouvelle clé de premier niveau juste après `positions` :

```json
  "strategyPositions": {
    "title": { "wheel": "Positions Wheel", "leaps": "Positions LEAPS" },
    "groups": {
      "assignedShares": "Actions assignées",
      "optionSales": "Ventes d'options",
      "optionBuys": "Achats d'options",
      "shares": "Actions"
    },
    "columns": {
      "position": "Position",
      "sector": "Secteur",
      "quantity": "Quantité",
      "averageAssignmentPrice": "Prix moyen",
      "averageCallStrike": "Prix moyen des calls",
      "assignedTotal": "Prix total assigné",
      "lastPrice": "Dernier prix",
      "unrealizedPnl": "P&L latent",
      "coverage": "Couverture"
    },
    "callBelowAssignment": "Strike moyen des calls sous le prix d'assignation",
    "covered": "couvert {{covered}}/{{quantity}}",
    "empty": "Aucune position ouverte dans cette stratégie."
  },
```

`apps/web/src/i18n/en.json`, même emplacement :

```json
  "strategyPositions": {
    "title": { "wheel": "Wheel positions", "leaps": "LEAPS positions" },
    "groups": {
      "assignedShares": "Assigned shares",
      "optionSales": "Option sells",
      "optionBuys": "Option buys",
      "shares": "Shares"
    },
    "columns": {
      "position": "Position",
      "sector": "Sector",
      "quantity": "Quantity",
      "averageAssignmentPrice": "Avg. price",
      "averageCallStrike": "Avg. call price",
      "assignedTotal": "Total assigned",
      "lastPrice": "Last price",
      "unrealizedPnl": "Unrealized P&L",
      "coverage": "Coverage"
    },
    "callBelowAssignment": "Average call strike below the assignment price",
    "covered": "covered {{covered}}/{{quantity}}",
    "empty": "No open position in this strategy."
  },
```

`apps/web/src/pages/StrategyPositionsPage.tsx` :

```tsx
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  leapsPositions,
  wheelPositions,
  type PricedSnapshot,
  type RiskReport,
  type StrategyLine,
  type WheelShareLine,
} from "@ib/coverage";
import { contractId, formatContractLabel, type JournalRow } from "@ib/ledger";
import { Badge } from "@ib/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ib/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ib/ui/tooltip";
import { PositionRow } from "@/components/PositionRow";
import { PositionTable, PositionTableHeader } from "@/components/PositionTable";
import { useAccountJournals, useAccountRiskReport } from "@/db/AccountDataProvider";
import type { SnapshotRecord } from "@/db/schema";
import { formatMoney, formatPrice } from "@/lib/format";
import { WHEEL_SHARE_COLUMNS } from "@/lib/positionColumns";
import { cn } from "@/lib/utils";

export type PositionsStrategy = "wheel" | "leaps";

type SectorOf = (symbol: string) => string | null;

const NO_ROWS: readonly JournalRow[] = [];
const NUMERIC = "text-right font-mono tabular-nums";

function pricedSnapshot(snapshot: SnapshotRecord | null | undefined, report: RiskReport | null | undefined): PricedSnapshot | null {
  return snapshot && report ? { positions: snapshot.positions, report } : null;
}

/**
 * A strategy's open positions (spec of sub-project 16, §5.2): its journal's open lines priced from
 * the snapshot, computed from what the shell already holds, never stored.
 */
export function StrategyPositionsPage({ strategy }: { strategy: PositionsStrategy }) {
  const { t } = useTranslation();
  const view = useAccountJournals();
  const { snapshot, report, sectorOf } = useAccountRiskReport();
  const ready = view.status === "ready" && snapshot !== undefined && report !== undefined;
  const rows = view.status === "ready" ? view.report.rows : NO_ROWS;
  const wheel = useMemo(
    () => (ready && strategy === "wheel" ? wheelPositions(rows, pricedSnapshot(snapshot, report)) : null),
    [ready, strategy, rows, snapshot, report],
  );
  const leaps = useMemo(
    () => (ready && strategy === "leaps" ? leapsPositions(rows, pricedSnapshot(snapshot, report)) : null),
    [ready, strategy, rows, snapshot, report],
  );

  if (!ready) return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="font-heading text-lg font-semibold tracking-tight">{t(`strategyPositions.title.${strategy}`)}</h1>
      {wheel && (
        <>
          <GroupCard title={t("strategyPositions.groups.assignedShares")} empty={wheel.shares.length === 0}>
            <WheelSharesTable lines={wheel.shares} sectorOf={sectorOf} />
          </GroupCard>
          <LinesCard title={t("strategyPositions.groups.optionSales")} lines={wheel.optionSales} sectorOf={sectorOf} />
        </>
      )}
      {leaps && (
        <>
          <LinesCard title={t("strategyPositions.groups.optionBuys")} lines={leaps.optionBuys} sectorOf={sectorOf} />
          <LinesCard title={t("strategyPositions.groups.optionSales")} lines={leaps.optionSales} sectorOf={sectorOf} />
          {/* Shares a LEAPS delivered are rare: their card only shows when there are some. */}
          {leaps.shares.length > 0 && <LinesCard title={t("strategyPositions.groups.shares")} lines={leaps.shares} sectorOf={sectorOf} />}
        </>
      )}
    </div>
  );
}

function GroupCard({ title, empty, children }: { title: string; empty: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Card aria-label={title}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {empty ? <p className="text-sm text-muted-foreground">{t("strategyPositions.empty")}</p> : children}
      </CardContent>
    </Card>
  );
}

function LinesCard({ title, lines, sectorOf }: { title: string; lines: readonly StrategyLine[]; sectorOf: SectorOf }) {
  return (
    <GroupCard title={title} empty={lines.length === 0}>
      <PositionTable>
        <PositionTableHeader />
        <TableBody>
          {lines.map((line) => (
            <PositionRow
              key={contractId(line.contract)}
              values={{
                contract: formatContractLabel(line.contract),
                label: line.label,
                sector: sectorOf(line.contract.ticker),
                marketValue: line.marketValue,
                quantity: line.quantity,
                avgPrice: line.avgPrice,
                lastPrice: line.lastPrice,
                unrealizedPnl: line.unrealizedPnl,
                decision: line.decision,
                position: line.position,
              }}
            />
          ))}
        </TableBody>
      </PositionTable>
    </GroupCard>
  );
}

function WheelSharesTable({ lines, sectorOf }: { lines: readonly WheelShareLine[]; sectorOf: SectorOf }) {
  const { t } = useTranslation();
  return (
    <Table className="min-w-[60rem] table-fixed [&_td]:whitespace-normal [&_th]:whitespace-normal">
      <colgroup>
        {WHEEL_SHARE_COLUMNS.map((column) => (
          <col key={column.key} style={{ width: column.width }} />
        ))}
      </colgroup>
      <TableHeader>
        <TableRow>
          {WHEEL_SHARE_COLUMNS.map((column) => (
            <TableHead key={column.key} className={cn(column.numeric && "text-right")}>
              {t(`strategyPositions.columns.${column.key}`)}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line) => (
          <WheelShareRow key={`${line.ticker}|${line.currency}`} line={line} sector={sectorOf(line.ticker)} />
        ))}
      </TableBody>
    </Table>
  );
}

function WheelShareRow({ line, sector }: { line: WheelShareLine; sector: string | null }) {
  const { t } = useTranslation();
  const pnl = line.unrealizedPnl;
  const callPrice = formatPrice(line.averageCallStrike);
  return (
    <TableRow>
      <TableCell className="font-medium">{line.ticker}</TableCell>
      <TableCell>{sector && <Badge variant="outline">{sector}</Badge>}</TableCell>
      <TableCell className={NUMERIC}>{line.quantity}</TableCell>
      <TableCell className={NUMERIC}>{formatPrice(line.averageAssignmentPrice)}</TableCell>
      {line.callStrikeBelowAssignment ? (
        <TableCell className={cn(NUMERIC, "bg-warning/25")}>
          <Tooltip>
            <TooltipTrigger render={<span>{callPrice}</span>} />
            <TooltipContent>{t("strategyPositions.callBelowAssignment")}</TooltipContent>
          </Tooltip>
        </TableCell>
      ) : (
        <TableCell className={NUMERIC}>{callPrice}</TableCell>
      )}
      <TableCell className={NUMERIC}>{formatMoney(line.assignedTotal)}</TableCell>
      <TableCell className={NUMERIC}>{formatPrice(line.lastPrice)}</TableCell>
      <TableCell className={cn(NUMERIC, pnl !== null && (pnl >= 0 ? "text-success" : "text-destructive"))}>{formatMoney(pnl)}</TableCell>
      <TableCell>
        <Badge variant={line.coveredShares === line.quantity ? "success" : "outline"}>
          {t("strategyPositions.covered", { covered: line.coveredShares, quantity: line.quantity })}
        </Badge>
      </TableCell>
    </TableRow>
  );
}
```

`apps/web/e2e/corporate-actions.spec.ts`, ligne 76 : trois liens du menu s'appellent désormais « Positions ».

```ts
  // Three nav links read "Positions" (overview, Wheel, LEAPS): the href names the overview's.
  await page.locator('a[href$="/positions"]').click();
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter web test src/pages/StrategyPositionsPage.test.tsx src/lib/navigation.test.ts src/routes/router.test.tsx src/routes/AppLayout.test.tsx src/i18n/index.test.ts src/pages/PositionsPage.test.tsx && pnpm --filter web typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/pages/StrategyPositionsPage.tsx apps/web/src/pages/StrategyPositionsPage.test.tsx apps/web/src/lib/positionColumns.ts apps/web/src/lib/navigation.ts apps/web/src/lib/navigation.test.ts apps/web/src/routes apps/web/src/i18n apps/web/e2e/corporate-actions.spec.ts docs/plans/2026-09-14-positions-strategie.md
git commit -m "feat(web): page Positions des stratégies Wheel et LEAPS

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NACu2yrhhokgAokMgFU55P"
```

---

### Task 7: la carte « Suggestion de Position »

**Files:**
- Create: `apps/web/src/components/PositionSuggestionsCard.tsx`
- Modify: `apps/web/src/pages/DashboardPage.tsx`
- Modify: `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`
- Test: `apps/web/src/pages/DashboardPage.test.tsx`

**Interfaces:**
- Consumes: `positionSuggestions`, `MAX_SUGGESTIONS`, `MIN_SUGGESTION_SCORE`, `MAX_SUGGESTION_TICKER_SHARE`, `RiskReport` (Task 4, `@ib/coverage`), `useSectors` (`@/db/hooks`), `formatPercent`, `formatRate` (`@/lib/format`).
- Produces : `export function PositionSuggestionsCard({ accountId, report }: { accountId: string; report: RiskReport | null })`.

- [x] **Step 1: Write the failing tests**

`apps/web/src/pages/DashboardPage.test.tsx` : ajouter après `findTotalCard` :

```ts
const sector = (ticker: string, category: string, score: number | null, status = "on") => ({
  ticker, name: "", category, score, status, updatedAt: "2026-09-03T08:00:00.000Z",
});

/** The rows of the suggestion card, header excluded, as the text of their cells. */
async function suggestionRows(): Promise<string[][]> {
  const card = await screen.findByLabelText("Suggestion de Position");
  return within(card)
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent ?? ""));
}
```

et, dans `describe("DashboardPage", …)` :

```ts
  it("suggests the least exposed sectors first, the best score next, with the share of risk already exposed", async () => {
    // SAMPLE_SNAPSHOT weighs 61,095 of risk: AAPL 30,700 and XOM 20,000 are over 5%, so never suggested.
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    await db.sectors.bulkPut([
      sector("AAPL", "Tech", 9), sector("NVDA", "Tech", 8), sector("XOM", "Energy", 9), sector("CVX", "Energy", 7),
      sector("KO", "Staples", 6), sector("PEP", "Staples", 5.5), sector("T", "Telecom", 9, "off"),
    ]);
    renderDashboard();
    expect(await suggestionRows()).toEqual([
      ["1", "KO", "Staples", "6", "0.0%", "0.0%"],
      ["2", "CVX", "Energy", "7", "32.7%", "0.0%"],
      ["3", "NVDA", "Tech", "8", "50.2%", "0.0%"],
    ]);
  });

  it("still suggests without a snapshot, every share at 0", async () => {
    await db.sectors.bulkPut([sector("KO", "Staples", 6), sector("CVX", "Energy", 7)]);
    renderDashboard();
    expect(await suggestionRows()).toEqual([
      ["1", "CVX", "Energy", "7", "0.0%", "0.0%"],
      ["2", "KO", "Staples", "6", "0.0%", "0.0%"],
    ]);
  });

  it("says why nothing is suggested, with a link to the sector table", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderDashboard();
    const card = await screen.findByLabelText("Suggestion de Position");
    expect(await within(card).findByText("Aucune suggestion : aucune ligne de la table sectorielle ne remplit les critères.")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Aller à Secteur et Score" })).toHaveAttribute("href", "/accounts/alpha/sectors");
  });
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter web test src/pages/DashboardPage.test.tsx`
Expected: FAIL — `Unable to find a label with the text of: Suggestion de Position`.

- [x] **Step 3: Write the implementation**

`apps/web/src/i18n/fr.json`, dans `dashboard`, après `cashCard` :

```json
    "suggestions": {
      "title": "Suggestion de Position",
      "rule": "Jusqu'à {{max}} tickers de la table sectorielle, de score ≥ {{score}} et de statut « on », hors actions pesant déjà {{share}} ou plus du risque du portefeuille. Tri par exposition croissante du secteur, puis score décroissant, puis exposition croissante du ticker ; expositions mesurées en valeur de risque.",
      "empty": "Aucune suggestion : aucune ligne de la table sectorielle ne remplit les critères.",
      "emptyLink": "Aller à Secteur et Score",
      "columns": {
        "rank": "#",
        "ticker": "Ticker",
        "sector": "Secteur",
        "score": "Score",
        "sectorShare": "% Secteur exposé",
        "tickerShare": "% Ticker exposé"
      }
    }
```

`apps/web/src/i18n/en.json`, même emplacement :

```json
    "suggestions": {
      "title": "Position suggestions",
      "rule": "Up to {{max}} tickers from the sector table, with a score ≥ {{score}} and status “on”, excluding stocks already at {{share}} or more of the portfolio's risk. Sorted by increasing sector exposure, then decreasing score, then increasing ticker exposure; exposures measured in risk value.",
      "empty": "No suggestion: no row of the sector table meets the criteria.",
      "emptyLink": "Go to Sectors & scores",
      "columns": {
        "rank": "#",
        "ticker": "Ticker",
        "sector": "Sector",
        "score": "Score",
        "sectorShare": "% sector exposed",
        "tickerShare": "% ticker exposed"
      }
    }
```

`apps/web/src/components/PositionSuggestionsCard.tsx` :

```tsx
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { MAX_SUGGESTIONS, MAX_SUGGESTION_TICKER_SHARE, MIN_SUGGESTION_SCORE, positionSuggestions, type RiskReport } from "@ib/coverage";
import { buttonVariants } from "@ib/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ib/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ib/ui/table";
import { useSectors } from "@/db/hooks";
import { formatPercent, formatRate } from "@/lib/format";
import { cn } from "@/lib/utils";

const COLUMNS = [
  { key: "rank", numeric: true },
  { key: "ticker", numeric: false },
  { key: "sector", numeric: false },
  { key: "score", numeric: true },
  { key: "sectorShare", numeric: true },
  { key: "tickerShare", numeric: true },
] as const;

const NUMERIC = "text-right font-mono tabular-nums";

/** Tickers of the shared sector table worth a position on the account on screen (spec of sub-project 16, §5.4). */
export function PositionSuggestionsCard({ accountId, report }: { accountId: string; report: RiskReport | null }) {
  const { t } = useTranslation();
  const sectors = useSectors();
  const suggestions = useMemo(() => (sectors ? positionSuggestions([...sectors.values()], report) : undefined), [sectors, report]);
  const title = t("dashboard.suggestions.title");

  return (
    <Card aria-label={title}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {t("dashboard.suggestions.rule", { max: MAX_SUGGESTIONS, score: MIN_SUGGESTION_SCORE, share: formatPercent(MAX_SUGGESTION_TICKER_SHARE) })}
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {suggestions === undefined ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : suggestions.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">{t("dashboard.suggestions.empty")}</p>
            <Link to={`/accounts/${accountId}/sectors`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              {t("dashboard.suggestions.emptyLink")}
            </Link>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {COLUMNS.map((column) => (
                  <TableHead key={column.key} className={cn(column.numeric && "text-right")}>
                    {t(`dashboard.suggestions.columns.${column.key}`)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {suggestions.map((suggestion) => (
                <TableRow key={suggestion.ticker}>
                  <TableCell className={NUMERIC}>{suggestion.rank}</TableCell>
                  <TableCell className="font-medium">{suggestion.ticker}</TableCell>
                  <TableCell>{suggestion.sector}</TableCell>
                  <TableCell className={NUMERIC}>{suggestion.score}</TableCell>
                  <TableCell className={NUMERIC}>{formatRate(suggestion.sectorShare)}</TableCell>
                  <TableCell className={NUMERIC}>{formatRate(suggestion.tickerShare)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
```

`apps/web/src/pages/DashboardPage.tsx` :
- importer `import { PositionSuggestionsCard } from "@/components/PositionSuggestionsCard";` ;
- dans la branche `report === null && !stats`, après `{noPositions}` : `<PositionSuggestionsCard accountId={accountId} report={report} />` ;
- dans le rendu principal, dernière enfant du conteneur, après le fragment des graphiques : `<PositionSuggestionsCard accountId={accountId} report={report} />`.

- [x] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter web test src/pages/DashboardPage.test.tsx src/i18n/index.test.ts && pnpm --filter web typecheck`
Expected: PASS, les tests existants du tableau de bord compris.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/components/PositionSuggestionsCard.tsx apps/web/src/pages/DashboardPage.tsx apps/web/src/pages/DashboardPage.test.tsx apps/web/src/i18n docs/plans/2026-09-14-positions-strategie.md
git commit -m "feat(web): carte Suggestion de Position sur le tableau de bord

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NACu2yrhhokgAokMgFU55P"
```

---

### Task 8: graine, documentation, vérification complète

**Files:**
- Modify: `apps/web/src/mocks/journals.ts`
- Modify: `apps/web/src/mocks/seed.test.ts`
- Modify: `CLAUDE.md`
- Modify: `docs/specs/2026-09-14-positions-strategie-design.md`
- Modify: `docs/points-reportes.md`

**Interfaces:**
- Consumes: `wheelHoldings` (Task 2), toutes les tâches précédentes.

- [x] **Step 1: Write the failing test**

`apps/web/src/mocks/seed.test.ts` : importer `wheelHoldings` depuis `@ib/ledger` (`import { anchoredBalances, buildJournals, wheelHoldings } from "@ib/ledger";`) et ajouter, à la fin du test « seeds on beta every strategy open and matching its snapshot… » :

```ts
    // A Wheel call struck below the assignment price, for the yellow cell of the Wheel positions page.
    expect(wheelHoldings(report.rows)).toEqual([
      { ticker: "MQZA", currency: "USD", quantity: 200, averageAssignmentPrice: 17, assignedTotal: 3400, openCallContracts: 1, averageCallStrike: 15, coveredShares: 100 },
    ]);
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test src/mocks/seed.test.ts`
Expected: FAIL — `openCallContracts: 0` et `averageCallStrike: null` reçus.

- [x] **Step 3: Seed the call**

`apps/web/src/mocks/journals.ts` :
- après `const QQQ = …` : `const MARA_CALL_15 = { symbol: "MQZA  261016C00015000", right: "C" as const, strike: 15, expiry: "2026-10-16" };`
- à la fin de `DEMO_TRANSACTIONS` : `trade({ externalId: "flex:trade:122", ...MARA_CALL_15, quantity: -1, price: 0.8, amount: 80, when: "2026-08-25T14:30:00.000Z" }),`
- à la fin de `DEMO_POSITIONS` : `position({ symbol: "MQZA", right: "C", strike: 15, expiry: "2026-10-16", quantity: -1, description: "MQZA 16OCT26 15 C" }),`
- le commentaire de `DEMO_TRANSACTIONS` commence par : `Demo only, never in the tests' ledger: a MQZA 15 call sold on the assigned shares, below their assignment price, so the Wheel positions page shows its yellow cell; an XOM put still open, …` (la suite inchangée).

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test src/mocks/seed.test.ts`
Expected: PASS (réconciliation sans écart, points de cash calés, holdings).

- [x] **Step 5: Documentation**

`CLAUDE.md`, tableau des sous-projets, après la ligne 15 :

```
| 16 | Positions par stratégie et Suggestion de Position | livré (AAAA-MM-JJ), en attente de merge |
```

(`AAAA-MM-JJ` : la date du jour d'exécution de cette étape.)

`CLAUDE.md`, section « Règles qui mordent si on les oublie », à la fin :

```markdown
- **Les positions d'une stratégie sont une vue calculée, jamais stockée** : `wheelPositions` et
  `leapsPositions` (`packages/coverage/src/strategy.ts`) lisent les lignes de journal ouvertes
  (`endWhen === null`) et les apparient au snapshot par `contractId(row.contract)`, la clé de la
  réconciliation. Une ligne montre la part de la stratégie — quantité et prix d'entrée du journal,
  dernier prix d'IB —, mais ses badges de couverture sont ceux de la position IB entière ; les
  actions Wheel ont leur propre couverture, `coveredShares` (`wheelHoldings`,
  `packages/ledger/src/journals/holdings.ts`). La page `StrategyPositionsPage` vit sous
  `positions/wheel` et `positions/leaps`.
- **La suggestion de position mesure en valeur de risque, jamais en capital** :
  `positionSuggestions` (`packages/coverage/src/suggestions.ts`) additionne `riskValue` des positions
  du compte affiché, par ticker et par secteur de la table sectorielle, et porte
  `select_put_sell_candidates` de l'ancien outil. `MIN_SUGGESTION_SCORE`, `MAX_SUGGESTIONS` et
  `MAX_SUGGESTION_TICKER_SHARE` vivent une seule fois dans `packages/coverage/src/constants.ts`.
```

`docs/specs/2026-09-14-positions-strategie-design.md` : `Statut : spec (2026-09-14).` devient `Statut : implémenté (AAAA-MM-JJ).`

`docs/points-reportes.md` : si la revue de branche relève des points jugés non bloquants, ajouter à la fin une section `## Reporté par le sous-projet 16 (positions par stratégie)` qui les liste, un point par puce, au format des sections précédentes ; sinon ne rien ajouter.

- [x] **Step 6: Full verification**

Run: `pnpm check`
Expected: sortie 0 (lint, typage, fraîcheur du schéma API, build, tous les tests).

Run: `node .claude/skills/run-frontend/driver.mjs /accounts/beta/positions/wheel /accounts/beta/positions/leaps /accounts/beta/dashboard --seed`
Expected: trois routes atteintes, aucune erreur console. Ouvrir chaque PNG avec l'outil Read : la page Wheel montre MQZA dans « Actions assignées » avec la cellule « Prix moyen des calls » en jaune, le put XOM et le call MQZA dans « Ventes d'options » ; la page LEAPS montre le LEAPS ZZZ et son call vendu ; le tableau de bord montre en dernière carte « Suggestion de Position », avec ses lignes ou son état vide et son lien selon les scores que porte la graine.

- [x] **Step 7: Commit**

```bash
git add apps/web/src/mocks CLAUDE.md docs
git commit -m "docs: sous-projet 16 livré, positions par stratégie et suggestion de position

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NACu2yrhhokgAokMgFU55P"
```

- [x] **Step 8: Instance de relecture**

Run: `pnpm dev:start` dans le worktree, puis `pnpm dev:status`.
Donner à Seb les deux URL affichées (web et api) : il regarde la branche avant de décider du merge. `pnpm dev:stop` se lance **avant** `git merge` et `git worktree remove`.
