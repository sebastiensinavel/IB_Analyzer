# Sous-projet 36 — Totaux de P/L et de valeur : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Cocher chaque case dans le même commit que la tâche** (CLAUDE.md, Workflow).

**Goal:** Afficher, calculés dans le navigateur, le P/L du jour, le P/L non réalisé, le réalisé du jour et la valeur totale — sur le tableau de bord, en tête des pages de positions et en tête de chaque tableau.

**Architecture:** Trois fonctions pures (`realizedOnDay` et `currentCashBalances` dans `packages/ledger`, `sumByCurrency` et `liquidationValue` dans `packages/coverage`) et un champ `marketValue` sur `WheelShareLine`. Côté web, un composant `HeaderTotals` rendu à côté du `h1` des pages et, par une prop `totals`, dans l'en-tête de `FilteredTableBox` ; deux nouveaux cadres et une ligne sur le tableau de bord. Rien n'est stocké, rien ne passe par le serveur ni l'agent.

**Tech Stack:** TypeScript, React 19, react-i18next, Vitest, fake-indexeddb, shadcn base-ui.

**Spec:** `docs/specs/2026-09-28-totaux-pnl-design.md` — à lire avant toute tâche.

## Global Constraints

- Aucun endpoint, modèle, migration ni table Dexie : tout se calcule dans le navigateur (CLAUDE.md, « Le serveur ne voit jamais »).
- Une valeur absente reste `null` et s'affiche « — », jamais `0`.
- Jamais de conversion de devise : une somme par devise.
- Somme partielle : total des valeurs connues, `missing` = nombre de lignes à `null` ; `total === null` seulement si aucune ligne n'a de valeur.
- « Le jour » = `marketDayOf(snapshot.asOf)` d'un snapshot `source === "agent"` ; sans lui, P/L du jour et réalisé du jour = « — ».
- `packages/ledger` n'écrit aucun texte visible ; tous les libellés dans `apps/web/src/i18n/{fr,en}.json`.
- Couleurs uniquement par les classes existantes (`text-success`, `text-destructive`, `text-muted-foreground`) — jamais de couleur en dur.
- Aucune page n'appelle `useJournals` ni `useRiskReport` : lire `useAccountJournals` / `useAccountRiskReport`.
- Tests `apps/web` sur `fake-indexeddb` avec un ledger semé, jamais en moquant les hooks. Filtrer un test : `npx vitest run <motif>` depuis `apps/web` (ou depuis le paquet).
- `pnpm check` une seule fois, à la fin (tâche 7).

## Review Focus

1. **Condor sur la page Condors** : l'en-tête somme la colonne P/L des lignes de condor (`CondorLine.pnl`), jamais ses jambes en plus — un double compte doublerait le chiffre. Test en tâche 5.
2. **Wheel, parts libre et couverte d'un même ticker** : deux lignes aux quantités disjointes ; la somme des deux encadrés = la position entière, jamais le double. Test en tâche 5.
3. **Positions, filtre actif** : le cash sort de la valeur totale de l'en-tête de page dès qu'une recherche ou un filtre de colonne est actif, et l'infobulle le dit. Test en tâche 4.
4. **Pas d'agent** : un snapshot Flex donne `dailyPnl` `null` partout → « P/L du jour — », jamais « 0,00 ». Tests en tâches 4 et 6.
5. **Assignation d'après minuit** : une ligne de journal fermée un samedi 01:02 compte dans le réalisé du vendredi. Test en tâche 1.

---

## Fichiers

- Create `packages/ledger/src/journals/realized.ts` (+ `.test.ts`) — `CurrencyTotal`, `realizedOnDay`.
- Modify `packages/ledger/src/journals/index.ts` — export.
- Modify `packages/ledger/src/cash.ts` (+ test existant ou `cash.current.test.ts`) — `currentCashBalances`.
- Create `packages/coverage/src/totals.ts` (+ `.test.ts`) — `sumByCurrency`, `addTotals`, `liquidationValue`.
- Modify `packages/coverage/src/index.ts` — export.
- Modify `packages/coverage/src/strategy.ts` — `WheelShareLine.marketValue`.
- Create `apps/web/src/components/HeaderTotals.tsx` (+ `.test.tsx`).
- Modify `apps/web/src/components/table/FilteredTableBox.tsx` — prop `totals`.
- Modify `apps/web/src/components/CashBalancesCard.tsx` — lit `currentCashBalances`.
- Modify `apps/web/src/components/PositionGroupCard.tsx`, `apps/web/src/pages/PositionsPage.tsx`, `apps/web/src/pages/StrategyPositionsPage.tsx`, `apps/web/src/pages/DashboardPage.tsx`.
- Create `apps/web/src/components/stats/UnrealizedPnlCard.tsx`, `apps/web/src/components/stats/DailyPnlCard.tsx`.
- Modify `apps/web/src/components/stats/PnlTotalCard.tsx` — prop `value` optionnelle.
- Modify `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`.
- Modify `CLAUDE.md`, `docs/points-reportes.md`, `docs/specs/2026-09-28-totaux-pnl-design.md` (statut).

---

### Task 1: `realizedOnDay` et `currentCashBalances` (packages/ledger)

**Files:**
- Create: `packages/ledger/src/journals/realized.ts`, `packages/ledger/src/journals/realized.test.ts`
- Modify: `packages/ledger/src/journals/index.ts`, `packages/ledger/src/cash.ts`
- Test: `packages/ledger/src/cash.current.test.ts`

**Interfaces:**
- Produces:
  - `export interface CurrencyTotal { currency: string; total: number | null; missing: number; count: number }`
  - `export function realizedOnDay(rows: readonly JournalRow[], day: string): CurrencyTotal[]`
  - `export function currentCashBalances(rows: readonly LedgerRow[], checks: readonly CashCheck[]): Record<string, number | null>`

- [x] **Step 1: Test `realizedOnDay`**

