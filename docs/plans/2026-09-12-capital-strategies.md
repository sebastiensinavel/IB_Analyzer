# Sous-projet 14 — Capital des LEAPS, des Condors et du portefeuille : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner aux pages Statistiques LEAPS et Condors le capital et le rendement mensuel (et l'exposition par secteur aux LEAPS), et au tableau de bord le profit/perte total, les profits/pertes mensuels, l'exposition, le capital et le rendement des trois stratégies ensemble.

**Architecture:** Deux couches. (1) *Moteur* (`packages/ledger`) : `computeStats` et `computeCapital` (ex-`computeWheelCapital`) prennent une liste de stratégies ; `computeCapital` mesure en plus les LEAPS (prix d'achat, actions exercées au strike) et les Condors (pire aile brute) ; `buildJournals` calcule quatre portées, `wheel`, `leaps`, `condors` et `portfolio` (les trois à la fois), rangées dans `JournalsReport.stats` et `JournalsReport.capital`. Le tableau de bord n'additionne rien : il lit la portée `portfolio`. (2) *Pages* (`apps/web`) : `lib/wheelCharts.ts` devient `lib/capitalCharts.ts`, générique sur les courbes tracées ; `WheelCapitalCards` éclate en cartes réutilisables (`ExposureCard`, `CapitalCard`, `ReturnCard`, `MonthlyPnlCard`, `PnlTotal`, `CurrencySelect`) que `StatsPage` et `DashboardPage` assemblent.

**Tech Stack:** TypeScript 6, Vitest 4, React 19, react-router 8, Dexie 4 (`fake-indexeddb` en test), react-i18next, shadcn base-ui, ECharts 6 et `echarts-for-react` 3, Tailwind 4 (requêtes de conteneur natives). Node 22, pnpm.

**Spec:** `docs/specs/2026-09-12-capital-strategies-design.md` (lire aussi `CLAUDE.md` et `docs/specs/2026-09-11-capital-wheel-design.md`, dont ce sous-projet généralise le §2 et le §4).

## Global Constraints

- **Rien dans `apps/api`**, aucune table, aucun store, aucune migration Dexie : le capital est une vue calculée des journaux, jamais stockée. Une tâche qui semble réclamer un endpoint ou une table est un signal d'arrêt.
- **Le tableau de bord est la portée `portfolio`, jamais une addition** : aucune fonction ne combine des résultats par stratégie ; `computeStats` et `computeCapital` sont appelées sur `SCOPE_STRATEGIES.portfolio`.
- **Journaux et rapport de risque se lisent par `useAccountJournals` et `useAccountRiskReport`** : aucune page ni composant n'appelle `useJournals` ni `useRiskReport`.
- **Montants (spec §2)** : put Wheel `strike × DEFAULT_MULTIPLIER × |quantity|` ; action Wheel `openPrice × |quantity|` ; LEAPS `openPrice × DEFAULT_MULTIPLIER × |quantity|` ; action LEAPS `openPrice × |quantity|` ; Condor `max(putWidth, callWidth) × DEFAULT_MULTIPLIER × |quantity|` ; tout le reste, dont un call vendu, ne compte rien. Jamais la valeur de marché, jamais le crédit déduit.
- **Ouvert en fin de mois = `startWhen < D` et (`endWhen === null` ou `endWhen ≥ D`)**, `D` le premier jour du mois suivant ; **jamais `ongoing`**.
- **`DEFAULT_MULTIPLIER` s'importe de `packages/ledger/src/constants.ts`**, jamais un `100` recodé. `ledger` n'importe jamais `@ib/coverage` (cycle).
- **Tout reste par devise, sans conversion.** La carte « Couverture en Cash » reste en USD, hors du sélecteur de devise.
- **Une valeur absente reste `null`**, jamais `0` : un mois sans capital alloué a `returnRate: null`.
- **Une teinte par courbe, la même sur toutes les pages** : rang de la clé dans `["cumulativePnl", "assigned", "allocated", "invested"]`. Aucune couleur en dur dans un composant.
- **Toute phrase vit dans `apps/web/src/i18n/{fr,en}.json`, mêmes clés dans les deux.** `packages/ledger` n'écrit aucun texte visible.
- **shadcn ici est base-ui** : `render={<X/>}`, jamais `asChild` ; `onValueChange` typé `T | null`.
- **Un test doit échouer si le comportement change.** `apps/web` teste sur `fake-indexeddb` avec une base semée, **jamais en moquant les hooks**.
- Code et commentaires en anglais ; documentation, i18n et messages de commit en français.
- Chaque commit se termine par les deux lignes :
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Arhu7RqqK2RvtQrwe6o6kH
  ```
- Le travail se fait dans un worktree `.claude/worktrees/capital-strategies` (skill `superpowers:using-git-worktrees`), branche `capital-strategies`, mergé sur `main` après revue.
- **Les cases de ce plan se cochent dans le worktree au fur et à mesure, dans le même commit que la tâche.**

---

## Structure des fichiers

```
packages/ledger/src/journals/
  types.ts                 CapitalScope, SCOPE_STRATEGIES ; CapitalMeasure, CapitalMonth, Exposure,
                           StrategyCapital (remplacent WheelMonth, WheelExposure, WheelCapital) ;
                           JournalsReport.stats et .capital par portée
  stats.ts (+ test)        computeStats(rows, strategies, lastWhen)
  capital.ts (+ test)      computeCapital(rows, strategies, stats) : LEAPS, Condors, portées
  replay.ts (+ test)       quatre portées dans buildJournals

apps/web/src/
  lib/wheelCharts.ts   →   lib/capitalCharts.ts (+ test) : CapitalSeries, SCOPE_SERIES, seriesColor,
                           monthGrid(series), sectorSlices sur quatre mesures
  hooks/useCapitalSeries.ts (+ test)  NOUVEAU  noms traduits des courbes d'une portée
  components/stats/
    WheelCapitalCards.tsx  SUPPRIMÉ
    CurrencySelect.tsx     NOUVEAU
    PnlTotal.tsx           NOUVEAU
    MonthlyPnlCard.tsx     NOUVEAU (sorti de StatsPage)
    ExposureCard.tsx       NOUVEAU
    CapitalCard.tsx        NOUVEAU
    ReturnCard.tsx         NOUVEAU
  components/CashCoverageCard.tsx     NOUVEAU (sorti de DashboardPage)
  pages/StatsPage.tsx (+ test)        LEAPS et Condors gagnent leurs cartes
  pages/DashboardPage.tsx (+ test)    total, exposition, capital, rendement du portefeuille
  lib/consistency.test.ts             littéral JournalsReport
  i18n/fr.json, i18n/en.json          stats.exposure.empty.{wheel,leaps,portfolio}, stats.capital.titlePortfolio
  mocks/journals.ts, mocks/seed.ts (+ test)   un Condor QQQ ouvert, secteurs ZZZ et QQQ

CLAUDE.md, docs/specs/2026-09-12-capital-strategies-design.md, docs/points-reportes.md
```

## Commandes

Depuis la racine du worktree.

```bash
pnpm install                                                   # une fois, à la création du worktree
pnpm --filter @ib/ledger test src/journals/capital.test.ts     # un fichier du moteur
pnpm --filter @ib/ledger test                                  # tout le moteur, oracle des journaux compris
pnpm --filter web test src/lib/capitalCharts.test.ts           # un fichier de l'app
pnpm --filter web test                                         # toute l'app
pnpm typecheck                                                 # tsc de tous les paquets, silencieux si OK
pnpm lint                                                      # oxlint
pnpm check                                                     # lint + typecheck + build + tous les Vitest
```

---

## Tâche 1 : les statistiques d'une liste de stratégies, et la portée `portfolio`

**Files:**
- Modify: `packages/ledger/src/journals/types.ts`
- Modify: `packages/ledger/src/journals/stats.ts` (`computeStats`)
- Modify: `packages/ledger/src/journals/replay.ts` (fin de `buildJournals`)
- Modify: `apps/web/src/lib/consistency.test.ts:9` (littéral `JournalsReport`)
- Test: `packages/ledger/src/journals/stats.test.ts`, `packages/ledger/src/journals/replay.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces, exportés par `@ib/ledger` via `journals/types.ts` :

```ts
export type CapitalScope = StatsStrategy | "portfolio";
export const SCOPE_STRATEGIES: Record<CapitalScope, readonly StatsStrategy[]>;
// JournalsReport.stats devient : Record<CapitalScope, StrategyStats[]>
```

et, dans `journals/stats.ts` : `computeStats(rows: readonly JournalRow[], strategies: readonly StatsStrategy[], lastWhen: string | null): StrategyStats[]`.

- [x] **Step 1 : écrire les tests qui échouent**

Dans `packages/ledger/src/journals/stats.test.ts`, remplacer le deuxième argument de **chaque** appel existant à `computeStats` par une liste : `"wheel"` devient `["wheel"]`, `"condors"` devient `["condors"]`, `"leaps"` devient `["leaps"]` (quatorze appels). Puis ajouter à la fin du `describe("computeStats", …)` :

```ts
  it("counts several strategies at once: months from the first flow of any, each total summed, never Others", () => {
    const rows = [
      row({}),
      row({ id: "y#1", strategy: "leaps", kind: "short_call", startWhen: "2026-06-10T14:30:00.000Z", openNet: 49 }),
      row({ id: "z#1", strategy: "condors", kind: "condor", strike: null, startWhen: "2026-09-03T14:30:00.000Z", openNet: 46 }),
      row({ id: "o#1", strategy: "others", kind: "short_call", openNet: 500 }),
    ];
    const [all] = computeStats(rows, ["wheel", "leaps", "condors"], null);
    expect(all).toEqual({
      currency: "USD",
      total: 114,
      months: [
        { month: "2026-06", pnl: 49 },
        { month: "2026-07", pnl: 0 },
        { month: "2026-08", pnl: 19 },
        { month: "2026-09", pnl: 46 },
      ],
      incomplete: 0,
    });
    const each = (["wheel", "leaps", "condors"] as const).map((strategy) => computeStats(rows, [strategy], null)[0].total);
    expect(all.total).toBe(each.reduce((n, total) => n + total, 0));
  });
```

Dans `packages/ledger/src/journals/replay.test.ts`, dans le `describe("buildJournals — statistics", …)`, ajouter après le test existant :

```ts
  it("gives the portfolio the statistics of the three strategies at once, never Others", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -1, price: 0.25, when: D1 }),
      option({ ticker: "ZZZ", right: "C", strike: 15, expiry: "2027-06-18", quantity: 1, price: 3, when: "2026-08-04T14:30:00.000Z" }),
      option({ ticker: "ZZZ", right: "C", strike: 20, expiry: "2026-09-18", quantity: -1, price: 0.5, when: "2026-09-05T14:30:00.000Z" }),
      option({ ticker: "AAPL", right: "C", strike: 200, expiry: "2026-09-18", quantity: -1, price: 1, when: D2 }),
    ]);
    // The MQZA put nets 24 in August, the call sold on the ZZZ LEAPS 49 in September; the naked AAPL call is Others.
    expect(report.stats.portfolio).toEqual([
      { currency: "USD", total: 73, months: [{ month: "2026-08", pnl: 24 }, { month: "2026-09", pnl: 49 }], incomplete: 0 },
    ]);
    expect(report.stats.condors).toEqual([]);
    expect(report.stats.portfolio[0].total).toBe(report.stats.wheel[0].total + report.stats.leaps[0].total);
  });
```

- [x] **Step 2 : lancer les tests, vérifier qu'ils échouent**

Run: `pnpm --filter @ib/ledger test src/journals/stats.test.ts src/journals/replay.test.ts`
Expected: FAIL — les appels à liste ne filtrent plus rien (`row.strategy !== ["wheel"]` est toujours vrai) : les tests existants de `stats.test.ts` reçoivent `[]` ; le test de `replay.test.ts` reçoit `undefined` pour `report.stats.portfolio`.

- [x] **Step 3 : implémenter**

Dans `packages/ledger/src/journals/types.ts`, juste après `export type StatsStrategy = "wheel" | "leaps" | "condors";` :

```ts
/** A statistics page, or the three strategies at once for the dashboard. */
export type CapitalScope = StatsStrategy | "portfolio";
/**
 * The strategies whose lines a scope reads. The dashboard's figures are the same computation over
 * more lines, never a sum of the strategies' results (spec of sub-project 14, §3).
 */
export const SCOPE_STRATEGIES: Record<CapitalScope, readonly StatsStrategy[]> = {
  wheel: ["wheel"],
  leaps: ["leaps"],
  condors: ["condors"],
  portfolio: ["wheel", "leaps", "condors"],
};
```

et, dans `JournalsReport`, remplacer `stats: Record<StatsStrategy, StrategyStats[]>;` par :

```ts
  stats: Record<CapitalScope, StrategyStats[]>;
```

Dans `packages/ledger/src/journals/stats.ts` :

1. Remplacer l'import par `import type { JournalRow, StatsStrategy, Strategy, StrategyStats } from "./types.ts";`.
2. Remplacer l'en-tête et le début de `computeStats` :

```ts
/**
 * `lastWhen` is the ledger's last transaction, whatever its strategy: the months run on to it,
 * so a position still open shows the months it has been open, not only the months money moved.
 */
export function computeStats(rows: readonly JournalRow[], strategy: StatsStrategy, lastWhen: string | null): StrategyStats[] {
  const byCurrency = new Map<string, { total: number; months: Map<string, number>; incomplete: number }>();
  for (const row of rows) {
    if (row.strategy !== strategy) continue;
```

par :

```ts
/**
 * `lastWhen` is the ledger's last transaction, whatever its strategy: the months run on to it,
 * so a position still open shows the months it has been open, not only the months money moved.
 * `strategies` is one strategy for its page, all three for the dashboard: the same flows, summed.
 */
export function computeStats(rows: readonly JournalRow[], strategies: readonly StatsStrategy[], lastWhen: string | null): StrategyStats[] {
  const scope = new Set<Strategy>(strategies);
  const byCurrency = new Map<string, { total: number; months: Map<string, number>; incomplete: number }>();
  for (const row of rows) {
    if (!scope.has(row.strategy)) continue;
```

Dans `packages/ledger/src/journals/replay.ts` :

1. Remplacer `import type { CloseEvent, JournalRow, JournalSnapshot, JournalsReport, Reconciliation } from "./types.ts";` par un seul import, au style de `classify.ts` :

```ts
import { SCOPE_STRATEGIES, type CapitalScope, type CloseEvent, type JournalRow, type JournalSnapshot, type JournalsReport, type Reconciliation } from "./types.ts";
```
2. À la fin de `buildJournals`, remplacer :

```ts
  const wheel = computeStats(rows, "wheel", lastWhen);
  return {
    rows,
    reconciliation,
    stats: { wheel, leaps: computeStats(rows, "leaps", lastWhen), condors: computeStats(rows, "condors", lastWhen) },
    wheelCapital: computeWheelCapital(rows, wheel),
  };
```

par :

```ts
  const statsOf = (scope: CapitalScope) => computeStats(rows, SCOPE_STRATEGIES[scope], lastWhen);
  const stats = { wheel: statsOf("wheel"), leaps: statsOf("leaps"), condors: statsOf("condors"), portfolio: statsOf("portfolio") };
  return { rows, reconciliation, stats, wheelCapital: computeWheelCapital(rows, stats.wheel) };
```

Dans `apps/web/src/lib/consistency.test.ts`, ligne 9, remplacer `stats: { wheel: [], leaps: [], condors: [] }` par `stats: { wheel: [], leaps: [], condors: [], portfolio: [] }`.

- [x] **Step 4 : lancer les tests et le typage**

Run: `pnpm --filter @ib/ledger test && pnpm --filter web test src/lib/consistency.test.ts src/pages/StatsPage.test.tsx && pnpm typecheck`
Expected: PASS, oracle des journaux compris ; `pnpm typecheck` silencieux.

- [x] **Step 5 : commit**

Cocher les cases de la tâche 1 dans ce plan, puis :

```bash
git add packages/ledger/src/journals apps/web/src/lib/consistency.test.ts docs/plans/2026-09-12-capital-strategies.md
git commit -F - <<'EOF'
feat(ledger): statistiques d'une liste de stratégies et portée portfolio

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Arhu7RqqK2RvtQrwe6o6kH
EOF
```

---

## Tâche 2 : le capital des LEAPS, des Condors et de chaque portée

**Files:**
- Modify: `packages/ledger/src/journals/types.ts`
- Modify: `packages/ledger/src/journals/capital.ts`
- Modify: `packages/ledger/src/journals/replay.ts` (fin de `buildJournals`)
- Modify: `apps/web/src/lib/wheelCharts.ts`, `apps/web/src/lib/wheelCharts.test.ts`, `apps/web/src/components/stats/WheelCapitalCards.tsx`, `apps/web/src/pages/StatsPage.tsx`, `apps/web/src/lib/consistency.test.ts`, `apps/web/src/mocks/seed.test.ts` (renommages de types et de champ seulement)
- Test: `packages/ledger/src/journals/capital.test.ts`, `packages/ledger/src/journals/replay.test.ts`

**Interfaces:**
- Consumes: `CapitalScope`, `SCOPE_STRATEGIES`, `computeStats(rows, strategies, lastWhen)` (tâche 1) ; `JournalRow.legs` (quatre jambes d'un condor, dans l'ordre put acheté, put vendu, call vendu, call acheté) ; `DEFAULT_MULTIPLIER`.
- Produces, exportés par `@ib/ledger` via `journals/types.ts` :

```ts
export type CapitalMeasure = "assigned" | "putCash" | "leaps" | "condors";
export interface CapitalMonth { month: string; cumulativePnl: number; assigned: number; putCash: number; leaps: number; condors: number; allocated: number; invested: number; returnRate: number | null }
export interface Exposure { ticker: string; assigned: number; putCash: number; leaps: number; condors: number }
export interface StrategyCapital { currency: string; months: CapitalMonth[]; exposure: Exposure[]; incomplete: number }
// JournalsReport : `wheelCapital` disparaît, `capital: Record<CapitalScope, StrategyCapital[]>` arrive.
```

et, dans `journals/capital.ts` (non réexporté par l'index) : `computeCapital(rows: readonly JournalRow[], strategies: readonly StatsStrategy[], stats: readonly StrategyStats[]): StrategyCapital[]` ; `nextMonthStart` inchangée. `WheelMonth`, `WheelExposure`, `WheelCapital` et `computeWheelCapital` n'existent plus.

- [x] **Step 1 : écrire les tests qui échouent**

Remplacer tout `packages/ledger/src/journals/capital.test.ts` par :

```ts
import { describe, expect, it } from "vitest";
import { computeCapital, nextMonthStart } from "./capital.ts";
import type { JournalRow, MonthPnl, RowKind, StatsStrategy, StrategyStats } from "./types.ts";

/** A Wheel put: two MQZA 17 puts sold on 2026-08-03, still open. */
function row(overrides: Partial<JournalRow>): JournalRow {
  return {
    id: "x#1", strategy: "wheel", kind: "short_put", ticker: "MQZA", label: "MQZA", currency: "USD", startWhen: "2026-08-03T14:30:00.000Z", quantity: -2, strike: 17,
    openPrice: 0.21, openTotal: 42, openCommission: -1, openNet: 41, assigned: false,
    endWhen: null, closePrice: null, closeTotal: null, closeCommission: null, closeNet: null, pnl: null, ongoing: true, event: null, orphan: false, note: null,
    openIds: [], closeIds: [], ...overrides,
  };
}

/** Wheel shares: 200 MQZA delivered at 17, still held. */
function shares(overrides: Partial<JournalRow>): JournalRow {
  return row({ kind: "shares", strike: null, quantity: 200, openPrice: 17, openTotal: -3400, openCommission: 0, openNet: -3400, assigned: true, ...overrides });
}

/** A LEAPS: one ZZZ 15 call bought at 3 on 2026-08-03, still open. */
function leaps(overrides: Partial<JournalRow>): JournalRow {
  return row({ strategy: "leaps", kind: "long_call", ticker: "ZZZ", quantity: 1, strike: 15, openPrice: 3, openTotal: -300, openCommission: -1, openNet: -301, ...overrides });
}

function leg(kind: RowKind, strike: number | null): JournalRow {
  return row({ strategy: "condors", kind, ticker: "SPY", strike, quantity: kind === "long_put" || kind === "long_call" ? 2 : -2 });
}

/** Two SPY condors sold on 2026-08-03, still open: puts 620/625, 5 wide, calls 660/670, 10 wide. */
function condor(overrides: Partial<JournalRow>): JournalRow {
  return row({
    strategy: "condors", kind: "condor", ticker: "SPY", strike: null, quantity: -2, openPrice: 0.5, openTotal: 100, openCommission: -8, openNet: 92,
    legs: [leg("long_put", 620), leg("short_put", 625), leg("short_call", 660), leg("long_call", 670)],
    ...overrides,
  });
}

function stats(months: MonthPnl[], currency = "USD"): StrategyStats {
  return { currency, total: months.reduce((n, m) => n + m.pnl, 0), months, incomplete: 0 };
}

const AUG_SEP: MonthPnl[] = [
  { month: "2026-08", pnl: 41 },
  { month: "2026-09", pnl: 99 },
];

const WHEEL = ["wheel"] as const;

describe("nextMonthStart", () => {
  it("gives the first day of the following month, across a year end", () => {
    expect(nextMonthStart("2026-08")).toBe("2026-09-01");
    expect(nextMonthStart("2026-12")).toBe("2027-01-01");
  });
});

describe("computeCapital — the Wheel", () => {
  it("counts a put sold at strike × 100 × contracts at every month end it is still open", () => {
    const [usd] = computeCapital([row({})], WHEEL, [stats(AUG_SEP)]);
    expect(usd.months.map((m) => [m.month, m.putCash, m.assigned, m.allocated])).toEqual([
      ["2026-08", 3400, 0, 3400],
      ["2026-09", 3400, 0, 3400],
    ]);
  });

  it("counts nothing for a put bought back before the month ends, and gives that month no return", () => {
    const bought = row({ endWhen: "2026-08-20T15:00:00.000Z", ongoing: false, event: "buyback" });
    const [usd] = computeCapital([bought], WHEEL, [stats([{ month: "2026-08", pnl: 30 }])]);
    expect(usd.months).toEqual([{ month: "2026-08", cumulativePnl: 30, assigned: 0, putCash: 0, leaps: 0, condors: 0, allocated: 0, invested: -30, returnRate: null }]);
  });

  it("still counts a put closed at the very first instant of the next month", () => {
    const bought = row({ endWhen: "2026-09-01T00:00:00.000Z", ongoing: false, event: "buyback" });
    const [usd] = computeCapital([bought], WHEEL, [stats([{ month: "2026-08", pnl: 41 }, { month: "2026-09", pnl: 0 }])]);
    expect(usd.months.map((m) => m.putCash)).toEqual([3400, 0]);
  });

  it("moves an assigned put's money from the puts to the shares the month of the assignment, never both", () => {
    // The engine keeps an assigned put ongoing until its shares are sold: only endWhen may be read.
    const put = row({ endWhen: "2026-09-15T20:00:00.000Z", closePrice: 0, closeTotal: 0, closeNet: 0, pnl: 41, event: "assigned", assigned: true, ongoing: true });
    const held = shares({ id: "y#1", startWhen: "2026-09-15T20:00:00.000Z", endWhen: "2026-11-10T15:00:00.000Z", ongoing: false, event: "sold" });
    const months = [
      { month: "2026-08", pnl: 41 },
      { month: "2026-09", pnl: 0 },
      { month: "2026-10", pnl: 0 },
      { month: "2026-11", pnl: 199 },
    ];
    const [usd] = computeCapital([put, held], WHEEL, [stats(months)]);
    expect(usd.months.map((m) => [m.month, m.putCash, m.assigned])).toEqual([
      ["2026-08", 3400, 0],
      ["2026-09", 0, 3400],
      ["2026-10", 0, 3400],
      ["2026-11", 0, 0],
    ]);
    expect(usd.exposure).toEqual([]);
  });

  it("counts shares the Wheel took over at the strike of the call that took them", () => {
    const taken = shares({ quantity: 100, openPrice: 20, openTotal: -2000, openNet: -2000, assigned: false, note: { code: "takenOverAtStrike", contract: "MQZA Sep18'26 20 Call" } });
    const [usd] = computeCapital([taken], WHEEL, [stats(AUG_SEP)]);
    expect(usd.months.map((m) => m.assigned)).toEqual([2000, 2000]);
  });

  it("counts only the shares still held after a partial sale", () => {
    const sold = shares({ quantity: 100, openTotal: -1700, openNet: -1700, endWhen: "2026-09-10T15:00:00.000Z", ongoing: false, event: "sold" });
    const kept = shares({ id: "x#2", quantity: 100, openTotal: -1700, openNet: -1700 });
    const [usd] = computeCapital([sold, kept], WHEEL, [stats(AUG_SEP)]);
    expect(usd.months.map((m) => m.assigned)).toEqual([3400, 1700]);
  });

  it("accumulates the P/L, derives the cash invested and the monthly return on the money allocated", () => {
    const [usd] = computeCapital([row({})], WHEEL, [stats(AUG_SEP)]);
    expect(usd.months).toEqual([
      { month: "2026-08", cumulativePnl: 41, assigned: 0, putCash: 3400, leaps: 0, condors: 0, allocated: 3400, invested: 3359, returnRate: 41 / 3400 },
      { month: "2026-09", cumulativePnl: 140, assigned: 0, putCash: 3400, leaps: 0, condors: 0, allocated: 3400, invested: 3260, returnRate: 99 / 3400 },
    ]);
  });

  it("leaves out and counts a line whose amount cannot be computed", () => {
    const rows = [row({ strike: null }), shares({ id: "y#1", openPrice: null }), row({ id: "z#1", strike: 20, quantity: -1 })];
    const [usd] = computeCapital(rows, WHEEL, [stats(AUG_SEP)]);
    expect(usd.incomplete).toBe(2);
    expect(usd.months.map((m) => m.allocated)).toEqual([2000, 2000]);
  });

  it("sums the lines still open per ticker, sorted, and ignores calls and other strategies", () => {
    const rows = [
      row({ ticker: "XOM", strike: 110, quantity: -1 }),
      shares({ id: "a#1" }),
      row({ id: "b#1", strike: 15, quantity: -1 }),
      row({ id: "c#1", ticker: "ZZZ", endWhen: "2026-08-20T15:00:00.000Z", ongoing: false, event: "buyback" }),
      row({ id: "d#1", ticker: "ZZZ", kind: "short_call", strike: 20, quantity: -1 }),
      leaps({ id: "e#1", ticker: "LLL" }),
      shares({ id: "f#1", ticker: "AAPL", strategy: "others", assigned: false }),
    ];
    const [usd] = computeCapital(rows, WHEEL, [stats(AUG_SEP)]);
    expect(usd.exposure).toEqual([
      { ticker: "MQZA", assigned: 3400, putCash: 1500, leaps: 0, condors: 0 },
      { ticker: "XOM", assigned: 0, putCash: 11000, leaps: 0, condors: 0 },
    ]);
  });

  it("gives one entry per currency of the statistics, each counting its own lines", () => {
    const rows = [row({}), row({ id: "y#1", currency: "EUR", ticker: "SAP", strike: 50, quantity: -1 })];
    const capital = computeCapital(rows, WHEEL, [stats(AUG_SEP, "EUR"), stats(AUG_SEP)]);
    expect(capital.map((c) => [c.currency, c.months[0].putCash])).toEqual([
      ["EUR", 5000],
      ["USD", 3400],
    ]);
  });
});

describe("computeCapital — LEAPS", () => {
  it("counts a LEAPS at its purchase price × 100 × contracts while it is open, and a call sold against it at nothing", () => {
    const bought = leaps({ quantity: 2, openTotal: -600, openNet: -602, endWhen: "2026-09-10T15:00:00.000Z", closeNet: 799, pnl: 197, ongoing: false, event: "sold" });
    const sold = leaps({ id: "y#1", kind: "short_call", strike: 20, quantity: -1, openPrice: 0.5, openTotal: 50, openNet: 49 });
    const [usd] = computeCapital([bought, sold], ["leaps"], [stats(AUG_SEP)]);
    expect(usd.months.map((m) => [m.month, m.leaps, m.allocated])).toEqual([
      ["2026-08", 600, 600],
      ["2026-09", 0, 0],
    ]);
  });

  it("moves an exercised LEAPS from its purchase price to the strike of its shares the month of the exercise, never both", () => {
    const exercised = leaps({ endWhen: "2026-09-15T20:00:00.000Z", closePrice: 0, closeTotal: 0, closeNet: 0, pnl: -301, event: "exercised", assigned: true, ongoing: true });
    const held = shares({ id: "y#1", strategy: "leaps", ticker: "ZZZ", quantity: 100, openPrice: 15, openTotal: -1500, openNet: -1500, startWhen: "2026-09-15T20:00:00.000Z" });
    const [usd] = computeCapital([exercised, held], ["leaps"], [stats(AUG_SEP)]);
    expect(usd.months.map((m) => [m.month, m.leaps, m.assigned])).toEqual([
      ["2026-08", 300, 0],
      ["2026-09", 1500, 0],
    ]);
    expect(usd.exposure).toEqual([{ ticker: "ZZZ", assigned: 0, putCash: 0, leaps: 1500, condors: 0 }]);
  });

  it("leaves out and counts a LEAPS without a price", () => {
    expect(computeCapital([leaps({ openPrice: null })], ["leaps"], [stats(AUG_SEP)])[0].incomplete).toBe(1);
  });
});

describe("computeCapital — Condors", () => {
  it("counts a condor at its worst wing × 100 × contracts, credit not deducted, until its last leg closes", () => {
    const closed = condor({ endWhen: "2026-09-18T20:00:00.000Z", closeTotal: 0, closeCommission: 0, closeNet: 0, pnl: 92, ongoing: false, event: "expired" });
    const [usd] = computeCapital([closed], ["condors"], [stats(AUG_SEP)]);
    expect(usd.months.map((m) => [m.month, m.condors, m.allocated])).toEqual([
      ["2026-08", 2000, 2000],
      ["2026-09", 0, 0],
    ]);
  });

  it("takes whichever wing is wider, the put wing as well as the call wing", () => {
    const widePut = condor({ legs: [leg("long_put", 610), leg("short_put", 625), leg("short_call", 660), leg("long_call", 670)] });
    const [usd] = computeCapital([widePut], ["condors"], [stats(AUG_SEP)]);
    expect(usd.months[0].condors).toBe(3000);
    expect(usd.exposure).toEqual([{ ticker: "SPY", assigned: 0, putCash: 0, leaps: 0, condors: 3000 }]);
  });

  it("leaves out and counts a condor without its legs or without a strike on one of them", () => {
    const rows = [
      condor({ legs: undefined }),
      condor({ id: "y#1", legs: [leg("long_put", null), leg("short_put", 625), leg("short_call", 660), leg("long_call", 670)] }),
      condor({ id: "z#1" }),
    ];
    const [usd] = computeCapital(rows, ["condors"], [stats(AUG_SEP)]);
    expect(usd.incomplete).toBe(2);
    expect(usd.months[0].condors).toBe(2000);
  });
});

describe("computeCapital — scopes", () => {
  it("counts a line only in the scopes that read its strategy, the portfolio every measure at once", () => {
    const rows = [row({}), leaps({ id: "b#1" }), condor({ id: "c#1" }), shares({ id: "d#1", strategy: "others", ticker: "AAPL", assigned: false })];
    const first = (strategies: readonly StatsStrategy[]) => computeCapital(rows, strategies, [stats(AUG_SEP)])[0].months[0];
    expect(first(["wheel"])).toMatchObject({ assigned: 0, putCash: 3400, leaps: 0, condors: 0, allocated: 3400 });
    expect(first(["leaps"])).toMatchObject({ assigned: 0, putCash: 0, leaps: 300, condors: 0, allocated: 300 });
    expect(first(["condors"])).toMatchObject({ assigned: 0, putCash: 0, leaps: 0, condors: 2000, allocated: 2000 });
    expect(first(["wheel", "leaps", "condors"])).toMatchObject({ assigned: 0, putCash: 3400, leaps: 300, condors: 2000, allocated: 5700, returnRate: 41 / 5700 });
  });
});
```

Dans `packages/ledger/src/journals/replay.test.ts`, remplacer tout le `describe("buildJournals — Wheel capital", …)` par :

```ts
describe("buildJournals — capital", () => {
  it("measures the Wheel's money at each month end, from the put sold to the shares still held", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -2, price: 0.25, when: "2026-08-03T14:30:00.000Z" }),
      ...deliver({ ...PUT, quantity: 2, when: "2026-09-15T20:00:00.000Z" }),
      stock({ ticker: "AAPL", quantity: 1, price: 180, when: "2026-10-05T14:30:00.000Z" }),
    ]);
    expect(report.capital.wheel).toEqual([
      {
        currency: "USD",
        months: [
          { month: "2026-08", cumulativePnl: 49, assigned: 0, putCash: 3400, leaps: 0, condors: 0, allocated: 3400, invested: 3351, returnRate: 49 / 3400 },
          { month: "2026-09", cumulativePnl: 49, assigned: 3400, putCash: 0, leaps: 0, condors: 0, allocated: 3400, invested: 3351, returnRate: 0 },
          { month: "2026-10", cumulativePnl: 49, assigned: 3400, putCash: 0, leaps: 0, condors: 0, allocated: 3400, invested: 3351, returnRate: 0 },
        ],
        exposure: [{ ticker: "MQZA", assigned: 3400, putCash: 0, leaps: 0, condors: 0 }],
        incomplete: 0,
      },
    ]);
  });

  it("measures every scope, the portfolio returning the strategies' summed P/L on their summed money", () => {
    const SPY = { ticker: "SPY", expiry: "2026-09-18" };
    const T = "2026-08-06T14:30:00.000Z";
    const report = buildJournals([
      // Wheel: a MQZA 17 put, 1,700 of cash, 24 of premium.
      option({ ...PUT, quantity: -1, price: 0.25, when: "2026-08-03T14:30:00.000Z" }),
      // LEAPS: a ZZZ call bought at 3, 300, and a call sold against it, 49 of premium.
      option({ ticker: "ZZZ", right: "C", strike: 15, expiry: "2027-06-18", quantity: 1, price: 3, when: "2026-08-04T14:30:00.000Z" }),
      option({ ticker: "ZZZ", right: "C", strike: 20, expiry: "2026-09-18", quantity: -1, price: 0.5, when: "2026-08-05T14:30:00.000Z" }),
      // Condors: wings of 5 and 10, 1,000; a credit of 75 less four commissions, 71.
      option({ ...SPY, right: "P", strike: 620, quantity: 1, price: 0.25, when: T }),
      option({ ...SPY, right: "P", strike: 625, quantity: -1, price: 0.75, when: T }),
      option({ ...SPY, right: "C", strike: 660, quantity: -1, price: 0.5, when: T }),
      option({ ...SPY, right: "C", strike: 670, quantity: 1, price: 0.25, when: T }),
      // Others: counted nowhere.
      stock({ ticker: "AAPL", quantity: 1, price: 180, when: "2026-08-07T14:30:00.000Z" }),
    ]);
    const [wheel] = report.capital.wheel[0].months;
    const [leapsMonth] = report.capital.leaps[0].months;
    const [condors] = report.capital.condors[0].months;
    expect([wheel.allocated, leapsMonth.allocated, condors.allocated]).toEqual([1700, 300, 1000]);
    expect(report.capital.portfolio).toEqual([
      {
        currency: "USD",
        months: [{ month: "2026-08", cumulativePnl: 144, assigned: 0, putCash: 1700, leaps: 300, condors: 1000, allocated: 3000, invested: 2856, returnRate: 144 / 3000 }],
        exposure: [
          { ticker: "MQZA", assigned: 0, putCash: 1700, leaps: 0, condors: 0 },
          { ticker: "SPY", assigned: 0, putCash: 0, leaps: 0, condors: 1000 },
          { ticker: "ZZZ", assigned: 0, putCash: 0, leaps: 300, condors: 0 },
        ],
        incomplete: 0,
      },
    ]);
    const summedPnl = wheel.cumulativePnl + leapsMonth.cumulativePnl + condors.cumulativePnl;
    expect(report.capital.portfolio[0].months[0].returnRate).toBe(summedPnl / (wheel.allocated + leapsMonth.allocated + condors.allocated));
  });
});
```

- [x] **Step 2 : lancer les tests, vérifier qu'ils échouent**

Run: `pnpm --filter @ib/ledger test src/journals/capital.test.ts src/journals/replay.test.ts`
Expected: FAIL — `computeCapital` n'est pas exporté par `./capital.ts` ; `report.capital` est `undefined`.

- [x] **Step 3 : implémenter le moteur**

Dans `packages/ledger/src/journals/types.ts`, remplacer tout le bloc qui va de `/** One month of the Wheel's money, measured at the month's end (spec of sub-project 13, §2). */` jusqu'à la fin de `interface WheelCapital { … }` par :

```ts
/** What a line ties up is filed under one of these (spec of sub-project 14, §2). */
export type CapitalMeasure = "assigned" | "putCash" | "leaps" | "condors";

/** One month of a scope's money, measured at the month's end. */
export interface CapitalMonth {
  /** YYYY-MM, the same months as the scope's StrategyStats, index for index. */
  month: string;
  cumulativePnl: number;
  /** Wheel shares held, at the price they entered the Wheel at. */
  assigned: number;
  /** Wheel puts open, at strike × multiplier × contracts. */
  putCash: number;
  /** LEAPS open at their purchase price, and shares a LEAPS delivered at its strike. */
  leaps: number;
  /** Condors open, at their worst wing × multiplier × contracts. */
  condors: number;
  /** assigned + putCash + leaps + condors */
  allocated: number;
  /** allocated − cumulativePnl */
  invested: number;
  /** This month's pnl / allocated; `null` when allocated is 0. */
  returnRate: number | null;
}

export interface Exposure {
  ticker: string;
  assigned: number;
  putCash: number;
  leaps: number;
  condors: number;
}

export interface StrategyCapital {
  currency: string;
  months: CapitalMonth[];
  /** Lines still open (`endWhen === null`), summed per ticker; only non-zero tickers, sorted by ticker. */
  exposure: Exposure[];
  /** Lines left out for want of a strike, a price, a quantity or a leg. */
  incomplete: number;
}
```

et, dans `JournalsReport`, remplacer :

```ts
  /** One entry per entry of `stats.wheel`, in the same order. */
  wheelCapital: WheelCapital[];
```

par :

```ts
  /** One entry per entry of `stats[scope]`, in the same order. */
  capital: Record<CapitalScope, StrategyCapital[]>;
```

Remplacer tout `packages/ledger/src/journals/capital.ts` par :

```ts
import { DEFAULT_MULTIPLIER } from "../constants.ts";
import type { CapitalMeasure, CapitalMonth, Exposure, JournalRow, StatsStrategy, Strategy, StrategyCapital, StrategyStats } from "./types.ts";

/** "2026-08" -> "2026-09-01": a line still open at this instant was open when August ended. */
export function nextMonthStart(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, "0")}-01`;
}

const MEASURES = ["assigned", "putCash", "leaps", "condors"] as const satisfies readonly CapitalMeasure[];

function noMoney(): Record<CapitalMeasure, number> {
  return { assigned: 0, putCash: 0, leaps: 0, condors: 0 };
}

interface TiedUp {
  row: JournalRow;
  measure: CapitalMeasure;
  /** `null` when a strike, a price, a quantity or a leg is missing. */
  amount: number | null;
}

function scaled(perUnit: number | null, multiplier: number, quantity: number | null): number | null {
  return perUnit === null || quantity === null ? null : perUnit * multiplier * Math.abs(quantity);
}

/**
 * The worst wing of a condor, gross: the rule of `structureAssignmentCash` in
 * `packages/coverage/src/report.ts`, which applies it to structures paired from positions where
 * this reads the journal's own legs — put bought, put sold, call sold, call bought. The credit is
 * already in the account's cash, so it is never deducted.
 */
function worstWing(row: JournalRow): number | null {
  const strikes = row.legs?.map((leg) => leg.strike) ?? [];
  if (strikes.length !== 4) return null;
  const [longPut, shortPut, shortCall, longCall] = strikes;
  if (longPut === null || shortPut === null || shortCall === null || longCall === null) return null;
  return Math.max(shortPut - longPut, longCall - shortCall);
}

/**
 * What one line ties up, at the price it entered its strategy at, never its market value: a Wheel
 * put the cash its strike calls for, Wheel shares the strike that delivered or took them over, a
 * LEAPS its purchase price and the shares it delivered their strike, a condor its worst wing. A
 * call sold ties nothing up: shares or a LEAPS cover it.
 */
function tiedUp(row: JournalRow): TiedUp | null {
  if (row.strategy === "wheel" && row.kind === "short_put") return { row, measure: "putCash", amount: scaled(row.strike, DEFAULT_MULTIPLIER, row.quantity) };
  if (row.strategy === "wheel" && row.kind === "shares") return { row, measure: "assigned", amount: scaled(row.openPrice, 1, row.quantity) };
  if (row.strategy === "leaps" && row.kind === "long_call") return { row, measure: "leaps", amount: scaled(row.openPrice, DEFAULT_MULTIPLIER, row.quantity) };
  if (row.strategy === "leaps" && row.kind === "shares") return { row, measure: "leaps", amount: scaled(row.openPrice, 1, row.quantity) };
  if (row.strategy === "condors" && row.kind === "condor") return { row, measure: "condors", amount: scaled(worstWing(row), DEFAULT_MULTIPLIER, row.quantity) };
  return null;
}

/**
 * Read off `endWhen`, never `ongoing`: an assigned put stays ongoing until its shares are sold,
 * and reading it open would count the same money twice, as the put and as the shares.
 */
function openAt(row: JournalRow, instant: string): boolean {
  return row.startWhen < instant && (row.endWhen === null || row.endWhen >= instant);
}

/**
 * A scope's money month by month, on the months of its statistics, and what it ties up now per
 * ticker. `stats` is `computeStats` over the same `strategies`: its months and pnl drive the
 * series, so the monthly bars and these lines share one axis — and over the three strategies the
 * return is their summed P/L on their summed money, with no sum written anywhere.
 */
export function computeCapital(rows: readonly JournalRow[], strategies: readonly StatsStrategy[], stats: readonly StrategyStats[]): StrategyCapital[] {
  const scope = new Set<Strategy>(strategies);
  return stats.map(({ currency, months }) => {
    const lines = rows
      .filter((row) => row.currency === currency && scope.has(row.strategy))
      .map(tiedUp)
      .filter((line): line is TiedUp => line !== null);
    const counted = lines.filter((line): line is TiedUp & { amount: number } => line.amount !== null);

    let cumulativePnl = 0;
    const measured = months.map(({ month, pnl }): CapitalMonth => {
      const instant = nextMonthStart(month);
      const totals = noMoney();
      for (const line of counted) if (openAt(line.row, instant)) totals[line.measure] += line.amount;
      cumulativePnl += pnl;
      const allocated = MEASURES.reduce((n, measure) => n + totals[measure], 0);
      return { month, cumulativePnl, ...totals, allocated, invested: allocated - cumulativePnl, returnRate: allocated === 0 ? null : pnl / allocated };
    });

    const byTicker = new Map<string, Exposure>();
    for (const line of counted) {
      if (line.row.endWhen !== null) continue;
      const exposure = byTicker.get(line.row.ticker) ?? { ticker: line.row.ticker, ...noMoney() };
      exposure[line.measure] += line.amount;
      byTicker.set(line.row.ticker, exposure);
    }
    const exposure = [...byTicker.values()]
      .filter((e) => MEASURES.reduce((n, measure) => n + e[measure], 0) !== 0)
      .sort((a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0));

    return { currency, months: measured, exposure, incomplete: lines.length - counted.length };
  });
}
```

Dans `packages/ledger/src/journals/replay.ts` :

1. Remplacer `import { computeWheelCapital } from "./capital.ts";` par `import { computeCapital } from "./capital.ts";`.
2. À la fin de `buildJournals`, remplacer :

```ts
  return { rows, reconciliation, stats, wheelCapital: computeWheelCapital(rows, stats.wheel) };
```

par :

```ts
  const capitalOf = (scope: CapitalScope) => computeCapital(rows, SCOPE_STRATEGIES[scope], stats[scope]);
  return {
    rows,
    reconciliation,
    stats,
    capital: { wheel: capitalOf("wheel"), leaps: capitalOf("leaps"), condors: capitalOf("condors"), portfolio: capitalOf("portfolio") },
  };
```

Run: `pnpm --filter @ib/ledger test`
Expected: PASS, oracle des journaux compris.

- [x] **Step 4 : suivre les renommages dans l'application**

Ces modifications ne changent aucun comportement ; la tâche 3 réécrit ces fichiers.

`apps/web/src/lib/wheelCharts.ts` :
- remplacer `import type { WheelCapital, WheelExposure } from "@ib/ledger";` par `import type { Exposure, StrategyCapital } from "@ib/ledger";` ;
- remplacer chaque `WheelExposure` par `Exposure` et chaque `WheelCapital` par `StrategyCapital` (trois signatures).

`apps/web/src/lib/wheelCharts.test.ts` :
- remplacer `import type { WheelCapital, WheelExposure } from "@ib/ledger";` par `import type { Exposure, StrategyCapital } from "@ib/ledger";` ;
- remplacer la fonction `exposure` par :

```ts
function exposure(ticker: string, assigned: number, putCash = 0): Exposure {
  return { ticker, assigned, putCash, leaps: 0, condors: 0 };
}
```

- remplacer `const CAPITAL: WheelCapital = {` et ses deux mois par :

```ts
const CAPITAL: StrategyCapital = {
  currency: "USD",
  months: [
    { month: "2026-08", cumulativePnl: 41, assigned: 0, putCash: 3400, leaps: 0, condors: 0, allocated: 3400, invested: 3359, returnRate: 41 / 3400 },
    { month: "2026-09", cumulativePnl: 41, assigned: 0, putCash: 0, leaps: 0, condors: 0, allocated: 0, invested: -41, returnRate: null },
  ],
```

- remplacer `const oneMonth: WheelCapital =` par `const oneMonth: StrategyCapital =`.

`apps/web/src/components/stats/WheelCapitalCards.tsx` : remplacer `import type { WheelCapital } from "@ib/ledger";` par `import type { StrategyCapital } from "@ib/ledger";` et `capital: WheelCapital;` par `capital: StrategyCapital;`.

`apps/web/src/pages/StatsPage.tsx` : remplacer `view.report.wheelCapital.find(` par `view.report.capital.wheel.find(`.

`apps/web/src/lib/consistency.test.ts`, ligne 9 : remplacer `wheelCapital: []` par `capital: { wheel: [], leaps: [], condors: [], portfolio: [] }`.

`apps/web/src/mocks/seed.test.ts` : remplacer

```ts
    expect(report.wheelCapital[0].exposure).toEqual([
      { ticker: "MQZA", assigned: 3400, putCash: 0 },
      { ticker: "XOM", assigned: 0, putCash: 11000 },
    ]);
```

par

```ts
    expect(report.capital.wheel[0].exposure).toEqual([
      { ticker: "MQZA", assigned: 3400, putCash: 0, leaps: 0, condors: 0 },
      { ticker: "XOM", assigned: 0, putCash: 11000, leaps: 0, condors: 0 },
    ]);
```

- [x] **Step 5 : lancer les tests, le typage et le lint**

Run: `pnpm --filter @ib/ledger test && pnpm --filter web test && pnpm typecheck && pnpm lint`
Expected: PASS partout ; typage silencieux ; oxlint sans nouvel avertissement. `grep -rn "WheelCapital\|WheelMonth\|WheelExposure\|wheelCapital\|computeWheelCapital" packages apps --include=*.ts --include=*.tsx | grep -v node_modules` ne rend que `WheelCapitalCards` (nom du composant, supprimé à la tâche 4).

- [x] **Step 6 : commit**

Cocher les cases de la tâche 2, puis :

```bash
git add packages/ledger/src/journals apps/web/src docs/plans/2026-09-12-capital-strategies.md
git commit -F - <<'EOF'
feat(ledger): capital des LEAPS, des Condors et de chaque portée

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Arhu7RqqK2RvtQrwe6o6kH
EOF
```

---

## Tâche 3 : des graphiques de capital génériques sur les courbes tracées

**Files:**
- Rename: `apps/web/src/lib/wheelCharts.ts` → `apps/web/src/lib/capitalCharts.ts`, `apps/web/src/lib/wheelCharts.test.ts` → `apps/web/src/lib/capitalCharts.test.ts`
- Create: `apps/web/src/hooks/useCapitalSeries.ts`, `apps/web/src/hooks/useCapitalSeries.test.tsx`
- Modify: `apps/web/src/components/stats/WheelCapitalCards.tsx`, `apps/web/src/pages/StatsPage.tsx` (appels)

**Interfaces:**
- Consumes: `CapitalScope`, `Exposure`, `StrategyCapital` de `@ib/ledger` (tâches 1 et 2).
- Produces :

```ts
// lib/capitalCharts.ts
export const MAX_NAMED_SLICES = 5;
export interface SectorSlice { sector: string; assigned: number; putCash: number; total: number; share: number; folded: boolean }
export type CapitalSeriesKey = "cumulativePnl" | "assigned" | "allocated" | "invested";
export interface CapitalSeries { key: CapitalSeriesKey; name: string }
export const SCOPE_SERIES: Record<CapitalScope, readonly CapitalSeriesKey[]>;
export function sectorSlices(exposure: readonly Exposure[], sectorOf: (ticker: string) => string | null, unclassified: string): SectorSlice[];
export function swatchColor(slice: SectorSlice, index: number, colors: ChartColors): string;
export function seriesColor(key: CapitalSeriesKey, colors: ChartColors): string;
export function exposureOption(slices: readonly SectorSlice[], other: string, colors: ChartColors, currency: string): EChartsOption;
export function monthGrid(series: readonly CapitalSeries[]): { left: number; right: number };
export function capitalOption(capital: StrategyCapital, series: readonly CapitalSeries[], colors: ChartColors): EChartsOption;
export function returnOption(capital: StrategyCapital, series: readonly CapitalSeries[], colors: ChartColors): EChartsOption;
// hooks/useCapitalSeries.ts
export function useCapitalSeries(scope: CapitalScope): CapitalSeries[];   // noms lus sous stats.capital.<clé>
```

`CapitalSeriesNames` n'existe plus.

- [x] **Step 1 : renommer, puis écrire les tests qui échouent**

```bash
git mv apps/web/src/lib/wheelCharts.ts apps/web/src/lib/capitalCharts.ts
git mv apps/web/src/lib/wheelCharts.test.ts apps/web/src/lib/capitalCharts.test.ts
```

Remplacer tout `apps/web/src/lib/capitalCharts.test.ts` par :

```ts
import { describe, expect, it } from "vitest";
import type { LineSeriesOption, PieSeriesOption } from "echarts";
import type { Exposure, StrategyCapital } from "@ib/ledger";
import { CHART_COLORS } from "@/lib/chartColors";
import {
  type CapitalSeries,
  capitalOption,
  exposureOption,
  monthGrid,
  returnOption,
  SCOPE_SERIES,
  sectorSlices,
  seriesColor,
  swatchColor,
} from "@/lib/capitalCharts";

const colors = CHART_COLORS.light;
const SECTORS: Record<string, string> = { MQZA: "Crypto", RQZA: "Crypto", XOM: "Energy", AAPL: "Tech" };
const sectorOf = (ticker: string) => SECTORS[ticker] ?? null;
/** Each ticker its own sector, "SA" for "A": to line up more sectors than the table has. */
const ownSector = (ticker: string) => `S${ticker}`;

function exposure(ticker: string, assigned: number, putCash = 0, leaps = 0, condors = 0): Exposure {
  return { ticker, assigned, putCash, leaps, condors };
}

/** Six sectors, 600 down to 100, plus a seventh of 40: SF and SG fold into Other, 140. */
const SEVEN = [...["A", "B", "C", "D", "E", "F"].map((t, i) => exposure(t, 600 - i * 100)), exposure("G", 40)];

const CAPITAL: StrategyCapital = {
  currency: "USD",
  months: [
    { month: "2026-08", cumulativePnl: 41, assigned: 0, putCash: 3400, leaps: 0, condors: 0, allocated: 3400, invested: 3359, returnRate: 41 / 3400 },
    { month: "2026-09", cumulativePnl: 41, assigned: 0, putCash: 0, leaps: 0, condors: 0, allocated: 0, invested: -41, returnRate: null },
  ],
  exposure: [],
  incomplete: 0,
};

/** The Wheel's four lines. */
const SERIES: CapitalSeries[] = [
  { key: "cumulativePnl", name: "Cumul" },
  { key: "assigned", name: "Assigné" },
  { key: "allocated", name: "Alloué" },
  { key: "invested", name: "Investi" },
];
/** The French names: the first is the longest, 24 characters. */
const LONG_SERIES = SERIES.map((s) => (s.key === "cumulativePnl" ? { ...s, name: "Cumul des profits/pertes" } : s));
/** A strategy other than the Wheel: nothing assigned. */
const THREE = SERIES.filter((s) => s.key !== "assigned");

type LinePoint = { value: number; symbolSize: number } | null;
const valuesOf = (data: LineSeriesOption["data"]) => (data as LinePoint[]).map((point) => (point === null ? null : point.value));
/** Which points draw a visible symbol. */
const symbolsOf = (data: LineSeriesOption["data"]) => (data as LinePoint[]).map((point) => point !== null && point.symbolSize > 0);

describe("sectorSlices", () => {
  it("sums tickers per sector, puts an unknown ticker under the unclassified label, largest first", () => {
    const slices = sectorSlices([exposure("MQZA", 3400), exposure("RQZA", 0, 1000), exposure("XOM", 0, 11000), exposure("ZZZ", 600)], sectorOf, "Non classé");
    expect(slices).toEqual([
      { sector: "Energy", assigned: 0, putCash: 11000, total: 11000, share: 11000 / 16000, folded: false },
      { sector: "Crypto", assigned: 3400, putCash: 1000, total: 4400, share: 4400 / 16000, folded: false },
      { sector: "Non classé", assigned: 600, putCash: 0, total: 600, share: 600 / 16000, folded: false },
    ]);
  });

  it("totals every measure of a ticker, whichever strategy ties it up", () => {
    const slices = sectorSlices([exposure("MQZA", 3400), exposure("ZZZ", 0, 0, 300), exposure("SPY", 0, 0, 0, 500)], sectorOf, "Non classé");
    expect(slices).toEqual([
      { sector: "Crypto", assigned: 3400, putCash: 0, total: 3400, share: 3400 / 4200, folded: false },
      { sector: "Non classé", assigned: 0, putCash: 0, total: 800, share: 800 / 4200, folded: false },
    ]);
  });

  it("orders equal totals by sector name", () => {
    expect(sectorSlices([exposure("XOM", 100), exposure("AAPL", 100)], sectorOf, "Non classé").map((s) => s.sector)).toEqual(["Energy", "Tech"]);
  });

  it("folds nothing up to five sectors, and every sector past the fifth beyond that", () => {
    expect(sectorSlices(SEVEN.slice(0, 5), ownSector, "?").some((s) => s.folded)).toBe(false);
    expect(sectorSlices(SEVEN, ownSector, "?").map((s) => [s.sector, s.folded])).toEqual([
      ["SA", false], ["SB", false], ["SC", false], ["SD", false], ["SE", false], ["SF", true], ["SG", true],
    ]);
  });

  it("gives nothing for an empty exposure", () => {
    expect(sectorSlices([], sectorOf, "Non classé")).toEqual([]);
  });
});

describe("swatchColor", () => {
  it("gives a named slice its series color by rank, and a folded one the gray of Other", () => {
    const slices = sectorSlices(SEVEN, ownSector, "?");
    expect(slices.map((slice, index) => swatchColor(slice, index, colors))).toEqual([...colors.series, colors.other, colors.other]);
  });
});

describe("exposureOption", () => {
  it("draws five named slices in the series colors and one gray Other slice summing the rest", () => {
    const [pie] = exposureOption(sectorSlices(SEVEN, ownSector, "?"), "Autres", colors, "USD").series as PieSeriesOption[];
    expect(pie.type).toBe("pie");
    expect(pie.data).toEqual([
      { name: "SA", value: 600, itemStyle: { color: colors.series[0] } },
      { name: "SB", value: 500, itemStyle: { color: colors.series[1] } },
      { name: "SC", value: 400, itemStyle: { color: colors.series[2] } },
      { name: "SD", value: 300, itemStyle: { color: colors.series[3] } },
      { name: "SE", value: 200, itemStyle: { color: colors.series[4] } },
      { name: "Autres", value: 140, itemStyle: { color: colors.other } },
    ]);
  });

  it("adds no Other slice when nothing is folded, and parts the slices with the card's own color", () => {
    const [pie] = exposureOption(sectorSlices(SEVEN.slice(0, 2), ownSector, "?"), "Autres", colors, "USD").series as PieSeriesOption[];
    expect((pie.data as { name: string }[]).map((d) => d.name)).toEqual(["SA", "SB"]);
    expect(pie.itemStyle).toMatchObject({ borderColor: colors.surface, borderWidth: 2 });
  });
});

describe("SCOPE_SERIES and seriesColor", () => {
  it("draws the assigned line on the Wheel only", () => {
    expect(SCOPE_SERIES).toEqual({
      wheel: ["cumulativePnl", "assigned", "allocated", "invested"],
      leaps: ["cumulativePnl", "allocated", "invested"],
      condors: ["cumulativePnl", "allocated", "invested"],
      portfolio: ["cumulativePnl", "allocated", "invested"],
    });
  });

  it("gives a line the same hue whatever lines stand beside it", () => {
    expect(["cumulativePnl", "assigned", "allocated", "invested"].map((key) => seriesColor(key as CapitalSeries["key"], colors))).toEqual(colors.series.slice(0, 4));
  });
});

describe("monthGrid", () => {
  it("makes room on the right for the longest end label, wrapped past fourteen characters", () => {
    // "Assigné" and "Investi", seven characters: ceil(7 × 7.5) = 53, plus the label's distance of 8 and 4 to spare.
    expect(monthGrid(SERIES)).toEqual({ left: 64, right: 65 });
    // "Cumul des profits/pertes" wraps to "Cumul des" / "profits/pertes": fourteen characters wide, 105 + 12.
    expect(monthGrid(LONG_SERIES)).toEqual({ left: 64, right: 117 });
  });

  it("measures only the lines it is given", () => {
    // "Cumul", five characters: ceil(5 × 7.5) = 38, plus 12.
    expect(monthGrid([{ key: "cumulativePnl", name: "Cumul" }])).toEqual({ left: 64, right: 50 });
  });
});

describe("capitalOption", () => {
  it("draws four straight lines on one axis, in fixed order and colors, each named at its end", () => {
    const option = capitalOption(CAPITAL, SERIES, colors);
    expect(Array.isArray(option.yAxis)).toBe(false);
    expect(option.xAxis).toMatchObject({ type: "category", data: ["2026-08", "2026-09"] });
    const series = option.series as LineSeriesOption[];
    expect(series.map((s) => [s.type, s.name, s.smooth, s.color, valuesOf(s.data)])).toEqual([
      ["line", "Cumul", false, colors.series[0], [41, 41]],
      ["line", "Assigné", false, colors.series[1], [0, 0]],
      ["line", "Alloué", false, colors.series[2], [3400, 0]],
      ["line", "Investi", false, colors.series[3], [3359, -41]],
    ]);
    expect(series.every((s) => s.endLabel?.show === true)).toBe(true);
  });

  it("draws a strategy with nothing assigned as three lines, each keeping the hue of its key", () => {
    const series = capitalOption(CAPITAL, THREE, colors).series as LineSeriesOption[];
    expect(series.map((s) => [s.name, s.color, valuesOf(s.data)])).toEqual([
      ["Cumul", colors.series[0], [41, 41]],
      ["Alloué", colors.series[2], [3400, 0]],
      ["Investi", colors.series[3], [3359, -41]],
    ]);
  });

  it("keeps its end labels readable: pushed apart where lines meet, wrapped, inside a margin made for the longest", () => {
    const option = capitalOption(CAPITAL, LONG_SERIES, colors);
    const series = option.series as LineSeriesOption[];
    expect(series.map((s) => s.labelLayout)).toEqual(Array(4).fill({ moveOverlap: "shiftY" }));
    expect(series.map((s) => s.endLabel)).toEqual(Array(4).fill(expect.objectContaining({ width: 105, overflow: "break", distance: 8 })));
    // Pushed down a pile at 0, a label covers the month under it instead of mixing its letters with it.
    expect(series.map((s) => s.endLabel)).toEqual(Array(4).fill(expect.objectContaining({ backgroundColor: colors.surface, padding: [0, 2] })));
    expect(option.grid).toMatchObject(monthGrid(LONG_SERIES));
    // One row of legend, paged when it runs out of width, above a plot that starts below it.
    expect(option.legend).toMatchObject({ type: "scroll", top: 0 });
    expect(option.grid).toMatchObject({ top: 40 });
    // The cumulative P/L ends near 0: its two-line label reaches below the axis, the months sit lower.
    expect(option.xAxis).toMatchObject({ axisLabel: { margin: 14 } });
    expect(option.grid).toMatchObject({ bottom: 40 });
  });

  it("lines its months up with the bars: the same frame, each point at the center of its month", () => {
    const option = capitalOption(CAPITAL, SERIES, colors);
    expect(option.grid).toMatchObject(monthGrid(SERIES));
    expect(option.xAxis).toMatchObject({ boundaryGap: true });
  });

  it("shows the points of a one-month scope, which draw no segment, and no symbol on a line that has one", () => {
    const oneMonth: StrategyCapital = { ...CAPITAL, months: CAPITAL.months.slice(0, 1) };
    expect((capitalOption(oneMonth, SERIES, colors).series as LineSeriesOption[]).map((s) => symbolsOf(s.data))).toEqual(Array(4).fill([true]));
    expect((capitalOption(CAPITAL, SERIES, colors).series as LineSeriesOption[]).map((s) => symbolsOf(s.data))).toEqual(Array(4).fill([false, false]));
  });

  it("formats the tooltip values as amounts in the capital's currency", () => {
    const { valueFormatter } = capitalOption(CAPITAL, SERIES, colors).tooltip as { valueFormatter: (value: unknown) => string };
    expect(valueFormatter(3359)).toBe("3,359.00 USD");
  });
});

describe("returnOption", () => {
  it("draws the monthly return as one straight line, a gap where nothing was allocated, over a zero baseline", () => {
    const option = returnOption(CAPITAL, SERIES, colors);
    expect(option.legend).toBeUndefined();
    const [line] = option.series as LineSeriesOption[];
    expect(line).toMatchObject({ type: "line", smooth: false, connectNulls: false });
    expect(valuesOf(line.data)).toEqual([41 / 3400, null]);
    expect(line.markLine?.data).toEqual([{ yAxis: 0 }]);
  });

  it("shows a month whose return stands between two gaps, which draws no segment, and only that one", () => {
    const rates = [null, 0.02, null, 0.01, 0.03];
    const months = rates.map((returnRate, i) => ({ ...CAPITAL.months[0], month: `2026-0${i + 1}`, returnRate }));
    const [line] = returnOption({ ...CAPITAL, months }, SERIES, colors).series as LineSeriesOption[];
    expect(valuesOf(line.data)).toEqual(rates);
    expect(symbolsOf(line.data)).toEqual([false, true, false, false, false]);
    // Every symbol drawn, never sampled away on a long axis: the isolated one would go with them.
    expect(line).toMatchObject({ showSymbol: true, showAllSymbol: true });
  });

  it("lines its months up with the capital chart's", () => {
    const option = returnOption(CAPITAL, LONG_SERIES, colors);
    expect(option.grid).toMatchObject(monthGrid(LONG_SERIES));
    expect(option.xAxis).toMatchObject({ boundaryGap: true });
  });

  it("never prints the same axis label twice on a flat return: a step of at least 0.1%", () => {
    expect(returnOption(CAPITAL, SERIES, colors).yAxis).toMatchObject({ minInterval: 0.001 });
  });

  it("formats the tooltip as a rate, a dash for a month without one", () => {
    const { valueFormatter } = returnOption(CAPITAL, SERIES, colors).tooltip as { valueFormatter: (value: unknown) => string };
    expect(valueFormatter(0.01206)).toBe("1.2%");
    expect(valueFormatter(null)).toBe("—");
  });
});
```

Créer `apps/web/src/hooks/useCapitalSeries.test.tsx` :

```tsx
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import { useCapitalSeries } from "@/hooks/useCapitalSeries";

const wrapper = ({ children }: { children: ReactNode }) => <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;

describe("useCapitalSeries", () => {
  it("names the Wheel's four lines in the language on screen", () => {
    const { result } = renderHook(() => useCapitalSeries("wheel"), { wrapper });
    expect(result.current).toEqual([
      { key: "cumulativePnl", name: "Cumul des profits/pertes" },
      { key: "assigned", name: "Assigné" },
      { key: "allocated", name: "Alloué" },
      { key: "invested", name: "Cash investi" },
    ]);
  });

  it("names no assigned line for the portfolio", () => {
    const { result } = renderHook(() => useCapitalSeries("portfolio"), { wrapper });
    expect(result.current.map((s) => s.name)).toEqual(["Cumul des profits/pertes", "Alloué", "Cash investi"]);
  });
});
```

- [x] **Step 2 : lancer les tests, vérifier qu'ils échouent**

Run: `pnpm --filter web test src/lib/capitalCharts.test.ts src/hooks/useCapitalSeries.test.tsx`
Expected: FAIL — `SCOPE_SERIES` et `seriesColor` ne sont pas exportés, `monthGrid` et `capitalOption` lisent `names[key]` sur un tableau (noms `undefined`), le module `@/hooks/useCapitalSeries` est introuvable.

- [x] **Step 3 : implémenter**

Remplacer tout `apps/web/src/lib/capitalCharts.ts` par :

```ts
import type { EChartsOption } from "echarts";
import type { CapitalScope, Exposure, StrategyCapital } from "@ib/ledger";
import { CHART_FONT, type ChartColors } from "@/lib/chartColors";
import { formatAmount, formatRate } from "@/lib/format";

/** A pie reads at a glance up to six slices: five named, the rest folded into Other. */
export const MAX_NAMED_SLICES = 5;

export interface SectorSlice {
  sector: string;
  /** The Wheel's split, shown in its own legend table. */
  assigned: number;
  putCash: number;
  /** Everything the sector ties up, whichever strategy ties it up. */
  total: number;
  /** total / the whole exposure */
  share: number;
  /** Past the fifth: drawn inside Other, still listed on its own in the legend table. */
  folded: boolean;
}

export type CapitalSeriesKey = "cumulativePnl" | "assigned" | "allocated" | "invested";

export interface CapitalSeries {
  key: CapitalSeriesKey;
  /** Translated by the page (`useCapitalSeries`). */
  name: string;
}

/** Every line a capital chart can draw. A line's rank here is its hue, on every page. */
const SERIES_HUES = ["cumulativePnl", "assigned", "allocated", "invested"] as const satisfies readonly CapitalSeriesKey[];

/** The lines each scope draws, in order: nothing is assigned outside the Wheel. */
export const SCOPE_SERIES: Record<CapitalScope, readonly CapitalSeriesKey[]> = {
  wheel: ["cumulativePnl", "assigned", "allocated", "invested"],
  leaps: ["cumulativePnl", "allocated", "invested"],
  condors: ["cumulativePnl", "allocated", "invested"],
  portfolio: ["cumulativePnl", "allocated", "invested"],
};

/** Room for the widest amount on a month chart's Y axis, "140,000" and its gap. */
const MONTH_GRID_LEFT = 64;
/** One character of CHART_FONT at ECharts' 12 px: a monospace advance of 0.6 em, rounded up. */
const CHAR_WIDTH = 7.5;
/** An end label wraps past this many characters: "Cumul des profits/pertes" takes two lines, not 180 px of a phone's plot. */
const END_LABEL_MAX_CHARS = 14;
/** ECharts' own default, written out because the margin counts it. */
const END_LABEL_DISTANCE = 8;
/** Left and right, around the text on its card-colored background. */
const END_LABEL_PADDING = 2;
/** A point with no neighbour draws no segment: this symbol is all that shows it. */
const ISOLATED_SYMBOL_SIZE = 6;

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function exposureTotal(e: Exposure): number {
  return e.assigned + e.putCash + e.leaps + e.condors;
}

export function sectorSlices(exposure: readonly Exposure[], sectorOf: (ticker: string) => string | null, unclassified: string): SectorSlice[] {
  const groups = new Map<string, { assigned: number; putCash: number; total: number }>();
  for (const e of exposure) {
    const sector = sectorOf(e.ticker) ?? unclassified;
    const group = groups.get(sector) ?? { assigned: 0, putCash: 0, total: 0 };
    group.assigned += e.assigned;
    group.putCash += e.putCash;
    group.total += exposureTotal(e);
    groups.set(sector, group);
  }
  const whole = exposure.reduce((n, e) => n + exposureTotal(e), 0);
  const sorted = [...groups.entries()]
    .map(([sector, group]) => ({ sector, ...group }))
    .sort((a, b) => b.total - a.total || compareNames(a.sector, b.sector));
  const folds = sorted.length > MAX_NAMED_SLICES;
  return sorted.map((slice, index) => ({ ...slice, share: whole === 0 ? 0 : slice.total / whole, folded: folds && index >= MAX_NAMED_SLICES }));
}

/** `index` is the slice's rank in `sectorSlices`; the named slices come first, so rank is hue. */
export function swatchColor(slice: SectorSlice, index: number, colors: ChartColors): string {
  return slice.folded ? colors.other : colors.series[index];
}

/** A capital line's hue: its key's rank among every line, so "Allocated" is the same color on every page. */
export function seriesColor(key: CapitalSeriesKey, colors: ChartColors): string {
  return colors.series[SERIES_HUES.indexOf(key)];
}

function endLabelWidth(series: readonly CapitalSeries[]): number {
  const longest = Math.max(...series.map((s) => s.name.length));
  return Math.ceil(Math.min(longest, END_LABEL_MAX_CHARS) * CHAR_WIDTH);
}

/**
 * The horizontal frame of a month chart: the capital chart's, whose right margin holds the end
 * labels of `series`. Every month chart of a page takes the same `series`, so a month sits at the
 * same x on each card.
 */
export function monthGrid(series: readonly CapitalSeries[]): { left: number; right: number } {
  return { left: MONTH_GRID_LEFT, right: endLabelWidth(series) + END_LABEL_DISTANCE + 2 * END_LABEL_PADDING };
}

/** A month's value, with a visible symbol only where no neighbour draws a segment to it. */
function linePoints(values: readonly (number | null)[]) {
  const isolated = (index: number) => (values[index - 1] ?? null) === null && (values[index + 1] ?? null) === null;
  return values.map((value, index) => (value === null ? null : { value, symbolSize: isolated(index) ? ISOLATED_SYMBOL_SIZE : 0 }));
}

/** Symbols on, sized per point by `linePoints`, and never sampled away on a long axis. */
const LINE_SYMBOLS = { showSymbol: true, showAllSymbol: true, symbol: "circle" } as const;

export function exposureOption(slices: readonly SectorSlice[], other: string, colors: ChartColors, currency: string): EChartsOption {
  const data = slices
    .filter((slice) => !slice.folded)
    .map((slice, index) => ({ name: slice.sector, value: slice.total, itemStyle: { color: swatchColor(slice, index, colors) } }));
  const folded = slices.filter((slice) => slice.folded);
  if (folded.length > 0) data.push({ name: other, value: folded.reduce((n, slice) => n + slice.total, 0), itemStyle: { color: colors.other } });
  return {
    textStyle: { fontFamily: CHART_FONT, color: colors.foreground },
    tooltip: {
      trigger: "item",
      formatter: (params: unknown) => {
        const { name, value, percent } = params as { name: string; value: number; percent: number };
        return `${name}: ${formatAmount(value)} ${currency} (${formatRate(percent / 100)})`;
      },
    },
    series: [
      {
        type: "pie",
        radius: "75%",
        label: { show: false },
        itemStyle: { borderColor: colors.surface, borderWidth: 2 },
        data,
      },
    ],
  };
}

export function capitalOption(capital: StrategyCapital, series: readonly CapitalSeries[], colors: ChartColors): EChartsOption {
  const labelWidth = endLabelWidth(series);
  return {
    textStyle: { fontFamily: CHART_FONT, color: colors.foreground },
    grid: { ...monthGrid(series), top: 40, bottom: 40 },
    // One row, paged past its width: a wrapped legend would run into the top of the plot.
    legend: { type: "scroll", top: 0, textStyle: { color: colors.foreground } },
    tooltip: {
      trigger: "axis",
      valueFormatter: (value: unknown) => `${typeof value === "number" ? formatAmount(value) : "—"} ${capital.currency}`,
    },
    // The cumulative P/L usually ends near 0, and its wrapped end label reaches half its height
    // below the line: the months sit lower than ECharts' 8 px so the two never touch.
    xAxis: {
      type: "category",
      boundaryGap: true,
      data: capital.months.map((m) => m.month),
      axisLabel: { margin: 14 },
      axisLine: { lineStyle: { color: colors.track } },
    },
    yAxis: { type: "value", splitLine: { lineStyle: { color: colors.track } } },
    series: series.map(({ key, name }) => ({
      type: "line" as const,
      name,
      smooth: false,
      ...LINE_SYMBOLS,
      color: seriesColor(key, colors),
      lineStyle: { width: 2 },
      // Allocated and cash invested part by the cumulative P/L alone, assigned meets allocated
      // whenever no put is open: their end labels would pile up without the shift. The shift is
      // bounded by the chart, not the plot, so a pile at 0 can still reach the months: the card's
      // own background lets a label cover a month label there rather than mix letters with it.
      endLabel: {
        show: true,
        formatter: "{a}",
        color: colors.foreground,
        width: labelWidth,
        overflow: "break" as const,
        distance: END_LABEL_DISTANCE,
        backgroundColor: colors.surface,
        padding: [0, END_LABEL_PADDING],
      },
      labelLayout: { moveOverlap: "shiftY" as const },
      data: linePoints(capital.months.map((m) => m[key])),
    })),
  };
}

export function returnOption(capital: StrategyCapital, series: readonly CapitalSeries[], colors: ChartColors): EChartsOption {
  return {
    textStyle: { fontFamily: CHART_FONT, color: colors.foreground },
    grid: { ...monthGrid(series), top: 16, bottom: 32 },
    tooltip: {
      trigger: "axis",
      valueFormatter: (value: unknown) => (typeof value === "number" ? formatRate(value) : "—"),
    },
    xAxis: { type: "category", boundaryGap: true, data: capital.months.map((m) => m.month), axisLine: { lineStyle: { color: colors.track } } },
    // The labels print one decimal: a finer step would print "0.1%" twice.
    yAxis: { type: "value", minInterval: 0.001, axisLabel: { formatter: (value: number) => formatRate(value) }, splitLine: { lineStyle: { color: colors.track } } },
    series: [
      {
        type: "line",
        smooth: false,
        connectNulls: false,
        ...LINE_SYMBOLS,
        color: colors.series[0],
        lineStyle: { width: 2 },
        data: linePoints(capital.months.map((m) => m.returnRate)),
        markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: colors.track, width: 1, type: "solid" }, data: [{ yAxis: 0 }] },
      },
    ],
  };
}
```

Créer `apps/web/src/hooks/useCapitalSeries.ts` :

```ts
import { useTranslation } from "react-i18next";
import type { CapitalScope } from "@ib/ledger";
import { type CapitalSeries, SCOPE_SERIES } from "@/lib/capitalCharts";

/**
 * The lines a scope's capital chart draws, named in the language on screen. The month charts of
 * the same page take their frame from them (`monthGrid`), so they are named once, here.
 */
export function useCapitalSeries(scope: CapitalScope): CapitalSeries[] {
  const { t } = useTranslation();
  return SCOPE_SERIES[scope].map((key) => ({ key, name: t(`stats.capital.${key}`) }));
}
```

Dans `apps/web/src/components/stats/WheelCapitalCards.tsx` :

1. Remplacer la ligne d'import de `@/lib/wheelCharts` par :

```tsx
import { type CapitalSeries, capitalOption, exposureOption, returnOption, sectorSlices, swatchColor } from "@/lib/capitalCharts";
```

2. Dans `WheelCapitalCardsProps`, remplacer le champ `names` et son commentaire par :

```tsx
  /** Translated by the page, which frames its own monthly bars on them too (`monthGrid`). */
  series: readonly CapitalSeries[];
```

3. Remplacer `{ capital, names, sectorOf, isDark }` par `{ capital, series, sectorOf, isDark }`, `capitalOption(capital, names, colors)` par `capitalOption(capital, series, colors)` et `returnOption(capital, names, colors)` par `returnOption(capital, series, colors)`.

Dans `apps/web/src/pages/StatsPage.tsx` :

1. Remplacer l'import `import { type CapitalSeriesNames, monthGrid } from "@/lib/wheelCharts";` par :

```tsx
import { useCapitalSeries } from "@/hooks/useCapitalSeries";
import { type CapitalSeries, monthGrid } from "@/lib/capitalCharts";
```

2. Juste après `const { sectorOf } = useAccountRiskReport();`, ajouter `const series = useCapitalSeries(strategy);`.
3. Supprimer le bloc `const names: CapitalSeriesNames = { … };`.
4. Remplacer `<MonthlyChart stats={stats} names={capital ? names : null} isDark={isDark} />` par `<MonthlyChart stats={stats} series={series} isDark={isDark} />` et `names={names}` (dans `WheelCapitalCards`) par `series={series}`.
5. Remplacer la fonction `MonthlyChart` entière (commentaire compris) par :

```tsx
/** `series`: the capital chart's lines below; the bars take its frame, so a month sits at the same x. */
function MonthlyChart({ stats, series, isDark }: { stats: StrategyStats; series: readonly CapitalSeries[]; isDark: boolean }) {
  const colors = chartColors(isDark);
  const option = {
    textStyle: { fontFamily: CHART_FONT, color: colors.foreground },
    grid: { ...monthGrid(series), top: 16, bottom: 32 },
    tooltip: { trigger: "axis", valueFormatter: (value: number) => `${formatAmount(value)} ${stats.currency}` },
    xAxis: { type: "category", data: stats.months.map((m) => m.month), axisLine: { lineStyle: { color: colors.track } } },
    yAxis: { type: "value", splitLine: { lineStyle: { color: colors.track } } },
    series: [
      {
        type: "bar",
        data: stats.months.map((m) => ({ value: m.pnl, itemStyle: { color: m.pnl >= 0 ? colors.success : colors.destructive } })),
      },
    ],
  };
  return (
    <div data-testid="monthly-chart" className="w-full">
      <ReactECharts option={option} opts={{ renderer: "svg" }} style={{ height: 260, width: "100%" }} />
    </div>
  );
}
```

- [x] **Step 4 : lancer les tests, le typage et le lint**

Run: `pnpm --filter web test && pnpm typecheck && pnpm lint`
Expected: PASS ; typage silencieux ; oxlint sans nouvel avertissement. `grep -rn "wheelCharts\|CapitalSeriesNames" apps/web/src` ne rend rien.

- [x] **Step 5 : commit**

Cocher les cases de la tâche 3, puis :

```bash
git add apps/web/src docs/plans/2026-09-12-capital-strategies.md
git commit -F - <<'EOF'
feat(web): graphiques de capital génériques, une teinte par courbe sur toutes les pages

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Arhu7RqqK2RvtQrwe6o6kH
EOF
```

---

## Tâche 4 : cartes réutilisables, et les pages LEAPS et Condors

**Files:**
- Create: `apps/web/src/components/stats/CurrencySelect.tsx`, `PnlTotal.tsx`, `MonthlyPnlCard.tsx`, `ExposureCard.tsx`, `CapitalCard.tsx`, `ReturnCard.tsx`
- Delete: `apps/web/src/components/stats/WheelCapitalCards.tsx`
- Modify: `apps/web/src/pages/StatsPage.tsx` (réécrit)
- Modify: `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json` (`stats.exposure.empty`)
- Test: `apps/web/src/pages/StatsPage.test.tsx`

**Interfaces:**
- Consumes: `JournalsReport.stats[scope]`, `JournalsReport.capital[scope]` (tâches 1 et 2) ; `CapitalSeries`, `sectorSlices`, `swatchColor`, `exposureOption`, `capitalOption`, `returnOption`, `monthGrid` (tâche 3) ; `useCapitalSeries` (tâche 3).
- Produces (tous sous `@/components/stats/`) :

```tsx
export function CurrencySelect(props: { currencies: readonly string[]; value: string | null; onChange: (currency: string | null) => void }): JSX.Element | null; // rien sous deux devises
export function PnlTotal(props: { stats: StrategyStats; className?: string }): JSX.Element;       // montant signé + note incomplete
export function MonthlyPnlCard(props: { stats: StrategyStats; series: readonly CapitalSeries[]; isDark: boolean }): JSX.Element;   // data-testid monthly-chart
export function ExposureCard(props: { capital: StrategyCapital; detailed: boolean; empty: string; sectorOf: (ticker: string) => string | null; isDark: boolean }): JSX.Element; // exposure-chart
export function CapitalCard(props: { capital: StrategyCapital; series: readonly CapitalSeries[]; title: string; isDark: boolean }): JSX.Element; // capital-chart
export function ReturnCard(props: { capital: StrategyCapital; series: readonly CapitalSeries[]; isDark: boolean }): JSX.Element;    // return-chart
```

et les clés `stats.exposure.empty.wheel`, `stats.exposure.empty.leaps`, `stats.exposure.empty.portfolio`.

- [x] **Step 1 : écrire les tests qui échouent**

Dans `apps/web/src/pages/StatsPage.test.tsx`, remplacer tout le test `it("draws none of the Wheel's money charts on another strategy", …)` par :

```tsx
  it("shows the LEAPS' exposure at their purchase price, with only a total and a share, beside their capital and return", async () => {
    renderStats("leaps");
    const card = (await screen.findByText("Exposition par secteur")).closest("[data-slot=card]") as HTMLElement;
    expect(within(card).getByTestId("exposure-chart")).toBeInTheDocument();
    // One ZZZ LEAPS bought at 3: 300. The call sold against it counts nothing.
    const unclassified = within(card).getByRole("row", { name: /Non classé/ });
    expect(within(unclassified).getByText("300.00")).toBeInTheDocument();
    expect(within(unclassified).getByText("100.0%")).toBeInTheDocument();
    expect(within(card).queryByText("Assigné")).not.toBeInTheDocument();
    expect(within(card).queryByText("Couverture des puts")).not.toBeInTheDocument();
    expect(screen.getByText("Capital de la stratégie")).toBeInTheDocument();
    expect(screen.getByTestId("capital-chart")).toBeInTheDocument();
    expect(screen.getByText("Rendement mensuel")).toBeInTheDocument();
    expect(screen.getByTestId("return-chart")).toBeInTheDocument();
  });

  it("says the LEAPS hold nothing once the LEAPS is sold, the capital still drawn", async () => {
    await db.transactions.add({ ...SAMPLE_JOURNAL_TRANSACTIONS[5], externalId: "flex:trade:304", quantity: -1, price: 4, amount: 400, when: "2026-08-25T15:00:00.000Z" });
    renderStats("leaps");
    expect(await screen.findByText("Aucune position LEAPS ouverte.")).toBeInTheDocument();
    expect(screen.queryByTestId("exposure-chart")).not.toBeInTheDocument();
    expect(screen.getByTestId("capital-chart")).toBeInTheDocument();
  });

  it("draws the condors' capital and return, and no exposure by sector", async () => {
    renderStats("condors");
    expect(await screen.findByText("46.00 USD")).toBeInTheDocument();
    expect(screen.getByTestId("monthly-chart")).toBeInTheDocument();
    expect(screen.getByTestId("capital-chart")).toBeInTheDocument();
    expect(screen.getByTestId("return-chart")).toBeInTheDocument();
    expect(screen.queryByText("Exposition par secteur")).not.toBeInTheDocument();
  });
```

- [x] **Step 2 : lancer les tests, vérifier qu'ils échouent**

Run: `pnpm --filter web test src/pages/StatsPage.test.tsx`
Expected: FAIL — les trois nouveaux tests : « Unable to find an element with the text: Exposition par secteur », « Aucune position LEAPS ouverte. », et `capital-chart` introuvable sur la page Condors. Les tests Wheel restent verts.

- [x] **Step 3 : implémenter**

Dans `apps/web/src/i18n/fr.json`, bloc `stats.exposure`, remplacer `"empty": "Aucune position Wheel ouverte.",` par :

```json
      "empty": {
        "wheel": "Aucune position Wheel ouverte.",
        "leaps": "Aucune position LEAPS ouverte.",
        "portfolio": "Aucune position ouverte."
      },
```

Dans `apps/web/src/i18n/en.json`, bloc `stats.exposure`, remplacer `"empty": "No open Wheel position.",` par :

```json
      "empty": {
        "wheel": "No open Wheel position.",
        "leaps": "No open LEAPS position.",
        "portfolio": "No open position."
      },
```

Créer `apps/web/src/components/stats/CurrencySelect.tsx` :

```tsx
import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ib/ui/select";

interface CurrencySelectProps {
  currencies: readonly string[];
  value: string | null;
  onChange: (currency: string | null) => void;
}

/** The currency the statistics show. With a single currency there is nothing to choose: nothing is drawn. */
export function CurrencySelect({ currencies, value, onChange }: CurrencySelectProps) {
  const { t } = useTranslation();
  if (currencies.length < 2) return null;
  return (
    <Select value={value} onValueChange={(next: string | null) => onChange(next)}>
      <SelectTrigger className="w-32" aria-label={t("stats.currency")}>
        <SelectValue>{(current: string | null) => current ?? ""}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {currencies.map((currency) => (
          <SelectItem key={currency} value={currency}>
            {currency}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

Créer `apps/web/src/components/stats/PnlTotal.tsx` :

```tsx
import { useTranslation } from "react-i18next";
import type { StrategyStats } from "@ib/ledger";
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A scope's total profit or loss, green or red, and the amounts it had to leave out. `className` sizes the amount. */
export function PnlTotal({ stats, className }: { stats: StrategyStats; className?: string }) {
  const { t } = useTranslation();
  return (
    <>
      <p className={cn("font-mono text-2xl font-semibold tabular-nums", stats.total >= 0 ? "text-success" : "text-destructive", className)}>
        {formatAmount(stats.total)} {stats.currency}
      </p>
      {stats.incomplete > 0 && <p className="text-xs text-muted-foreground">{t("stats.incomplete", { count: stats.incomplete })}</p>}
    </>
  );
}
```

Créer `apps/web/src/components/stats/MonthlyPnlCard.tsx` :

```tsx
import ReactECharts from "echarts-for-react";
import { useTranslation } from "react-i18next";
import type { StrategyStats } from "@ib/ledger";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { type CapitalSeries, monthGrid } from "@/lib/capitalCharts";
import { CHART_FONT, chartColors } from "@/lib/chartColors";
import { formatAmount } from "@/lib/format";

interface MonthlyPnlCardProps {
  stats: StrategyStats;
  /** The capital chart's lines below: the bars take its frame, so a month sits at the same x. */
  series: readonly CapitalSeries[];
  isDark: boolean;
}

export function MonthlyPnlCard({ stats, series, isDark }: MonthlyPnlCardProps) {
  const { t } = useTranslation();
  const colors = chartColors(isDark);
  const option = {
    textStyle: { fontFamily: CHART_FONT, color: colors.foreground },
    grid: { ...monthGrid(series), top: 16, bottom: 32 },
    tooltip: { trigger: "axis", valueFormatter: (value: number) => `${formatAmount(value)} ${stats.currency}` },
    xAxis: { type: "category", data: stats.months.map((m) => m.month), axisLine: { lineStyle: { color: colors.track } } },
    yAxis: { type: "value", splitLine: { lineStyle: { color: colors.track } } },
    series: [
      {
        type: "bar",
        data: stats.months.map((m) => ({ value: m.pnl, itemStyle: { color: m.pnl >= 0 ? colors.success : colors.destructive } })),
      },
    ],
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("stats.monthly")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div data-testid="monthly-chart" className="w-full">
          <ReactECharts option={option} opts={{ renderer: "svg" }} style={{ height: 260, width: "100%" }} />
        </div>
      </CardContent>
    </Card>
  );
}
```

Créer `apps/web/src/components/stats/ExposureCard.tsx` :

```tsx
import ReactECharts from "echarts-for-react";
import { useTranslation } from "react-i18next";
import type { StrategyCapital } from "@ib/ledger";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ib/ui/table";
import { exposureOption, sectorSlices, swatchColor } from "@/lib/capitalCharts";
import { chartColors } from "@/lib/chartColors";
import { formatAmount, formatRate } from "@/lib/format";

interface ExposureCardProps {
  capital: StrategyCapital;
  /** The Wheel's split of each sector between the shares assigned and the puts' cash. */
  detailed: boolean;
  /** Said in place of the pie when nothing is open. */
  empty: string;
  sectorOf: (ticker: string) => string | null;
  isDark: boolean;
}

/**
 * What a scope ties up per sector now: a pie and its legend table, side by side when the card is
 * wide enough, the table under the pie otherwise — the same card fills a statistics page and half
 * of the dashboard.
 */
export function ExposureCard({ capital, detailed, empty, sectorOf, isDark }: ExposureCardProps) {
  const { t } = useTranslation();
  const colors = chartColors(isDark);
  const slices = sectorSlices(capital.exposure, sectorOf, t("stats.exposure.unclassified"));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("stats.exposure.title")}</CardTitle>
      </CardHeader>
      <CardContent className="@container">
        {slices.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <div className="grid items-center gap-4 @2xl:grid-cols-2">
            <div data-testid="exposure-chart" className="w-full">
              <ReactECharts
                option={exposureOption(slices, t("stats.exposure.other"), colors, capital.currency)}
                opts={{ renderer: "svg" }}
                style={{ height: 260, width: "100%" }}
              />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("stats.exposure.sector")}</TableHead>
                  {detailed && (
                    <>
                      <TableHead className="text-right">{t("stats.exposure.assigned")}</TableHead>
                      <TableHead className="text-right">{t("stats.exposure.putCash")}</TableHead>
                    </>
                  )}
                  <TableHead className="text-right">{t("stats.exposure.total")}</TableHead>
                  <TableHead className="text-right">{t("stats.exposure.share")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {slices.map((slice, index) => (
                  <TableRow key={slice.sector}>
                    <TableCell className="font-medium">
                      <span className="inline-flex items-center gap-2">
                        <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: swatchColor(slice, index, colors) }} />
                        {slice.sector}
                      </span>
                    </TableCell>
                    {detailed && (
                      <>
                        <TableCell className="text-right font-mono tabular-nums">{formatAmount(slice.assigned)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{formatAmount(slice.putCash)}</TableCell>
                      </>
                    )}
                    <TableCell className="text-right font-mono tabular-nums">{formatAmount(slice.total)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatRate(slice.share)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

Créer `apps/web/src/components/stats/CapitalCard.tsx` :

```tsx
import ReactECharts from "echarts-for-react";
import { useTranslation } from "react-i18next";
import type { StrategyCapital } from "@ib/ledger";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { type CapitalSeries, capitalOption } from "@/lib/capitalCharts";
import { chartColors } from "@/lib/chartColors";

interface CapitalCardProps {
  capital: StrategyCapital;
  series: readonly CapitalSeries[];
  title: string;
  isDark: boolean;
}

/** A scope's capital month by month, and the amounts it had to leave out. */
export function CapitalCard({ capital, series, title, isDark }: CapitalCardProps) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div data-testid="capital-chart" className="w-full">
          <ReactECharts option={capitalOption(capital, series, chartColors(isDark))} opts={{ renderer: "svg" }} style={{ height: 300, width: "100%" }} />
        </div>
        {capital.incomplete > 0 && <p className="text-xs text-muted-foreground">{t("stats.incomplete", { count: capital.incomplete })}</p>}
      </CardContent>
    </Card>
  );
}
```

Créer `apps/web/src/components/stats/ReturnCard.tsx` :

```tsx
import ReactECharts from "echarts-for-react";
import { useTranslation } from "react-i18next";
import type { StrategyCapital } from "@ib/ledger";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { type CapitalSeries, returnOption } from "@/lib/capitalCharts";
import { chartColors } from "@/lib/chartColors";

interface ReturnCardProps {
  capital: StrategyCapital;
  /** The capital chart's lines, for its frame only. */
  series: readonly CapitalSeries[];
  isDark: boolean;
}

export function ReturnCard({ capital, series, isDark }: ReturnCardProps) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("stats.return.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div data-testid="return-chart" className="w-full">
          <ReactECharts option={returnOption(capital, series, chartColors(isDark))} opts={{ renderer: "svg" }} style={{ height: 260, width: "100%" }} />
        </div>
      </CardContent>
    </Card>
  );
}
```

Supprimer le composant de la Wheel :

```bash
git rm apps/web/src/components/stats/WheelCapitalCards.tsx
```

Remplacer tout `apps/web/src/pages/StatsPage.tsx` par :

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { StatsStrategy, StrategyStats } from "@ib/ledger";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { CapitalCard } from "@/components/stats/CapitalCard";
import { CurrencySelect } from "@/components/stats/CurrencySelect";
import { ExposureCard } from "@/components/stats/ExposureCard";
import { MonthlyPnlCard } from "@/components/stats/MonthlyPnlCard";
import { PnlTotal } from "@/components/stats/PnlTotal";
import { ReturnCard } from "@/components/stats/ReturnCard";
import { useAccountJournals, useAccountRiskReport } from "@/db/AccountDataProvider";
import { useCapitalSeries } from "@/hooks/useCapitalSeries";
import { useTheme } from "@/hooks/useTheme";

interface StatsPageProps {
  strategy: StatsStrategy;
}

export function StatsPage({ strategy }: StatsPageProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const view = useAccountJournals();
  const { sectorOf } = useAccountRiskReport();
  const series = useCapitalSeries(strategy);
  const [chosen, setChosen] = useState<string | null>(null);

  if (view.status === "loading") {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  const all = view.report.stats[strategy];
  const stats: StrategyStats | undefined = all.find((s) => s.currency === chosen) ?? all[0];
  const capital = stats ? view.report.capital[strategy].find((c) => c.currency === stats.currency) : undefined;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-lg font-semibold tracking-tight">{t(`stats.title.${strategy}`)}</h1>
        <CurrencySelect currencies={all.map((s) => s.currency)} value={stats?.currency ?? null} onChange={setChosen} />
      </div>

      {!stats ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("stats.empty")}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t("stats.total")}</CardTitle>
            </CardHeader>
            <CardContent>
              <PnlTotal stats={stats} />
            </CardContent>
          </Card>
          <MonthlyPnlCard stats={stats} series={series} isDark={isDark} />
          {/* No exposure by sector for the condors: not asked for (spec of sub-project 14, §1). */}
          {capital && strategy !== "condors" && (
            <ExposureCard
              capital={capital}
              detailed={strategy === "wheel"}
              empty={t(`stats.exposure.empty.${strategy}`)}
              sectorOf={sectorOf}
              isDark={isDark}
            />
          )}
          {capital && <CapitalCard capital={capital} series={series} title={t("stats.capital.title")} isDark={isDark} />}
          {capital && <ReturnCard capital={capital} series={series} isDark={isDark} />}
        </>
      )}
    </div>
  );
}
```

- [x] **Step 4 : lancer les tests, le typage et le lint**

Run: `pnpm --filter web test && pnpm typecheck && pnpm lint`
Expected: PASS, les tests Wheel de `StatsPage.test.tsx` compris (colonnes Assigné et Couverture des puts toujours là) ; typage silencieux ; oxlint sans nouvel avertissement.

- [x] **Step 5 : commit**

Cocher les cases de la tâche 4, puis :

```bash
git add apps/web/src docs/plans/2026-09-12-capital-strategies.md
git commit -F - <<'EOF'
feat(web): exposition, capital et rendement sur les pages LEAPS et Condors

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Arhu7RqqK2RvtQrwe6o6kH
EOF
```

---

## Tâche 5 : le tableau de bord du portefeuille

**Files:**
- Create: `apps/web/src/components/CashCoverageCard.tsx`
- Modify: `apps/web/src/pages/DashboardPage.tsx` (réécrit)
- Modify: `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json` (`stats.capital.titlePortfolio`)
- Modify: `docs/points-reportes.md` (le lien nu de `DashboardPage.tsx` disparaît)
- Test: `apps/web/src/pages/DashboardPage.test.tsx`

**Interfaces:**
- Consumes: `JournalsReport.stats.portfolio`, `JournalsReport.capital.portfolio` ; `useCapitalSeries("portfolio")` ; `CurrencySelect`, `PnlTotal`, `MonthlyPnlCard`, `ExposureCard`, `CapitalCard`, `ReturnCard` (tâche 4) ; `useAccountRiskReport().report` et `.sectorOf`.
- Produces: `CashCoverageCard({ report: RiskReport; isDark: boolean })`, la carte « Couverture en Cash » actuelle, inchangée ; la clé `stats.capital.titlePortfolio`.

- [x] **Step 1 : écrire les tests qui échouent**

Dans `apps/web/src/pages/DashboardPage.test.tsx` :

1. Ajouter l'import `import { SAMPLE_JOURNAL_SNAPSHOT, SAMPLE_JOURNAL_TRANSACTIONS } from "@/mocks/journals";`.
2. Remplacer le `beforeEach` par :

```tsx
beforeEach(async () => {
  await Promise.all([db.transactions.clear(), db.snapshots.clear(), db.sectors.clear()]);
});
```

3. Dans le test « shows the empty state with a link to the data sources without a snapshot », ajouter à la fin :

```tsx
    expect(screen.queryByRole("group", { name: "Profit/Perte total" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("capital-chart")).not.toBeInTheDocument();
```

4. À la fin du `describe("DashboardPage", …)`, ajouter :

```tsx
  it("totals the three strategies at the top right: the Wheel's 140, the LEAPS' 49 and the condor's 46", async () => {
    await db.transactions.bulkAdd(SAMPLE_JOURNAL_TRANSACTIONS);
    await db.snapshots.put(SAMPLE_JOURNAL_SNAPSHOT);
    renderDashboard("beta");
    const total = await screen.findByRole("group", { name: "Profit/Perte total" });
    expect(within(total).getByText("235.00 USD")).toHaveClass("text-success");
    expect(screen.queryByLabelText("Devise")).not.toBeInTheDocument();
  });

  it("draws the money of every strategy at once: monthly bars, exposure, capital and return", async () => {
    await db.transactions.bulkAdd(SAMPLE_JOURNAL_TRANSACTIONS);
    await db.snapshots.put(SAMPLE_JOURNAL_SNAPSHOT);
    renderDashboard("beta");
    expect(await screen.findByLabelText("Couverture en Cash")).toBeInTheDocument();
    expect(screen.getByTestId("monthly-chart")).toBeInTheDocument();
    const card = screen.getByText("Exposition par secteur").closest("[data-slot=card]") as HTMLElement;
    // 3,400 of MQZA shares assigned to the Wheel and a ZZZ LEAPS bought for 300, neither sector known.
    const unclassified = within(card).getByRole("row", { name: /Non classé/ });
    expect(within(unclassified).getByText("3,700.00")).toBeInTheDocument();
    expect(within(unclassified).getByText("100.0%")).toBeInTheDocument();
    expect(within(card).queryByText("Assigné")).not.toBeInTheDocument();
    expect(screen.getByText("Capital de toutes les stratégies")).toBeInTheDocument();
    expect(screen.getByTestId("capital-chart")).toBeInTheDocument();
    expect(screen.getByTestId("return-chart")).toBeInTheDocument();
  });

  it("offers a currency switch when the strategies span several, EUR first, the cash card still in USD", async () => {
    await db.transactions.bulkAdd([
      ...SAMPLE_JOURNAL_TRANSACTIONS,
      { ...SAMPLE_JOURNAL_TRANSACTIONS[0], externalId: "flex:trade:201", symbol: "SAP   261002P00017000", currency: "EUR", amount: 30 },
    ]);
    await db.snapshots.put(SAMPLE_JOURNAL_SNAPSHOT);
    renderDashboard("beta");
    expect(await screen.findByLabelText("Devise")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Profit/Perte total" })).getByText("29.00 EUR")).toBeInTheDocument();
    expect(tileValue(screen.getByLabelText("Couverture en Cash"), "Cash en portefeuille")).toHaveTextContent("$12,000.00");
  });

  it("keeps the journal cards without a snapshot, the empty message in place of the cash card", async () => {
    await db.transactions.bulkAdd(SAMPLE_JOURNAL_TRANSACTIONS);
    renderDashboard("beta");
    expect(await screen.findByText("Aucune position — importez un relevé HTML ou une réponse de Flex Query avec Open Positions.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Aller aux sources de données" })).toHaveAttribute("href", "/accounts/beta/sources");
    expect(screen.queryByLabelText("Couverture en Cash")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Profit/Perte total" })).toHaveTextContent("235.00 USD");
    expect(screen.getByTestId("capital-chart")).toBeInTheDocument();
  });
```

- [x] **Step 2 : lancer les tests, vérifier qu'ils échouent**

Run: `pnpm --filter web test src/pages/DashboardPage.test.tsx`
Expected: FAIL — les quatre nouveaux tests ne trouvent ni le groupe « Profit/Perte total », ni « Exposition par secteur », ni « Devise » ; le dernier voit l'état vide seul. Les tests existants de la carte Cash restent verts.

- [x] **Step 3 : implémenter**

Dans `apps/web/src/i18n/fr.json`, bloc `stats.capital`, remplacer `"title": "Capital de la stratégie",` par :

```json
      "title": "Capital de la stratégie",
      "titlePortfolio": "Capital de toutes les stratégies",
```

Dans `apps/web/src/i18n/en.json`, bloc `stats.capital`, remplacer `"title": "Strategy capital",` par :

```json
      "title": "Strategy capital",
      "titlePortfolio": "Capital of all strategies",
```

Créer `apps/web/src/components/CashCoverageCard.tsx` avec la carte actuelle, sortie telle quelle de `DashboardPage` :

```tsx
import ReactECharts from "echarts-for-react";
import { useTranslation } from "react-i18next";
import { cashOk, cashRequired, type RiskReport } from "@ib/coverage";
import { Badge } from "@ib/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { CHART_FONT, chartColors } from "@/lib/chartColors";
import { formatMoney, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The cash the account holds against the cash its short puts and condors require, in USD. */
export function CashCoverageCard({ report, isDark }: { report: RiskReport; isDark: boolean }) {
  const { t } = useTranslation();
  const required = cashRequired(report);
  const ok = cashOk(report);
  const available = report.cashAvailable;
  const remaining = available === null ? null : available - required;
  const ratio = available === null ? null : required > 0 ? Math.min(available / required, 1) : 1;
  const colors = chartColors(isDark);

  const gaugeOption = {
    series: [
      {
        type: "gauge",
        startAngle: 210,
        endAngle: -30,
        min: 0,
        max: 1,
        progress: { show: true, width: 14, itemStyle: { color: ok ? colors.success : colors.destructive } },
        axisLine: { lineStyle: { width: 14, color: [[1, colors.track]] } },
        pointer: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        detail: {
          formatter: () => formatPercent(ratio ?? 0),
          fontSize: 26,
          fontWeight: 600,
          fontFamily: CHART_FONT,
          color: colors.foreground,
          offsetCenter: [0, "0%"],
        },
        data: [{ value: ratio ?? 0 }],
      },
    ],
  };

  const verdict =
    ok === null
      ? { variant: "outline" as const, label: t("dashboard.cashCard.unknown") }
      : ok
        ? { variant: "success" as const, label: t("dashboard.cashCard.ok") }
        : { variant: "destructive" as const, label: t("dashboard.cashCard.short") };

  return (
    <Card aria-label={t("dashboard.cashCard.title")}>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t("dashboard.cashCard.title")}</CardTitle>
        <CardAction>
          <Badge variant={verdict.variant}>{verdict.label}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        {ratio !== null && (
          <div data-testid="cash-gauge" className="w-full">
            <ReactECharts option={gaugeOption} opts={{ renderer: "svg" }} style={{ height: 180, width: "100%" }} />
          </div>
        )}
        <div className="@container w-full">
          <div className="grid grid-cols-1 gap-3 @sm:grid-cols-3">
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">{t("dashboard.cashCard.portfolio")}</p>
              <p className="font-mono text-base font-medium tabular-nums">{formatMoney(available)}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">{t("dashboard.cashCard.required")}</p>
              <p className="font-mono text-base font-medium tabular-nums">{formatMoney(required)}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">{t("dashboard.cashCard.available")}</p>
              <p className={cn("font-mono text-base font-medium tabular-nums", remaining !== null && remaining < 0 && "text-destructive")}>
                {formatMoney(remaining)}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

Remplacer tout `apps/web/src/pages/DashboardPage.tsx` par :

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type { StrategyStats } from "@ib/ledger";
import { buttonVariants } from "@ib/ui/button";
import { Card, CardContent } from "@ib/ui/card";
import { CashCoverageCard } from "@/components/CashCoverageCard";
import { CapitalCard } from "@/components/stats/CapitalCard";
import { CurrencySelect } from "@/components/stats/CurrencySelect";
import { ExposureCard } from "@/components/stats/ExposureCard";
import { MonthlyPnlCard } from "@/components/stats/MonthlyPnlCard";
import { PnlTotal } from "@/components/stats/PnlTotal";
import { ReturnCard } from "@/components/stats/ReturnCard";
import { useAccountJournals, useAccountRiskReport } from "@/db/AccountDataProvider";
import { useCapitalSeries } from "@/hooks/useCapitalSeries";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

export function DashboardPage() {
  const { accountId = "" } = useParams<{ accountId: string }>();
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { report, sectorOf } = useAccountRiskReport();
  const view = useAccountJournals();
  const series = useCapitalSeries("portfolio");
  const [chosen, setChosen] = useState<string | null>(null);

  if (report === undefined || view.status === "loading") {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  // The three strategies at once: the same statistics and capital as their own pages, computed
  // over more lines, never a sum of their results (spec of sub-project 14, §3).
  const all = view.report.stats.portfolio;
  const stats: StrategyStats | undefined = all.find((s) => s.currency === chosen) ?? all[0];
  const capital = stats ? view.report.capital.portfolio.find((c) => c.currency === stats.currency) : undefined;
  const title = <h1 className="font-heading text-lg font-semibold tracking-tight">{t("nav.dashboard")}</h1>;

  const noPositions = (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">{t("positions.empty")}</p>
        <Link to={`/accounts/${accountId}/sources`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          {t("positions.emptyLink")}
        </Link>
      </CardContent>
    </Card>
  );

  if (report === null && !stats) {
    return (
      <div className="flex flex-col gap-4 p-4 md:p-6">
        {title}
        {noPositions}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {title}
        {stats && (
          <div className="flex flex-wrap items-center gap-3">
            <div role="group" aria-label={t("stats.total")} className="text-right">
              <p className="text-xs text-muted-foreground">{t("stats.total")}</p>
              <PnlTotal stats={stats} className="text-lg" />
            </div>
            <CurrencySelect currencies={all.map((s) => s.currency)} value={stats.currency} onChange={setChosen} />
          </div>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {report === null ? noPositions : <CashCoverageCard report={report} isDark={isDark} />}
        {capital && <ExposureCard capital={capital} detailed={false} empty={t("stats.exposure.empty.portfolio")} sectorOf={sectorOf} isDark={isDark} />}
      </div>
      {stats && capital && (
        <>
          <MonthlyPnlCard stats={stats} series={series} isDark={isDark} />
          <CapitalCard capital={capital} series={series} title={t("stats.capital.titlePortfolio")} isDark={isDark} />
          <ReturnCard capital={capital} series={series} isDark={isDark} />
        </>
      )}
    </div>
  );
}
```

Dans `docs/points-reportes.md`, section « Sans échéance », entrée « Un lien stylé en bouton devrait être un `<Link>` portant `cn(buttonVariants(...))` », remplacer :

```markdown
  **Trois sites l'utilisent encore nu** et sortent donc avec cette bordure transparente :
  `PositionsPage.tsx:33`, `DashboardPage.tsx:49`, `SettingsPage.tsx:53`. Deux autres portent
  `cn(buttonVariants(...))` et sont corrects. Tant que les trois restent, la règle énoncée
```

par :

```markdown
  **Deux sites l'utilisent encore nu** et sortent donc avec cette bordure transparente :
  `PositionsPage.tsx:33` et `SettingsPage.tsx:53` (`DashboardPage` porte `cn(...)` depuis le
  sous-projet 14). Les autres sont corrects. Tant que les deux restent, la règle énoncée
```

(Relire l'entrée entière avant de la modifier : si la phrase qui suit dit encore « les trois », l'accorder.)

- [x] **Step 4 : lancer les tests, le typage et le lint**

Run: `pnpm --filter web test && pnpm typecheck && pnpm lint`
Expected: PASS ; typage silencieux ; oxlint sans nouvel avertissement (le `role="group"` porte son `aria-label`).

- [x] **Step 5 : commit**

Cocher les cases de la tâche 5, puis :

```bash
git add apps/web/src docs/points-reportes.md docs/plans/2026-09-12-capital-strategies.md
git commit -F - <<'EOF'
feat(web): profit/perte total, exposition, capital et rendement du portefeuille sur le tableau de bord

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Arhu7RqqK2RvtQrwe6o6kH
EOF
```

---

## Tâche 6 : graine, vérification dans la vraie application, documentation, revue, merge

**Files:**
- Modify: `apps/web/src/mocks/journals.ts`, `apps/web/src/mocks/seed.ts`, `apps/web/src/mocks/seed.test.ts`
- Modify: `CLAUDE.md`, `docs/specs/2026-09-12-capital-strategies-design.md`, `docs/points-reportes.md` (si la revue reporte quelque chose)

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: `DEMO_TRANSACTIONS: Transaction[]`, `DEMO_POSITIONS: Position[]`, `DEMO_SECTORS: SectorRecord[]` dans `mocks/journals.ts` (renommés depuis `DEMO_WHEEL_*`).

- [x] **Step 1 : écrire le test de graine qui échoue**

Dans `apps/web/src/mocks/seed.test.ts`, remplacer tout le test `it("seeds on beta a Wheel that matches its snapshot: …", …)` par :

```ts
  it("seeds on beta every strategy open and matching its snapshot: a put beside assigned shares, a LEAPS, a condor, in four sectors", async () => {
    await seedDemo();
    const ledger = await db.transactions.where("accountId").equals("beta").toArray();
    const snapshot = await db.snapshots.where("accountId").equals("beta").first();
    const report = buildJournals(ledger, snapshot ? { asOf: snapshot.asOf, positions: snapshot.positions } : undefined);
    expect(report.reconciliation.differences).toEqual([]);
    expect(report.capital.wheel[0].exposure).toEqual([
      { ticker: "MQZA", assigned: 3400, putCash: 0, leaps: 0, condors: 0 },
      { ticker: "XOM", assigned: 0, putCash: 11000, leaps: 0, condors: 0 },
    ]);
    expect(report.capital.portfolio[0].exposure).toEqual([
      { ticker: "MQZA", assigned: 3400, putCash: 0, leaps: 0, condors: 0 },
      { ticker: "QQQ", assigned: 0, putCash: 0, leaps: 0, condors: 500 },
      { ticker: "XOM", assigned: 0, putCash: 11000, leaps: 0, condors: 0 },
      { ticker: "ZZZ", assigned: 0, putCash: 0, leaps: 300, condors: 0 },
    ]);
    const sectors = await db.sectors.bulkGet(["MQZA", "QQQ", "XOM", "ZZZ"]);
    expect(sectors.map((s) => s?.category)).toEqual(["Crypto", "ETF", "Energy", "Materials"]);
  });
```

Run: `pnpm --filter web test src/mocks/seed.test.ts`
Expected: FAIL — l'exposition du portefeuille n'a ni QQQ ni ZZZ côté secteurs (`QQQ` absent, catégories `undefined`).

- [x] **Step 2 : la graine**

Dans `apps/web/src/mocks/journals.ts` :

1. Après `const XOM_PUT = …`, ajouter :

```ts
const QQQ = (right: "C" | "P", strike: number) => ({ symbol: `QQQ   261016${right}00${strike}000`, right, strike, expiry: "2026-10-16" });
```

2. Remplacer tout le bloc final, du commentaire `/** Demo only, never in the tests' ledger: …` jusqu'à la fin de `DEMO_WHEEL_SECTORS`, par :

```ts
/**
 * Demo only, never in the tests' ledger: an XOM put still open, so the Wheel statistics show put
 * cash beside the assigned MQZA shares, and a QQQ condor still open, wings of 5, so every strategy
 * ties money up on the dashboard; a sector for MQZA, ZZZ and QQQ, so the exposure pies have several.
 */
export const DEMO_TRANSACTIONS: Transaction[] = [
  trade({ externalId: "flex:trade:117", ...XOM_PUT, quantity: -1, price: 1.2, amount: 120, when: "2026-08-10T14:30:00.000Z" }),
  trade({ externalId: "flex:trade:118", ...QQQ("P", 480), quantity: 1, price: 0.25, amount: -25, when: "2026-08-20T14:30:00.000Z" }),
  trade({ externalId: "flex:trade:119", ...QQQ("P", 485), quantity: -1, price: 0.75, amount: 75, when: "2026-08-20T14:30:00.000Z" }),
  trade({ externalId: "flex:trade:120", ...QQQ("C", 520), quantity: -1, price: 0.5, amount: 50, when: "2026-08-20T14:30:00.000Z" }),
  trade({ externalId: "flex:trade:121", ...QQQ("C", 525), quantity: 1, price: 0.25, amount: -25, when: "2026-08-20T14:30:00.000Z" }),
];

export const DEMO_POSITIONS: Position[] = [
  position({ symbol: "XOM", right: "P", strike: 110, expiry: "2026-10-16", quantity: -1, description: "XOM 16OCT26 110 P" }),
  position({ symbol: "QQQ", right: "P", strike: 480, expiry: "2026-10-16", quantity: 1, description: "QQQ 16OCT26 480 P" }),
  position({ symbol: "QQQ", right: "P", strike: 485, expiry: "2026-10-16", quantity: -1, description: "QQQ 16OCT26 485 P" }),
  position({ symbol: "QQQ", right: "C", strike: 520, expiry: "2026-10-16", quantity: -1, description: "QQQ 16OCT26 520 C" }),
  position({ symbol: "QQQ", right: "C", strike: 525, expiry: "2026-10-16", quantity: 1, description: "QQQ 16OCT26 525 C" }),
];

export const DEMO_SECTORS: SectorRecord[] = [
  { ticker: "MQZA", name: "MQZA Holdings", category: "Crypto", score: null, status: "on", importedAt: "2026-09-03T08:00:00.000Z" },
  { ticker: "ZZZ", name: "ZZZ Corp", category: "Materials", score: null, status: "on", importedAt: "2026-09-03T08:00:00.000Z" },
  { ticker: "QQQ", name: "Invesco QQQ Trust", category: "ETF", score: null, status: "on", importedAt: "2026-09-03T08:00:00.000Z" },
];
```

Dans `apps/web/src/mocks/seed.ts` :

1. Remplacer l'import de `@/mocks/journals` par :

```ts
import { DEMO_POSITIONS, DEMO_SECTORS, DEMO_TRANSACTIONS, SAMPLE_JOURNAL_SNAPSHOT, SAMPLE_JOURNAL_TRANSACTIONS } from "@/mocks/journals";
```

2. Dans `seedDemo`, remplacer `DEMO_WHEEL_TRANSACTIONS` par `DEMO_TRANSACTIONS`, `DEMO_WHEEL_SECTORS` par `DEMO_SECTORS` et `DEMO_WHEEL_POSITIONS` par `DEMO_POSITIONS`.
3. Dans le commentaire de `seedDemo`, remplacer « a Wheel cycle with a put still open, a covered LEAPS and a condor » par « a Wheel cycle with a put still open, a covered LEAPS, a condor expired and one still open ».

Run: `pnpm --filter web test && grep -rn "DEMO_WHEEL" apps/web/src`
Expected: PASS, `seed.test.ts` compris ; le `grep` ne rend rien.

Commit (cocher les steps 1 et 2) :

```bash
git add apps/web/src/mocks docs/plans/2026-09-12-capital-strategies.md
git commit -F - <<'EOF'
feat(web): la graine beta montre un Condor ouvert et quatre secteurs

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Arhu7RqqK2RvtQrwe6o6kH
EOF
```

- [x] **Step 3 : `pnpm check`**

Run: `pnpm check`
Expected: lint, typecheck, `check:api-types`, build et tous les Vitest verts. Un échec s'examine avec `superpowers:systematic-debugging`, jamais par un contournement.

- [x] **Step 4 : captures**

Le worktree a son propre port Vite (`tools/dev-env/ports.mjs`) : lire la ligne `dev-env: worktree capital-strategies → web :…` du driver.

```bash
SHOTS=/tmp/ib-frontend-shots/capital-strategies
node .claude/skills/run-frontend/driver.mjs /accounts/beta/dashboard /accounts/beta/stats/leaps /accounts/beta/stats/condors /accounts/beta/stats/wheel --seed --height=2600 --out=$SHOTS/seed
node .claude/skills/run-frontend/driver.mjs /accounts/beta/dashboard /accounts/beta/stats/leaps --seed --dark --height=2600 --out=$SHOTS/dark
node .claude/skills/run-frontend/driver.mjs /accounts/beta/dashboard --seed --width=400 --height=4200 --out=$SHOTS/narrow
```

Lire chaque PNG avec l'outil Read et vérifier :
- `seed/accounts-beta-dashboard.png` : en haut à droite « Profit/Perte total » à **425.00 USD** en vert, aucun sélecteur de devise ; la carte « Couverture en Cash » à gauche, badge « Couvert » (cash requis 11 500 : put XOM 11 000 et Condor QQQ 500), l'exposition à droite, camembert au-dessus du tableau Secteur/Total/Part : Energy 11,000.00 (72.4 %), Crypto 3,400.00 (22.4 %), ETF 500.00 (3.3 %), Materials 300.00 (2.0 %) ; puis en pleine largeur « Profits/pertes mensuels » (2026-06 : 90, 2026-07 : 99, 2026-08 : 236), « Capital de toutes les stratégies » avec trois courbes — Cumul 90 → 189 → 425, Alloué 3,700 → 3,700 → 15,200, Cash investi 3,610 → 3,511 → 14,775 — et « Rendement mensuel » à 2.4 %, 2.7 %, 1.6 % ; les mois alignés d'une carte à l'autre ; la barre de titre garde Couverture et Reconstitution en vert ;
- `seed/accounts-beta-stats-leaps.png` : total 49.00 USD ; exposition Materials 300.00, 100.0 %, sans colonnes Assigné ni Couverture des puts ; capital en trois courbes, Alloué à 300 sur 2026-06 → 2026-08 en aqua, Cash investi en jaune ; rendement 16.3 %, 0.0 %, 0.0 % ;
- `seed/accounts-beta-stats-condors.png` : total 117.00 USD ; aucune carte d'exposition ; capital sur le seul mois 2026-08 (points isolés visibles), Alloué 500 ; rendement 23.4 % ;
- `seed/accounts-beta-stats-wheel.png` : inchangée par rapport au sous-projet 13 (quatre courbes, exposition détaillée) ;
- `dark/…` : parts, courbes, étiquettes et tableaux lisibles en thème sombre ;
- `narrow/…` : à 400 px, le total passe sous le titre sans déborder, les cartes s'empilent, rien ne déborde horizontalement.

Si le driver échoue (délai `networkidle`, Chromium manquant), s'arrêter et le signaler avec sa sortie ; ne pas modifier le driver. Si la couverture de `beta` passe au rouge, s'arrêter : le Condor QQQ n'est pas reconnu comme structure par `packages/coverage`, et la graine doit changer, pas le moteur.

- [x] **Step 5 : `CLAUDE.md` et le spec**

Dans `CLAUDE.md` :

1. Tableau des sous-projets, ajouter après la ligne du 13 :

```markdown
| 14 | Capital des LEAPS, des Condors et du portefeuille | livré (2026-09-12), en attente de merge |
```

2. Remplacer toute la règle « **Le capital de la Wheel se mesure au prix d'entrée, jamais à la valeur de marché** : … Ses mois sont ceux de `StrategyStats`, qui courent jusqu'à la dernière transaction du compte. » par :

```markdown
- **Le capital d'une stratégie se mesure au prix d'entrée, jamais à la valeur de marché** :
  `computeCapital` (`packages/ledger/src/journals/capital.ts`) compte une action de la Wheel au
  `openPrice` de sa ligne — le strike du put qui l'a livrée ou du call qui l'a reprise —, un put
  vendu à `strike × DEFAULT_MULTIPLIER × |quantité|`, un LEAPS à son prix d'achat ×
  `DEFAULT_MULTIPLIER` et les actions qu'il a livrées à leur strike, un Condor à sa pire aile
  brute, crédit non déduit (la règle de `structureAssignmentCash`, que `ledger` ne peut pas
  importer). Un call vendu ne compte rien. Une ligne est ouverte en fin de mois selon `startWhen`
  et `endWhen`, **jamais selon `ongoing`** : un put assigné reste `ongoing` tant que ses actions
  ne sont pas vendues, le lire ouvert compterait deux fois le même argent. Ses mois sont ceux de
  `StrategyStats`, qui courent jusqu'à la dernière transaction du compte.
- **Le tableau de bord est la portée `portfolio`, jamais une addition** : `buildJournals` appelle
  `computeStats` et `computeCapital` sur `SCOPE_STRATEGIES[scope]` pour `wheel`, `leaps`,
  `condors` et `portfolio`, les trois stratégies à la fois. Le profit/perte total du tableau de
  bord est donc la somme des trois totaux et son rendement la somme des profits/pertes sur la
  somme des montants alloués, sans qu'aucune fonction ne combine des résultats par stratégie.
```

3. Dans la règle « **Journaux et rapport de risque se calculent une fois, dans la coquille** », rien ne change ; vérifier seulement que `DashboardPage` lit bien `useAccountJournals`.

Dans `docs/specs/2026-09-12-capital-strategies-design.md`, remplacer `Statut : spec validée au brainstorming (2026-09-12), à planifier.` par `Statut : implémenté (2026-09-12).`, et reporter tout écart d'implémentation constaté pendant les tâches.

Commit :

```bash
git add CLAUDE.md docs
git commit -F - <<'EOF'
docs: sous-projet 14 livré, règle du capital des trois stratégies et du portefeuille

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Arhu7RqqK2RvtQrwe6o6kH
EOF
```

- [x] **Step 6 : revue de branche**

Invoquer `superpowers:requesting-code-review` sur la branche `capital-strategies` contre `main`, avec ce plan et le spec. Corriger chaque constat retenu (TDD, un commit par correction). Un constat jugé non bloquant et reporté délibérément s'écrit dans `docs/points-reportes.md`, sous un titre `## Reporté par le sous-projet 14 (capital des LEAPS, des Condors et du portefeuille)` inséré avant `## Sans échéance`, avec la raison du report. Relancer `pnpm check` après les corrections.

- [x] **Step 7 : merge**

Cocher les cases de la tâche 6 dans le dernier commit de la branche, puis invoquer `superpowers:finishing-a-development-branch`. Après le merge sur `main`, dans `CLAUDE.md`, la ligne du 14 devient `| 14 | Capital des LEAPS, des Condors et du portefeuille | fait (2026-09-12) |`, puis :

```bash
git add CLAUDE.md
git commit -F - <<'EOF'
docs: sous-projet 14 mergé sur main

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Arhu7RqqK2RvtQrwe6o6kH
EOF
```