```ts
// packages/ledger/src/journals/realized.test.ts
import { describe, expect, it } from "vitest";
import { realizedOnDay } from "./realized.ts";
import type { JournalRow } from "./types.ts";

function row(overrides: Partial<JournalRow>): JournalRow {
  return {
    id: "x#1", strategy: "wheel", kind: "short_put", ticker: "MQZA", label: "MQZA", currency: "USD",
    contract: { ticker: "MQZA", secType: "OPT", right: "P", strike: 17, expiry: "2026-10-02", currency: "USD" },
    startWhen: "2026-08-01T14:30:00.000Z", quantity: -1, strike: 17,
    openPrice: 0.2, openTotal: 20, openCommission: -1, openNet: 19, assigned: false,
    endWhen: null, closePrice: null, closeTotal: null, closeCommission: null, closeNet: null, pnl: null,
    ongoing: true, event: null, orphan: false, note: null, openIds: [], closeIds: [], ...overrides,
  };
}

const closed = (endWhen: string, pnl: number | null, extra: Partial<JournalRow> = {}) =>
  row({ endWhen, pnl, ongoing: false, event: "buyback", ...extra });

describe("realizedOnDay", () => {
  it("sums the pnl of the lines closed that market day, across strategies, Others included", () => {
    const rows = [
      closed("2026-09-25T15:00:00.000Z", 200),
      closed("2026-09-25T10:00:00.000Z", 500, { strategy: "others", kind: "shares" }),
      closed("2026-09-24T15:00:00.000Z", 999),
    ];
    expect(realizedOnDay(rows, "2026-09-25")).toEqual([{ currency: "USD", total: 700, missing: 0, count: 2 }]);
  });

  it("never counts a line opened that day: a premium received realizes nothing", () => {
    expect(realizedOnDay([row({ startWhen: "2026-09-25T15:00:00.000Z" })], "2026-09-25")).toEqual([]);
  });

  it("counts an assignment stamped Saturday 01:02 on the Friday it belongs to", () => {
    const rows = [closed("2026-09-26T01:02:00.000Z", 150, { event: "assigned" })];
    expect(realizedOnDay(rows, "2026-09-25")).toEqual([{ currency: "USD", total: 150, missing: 0, count: 1 }]);
  });

  it("counts a line without pnl as missing, total null when none has one", () => {
    expect(realizedOnDay([closed("2026-09-25T15:00:00.000Z", null)], "2026-09-25")).toEqual([
      { currency: "USD", total: null, missing: 1, count: 1 },
    ]);
    expect(realizedOnDay([closed("2026-09-25T15:00:00.000Z", null), closed("2026-09-25T16:00:00.000Z", 10)], "2026-09-25")).toEqual([
      { currency: "USD", total: 10, missing: 1, count: 2 },
    ]);
  });

  it("counts a condor once, on the day its composite closes", () => {
    const condor = closed("2026-09-25T15:00:00.000Z", 120, { strategy: "condors", kind: "condor" });
    expect(realizedOnDay([condor], "2026-09-25")).toEqual([{ currency: "USD", total: 120, missing: 0, count: 1 }]);
  });

  it("keeps one entry per currency, sorted by code", () => {
    const rows = [closed("2026-09-25T15:00:00.000Z", 5, { currency: "USD" }), closed("2026-09-25T15:00:00.000Z", 3, { currency: "EUR" })];
    expect(realizedOnDay(rows, "2026-09-25").map((t) => t.currency)).toEqual(["EUR", "USD"]);
  });
});
```

- [x] **Step 2: Lancer, voir échouer** — `cd packages/ledger && npx vitest run realized` → FAIL (module absent).

- [x] **Step 3: Implémenter**

```ts
// packages/ledger/src/journals/realized.ts
import { marketDayOf } from "../filter.ts";
import type { JournalRow } from "./types.ts";

/** A sum of one currency's values: `total` over the known ones, `null` when none is known. */
export interface CurrencyTotal {
  currency: string;
  total: number | null;
  /** Lines whose value was `null`: left out of `total`, never counted as 0. */
  missing: number;
  count: number;
}

/**
 * What the lines closed on a market day realized, by currency (spec of sub-project 36, §2.2):
 * every strategy, Others included, whatever closed them — a buyback, a sale, an assignment, an
 * expiry. An opening realizes nothing. A condor has one line, its composite — its legs have none —
 * so it counts once, on the day its last leg closes.
 */
export function realizedOnDay(rows: readonly JournalRow[], day: string): CurrencyTotal[] {
  const byCurrency = new Map<string, CurrencyTotal>();
  for (const row of rows) {
    if (row.endWhen === null || marketDayOf(row.endWhen) !== day) continue;
    const bucket = byCurrency.get(row.currency) ?? { currency: row.currency, total: null, missing: 0, count: 0 };
    byCurrency.set(row.currency, bucket);
    bucket.count += 1;
    if (row.pnl === null) bucket.missing += 1;
    else bucket.total = (bucket.total ?? 0) + row.pnl;
  }
  return [...byCurrency.values()].sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}
```

Ajouter `export * from "./realized.ts";` dans `packages/ledger/src/journals/index.ts`.

- [x] **Step 4: Test `currentCashBalances`** — reprend la règle de `CashBalancesCard.tsx:53-55` (« dernière ligne, sinon l'Ending Cash seul, sinon `null` »).

```ts
// packages/ledger/src/cash.current.test.ts
import { describe, expect, it } from "vitest";
import { currentCashBalances, type CashCheck, type LedgerRow } from "./cash.ts";

const check = (currency: string, offset: number, end: CashCheck["end"]): CashCheck => ({ currency, offset, end, start: null });

describe("currentCashBalances", () => {
  it("reads each currency on the last ledger row", () => {
    const rows = [{ balances: { USD: 10, EUR: 1 } }, { balances: { USD: 42, EUR: 7 } }] as unknown as LedgerRow[];
    expect(currentCashBalances(rows, [check("USD", 0, null), check("EUR", 0, null)])).toEqual({ USD: 42, EUR: 7 });
  });

  it("falls back on the Ending Cash alone for an empty ledger, null without it", () => {
    expect(currentCashBalances([], [check("USD", 1234, { asOf: "2026-09-01", amount: 1234 }), check("EUR", 0, null)])).toEqual({ USD: 1234, EUR: null });
  });
});
```

(Si `LedgerRow.balances` porte un autre nom, suivre le type réel de `cash.ts` et ajuster le cast.)

- [x] **Step 5: Voir échouer**, puis implémenter dans `packages/ledger/src/cash.ts` :

```ts
/**
 * The cash of each currency now, as the Positions page's Cash card shows it: the last anchored
 * balance, or — on an empty ledger — the Ending Cash alone when a Cash Report anchors the
 * currency, and nothing known otherwise.
 */
export function currentCashBalances(rows: readonly LedgerRow[], checks: readonly CashCheck[]): Record<string, number | null> {
  const last = rows.at(-1);
  return Object.fromEntries(checks.map(({ currency, offset, end }) => [currency, last ? (last.balances[currency] ?? null) : end ? offset : null]));
}
```

- [x] **Step 6: `CashBalancesCard` lit `currentCashBalances`** — dans `apps/web/src/components/CashBalancesCard.tsx`, remplacer le calcul local de `amount` par `const current = currentCashBalances(rows, checks);` hors de la boucle et `const amount = current[currency];` dedans (import depuis `@ib/ledger`). Comportement inchangé : `cd apps/web && npx vitest run CashBalances Positions` doit rester vert.

- [x] **Step 7: Tests verts** — `cd packages/ledger && npx vitest run realized cash`.

- [x] **Step 8: Commit** (cases cochées dans ce plan)

```bash
git add packages/ledger apps/web/src/components/CashBalancesCard.tsx docs/plans/2026-09-28-totaux-pnl.md
git commit -m "Totaux : le réalisé du jour et le cash courant, calculés dans ledger"
```

---

### Task 2: `sumByCurrency`, `liquidationValue`, `WheelShareLine.marketValue` (packages/coverage)

**Files:**
- Create: `packages/coverage/src/totals.ts`, `packages/coverage/src/totals.test.ts`
- Modify: `packages/coverage/src/index.ts`, `packages/coverage/src/strategy.ts:53-63,424-441`
- Test: `packages/coverage/src/strategy.test.ts`

**Interfaces:**
- Consumes: `CurrencyTotal` (tâche 1, `@ib/ledger`).
- Produces:
  - `export function sumByCurrency<Row>(rows: readonly Row[], currencyOf: (row: Row) => string, pick: (row: Row) => number | null): CurrencyTotal[]`
  - `export function liquidationValue(positions: readonly Position[], cash: Readonly<Record<string, number | null>>): CurrencyTotal[]`
  - `export function addTotals(...lists: readonly (readonly CurrencyTotal[])[]): CurrencyTotal[]` — additionne par devise `total` (`null + x = x`, `null + null = null`), `missing` et `count`.
  - `WheelShareLine.marketValue: number | null`

- [x] **Step 1: Tests**

```ts
// packages/coverage/src/totals.test.ts
import { describe, expect, it } from "vitest";
import type { Position } from "@ib/ledger";
import { addTotals, liquidationValue, sumByCurrency } from "./totals.ts";

type R = { c: string; v: number | null };
const sum = (rows: R[]) => sumByCurrency(rows, (r) => r.c, (r) => r.v);

describe("sumByCurrency", () => {
  it("adds the known values and counts the missing ones", () => {
    expect(sum([{ c: "USD", v: 10 }, { c: "USD", v: null }, { c: "USD", v: -3 }])).toEqual([{ currency: "USD", total: 7, missing: 1, count: 3 }]);
  });
  it("gives null only when no line has a value", () => {
    expect(sum([{ c: "USD", v: null }])).toEqual([{ currency: "USD", total: null, missing: 1, count: 1 }]);
  });
  it("never converts: one entry per currency, sorted", () => {
    expect(sum([{ c: "USD", v: 1 }, { c: "EUR", v: 2 }])).toEqual([
      { currency: "EUR", total: 2, missing: 0, count: 1 },
      { currency: "USD", total: 1, missing: 0, count: 1 },
    ]);
  });
  it("returns nothing for no rows", () => {
    expect(sum([])).toEqual([]);
  });
});

const position = (overrides: Partial<Position>): Position =>
  ({ symbol: "AAPL", secType: "STK", right: null, strike: null, expiry: null, multiplier: 1, quantity: 10, avgPrice: 100,
     marketPrice: 110, marketValue: 1100, unrealizedPnl: 100, dailyPnl: null, dayChange: null, currency: "USD", conid: null, description: "AAPL", ...overrides }) as Position;

describe("addTotals", () => {
  it("adds by currency, null plus a value giving the value, missing and count summed", () => {
    expect(addTotals(
      [{ currency: "USD", total: 10, missing: 0, count: 1 }],
      [{ currency: "USD", total: null, missing: 1, count: 1 }, { currency: "EUR", total: 2, missing: 0, count: 1 }],
    )).toEqual([
      { currency: "EUR", total: 2, missing: 0, count: 1 },
      { currency: "USD", total: 10, missing: 1, count: 2 },
    ]);
  });
  it("keeps null when no part knows a value", () => {
    expect(addTotals([{ currency: "USD", total: null, missing: 2, count: 2 }], [])).toEqual([{ currency: "USD", total: null, missing: 2, count: 2 }]);
  });
});

describe("liquidationValue", () => {
  it("adds the positions' market values, a sold option negative, and the cash", () => {
    const positions = [position({}), position({ secType: "OPT", marketValue: -250, description: "AAPL P" })];
    expect(liquidationValue(positions, { USD: 5000 })).toEqual([{ currency: "USD", total: 5850, missing: 0, count: 3 }]);
  });
  it("counts an unknown cash as missing, and a currency with cash only", () => {
    expect(liquidationValue([position({})], { USD: null, EUR: 40 })).toEqual([
      { currency: "EUR", total: 40, missing: 0, count: 1 },
      { currency: "USD", total: 1100, missing: 1, count: 2 },
    ]);
  });
});
```

(Adapter les champs de `position()` au type réel `Position` de `packages/ledger/src/types.ts:66-100` si un nom diffère.)

- [x] **Step 2: Voir échouer** — `cd packages/coverage && npx vitest run totals`.

- [x] **Step 3: Implémenter**

```ts
// packages/coverage/src/totals.ts
import type { CurrencyTotal, Position } from "@ib/ledger";

/**
 * One column summed by currency (spec of sub-project 36, §2.1): the known values added, the
 * `null` ones counted apart, never converted from one currency into another.
 */
export function sumByCurrency<Row>(rows: readonly Row[], currencyOf: (row: Row) => string, pick: (row: Row) => number | null): CurrencyTotal[] {
  const byCurrency = new Map<string, CurrencyTotal>();
  for (const row of rows) {
    const currency = currencyOf(row);
    const bucket = byCurrency.get(currency) ?? { currency, total: null, missing: 0, count: 0 };
    byCurrency.set(currency, bucket);
    bucket.count += 1;
    const value = pick(row);
    if (value === null) bucket.missing += 1;
    else bucket.total = (bucket.total ?? 0) + value;
  }
  return [...byCurrency.values()].sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}

/** Several sums added by currency: a page's header over its tables' headers. */
export function addTotals(...lists: readonly (readonly CurrencyTotal[])[]): CurrencyTotal[] {
  const byCurrency = new Map<string, CurrencyTotal>();
  for (const entry of lists.flat()) {
    const bucket = byCurrency.get(entry.currency) ?? { currency: entry.currency, total: null, missing: 0, count: 0 };
    byCurrency.set(entry.currency, bucket);
    bucket.missing += entry.missing;
    bucket.count += entry.count;
    if (entry.total !== null) bucket.total = (bucket.total ?? 0) + entry.total;
  }
  return [...byCurrency.values()].sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}

/** What the account is worth, by currency: the snapshot's market values plus the current cash (§2.4). */
export function liquidationValue(positions: readonly Position[], cash: Readonly<Record<string, number | null>>): CurrencyTotal[] {
  type Part = { currency: string; value: number | null };
  const parts: Part[] = [
    ...positions.map((p) => ({ currency: p.currency, value: p.marketValue })),
    ...Object.entries(cash).map(([currency, value]) => ({ currency, value })),
  ];
  return sumByCurrency(parts, (p) => p.currency, (p) => p.value);
}
```

Ajouter `export * from "./totals.ts";` dans `packages/coverage/src/index.ts`.

- [x] **Step 4: `WheelShareLine.marketValue`** — test dans `strategy.test.ts`, à côté des tests existants des `shares` de `strategyPositions` (reprendre leur fixture) :

```ts
it("prices the Wheel's shares at lastPrice × quantity, null without a price", () => {
  // Fixture existante : 200 actions Wheel dont la position IB est cotée `marketPrice`.
  const { shares } = strategyPositions(rows, "wheel", snapshot);
  expect(shares[0].marketValue).toBe(shares[0].lastPrice! * shares[0].quantity);
  const { shares: unpriced } = strategyPositions(rows, "wheel", null);
  expect(unpriced[0].marketValue).toBeNull();
});
```

Dans `strategy.ts`, ajouter à `WheelShareLine` :

```ts
  /** lastPrice × quantity: what the table's header sums, no column of its own. */
  marketValue: number | null;
```

et dans le `map` de `strategyPositions` : `marketValue: lastPrice === null ? null : lastPrice * holding.quantity,`.

Vérifier que `strategyBoxContents` (`strategyBoxes.ts`), qui coupe une ligne d'actions en part libre et part couverte, **recalcule `marketValue` sur la quantité de chaque part** comme il le fait pour `quantity`, `unrealizedPnl` et `dailyPnl` ; sinon l'ajouter, avec ce test dans `strategyBoxes.test.ts` :

```ts
it("splits the market value with the quantity: free and covered parts add up to the whole", () => {
  // Reprendre la fixture existante d'un ticker coupé en part libre et part couverte.
  const parts = [...contents.shares.sharesUncovered, ...contents.shares.sharesCallAbove, ...contents.shares.sharesCallBelow].filter((l) => l.ticker === ticker);
  expect(parts.reduce((s, l) => s + l.marketValue!, 0)).toBe(whole.marketValue);
});
```

- [x] **Step 5: Tests verts** — `cd packages/coverage && npx vitest run` puis `npx tsc --noEmit -p .` (le nouveau champ obligatoire peut casser une fixture de test d'`apps/web` : `cd apps/web && npx tsc --noEmit -p .` et compléter les fixtures).

- [x] **Step 6: Commit** — `git commit -m "Totaux : sommes par devise, valeur de liquidation, valeur de marché des actions Wheel"`.

---

### Task 3: `HeaderTotals` et la prop `totals` de `FilteredTableBox`

**Files:**
- Create: `apps/web/src/components/HeaderTotals.tsx`, `apps/web/src/components/HeaderTotals.test.tsx`
- Modify: `apps/web/src/components/table/FilteredTableBox.tsx`, `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`

**Interfaces:**
- Consumes: `CurrencyTotal` (`@ib/ledger`).
- Produces:
  - `export interface HeaderTotalsValue { daily: CurrencyTotal[]; value: CurrencyTotal[]; pnl: CurrencyTotal[]; valueNote?: string }`
  - `export function HeaderTotals({ totals }: { totals: HeaderTotalsValue }): JSX.Element | null` — rien quand les trois tableaux sont vides.
  - `export function headerTotals<Row>(rows: readonly Row[], currencyOf: (r: Row) => string, pick: { daily: (r: Row) => number | null; value: (r: Row) => number | null; pnl: (r: Row) => number | null }): HeaderTotalsValue`
  - `FilteredTableBoxProps.totals?: HeaderTotalsValue`

- [x] **Step 1: Textes** — `fr.json`, nouvelle section racine :

```json
"totals": {
  "daily": "P/L du jour",
  "value": "Valeur",
  "pnl": "P/L",
  "partial_one": "{{count}} ligne sans valeur",
  "partial_other": "{{count}} lignes sans valeur",
  "cashExcluded": "Hors cash : un filtre est actif."
}
```

`en.json` : `"daily": "Day P/L"`, `"value": "Value"`, `"pnl": "P/L"`, `"partial_one": "{{count}} line without a value"`, `"partial_other": "{{count}} lines without a value"`, `"cashExcluded": "Cash left out: a filter is active."`.

- [x] **Step 2: Test**

```tsx
// apps/web/src/components/HeaderTotals.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import { HeaderTotals, headerTotals } from "@/components/HeaderTotals";

const renderTotals = (totals: Parameters<typeof HeaderTotals>[0]["totals"]) =>
  render(<I18nextProvider i18n={i18n}><HeaderTotals totals={totals} /></I18nextProvider>);

type R = { c: string; d: number | null; v: number | null; p: number | null };
const build = (rows: R[]) => headerTotals(rows, (r) => r.c, { daily: (r) => r.d, value: (r) => r.v, pnl: (r) => r.p });

describe("HeaderTotals", () => {
  it("shows the day P/L, the value and the P/L, signed tones on the two P/L", () => {
    renderTotals(build([{ c: "USD", d: -215.4, v: 42310, p: 1830 }]));
    const line = screen.getByTestId("header-totals-USD");
    expect(line).toHaveTextContent("-215.40");
    expect(line).toHaveTextContent("42,310.00");
    expect(line).toHaveTextContent("1,830.00");
    expect(line).toHaveTextContent("USD");
    expect(screen.getByText("-215.40")).toHaveClass("text-destructive");
    expect(screen.getByText("1,830.00")).toHaveClass("text-success");
    expect(screen.getByText("42,310.00")).not.toHaveClass("text-success");
  });

  it("shows — for a day P/L nobody knows, never 0.00", () => {
    renderTotals(build([{ c: "USD", d: null, v: 100, p: 5 }]));
    expect(screen.getByTestId("header-totals-USD")).toHaveTextContent("—");
    expect(screen.getByTestId("header-totals-USD")).not.toHaveTextContent("0.00 ·");
  });

  it("marks a partial sum with an asterisk", () => {
    renderTotals(build([{ c: "USD", d: 10, v: 1, p: 1 }, { c: "USD", d: null, v: 1, p: 1 }]));
    expect(screen.getByTestId("header-totals-USD")).toHaveTextContent("10.00*");
  });

  it("writes one line per currency", () => {
    renderTotals(build([{ c: "USD", d: 1, v: 1, p: 1 }, { c: "EUR", d: 2, v: 2, p: 2 }]));
    expect(screen.getByTestId("header-totals-EUR")).toBeInTheDocument();
    expect(screen.getByTestId("header-totals-USD")).toBeInTheDocument();
  });

  it("renders nothing without a line", () => {
    const { container } = renderTotals(build([]));
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [x] **Step 3: Voir échouer** — `cd apps/web && npx vitest run HeaderTotals`.

- [x] **Step 4: Implémenter**

```tsx
// apps/web/src/components/HeaderTotals.tsx
import { useTranslation } from "react-i18next";
import { sumByCurrency } from "@ib/coverage";
import type { CurrencyTotal } from "@ib/ledger";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ib/ui/tooltip";
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface HeaderTotalsValue {
  daily: CurrencyTotal[];
  value: CurrencyTotal[];
  pnl: CurrencyTotal[];
  /** Said in the value's tooltip: why it is not what the page would otherwise sum. */
  valueNote?: string;
}

/** The three sums of a set of lines (spec of sub-project 36, §4): the header of a page or a table. */
export function headerTotals<Row>(
  rows: readonly Row[],
  currencyOf: (row: Row) => string,
  pick: { daily: (row: Row) => number | null; value: (row: Row) => number | null; pnl: (row: Row) => number | null },
): HeaderTotalsValue {
  return {
    daily: sumByCurrency(rows, currencyOf, pick.daily),
    value: sumByCurrency(rows, currencyOf, pick.value),
    pnl: sumByCurrency(rows, currencyOf, pick.pnl),
  };
}

function Figure({ label, total, signed, note }: { label: string; total: CurrencyTotal | undefined; signed: boolean; note?: string }) {
  const { t } = useTranslation();
  const value = total?.total ?? null;
  const partial = total !== undefined && total.missing > 0 && value !== null;
  const tone = value === null ? "text-muted-foreground" : signed ? (value >= 0 ? "text-success" : "text-destructive") : undefined;
  const tip = [partial ? t("totals.partial", { count: total.missing }) : null, note ?? null].filter(Boolean).join(" ");
  const figure = (
    <span className="whitespace-nowrap">
      <span className="text-xs text-muted-foreground">{label}</span>{" "}
      <span className={cn("font-mono tabular-nums", tone)}>{value === null ? "—" : formatAmount(value)}</span>
      {(partial || note) && <span className="text-muted-foreground">*</span>}
    </span>
  );
  return tip ? (
    <Tooltip>
      <TooltipTrigger render={<span />}>{figure}</TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  ) : (
    figure
  );
}

/** One compact line per currency, beside a title; wraps on a narrow screen. */
export function HeaderTotals({ totals }: { totals: HeaderTotalsValue }) {
  const { t } = useTranslation();
  const currencies = [...new Set([...totals.daily, ...totals.value, ...totals.pnl].map((entry) => entry.currency))].sort();
  if (currencies.length === 0) return null;
  const of = (list: CurrencyTotal[], currency: string) => list.find((entry) => entry.currency === currency);
  return (
    <div className="flex flex-col items-end gap-0.5 text-sm">
      {currencies.map((currency) => (
        <div key={currency} data-testid={`header-totals-${currency}`} className="flex flex-wrap items-baseline justify-end gap-x-3 gap-y-0.5">
          <Figure label={t("totals.daily")} total={of(totals.daily, currency)} signed />
          <Figure label={t("totals.value")} total={of(totals.value, currency)} signed={false} note={totals.valueNote} />
          <Figure label={t("totals.pnl")} total={of(totals.pnl, currency)} signed />
          <span className="text-xs text-muted-foreground">{currency}</span>
        </div>
      ))}
    </div>
  );
}
```

L'astérisque colle au chiffre : le test attend `10.00*`. Si `toHaveTextContent` voit une espace, retirer celle-ci plutôt que d'assouplir le test.

- [x] **Step 5: `FilteredTableBox`** — prop `totals?: HeaderTotalsValue` ; dans le `CardHeader` :

```tsx
<CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
  <CardTitle>{title}</CardTitle>
  {totals && <HeaderTotals totals={totals} />}
</CardHeader>
```

Vérifier dans `packages/ui/src/card.tsx` que `CardHeader` accepte `className` et ne pose pas une grille qui écraserait `flex` (le `CardHeader` shadcn récent est une `grid` avec `CardAction`) ; s'il y a un `CardAction`, poser `HeaderTotals` dedans plutôt que de forcer `flex`.

- [x] **Step 6: Tests verts** — `cd apps/web && npx vitest run HeaderTotals FilteredTableBox`.

- [x] **Step 7: Commit** — `git commit -m "Totaux : HeaderTotals, dans l'en-tête des tableaux filtrés"`.

---

### Task 4: En-têtes de la page Positions

**Files:**
- Modify: `apps/web/src/pages/PositionsPage.tsx`, `apps/web/src/components/PositionGroupCard.tsx`
- Test: `apps/web/src/pages/PositionsPage.test.tsx`

**Interfaces:**
- Consumes: `headerTotals`, `HeaderTotals`, `HeaderTotalsValue` (tâche 3), `liquidationValue` (tâche 2), `currentCashBalances` (tâche 1), `activeCriteria` (`lib/tableView.ts`).
- Produces: `PositionGroupCardProps.totals?: HeaderTotalsValue`.

- [x] **Step 1: Tests** dans `PositionsPage.test.tsx`, avec sa fixture existante (snapshot semé + ledger + cash points). Ajouter :

```tsx
it("heads the page with the day P/L, the liquidation value cash included, and the P/L", async () => {
  // Semer un snapshot agent de deux positions USD (marketValue 1000 et -200, unrealizedPnl 50 et 20,
  // dailyPnl 10 et -4) et un cash USD calé à 5000 (cash point `end`).
  renderPage();
  const header = await screen.findByTestId("page-totals");
  const usd = within(header).getByTestId("header-totals-USD");
  expect(usd).toHaveTextContent("6.00");       // 10 − 4
  expect(usd).toHaveTextContent("5,800.00");   // 1000 − 200 + 5000
  expect(usd).toHaveTextContent("70.00");      // 50 + 20
});

it("heads each group card with its own lines", async () => {
  renderPage();
  const sells = await screen.findByRole("region", { name: "Ventes d'options" }); // aria-label du Card
  expect(within(sells).getByTestId("header-totals-USD")).toHaveTextContent("-200.00");
});

it("leaves the cash out of the page value once a search is active, and says so", async () => {
  const user = userEvent.setup();
  renderPage();
  await user.type(await screen.findByRole("searchbox"), "AAPL{Enter}");
  const usd = within(await screen.findByTestId("page-totals")).getByTestId("header-totals-USD");
  expect(usd).not.toHaveTextContent("5,800.00");
  expect(usd).toHaveTextContent("*");
});

it("shows — for the day P/L from a Flex snapshot, never 0.00", async () => {
  // Même snapshot, source "flex", dailyPnl null partout.
  renderPage();
  const usd = within(await screen.findByTestId("page-totals")).getByTestId("header-totals-USD");
  expect(usd.textContent).toMatch(/P\/L du jour\s*—/);
});
```

Adapter la façon de trouver la carte et le champ de recherche à ce que les tests existants du fichier utilisent déjà (`getByRole` / `aria-label`), sans changer les assertions de montant.

- [x] **Step 2: Voir échouer.**

- [x] **Step 3: Implémenter**
  - `PositionGroupCard` : prop `totals?: HeaderTotalsValue`, passée à `FilteredTableBox`.
  - `PositionsPage` : pour chaque `box`, `const totals = headerTotals(box.rows, (p) => p.currency, { daily: (p) => p.dailyPnl, value: (p) => p.marketValue, pnl: (p) => p.unrealizedPnl })` → `totals={…}`.
  - En-tête de page :

```tsx
const shown = boxes.flatMap((box) => box.rows);
const filtered = search.applied.trim() !== "" || ids.some((id) => activeCriteria(specs, viewOf[id]).length > 0);
const cash = anchored ? currentCashBalances(anchored.rows, anchored.checks) : {};
const pageTotals: HeaderTotalsValue = {
  ...headerTotals(shown, (p) => p.currency, { daily: (p) => p.dailyPnl, value: (p) => p.marketValue, pnl: (p) => p.unrealizedPnl }),
  ...(filtered ? { valueNote: t("totals.cashExcluded") } : { value: liquidationValue(shown, cash) }),
};
```

    `liquidationValue` prend des `Position` : `AnalyzedPosition` doit porter `currency` et `marketValue` (vérifier son type ; sinon passer `report.positions` mappés). Rendu :

```tsx
<div className="flex flex-wrap items-start justify-between gap-3">
  <h1 className="font-heading text-lg font-semibold tracking-tight">{t("nav.positions")}</h1>
  <div data-testid="page-totals"><HeaderTotals totals={pageTotals} /></div>
</div>
```

  - La branche « aucun snapshot » (`report === null || snapshot === null`) ne reçoit pas d'en-tête.

- [x] **Step 4: Tests verts** — `cd apps/web && npx vitest run PositionsPage`.

- [x] **Step 5: Commit** — `git commit -m "Totaux : en-têtes de la page Positions"`.

---

### Task 5: En-têtes des pages de stratégie

**Files:**
- Modify: `apps/web/src/pages/StrategyPositionsPage.tsx`
- Test: `apps/web/src/pages/StrategyPositionsPage.test.tsx`

**Interfaces:**
- Consumes: `headerTotals`, `HeaderTotals`, `HeaderTotalsValue` (tâche 3), `addTotals`, `WheelShareLine.marketValue` (tâche 2).

Sommes par type de ligne :

| Ligne | daily | value | pnl | devise |
|---|---|---|---|---|
| `StrategyLine` | `dailyPnl` | `marketValue` | `unrealizedPnl` | `contract.currency` |
| `WheelShareLine` | `dailyPnl` | `marketValue` | `unrealizedPnl` | `currency` |
| `CondorLine` | `dailyPnl` | `marketValue` | `pnl` | `contract.currency` |

- [x] **Step 1: Tests** dans `StrategyPositionsPage.test.tsx`, sur la fixture `SNAPSHOT` existante (les montants attendus se calculent sur cette fixture : les écrire en dur dans le test après les avoir dérivés à la main des positions de `SNAPSHOT`, pas en relisant la sortie du code) :

```tsx
it("heads the Wheel page with the sums of every box's shown lines", async () => { /* page-totals : value = Σ marketValue des encadrés rendus */ });
it("heads each Wheel box with its own lines, free and covered shares never counted twice", async () => {
  // MQZA : 200 actions Wheel à 18, un call : les parts des encadrés d'actions somment 3 600,00 à elles toutes.
});
it("narrows every header to the searched ticker", async () => { /* recherche « MQZA » → page-totals ne contient plus la valeur des autres tickers */ });
it("heads the Condors page with the condor lines' P/L column, never their legs on top", async () => {
  // Semer un condor ouvert (reprendre la fixture condor existante du fichier) : page-totals.pnl = CondorLine.pnl.
});
it("marks the day P/L partial when dayShare drops a line", async () => { /* une ligne dayChange null : « * » sur P/L du jour */ });
```

Chaque test écrit ses montants attendus en dur et ses assertions sur `within(screen.getByTestId("page-totals"))` ou sur la carte (`aria-label` = titre de l'encadré).

- [x] **Step 2: Voir échouer.**

- [x] **Step 3: Implémenter**
  - Trois fonctions locales en tête de fichier :

```ts
const lineTotals = (rows: readonly StrategyLine[]) =>
  headerTotals(rows, (l) => l.contract.currency, { daily: (l) => l.dailyPnl, value: (l) => l.marketValue, pnl: (l) => l.unrealizedPnl });
const shareTotals = (rows: readonly WheelShareLine[]) =>
  headerTotals(rows, (l) => l.currency, { daily: (l) => l.dailyPnl, value: (l) => l.marketValue, pnl: (l) => l.unrealizedPnl });
const condorTotals = (rows: readonly CondorLine[]) =>
  headerTotals(rows, (l) => l.contract.currency, { daily: (l) => l.dailyPnl, value: (l) => l.marketValue, pnl: (l) => l.pnl });
```

  - `LinesBox`, `CondorsBox`, `SharesBox` passent `totals={xxxTotals(box.rows)}` à `FilteredTableBox`.
  - En-tête de page : les lignes affichées de tous les encadrés, fusionnées par `addTotals` (tâche 2) :

```ts
const parts = [
  ...[...lines.values()].map((box) => lineTotals(box.rows)),
  ...[...shares.values()].map((box) => shareTotals(box.rows)),
  ...[...condorBoxes.values()].map((box) => condorTotals(box.rows)),
];
const pageTotals: HeaderTotalsValue = {
  daily: addTotals(...parts.map((part) => part.daily)),
  value: addTotals(...parts.map((part) => part.value)),
  pnl: addTotals(...parts.map((part) => part.pnl)),
};
```

    Seuls les encadrés rendus comptent : `lines`, `shares`, `condorBoxes` sont les `Map` que la page construit déjà après `filterBoxes`, et un encadré déclaré mais absent de `defs` n'y est pas.
  - Rendu du titre, identique à la page Positions (`data-testid="page-totals"`).

- [x] **Step 4: Tests verts** — `cd apps/web && npx vitest run StrategyPositions`.

- [x] **Step 5: Commit** — `git commit -m "Totaux : en-têtes des pages de stratégie"`.

---

### Task 6: Tableau de bord

**Files:**
- Create: `apps/web/src/components/stats/UnrealizedPnlCard.tsx`, `apps/web/src/components/stats/DailyPnlCard.tsx`
- Modify: `apps/web/src/components/stats/PnlTotalCard.tsx`, `apps/web/src/pages/DashboardPage.tsx`, `apps/web/src/i18n/{fr,en}.json`
- Test: `apps/web/src/pages/DashboardPage.test.tsx`

**Interfaces:**
- Consumes: `realizedOnDay`, `currentCashBalances`, `marketDayOf`, `anchoredBalances` (`@ib/ledger`), `sumByCurrency`, `liquidationValue` (`@ib/coverage`), `useLedger`, `useCashPoints` (`db/hooks.ts`), `BALANCE_CURRENCIES` (même import que `PositionsPage`).
- Produces:
  - `PnlTotalCard({ stats, value }: { stats: StrategyStats; value?: CurrencyTotal | null })` — `value` absent : rien (pages de statistiques) ; `null` : « — ».
  - `UnrealizedPnlCard({ unrealized, realizedToday }: { unrealized: CurrencyTotal | null; realizedToday: CurrencyTotal | null })`
  - `DailyPnlCard({ daily }: { daily: CurrencyTotal | null })`

- [x] **Step 1: Textes** — `fr.json` sous `stats` : `"totalValue": "Valeur totale"`, `"unrealized": "P/L non réalisé"`, `"realizedToday": "Réalisé du jour"`, `"dailyUnrealized": "P/L non réalisé du jour"`. `en.json` : `"Total value"`, `"Unrealized P/L"`, `"Realized today"`, `"Unrealized P/L today"`.

- [x] **Step 2: Tests** dans `DashboardPage.test.tsx`, sur la fixture existante, en semant un snapshot `agent` (`asOf` `2026-09-25T15:00:00.000Z`), deux positions USD (marketValue 1000/-200, unrealizedPnl 50/20, dailyPnl 10/-4), un cash point USD `end` à 5000, et une transaction qui ferme une ligne ce jour-là (rachat d'un put vendu plus tôt, P/L de journal connu) :

```tsx
it("adds the account's total value to the total P/L card", async () => {
  renderPage();
  const card = await screen.findByRole("region", { name: "Profit/Perte total" });
  expect(card).toHaveTextContent("Valeur totale");
  expect(card).toHaveTextContent("5,800.00");
});
it("shows the unrealized P/L with today's realized under it", async () => {
  const card = await screen.findByRole("region", { name: "P/L non réalisé" });
  expect(card).toHaveTextContent("70.00");
  expect(card).toHaveTextContent("Réalisé du jour");
  expect(card).toHaveTextContent(/* P/L du rachat, en dur */);
});
it("shows the day's unrealized P/L above the sector exposure", async () => {
  const card = await screen.findByRole("region", { name: "P/L non réalisé du jour" });
  expect(card).toHaveTextContent("6.00");
  // ordre : cette carte précède « Exposition par secteur » dans le DOM
  const exposure = screen.getByRole("region", { name: "Exposition par secteur" });
  expect(card.compareDocumentPosition(exposure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it("shows — for the day's figures without an agent snapshot", async () => {
  // snapshot flex : P/L non réalisé du jour et Réalisé du jour valent « — », P/L non réalisé reste calculé.
});
```

Les cartes portent `aria-label={titre}` sur leur `Card` pour être trouvées par `role="region"` ; ajouter l'`aria-label` à `PnlTotalCard` et `ExposureCard` si absent (vérifier que cela ne casse pas un test existant). Adapter `renderPage` / la manière de semer à ce que le fichier fait déjà.

- [x] **Step 3: Voir échouer.**

- [x] **Step 4: Implémenter**
  - Grand chiffre : extraire de `PnlTotal` une `SignedAmount({ value, currency, size })` si utile, sinon reprendre ses classes (`font-mono text-2xl font-semibold tabular-nums`, `text-success`/`text-destructive`, « — » en `text-muted-foreground`).
  - `PnlTotalCard` : sous `<PnlTotal/>`, si `value !== undefined`, une ligne `text-sm` : `t("stats.totalValue")` puis la valeur mono neutre (« — » si `null` ou `total === null`, `*` + infobulle `totals.partial` si `missing > 0`).
  - `UnrealizedPnlCard` : titre `stats.unrealized`, grand chiffre signé, puis ligne `text-sm` `stats.realizedToday` + montant signé.
  - `DailyPnlCard` : titre `stats.dailyUnrealized`, grand chiffre signé.
  - `DashboardPage` :

```ts
const { snapshot, report, sectorOf } = useAccountRiskReport();
const ledger = useLedger(accountId);
const points = useCashPoints(accountId);
const anchored = useMemo(() => (ledger && points ? anchoredBalances(ledger, BALANCE_CURRENCIES, points) : undefined), [ledger, points]);
const agentDay = snapshot?.source === "agent" ? marketDayOf(snapshot.asOf) : null;
// … après le calcul de `stats` :
const currency = stats?.currency ?? "USD";
const pick = (list: CurrencyTotal[]) => list.find((entry) => entry.currency === currency) ?? null;
const positions = snapshot?.positions ?? [];
const value = snapshot ? pick(liquidationValue(positions, anchored ? currentCashBalances(anchored.rows, anchored.checks) : {})) : null;
const unrealized = snapshot ? pick(sumByCurrency(positions, (p) => p.currency, (p) => p.unrealizedPnl)) : null;
const daily = agentDay ? pick(sumByCurrency(positions, (p) => p.currency, (p) => p.dailyPnl)) : null;
const realizedToday = agentDay ? pick(realizedOnDay(view.report.rows, agentDay)) ?? { currency, total: 0, missing: 0, count: 0 } : null;
```

    Un jour d'agent sans fermeture vaut 0, pas « — » : l'agent a vu la journée. Poser les hooks (`useMemo`) avant le premier `return` de la page. Grille : colonne gauche `PnlTotalCard value` → `UnrealizedPnlCard` → `CashCoverageCard` ; colonne droite `DailyPnlCard` → `ExposureCard` (la colonne droite devient un `flex flex-col gap-4`).

- [x] **Step 5: Tests verts** — `cd apps/web && npx vitest run DashboardPage Stats PnlTotal`.

- [x] **Step 6: Commit** — `git commit -m "Totaux : valeur totale, P/L non réalisé et P/L du jour au tableau de bord"`.

---

### Task 7: Documentation, vérification, instance de relecture

**Files:**
- Modify: `CLAUDE.md`, `docs/points-reportes.md`, `docs/specs/2026-09-28-totaux-pnl-design.md`

- [ ] **Step 1: `CLAUDE.md`** — ajouter une règle dans « Règles qui mordent » :

```markdown
- **Les totaux sont des sommes calculées, jamais stockées** (sous-projet 36) : `sumByCurrency`,
  `addTotals` et `liquidationValue` (`packages/coverage/src/totals.ts`), `realizedOnDay`
  (`packages/ledger/src/journals/realized.ts`), `currentCashBalances` (`packages/ledger/src/cash.ts`).
  Par devise, jamais convertis ; une valeur absente compte dans `missing`, jamais pour 0, et le
  total n'est `null` que si aucune ligne n'en a. Un en-tête somme **les lignes affichées**, filtres
  compris ; celui de la page Positions ne compte le cash que sans filtre. « Le jour » est
  `marketDayOf` d'un snapshot `agent` : sans lui, P/L du jour et réalisé du jour valent « — ». Le
  réalisé du jour compte toute fermeture — une ouverture ne réalise rien — et un condor le jour de
  sa dernière jambe.
```

  et la ligne du registre : `| 36 | Les totaux : P/L du jour, P/L non réalisé, valeur totale | fait (2026-09-28) |`.

- [ ] **Step 2: `docs/points-reportes.md`** — section « Reporté par le sous-projet 36 (Totaux) » : une jambe de condor fermée seule n'entre dans aucun réalisé du jour ; le composite compte tout son `pnl` le jour de sa dernière jambe.

- [ ] **Step 3: Statut de la spec** → « implémenté (2026-09-28) ».

- [ ] **Step 4: `pnpm check`** depuis la racine du worktree — tout vert. Sinon corriger et relancer.

- [ ] **Step 5: Commit** — `git commit -m "Totaux : documentation du sous-projet 36"`.

- [ ] **Step 6: Instance de relecture** — `pnpm dev:start` dans le worktree, donner les deux URL à Seb (et rappeler `ib-tws-agent origin add http://127.0.0.1:<port>` pour voir les valeurs du jour).
