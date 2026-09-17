# Sous-projet 13 — Capital et exposition de la Wheel : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter à la page Statistiques Wheel un camembert d'exposition par secteur, un graphique en lignes lissées du capital de la stratégie (cumul des profits/pertes, assigné, alloué, cash investi) et un graphique en ligne lissée du rendement mensuel.

**Architecture:** Deux couches. (1) *Moteur* (`packages/ledger`) : `JournalRow` gagne `strike` ; `computeStats` prolonge ses mois jusqu'à la dernière transaction du compte ; une fonction pure `computeWheelCapital` (`journals/capital.ts`) mesure, sur les mois des statistiques Wheel, ce que les puts et les actions de la Wheel immobilisent en fin de mois, et l'exposition courante par ticker. `buildJournals` la range dans `JournalsReport.wheelCapital`. (2) *Page* (`apps/web`) : `lib/wheelCharts.ts` construit les options ECharts en fonctions pures, `components/stats/WheelCapitalCards.tsx` pose trois cartes, `StatsPage` les monte sous la carte mensuelle pour la seule Wheel, le secteur étant joint par `sectorOf` de `useAccountRiskReport`.

**Tech Stack:** TypeScript 6, Vitest 4, React 19, react-router 8, Dexie 4 (`fake-indexeddb` en test), react-i18next, shadcn base-ui, ECharts 6 et `echarts-for-react` 3, Tailwind 4. Node 22, pnpm.

**Spec:** `docs/specs/2026-09-11-capital-wheel-design.md` (lire aussi `CLAUDE.md`, et `docs/specs/2026-09-07-journaux-design.md` §2.4 et §5 pour l'attribution des statistiques en flux de trésorerie).

## Global Constraints

- **Rien dans `apps/api`**, aucune table, aucun store, aucune migration Dexie : le capital de la Wheel est une vue calculée des journaux, recalculée à chaque changement, jamais stockée. Une tâche qui semble réclamer un endpoint ou une table est un signal d'arrêt.
- **Journaux et rapport de risque se lisent par `useAccountJournals` et `useAccountRiskReport`** : aucune page ni composant n'appelle `useJournals` ni `useRiskReport`.
- **Un montant compte au prix d'entrée dans la Wheel, jamais à la valeur de marché** : un put à `strike × DEFAULT_MULTIPLIER × |quantity|`, une action à `openPrice × |quantity|` (spec §2).
- **Ouvert en fin de mois = `startWhen < D` et (`endWhen === null` ou `endWhen ≥ D`)**, `D` le premier jour du mois suivant ; **jamais `ongoing`** (spec §2).
- **`DEFAULT_MULTIPLIER` s'importe de `packages/ledger/src/constants.ts`**, jamais un `100` recodé.
- **Tout reste par devise, sans conversion.**
- **Une valeur absente reste `null`**, jamais `0` : un mois sans capital alloué a `returnRate: null`, un trou dans la courbe, « — » dans l'infobulle.
- **Un seul axe Y par graphique.** Aucune couleur en dur dans un composant : elles vivent dans `lib/chartColors.ts`. Les teintes catégorielles s'attribuent dans un ordre fixe, jamais en cycle, au plus cinq.
- **Toute phrase vit dans `apps/web/src/i18n/{fr,en}.json`, mêmes clés dans les deux.** `packages/ledger` n'écrit aucun texte visible.
- **shadcn ici est base-ui** : `render={<X/>}`, jamais `asChild`.
- **Un test doit échouer si le comportement change.** `apps/web` teste sur `fake-indexeddb` avec une base semée, **jamais en moquant les hooks**.
- Code et commentaires en anglais ; documentation, i18n et messages de commit en français.
- Chaque commit se termine par les deux lignes :
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01VABd1De1hBzffj365aJSXy
  ```
- Le travail se fait dans un worktree `.claude/worktrees/capital-wheel` (skill `superpowers:using-git-worktrees`), branche `capital-wheel`, mergé sur `main` après revue.
- **Les cases de ce plan se cochent dans le worktree au fur et à mesure, dans le même commit que la tâche.**

---

## Structure des fichiers

```
packages/ledger/src/journals/
  types.ts                         JournalRow.strike ; WheelMonth, WheelExposure, WheelCapital ;
                                   JournalsReport.wheelCapital ; doc de StrategyStats.months
  rows.ts (+ test)                 buildRow pose strike
  replay.ts (+ test)               settlementRow pose strike ; lastWhen ; wheelCapital
  stats.ts (+ test)                computeStats(rows, strategy, lastWhen)
  capital.ts (+ test)     NOUVEAU  nextMonthStart, computeWheelCapital
  condor.test.ts                   strike du composite et des jambes

apps/web/src/
  lib/chartColors.ts               ChartColors, surface, series, other
  lib/format.ts (+ test)           formatRate
  lib/wheelCharts.ts (+ test) NOUVEAU  sectorSlices, swatchColor, exposureOption, capitalOption,
                                   returnOption
  lib/journalTone.test.ts          helper row() : strike
  lib/consistency.test.ts          littéral JournalsReport : wheelCapital
  components/stats/WheelCapitalCards.tsx  NOUVEAU  les trois cartes
  pages/StatsPage.tsx (+ test)     monte WheelCapitalCards sur la Wheel
  i18n/fr.json, i18n/en.json       stats.exposure.*, stats.capital.*, stats.return.*
  mocks/journals.ts                DEMO_WHEEL_TRANSACTIONS, DEMO_WHEEL_POSITIONS, DEMO_WHEEL_SECTORS
  mocks/seed.ts (+ test)           la graine beta les écrit

CLAUDE.md, docs/specs/2026-09-11-capital-wheel-design.md
```

## Commandes

Depuis la racine du worktree.

```bash
pnpm install                                                   # une fois, à la création du worktree
pnpm --filter @ib/ledger test src/journals/capital.test.ts     # un fichier du moteur
pnpm --filter @ib/ledger test                                  # tout le moteur, oracle des journaux compris
pnpm --filter web test src/lib/wheelCharts.test.ts             # un fichier de l'app (garde TZ=Asia/Kolkata)
pnpm --filter web test                                         # toute l'app
pnpm typecheck                                                 # tsc de tous les paquets, silencieux si OK
pnpm lint                                                      # oxlint
pnpm check                                                     # lint + typecheck + build + tous les Vitest
```

---

## Tâche 1 : chaque ligne de journal porte son strike

**Files:**
- Modify: `packages/ledger/src/journals/types.ts` (interface `JournalRow`)
- Modify: `packages/ledger/src/journals/rows.ts` (`buildRow`)
- Modify: `packages/ledger/src/journals/replay.ts` (`settlementRow`)
- Test: `packages/ledger/src/journals/rows.test.ts`, `condor.test.ts`, `replay.test.ts`, `stats.test.ts`, `apps/web/src/lib/journalTone.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `JournalRow.strike: number | null`, placé juste après `quantity`. Le strike de l'option ; `null` pour des actions et pour un condor composite (dont le contrat a `strike: null`).

- [x] **Step 1 : écrire les tests qui échouent**

Dans `packages/ledger/src/journals/rows.test.ts`, test « prorates the opening over the portion closed and nets the exit », dans l'objet passé à `expect(row).toEqual({…})`, ajouter après `quantity: -2,` :

```ts
      strike: 17,
```

Dans `packages/ledger/src/journals/condor.test.ts`, test « folds four legs opened together into one Condors row, legs attached », dans l'objet passé à `expect(row).toMatchObject({…})`, ajouter après `quantity: -1,` :

```ts
      strike: null,
```

puis, juste après ce `toMatchObject`, ajouter :

```ts
    expect(row.legs?.map((leg) => leg.strike)).toEqual([620, 625, 660, 665]);
```

Dans `packages/ledger/src/journals/replay.test.ts` :
- dans l'objet `toEqual` dont `id` vaut `"flex:trade:3#1"` (vers la ligne 143, `kind: "shares"`), ajouter après `quantity: 200,` : `strike: null,` ;
- dans le test « keeps an unclaimed settlement as a bare Others row », dans `expect.objectContaining({…})`, ajouter après `quantity: null,` : `strike: 640,`.

- [x] **Step 2 : lancer les tests, vérifier qu'ils échouent**

Run: `pnpm --filter @ib/ledger test src/journals/rows.test.ts src/journals/condor.test.ts src/journals/replay.test.ts`
Expected: FAIL — le `toEqual` de `rows.test.ts` et celui de `replay.test.ts` rapportent une clé `strike` absente de la ligne reçue ; le `toMatchObject` du condor et l'`objectContaining` du règlement, pareil ; `leg.strike` vaut `undefined`.

- [x] **Step 3 : implémenter**

Dans `packages/ledger/src/journals/types.ts`, interface `JournalRow`, juste après le champ `quantity` :

```ts
  /** Option: the contract's strike; `null` for shares and for a condor composite. */
  strike: number | null;
```

Dans `packages/ledger/src/journals/rows.ts`, `buildRow`, dans l'objet rendu, juste après `quantity: Math.sign(lot.quantity) * quantity,` :

```ts
    strike: lot.contract.strike,
```

Dans `packages/ledger/src/journals/replay.ts`, `settlementRow`, dans l'objet rendu, juste après `quantity: null,` :

```ts
    strike: contract.strike,
```

Les deux helpers de test qui fabriquent une ligne entière doivent compiler :
- `packages/ledger/src/journals/stats.test.ts`, fonction `row` : ajouter `strike: 17,` après `quantity: -1,` ;
- `apps/web/src/lib/journalTone.test.ts`, fonction `row` : ajouter `strike: null,` après `quantity: -1,`.

- [x] **Step 4 : lancer les tests et le typage**

Run: `pnpm --filter @ib/ledger test && pnpm --filter web test src/lib/journalTone.test.ts && pnpm typecheck`
Expected: PASS partout, oracle des journaux compris (`flex_journals_corpus.xml`, zéro écart) ; `pnpm typecheck` silencieux.

- [x] **Step 5 : commit**

Cocher les cases de la tâche 1 dans ce plan, puis :

```bash
git add packages/ledger/src/journals apps/web/src/lib/journalTone.test.ts docs/plans/2026-09-11-capital-wheel.md
git commit -F - <<'EOF'
feat(ledger): chaque ligne de journal porte le strike de son contrat

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VABd1De1hBzffj365aJSXy
EOF
```

---

## Tâche 2 : les statistiques courent jusqu'à la dernière transaction du compte

**Files:**
- Modify: `packages/ledger/src/journals/stats.ts` (`computeStats`)
- Modify: `packages/ledger/src/journals/replay.ts` (fin de `buildJournals`)
- Modify: `packages/ledger/src/journals/types.ts` (commentaire de `StrategyStats.months`)
- Test: `packages/ledger/src/journals/stats.test.ts`, `packages/ledger/src/journals/replay.test.ts`

**Interfaces:**
- Consumes: rien de la tâche 1.
- Produces: `computeStats(rows: readonly JournalRow[], strategy: StatsStrategy, lastWhen: string | null): StrategyStats[]`. Les mois vont du premier flux au plus tardif de deux mois : celui du dernier flux et `monthOf(lastWhen)`. Sans aucun flux, `months` reste `[]`. Dans `buildJournals`, `lastWhen` est le `when` le plus grand de toutes les transactions reçues, `null` sans transaction.

- [x] **Step 1 : écrire les tests qui échouent**

Dans `packages/ledger/src/journals/stats.test.ts`, ajouter `, null` en troisième argument de **chaque** appel existant à `computeStats` (onze appels : `computeStats([…], "wheel")` devient `computeStats([…], "wheel", null)`, idem pour `"condors"` et `"leaps"`). Puis ajouter à la fin du `describe("computeStats", …)` :

```ts
  it("runs the months on to the month of the ledger's last transaction, at zero", () => {
    expect(computeStats([row({})], "wheel", "2026-10-15T15:00:00.000Z")[0].months).toEqual([
      { month: "2026-08", pnl: 19 },
      { month: "2026-09", pnl: 0 },
      { month: "2026-10", pnl: 0 },
    ]);
  });

  it("never cuts the months short of the last flow when the last transaction is older", () => {
    expect(computeStats([row({})], "wheel", "2026-07-01T00:00:00.000Z")[0].months).toEqual([{ month: "2026-08", pnl: 19 }]);
  });

  it("adds no month to a strategy that has no flow yet", () => {
    const held = row({ kind: "shares", strike: null, assigned: true, quantity: 100, openTotal: -1700, openCommission: 0, openNet: -1700 });
    expect(computeStats([held], "wheel", "2026-10-15T15:00:00.000Z")).toEqual([{ currency: "USD", total: 0, months: [], incomplete: 0 }]);
  });
```

Dans `packages/ledger/src/journals/replay.test.ts`, ajouter à la fin du fichier :

```ts
describe("buildJournals — statistics", () => {
  it("runs every strategy's months on to the ledger's last transaction, whatever its strategy", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -1, price: 0.25, when: D1 }),
      stock({ ticker: "AAPL", quantity: 1, price: 180, when: "2026-10-05T14:30:00.000Z" }),
    ]);
    expect(report.stats.wheel[0].months.map((m) => m.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
  });
});
```

- [x] **Step 2 : lancer les tests, vérifier qu'ils échouent**

Run: `pnpm --filter @ib/ledger test src/journals/stats.test.ts src/journals/replay.test.ts`
Expected: FAIL — les trois nouveaux tests de `stats.test.ts` : le premier reçoit `[{ month: "2026-08", pnl: 19 }]` seul ; le test de `replay.test.ts` reçoit `["2026-08"]`. (Les deux autres nouveaux tests de `stats.test.ts` peuvent déjà passer : ils gardent le comportement actuel.)

- [x] **Step 3 : implémenter**

Dans `packages/ledger/src/journals/stats.ts`, remplacer toute la fonction `computeStats` par :

```ts
/**
 * `lastWhen` is the ledger's last transaction, whatever its strategy: the months run on to it,
 * so a position still open shows the months it has been open, not only the months money moved.
 */
export function computeStats(rows: readonly JournalRow[], strategy: StatsStrategy, lastWhen: string | null): StrategyStats[] {
  const byCurrency = new Map<string, { total: number; months: Map<string, number>; incomplete: number }>();
  for (const row of rows) {
    if (row.strategy !== strategy) continue;
    const bucket = byCurrency.get(row.currency) ?? { total: 0, months: new Map(), incomplete: 0 };
    byCurrency.set(row.currency, bucket);
    for (const { month, amount } of contributions(row)) {
      if (amount === null) {
        bucket.incomplete += 1;
        continue;
      }
      bucket.total += amount;
      bucket.months.set(month, (bucket.months.get(month) ?? 0) + amount);
    }
  }
  const lastMonth = lastWhen === null ? null : monthOf(lastWhen);
  return [...byCurrency.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, bucket]) => {
      const keys = [...bucket.months.keys()].sort();
      if (keys.length === 0) return { currency, total: bucket.total, months: [], incomplete: bucket.incomplete };
      const lastFlow = keys[keys.length - 1];
      const last = lastMonth !== null && lastMonth > lastFlow ? lastMonth : lastFlow;
      const months = monthsBetween(keys[0], last).map((month) => ({ month, pnl: bucket.months.get(month) ?? 0 }));
      return { currency, total: bucket.total, months, incomplete: bucket.incomplete };
    });
}
```

Dans `packages/ledger/src/journals/replay.ts`, à la fin de `buildJournals`, remplacer la ligne :

```ts
  return { rows, reconciliation, stats: { wheel: computeStats(rows, "wheel"), leaps: computeStats(rows, "leaps"), condors: computeStats(rows, "condors") } };
```

par :

```ts
  const lastWhen = transactions.reduce<string | null>((latest, transaction) => (latest === null || transaction.when > latest ? transaction.when : latest), null);
  return {
    rows,
    reconciliation,
    stats: { wheel: computeStats(rows, "wheel", lastWhen), leaps: computeStats(rows, "leaps", lastWhen), condors: computeStats(rows, "condors", lastWhen) },
  };
```

Dans `packages/ledger/src/journals/types.ts`, interface `StrategyStats`, remplacer le commentaire de `months` par :

```ts
  /** Consecutive months from the first flow to the later of the last flow and the ledger's last transaction, zeros included. */
```

- [x] **Step 4 : lancer les tests**

Run: `pnpm --filter @ib/ledger test && pnpm --filter web test src/pages/StatsPage.test.tsx && pnpm typecheck`
Expected: PASS. `StatsPage.test.tsx` reste vert : la dernière transaction de `SAMPLE_JOURNAL_TRANSACTIONS` (2026-08-29) tombe dans le dernier mois de flux de la Wheel.

- [x] **Step 5 : commit**

Cocher les cases de la tâche 2, puis :

```bash
git add packages/ledger/src/journals docs/plans/2026-09-11-capital-wheel.md
git commit -F - <<'EOF'
feat(ledger): les mois des statistiques courent jusqu'à la dernière transaction du compte

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VABd1De1hBzffj365aJSXy
EOF
```

---

## Tâche 3 : le capital de la Wheel, mois par mois, et son exposition courante

**Files:**
- Create: `packages/ledger/src/journals/capital.ts`
- Create: `packages/ledger/src/journals/capital.test.ts`
- Modify: `packages/ledger/src/journals/types.ts` (types du capital, `JournalsReport.wheelCapital`)
- Modify: `packages/ledger/src/journals/replay.ts` (fin de `buildJournals`)
- Modify: `apps/web/src/lib/consistency.test.ts:9` (littéral `JournalsReport`)
- Test: `packages/ledger/src/journals/replay.test.ts`

**Interfaces:**
- Consumes: `JournalRow.strike` (tâche 1) ; `computeStats(rows, strategy, lastWhen)` (tâche 2) ; `DEFAULT_MULTIPLIER` de `packages/ledger/src/constants.ts`.
- Produces, exportés par `@ib/ledger` via `journals/types.ts` :

```ts
export interface WheelMonth {
  month: string;
  cumulativePnl: number;
  assigned: number;
  putCash: number;
  allocated: number;
  invested: number;
  returnRate: number | null;
}
export interface WheelExposure { ticker: string; assigned: number; putCash: number }
export interface WheelCapital { currency: string; months: WheelMonth[]; exposure: WheelExposure[]; incomplete: number }
// JournalsReport gagne : wheelCapital: WheelCapital[];
```

et, dans `journals/capital.ts` (non réexporté par l'index) : `nextMonthStart(month: string): string`, `computeWheelCapital(rows: readonly JournalRow[], stats: readonly StrategyStats[]): WheelCapital[]`.

- [x] **Step 1 : écrire les tests qui échouent**

Créer `packages/ledger/src/journals/capital.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { computeWheelCapital, nextMonthStart } from "./capital.ts";
import type { JournalRow, MonthPnl, StrategyStats } from "./types.ts";

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

function stats(months: MonthPnl[], currency = "USD"): StrategyStats {
  return { currency, total: months.reduce((n, m) => n + m.pnl, 0), months, incomplete: 0 };
}

const AUG_SEP: MonthPnl[] = [
  { month: "2026-08", pnl: 41 },
  { month: "2026-09", pnl: 99 },
];

describe("nextMonthStart", () => {
  it("gives the first day of the following month, across a year end", () => {
    expect(nextMonthStart("2026-08")).toBe("2026-09-01");
    expect(nextMonthStart("2026-12")).toBe("2027-01-01");
  });
});

describe("computeWheelCapital", () => {
  it("counts a put sold at strike × 100 × contracts at every month end it is still open", () => {
    const [usd] = computeWheelCapital([row({})], [stats(AUG_SEP)]);
    expect(usd.months.map((m) => [m.month, m.putCash, m.assigned, m.allocated])).toEqual([
      ["2026-08", 3400, 0, 3400],
      ["2026-09", 3400, 0, 3400],
    ]);
  });

  it("counts nothing for a put bought back before the month ends, and gives that month no return", () => {
    const bought = row({ endWhen: "2026-08-20T15:00:00.000Z", ongoing: false, event: "buyback" });
    const [usd] = computeWheelCapital([bought], [stats([{ month: "2026-08", pnl: 30 }])]);
    expect(usd.months).toEqual([{ month: "2026-08", cumulativePnl: 30, assigned: 0, putCash: 0, allocated: 0, invested: -30, returnRate: null }]);
  });

  it("still counts a put closed at the very first instant of the next month", () => {
    const bought = row({ endWhen: "2026-09-01T00:00:00.000Z", ongoing: false, event: "buyback" });
    const [usd] = computeWheelCapital([bought], [stats([{ month: "2026-08", pnl: 41 }, { month: "2026-09", pnl: 0 }])]);
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
    const [usd] = computeWheelCapital([put, held], [stats(months)]);
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
    const [usd] = computeWheelCapital([taken], [stats(AUG_SEP)]);
    expect(usd.months.map((m) => m.assigned)).toEqual([2000, 2000]);
  });

  it("counts only the shares still held after a partial sale", () => {
    const sold = shares({ quantity: 100, openTotal: -1700, openNet: -1700, endWhen: "2026-09-10T15:00:00.000Z", ongoing: false, event: "sold" });
    const kept = shares({ id: "x#2", quantity: 100, openTotal: -1700, openNet: -1700 });
    const [usd] = computeWheelCapital([sold, kept], [stats(AUG_SEP)]);
    expect(usd.months.map((m) => m.assigned)).toEqual([3400, 1700]);
  });

  it("accumulates the P/L, derives the cash invested and the monthly return on the money allocated", () => {
    const [usd] = computeWheelCapital([row({})], [stats(AUG_SEP)]);
    expect(usd.months).toEqual([
      { month: "2026-08", cumulativePnl: 41, assigned: 0, putCash: 3400, allocated: 3400, invested: 3359, returnRate: 41 / 3400 },
      { month: "2026-09", cumulativePnl: 140, assigned: 0, putCash: 3400, allocated: 3400, invested: 3260, returnRate: 99 / 3400 },
    ]);
  });

  it("leaves out and counts a line whose amount cannot be computed", () => {
    const rows = [row({ strike: null }), shares({ id: "y#1", openPrice: null }), row({ id: "z#1", strike: 20, quantity: -1 })];
    const [usd] = computeWheelCapital(rows, [stats(AUG_SEP)]);
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
      row({ id: "e#1", ticker: "LLL", strategy: "leaps", kind: "long_call", strike: 15, quantity: 1 }),
      shares({ id: "f#1", ticker: "AAPL", strategy: "others", assigned: false }),
    ];
    const [usd] = computeWheelCapital(rows, [stats(AUG_SEP)]);
    expect(usd.exposure).toEqual([
      { ticker: "MQZA", assigned: 3400, putCash: 1500 },
      { ticker: "XOM", assigned: 0, putCash: 11000 },
    ]);
  });

  it("gives one entry per currency of the statistics, each counting its own lines", () => {
    const rows = [row({}), row({ id: "y#1", currency: "EUR", ticker: "SAP", strike: 50, quantity: -1 })];
    const capital = computeWheelCapital(rows, [stats(AUG_SEP, "EUR"), stats(AUG_SEP)]);
    expect(capital.map((c) => [c.currency, c.months[0].putCash])).toEqual([
      ["EUR", 5000],
      ["USD", 3400],
    ]);
  });
});
```

Dans `packages/ledger/src/journals/replay.test.ts`, ajouter à la fin du fichier :

```ts
describe("buildJournals — Wheel capital", () => {
  it("measures the Wheel's money at each month end, from the put sold to the shares still held", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -2, price: 0.25, when: "2026-08-03T14:30:00.000Z" }),
      ...deliver({ ...PUT, quantity: 2, when: "2026-09-15T20:00:00.000Z" }),
      stock({ ticker: "AAPL", quantity: 1, price: 180, when: "2026-10-05T14:30:00.000Z" }),
    ]);
    expect(report.wheelCapital).toEqual([
      {
        currency: "USD",
        months: [
          { month: "2026-08", cumulativePnl: 49, assigned: 0, putCash: 3400, allocated: 3400, invested: 3351, returnRate: 49 / 3400 },
          { month: "2026-09", cumulativePnl: 49, assigned: 3400, putCash: 0, allocated: 3400, invested: 3351, returnRate: 0 },
          { month: "2026-10", cumulativePnl: 49, assigned: 3400, putCash: 0, allocated: 3400, invested: 3351, returnRate: 0 },
        ],
        exposure: [{ ticker: "MQZA", assigned: 3400, putCash: 0 }],
        incomplete: 0,
      },
    ]);
  });
});
```

- [x] **Step 2 : lancer les tests, vérifier qu'ils échouent**

Run: `pnpm --filter @ib/ledger test src/journals/capital.test.ts src/journals/replay.test.ts`
Expected: FAIL — `capital.test.ts` ne trouve pas le module `./capital.ts` ; le nouveau test de `replay.test.ts` reçoit `undefined` pour `report.wheelCapital`.

- [x] **Step 3 : implémenter**

Dans `packages/ledger/src/journals/types.ts`, juste avant `export interface JournalsReport`, ajouter :

```ts
/** One month of the Wheel's money, measured at the month's end (spec of sub-project 13, §2). */
export interface WheelMonth {
  /** YYYY-MM, the same months as the Wheel's StrategyStats, index for index. */
  month: string;
  cumulativePnl: number;
  /** Wheel shares held, at the price they entered the Wheel at. */
  assigned: number;
  /** Wheel puts open, at strike × multiplier × contracts. */
  putCash: number;
  /** assigned + putCash */
  allocated: number;
  /** allocated − cumulativePnl */
  invested: number;
  /** This month's pnl / allocated; `null` when allocated is 0. */
  returnRate: number | null;
}

export interface WheelExposure {
  ticker: string;
  assigned: number;
  putCash: number;
}

export interface WheelCapital {
  currency: string;
  months: WheelMonth[];
  /** Lines still open (`endWhen === null`), summed per ticker; only non-zero tickers, sorted by ticker. */
  exposure: WheelExposure[];
  /** Lines left out for want of a strike, a price or a quantity. */
  incomplete: number;
}
```

et, dans `JournalsReport`, après `stats: Record<StatsStrategy, StrategyStats[]>;` :

```ts
  /** One entry per entry of `stats.wheel`, in the same order. */
  wheelCapital: WheelCapital[];
```

Créer `packages/ledger/src/journals/capital.ts` :

```ts
import { DEFAULT_MULTIPLIER } from "../constants.ts";
import type { JournalRow, StrategyStats, WheelCapital, WheelExposure, WheelMonth } from "./types.ts";

/** "2026-08" -> "2026-09-01": a line still open at this instant was open when August ended. */
export function nextMonthStart(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, "0")}-01`;
}

type Measure = "assigned" | "putCash";

interface TiedUp {
  row: JournalRow;
  measure: Measure;
  /** `null` when a strike, a price or a quantity is missing. */
  amount: number | null;
}

/**
 * What one line ties up: a Wheel put the cash its strike calls for, Wheel shares the price they
 * entered the Wheel at — the put's strike when delivered, the call's when taken over — never
 * their market value. A call sold ties nothing up: the shares cover it.
 */
function tiedUp(row: JournalRow): TiedUp | null {
  if (row.strategy !== "wheel") return null;
  if (row.kind === "short_put") {
    const amount = row.strike === null || row.quantity === null ? null : row.strike * DEFAULT_MULTIPLIER * Math.abs(row.quantity);
    return { row, measure: "putCash", amount };
  }
  if (row.kind === "shares") {
    const amount = row.openPrice === null || row.quantity === null ? null : row.openPrice * Math.abs(row.quantity);
    return { row, measure: "assigned", amount };
  }
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
 * The Wheel's money month by month, on the months of its statistics, and what it ties up now
 * per ticker. `stats` is the Wheel's `computeStats` result: its months and pnl drive the series,
 * so the monthly bars and these lines share one axis.
 */
export function computeWheelCapital(rows: readonly JournalRow[], stats: readonly StrategyStats[]): WheelCapital[] {
  return stats.map(({ currency, months }) => {
    const lines = rows
      .filter((row) => row.currency === currency)
      .map(tiedUp)
      .filter((line): line is TiedUp => line !== null);
    const counted = lines.filter((line): line is TiedUp & { amount: number } => line.amount !== null);

    let cumulativePnl = 0;
    const measured = months.map(({ month, pnl }): WheelMonth => {
      const instant = nextMonthStart(month);
      const totals = { assigned: 0, putCash: 0 };
      for (const line of counted) if (openAt(line.row, instant)) totals[line.measure] += line.amount;
      cumulativePnl += pnl;
      const allocated = totals.assigned + totals.putCash;
      return {
        month,
        cumulativePnl,
        assigned: totals.assigned,
        putCash: totals.putCash,
        allocated,
        invested: allocated - cumulativePnl,
        returnRate: allocated === 0 ? null : pnl / allocated,
      };
    });

    const byTicker = new Map<string, WheelExposure>();
    for (const line of counted) {
      if (line.row.endWhen !== null) continue;
      const exposure = byTicker.get(line.row.ticker) ?? { ticker: line.row.ticker, assigned: 0, putCash: 0 };
      exposure[line.measure] += line.amount;
      byTicker.set(line.row.ticker, exposure);
    }
    const exposure = [...byTicker.values()]
      .filter((e) => e.assigned + e.putCash !== 0)
      .sort((a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0));

    return { currency, months: measured, exposure, incomplete: lines.length - counted.length };
  });
}
```

Dans `packages/ledger/src/journals/replay.ts`, ajouter l'import :

```ts
import { computeWheelCapital } from "./capital.ts";
```

et remplacer le `return` écrit à la tâche 2 par :

```ts
  const wheel = computeStats(rows, "wheel", lastWhen);
  return {
    rows,
    reconciliation,
    stats: { wheel, leaps: computeStats(rows, "leaps", lastWhen), condors: computeStats(rows, "condors", lastWhen) },
    wheelCapital: computeWheelCapital(rows, wheel),
  };
```

Dans `apps/web/src/lib/consistency.test.ts`, ligne 9, remplacer :

```ts
  return { status: "ready", report: { rows: [], reconciliation, stats: { wheel: [], leaps: [], condors: [] } }, identityIssues: [] };
```

par :

```ts
  return { status: "ready", report: { rows: [], reconciliation, stats: { wheel: [], leaps: [], condors: [] }, wheelCapital: [] }, identityIssues: [] };
```

- [x] **Step 4 : lancer les tests et le typage**

Run: `pnpm --filter @ib/ledger test && pnpm --filter web test src/lib/consistency.test.ts && pnpm typecheck`
Expected: PASS, oracle des journaux compris ; `pnpm typecheck` silencieux.

- [x] **Step 5 : commit**

Cocher les cases de la tâche 3, puis :

```bash
git add packages/ledger/src/journals apps/web/src/lib/consistency.test.ts docs/plans/2026-09-11-capital-wheel.md
git commit -F - <<'EOF'
feat(ledger): capital de la Wheel en fin de mois et exposition courante par ticker

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VABd1De1hBzffj365aJSXy
EOF
```

---

## Tâche 4 : couleurs, format de rendement et options ECharts de la Wheel

**Files:**
- Modify: `apps/web/src/lib/chartColors.ts`
- Modify: `apps/web/src/lib/format.ts`, `apps/web/src/lib/format.test.ts`
- Create: `apps/web/src/lib/wheelCharts.ts`
- Create: `apps/web/src/lib/wheelCharts.test.ts`

**Interfaces:**
- Consumes: `WheelCapital`, `WheelExposure` de `@ib/ledger` (tâche 3).
- Produces :

```ts
// lib/chartColors.ts
export interface ChartColors { success: string; destructive: string; track: string; foreground: string; surface: string; series: readonly string[]; other: string }
export function chartColors(isDark: boolean): ChartColors;   // inchangée, typée ChartColors
// lib/format.ts
export function formatRate(ratio: number): string;           // 0.01206 -> "1.2%"
// lib/wheelCharts.ts
export const MAX_NAMED_SLICES = 5;
export interface SectorSlice { sector: string; assigned: number; putCash: number; total: number; share: number; folded: boolean }
export interface CapitalSeriesNames { cumulativePnl: string; assigned: string; allocated: string; invested: string }
export function sectorSlices(exposure: readonly WheelExposure[], sectorOf: (ticker: string) => string | null, unclassified: string): SectorSlice[];
export function swatchColor(slice: SectorSlice, index: number, colors: ChartColors): string;
export function exposureOption(slices: readonly SectorSlice[], other: string, colors: ChartColors, currency: string): EChartsOption;
export function capitalOption(capital: WheelCapital, names: CapitalSeriesNames, colors: ChartColors): EChartsOption;
export function returnOption(capital: WheelCapital, colors: ChartColors): EChartsOption;
```

- [x] **Step 1 : écrire les tests qui échouent**

Dans `apps/web/src/lib/format.test.ts`, ajouter `formatRate` à l'import depuis `@/lib/format`, puis ajouter après le `describe("formatPercent", …)` :

```ts
describe("formatRate", () => {
  it("keeps one decimal of a percent, sign included", () => {
    expect(formatRate(0.01206)).toBe("1.2%");
    expect(formatRate(-0.004)).toBe("-0.4%");
    expect(formatRate(0)).toBe("0.0%");
  });
});
```

Créer `apps/web/src/lib/wheelCharts.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { LineSeriesOption, PieSeriesOption } from "echarts";
import type { WheelCapital, WheelExposure } from "@ib/ledger";
import { CHART_COLORS } from "@/lib/chartColors";
import { capitalOption, exposureOption, returnOption, sectorSlices, swatchColor } from "@/lib/wheelCharts";

const colors = CHART_COLORS.light;
const SECTORS: Record<string, string> = { MQZA: "Crypto", RQZA: "Crypto", XOM: "Energy", AAPL: "Tech" };
const sectorOf = (ticker: string) => SECTORS[ticker] ?? null;
/** Each ticker its own sector, "SA" for "A": to line up more sectors than the table has. */
const ownSector = (ticker: string) => `S${ticker}`;

function exposure(ticker: string, assigned: number, putCash = 0): WheelExposure {
  return { ticker, assigned, putCash };
}

/** Six sectors, 600 down to 100, plus a seventh of 40: SF and SG fold into Other, 140. */
const SEVEN = [...["A", "B", "C", "D", "E", "F"].map((t, i) => exposure(t, 600 - i * 100)), exposure("G", 40)];

const CAPITAL: WheelCapital = {
  currency: "USD",
  months: [
    { month: "2026-08", cumulativePnl: 41, assigned: 0, putCash: 3400, allocated: 3400, invested: 3359, returnRate: 41 / 3400 },
    { month: "2026-09", cumulativePnl: 41, assigned: 0, putCash: 0, allocated: 0, invested: -41, returnRate: null },
  ],
  exposure: [],
  incomplete: 0,
};

const NAMES = { cumulativePnl: "Cumul", assigned: "Assigné", allocated: "Alloué", invested: "Investi" };

describe("sectorSlices", () => {
  it("sums tickers per sector, puts an unknown ticker under the unclassified label, largest first", () => {
    const slices = sectorSlices([exposure("MQZA", 3400), exposure("RQZA", 0, 1000), exposure("XOM", 0, 11000), exposure("ZZZ", 600)], sectorOf, "Non classé");
    expect(slices).toEqual([
      { sector: "Energy", assigned: 0, putCash: 11000, total: 11000, share: 11000 / 16000, folded: false },
      { sector: "Crypto", assigned: 3400, putCash: 1000, total: 4400, share: 4400 / 16000, folded: false },
      { sector: "Non classé", assigned: 600, putCash: 0, total: 600, share: 600 / 16000, folded: false },
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

describe("capitalOption", () => {
  it("draws four smoothed lines on one axis, in fixed order and colors, each named at its end", () => {
    const option = capitalOption(CAPITAL, NAMES, colors);
    expect(Array.isArray(option.yAxis)).toBe(false);
    expect(option.xAxis).toMatchObject({ type: "category", data: ["2026-08", "2026-09"] });
    const series = option.series as LineSeriesOption[];
    expect(series.map((s) => [s.type, s.name, s.smooth, s.color, s.data])).toEqual([
      ["line", "Cumul", true, colors.series[0], [41, 41]],
      ["line", "Assigné", true, colors.series[1], [0, 0]],
      ["line", "Alloué", true, colors.series[2], [3400, 0]],
      ["line", "Investi", true, colors.series[3], [3359, -41]],
    ]);
    expect(series.every((s) => s.endLabel?.show === true)).toBe(true);
  });

  it("formats the tooltip values as amounts in the capital's currency", () => {
    const { valueFormatter } = capitalOption(CAPITAL, NAMES, colors).tooltip as { valueFormatter: (value: unknown) => string };
    expect(valueFormatter(3359)).toBe("3,359.00 USD");
  });
});

describe("returnOption", () => {
  it("draws the monthly return as one smoothed line, a gap where nothing was allocated, over a zero baseline", () => {
    const option = returnOption(CAPITAL, colors);
    expect(option.legend).toBeUndefined();
    const [line] = option.series as LineSeriesOption[];
    expect(line).toMatchObject({ type: "line", smooth: true, connectNulls: false, data: [41 / 3400, null] });
    expect(line.markLine?.data).toEqual([{ yAxis: 0 }]);
  });

  it("formats the tooltip as a rate, a dash for a month without one", () => {
    const { valueFormatter } = returnOption(CAPITAL, colors).tooltip as { valueFormatter: (value: unknown) => string };
    expect(valueFormatter(0.01206)).toBe("1.2%");
    expect(valueFormatter(null)).toBe("—");
  });
});
```

- [x] **Step 2 : lancer les tests, vérifier qu'ils échouent**

Run: `pnpm --filter web test src/lib/format.test.ts src/lib/wheelCharts.test.ts`
Expected: FAIL — `formatRate` n'est pas exporté ; le module `@/lib/wheelCharts` est introuvable.

- [x] **Step 3 : implémenter**

Remplacer tout `apps/web/src/lib/chartColors.ts` par :

```ts
// Must stay in sync with the success/destructive/border/card tokens in src/index.css —
// ECharts renders to SVG directly and can't read CSS custom properties itself.
export interface ChartColors {
  success: string;
  destructive: string;
  track: string;
  foreground: string;
  /** The card behind the chart (`--card`): the gap between two pie slices. */
  surface: string;
  /**
   * Categorical hues in fixed order, never cycled: the dataviz reference palette, validated
   * against the card surface of each theme (spec of sub-project 13, §4.5).
   */
  series: readonly string[];
  /** A slice that folds several sectors together. */
  other: string;
}

export const CHART_COLORS: { light: ChartColors; dark: ChartColors } = {
  light: {
    success: "oklch(0.6 0.14 152)",
    destructive: "oklch(0.577 0.245 27.325)",
    track: "oklch(0.9 0.006 250)",
    foreground: "oklch(0.145 0.01 250)",
    surface: "oklch(1 0 0)",
    series: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"],
    other: "#898781",
  },
  dark: {
    success: "oklch(0.72 0.16 152)",
    destructive: "oklch(0.704 0.191 22.216)",
    track: "oklch(1 0 0 / 12%)",
    foreground: "oklch(0.96 0.003 250)",
    surface: "oklch(0.16 0.008 250)",
    series: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"],
    other: "#898781",
  },
};

export const CHART_FONT = "'Geist Mono Variable', ui-monospace, SFMono-Regular, monospace";

export function chartColors(isDark: boolean): ChartColors {
  return isDark ? CHART_COLORS.dark : CHART_COLORS.light;
}
```

Dans `apps/web/src/lib/format.ts`, juste après la fonction `formatPercent`, ajouter :

```ts
const RATE_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** A return: one decimal, where `formatPercent` rounds a gauge to the whole percent. */
export function formatRate(ratio: number): string {
  return RATE_FORMATTER.format(ratio);
}
```

Créer `apps/web/src/lib/wheelCharts.ts` :

```ts
import type { EChartsOption } from "echarts";
import type { WheelCapital, WheelExposure } from "@ib/ledger";
import { CHART_FONT, type ChartColors } from "@/lib/chartColors";
import { formatAmount, formatRate } from "@/lib/format";

/** A pie reads at a glance up to six slices: five named, the rest folded into Other. */
export const MAX_NAMED_SLICES = 5;

export interface SectorSlice {
  sector: string;
  assigned: number;
  putCash: number;
  total: number;
  /** total / the whole exposure */
  share: number;
  /** Past the fifth: drawn inside Other, still listed on its own in the legend table. */
  folded: boolean;
}

export interface CapitalSeriesNames {
  cumulativePnl: string;
  assigned: string;
  allocated: string;
  invested: string;
}

/** Order of the capital lines, which is also the order of their hues. */
const CAPITAL_SERIES = ["cumulativePnl", "assigned", "allocated", "invested"] as const;

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sectorSlices(exposure: readonly WheelExposure[], sectorOf: (ticker: string) => string | null, unclassified: string): SectorSlice[] {
  const groups = new Map<string, { assigned: number; putCash: number }>();
  for (const { ticker, assigned, putCash } of exposure) {
    const sector = sectorOf(ticker) ?? unclassified;
    const group = groups.get(sector) ?? { assigned: 0, putCash: 0 };
    group.assigned += assigned;
    group.putCash += putCash;
    groups.set(sector, group);
  }
  const whole = exposure.reduce((n, e) => n + e.assigned + e.putCash, 0);
  const sorted = [...groups.entries()]
    .map(([sector, { assigned, putCash }]) => ({ sector, assigned, putCash, total: assigned + putCash }))
    .sort((a, b) => b.total - a.total || compareNames(a.sector, b.sector));
  const folds = sorted.length > MAX_NAMED_SLICES;
  return sorted.map((slice, index) => ({ ...slice, share: whole === 0 ? 0 : slice.total / whole, folded: folds && index >= MAX_NAMED_SLICES }));
}

/** `index` is the slice's rank in `sectorSlices`; the named slices come first, so rank is hue. */
export function swatchColor(slice: SectorSlice, index: number, colors: ChartColors): string {
  return slice.folded ? colors.other : colors.series[index];
}

export function exposureOption(slices: readonly SectorSlice[], other: string, colors: ChartColors, currency: string): EChartsOption {
  const data = slices
    .filter((slice) => !slice.folded)
    .map((slice, index) => ({ name: slice.sector, value: slice.total, itemStyle: { color: colors.series[index] } }));
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

export function capitalOption(capital: WheelCapital, names: CapitalSeriesNames, colors: ChartColors): EChartsOption {
  return {
    textStyle: { fontFamily: CHART_FONT, color: colors.foreground },
    grid: { left: 64, right: 120, top: 40, bottom: 32 },
    legend: { top: 0, textStyle: { color: colors.foreground } },
    tooltip: {
      trigger: "axis",
      valueFormatter: (value: unknown) => `${typeof value === "number" ? formatAmount(value) : "—"} ${capital.currency}`,
    },
    xAxis: { type: "category", boundaryGap: false, data: capital.months.map((m) => m.month), axisLine: { lineStyle: { color: colors.track } } },
    yAxis: { type: "value", splitLine: { lineStyle: { color: colors.track } } },
    series: CAPITAL_SERIES.map((key, index) => ({
      type: "line" as const,
      name: names[key],
      smooth: true,
      showSymbol: false,
      color: colors.series[index],
      lineStyle: { width: 2 },
      endLabel: { show: true, formatter: "{a}", color: colors.foreground },
      data: capital.months.map((m) => m[key]),
    })),
  };
}

export function returnOption(capital: WheelCapital, colors: ChartColors): EChartsOption {
  return {
    textStyle: { fontFamily: CHART_FONT, color: colors.foreground },
    grid: { left: 56, right: 16, top: 16, bottom: 32 },
    tooltip: {
      trigger: "axis",
      valueFormatter: (value: unknown) => (typeof value === "number" ? formatRate(value) : "—"),
    },
    xAxis: { type: "category", boundaryGap: false, data: capital.months.map((m) => m.month), axisLine: { lineStyle: { color: colors.track } } },
    yAxis: { type: "value", axisLabel: { formatter: (value: number) => formatRate(value) }, splitLine: { lineStyle: { color: colors.track } } },
    series: [
      {
        type: "line",
        smooth: true,
        connectNulls: false,
        showSymbol: false,
        color: colors.series[0],
        lineStyle: { width: 2 },
        data: capital.months.map((m) => m.returnRate),
        markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: colors.track, width: 1, type: "solid" }, data: [{ yAxis: 0 }] },
      },
    ],
  };
}
```

- [x] **Step 4 : lancer les tests, le typage et le lint**

Run: `pnpm --filter web test src/lib && pnpm typecheck && pnpm lint`
Expected: PASS ; typage silencieux ; oxlint sans nouvel avertissement. Si `tsc` refuse un champ d'option ECharts, corriger le typage de ce champ (par exemple un `as const` sur un littéral de chaîne), jamais en typant le retour `any`.

- [x] **Step 5 : commit**

Cocher les cases de la tâche 4, puis :

```bash
git add apps/web/src/lib docs/plans/2026-09-11-capital-wheel.md
git commit -F - <<'EOF'
feat(web): options ECharts du capital de la Wheel, teintes catégorielles et format de rendement

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VABd1De1hBzffj365aJSXy
EOF
```

---

## Tâche 5 : trois cartes sur la page Statistiques Wheel

**Files:**
- Create: `apps/web/src/components/stats/WheelCapitalCards.tsx`
- Modify: `apps/web/src/pages/StatsPage.tsx`
- Modify: `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json` (bloc `stats`)
- Test: `apps/web/src/pages/StatsPage.test.tsx`

**Interfaces:**
- Consumes: `JournalsReport.wheelCapital` (tâche 3) ; `sectorSlices`, `swatchColor`, `exposureOption`, `capitalOption`, `returnOption`, `chartColors`, `formatAmount`, `formatRate` (tâche 4) ; `useAccountRiskReport().sectorOf`.
- Produces: `WheelCapitalCards({ capital: WheelCapital; sectorOf: (ticker: string) => string | null; isDark: boolean })`, trois `<Card>` avec `data-testid` `exposure-chart`, `capital-chart`, `return-chart`.

- [x] **Step 1 : écrire les tests qui échouent**

Dans `apps/web/src/pages/StatsPage.test.tsx` :

1. Remplacer le `beforeEach` par :

```ts
beforeEach(async () => {
  await Promise.all([db.transactions.clear(), db.snapshots.clear(), db.sectors.clear()]);
  await db.transactions.bulkAdd(SAMPLE_JOURNAL_TRANSACTIONS);
});
```

2. Juste avant `describe("StatsPage", …)`, ajouter :

```ts
/** An XOM 110 put sold on 2026-08-10, still open: 11,000 of cash beside the 3,400 of MQZA shares assigned. */
const XOM_PUT = {
  ...SAMPLE_JOURNAL_TRANSACTIONS[0],
  externalId: "flex:trade:301",
  symbol: "XOM   261016P00110000",
  strike: 110,
  expiry: "2026-10-16",
  quantity: -1,
  price: 1.2,
  amount: 120,
  when: "2026-08-10T14:30:00.000Z",
};

const ENERGY = { ticker: "XOM", name: "Exxon Mobil", category: "Energy", score: null, status: "off", importedAt: "2026-09-03T08:00:00.000Z" };
```

3. À la fin du `describe("StatsPage", …)`, ajouter :

```ts
  it("shows the Wheel's exposure by sector, a ticker the table does not know unclassified", async () => {
    await db.transactions.add(XOM_PUT);
    await db.sectors.add(ENERGY);
    renderStats("wheel");
    const card = (await screen.findByText("Exposition par secteur")).closest("[data-slot=card]") as HTMLElement;
    expect(within(card).getByTestId("exposure-chart")).toBeInTheDocument();
    // 11,000 of XOM put cash and 3,400 of MQZA shares assigned: 14,400 in all.
    const energy = within(card).getByRole("row", { name: /Energy/ });
    expect(within(energy).getAllByText("11,000.00")).toHaveLength(2);
    expect(within(energy).getByText("76.4%")).toBeInTheDocument();
    const unclassified = within(card).getByRole("row", { name: /Non classé/ });
    expect(within(unclassified).getAllByText("3,400.00")).toHaveLength(2);
    expect(within(unclassified).getByText("23.6%")).toBeInTheDocument();
    expect(screen.getByText("Capital de la stratégie")).toBeInTheDocument();
    expect(screen.getByTestId("capital-chart")).toBeInTheDocument();
    expect(screen.getByText("Rendement mensuel")).toBeInTheDocument();
    expect(screen.getByTestId("return-chart")).toBeInTheDocument();
  });

  it("says the Wheel holds nothing once its shares are sold, the capital still drawn", async () => {
    await db.transactions.add({ ...SAMPLE_JOURNAL_TRANSACTIONS[2], externalId: "flex:trade:302", quantity: -200, price: 18, amount: 3600, commission: -1, when: "2026-08-25T15:00:00.000Z" });
    renderStats("wheel");
    expect(await screen.findByText("Aucune position Wheel ouverte.")).toBeInTheDocument();
    expect(screen.queryByTestId("exposure-chart")).not.toBeInTheDocument();
    expect(screen.getByTestId("capital-chart")).toBeInTheDocument();
  });

  it("draws none of the Wheel's money charts on another strategy", async () => {
    renderStats("leaps");
    expect(await screen.findByText("49.00 USD")).toBeInTheDocument();
    expect(screen.queryByText("Exposition par secteur")).not.toBeInTheDocument();
    expect(screen.queryByTestId("capital-chart")).not.toBeInTheDocument();
    expect(screen.queryByTestId("return-chart")).not.toBeInTheDocument();
  });
```

- [x] **Step 2 : lancer les tests, vérifier qu'ils échouent**

Run: `pnpm --filter web test src/pages/StatsPage.test.tsx`
Expected: FAIL — « Unable to find an element with the text: Exposition par secteur » et « Aucune position Wheel ouverte. » ; le test LEAPS passe déjà.

- [x] **Step 3 : implémenter**

Dans `apps/web/src/i18n/fr.json`, bloc `stats`, remplacer `"empty": "Aucune donnée pour cette stratégie."` par :

```json
    "empty": "Aucune donnée pour cette stratégie.",
    "exposure": {
      "title": "Exposition par secteur",
      "empty": "Aucune position Wheel ouverte.",
      "sector": "Secteur",
      "assigned": "Assigné",
      "putCash": "Couverture des puts",
      "total": "Total",
      "share": "Part",
      "unclassified": "Non classé",
      "other": "Autres"
    },
    "capital": {
      "title": "Capital de la stratégie",
      "cumulativePnl": "Cumul des profits/pertes",
      "assigned": "Assigné",
      "allocated": "Alloué",
      "invested": "Cash investi"
    },
    "return": {
      "title": "Rendement mensuel"
    }
```

Dans `apps/web/src/i18n/en.json`, bloc `stats`, remplacer `"empty": "No data for this strategy."` par :

```json
    "empty": "No data for this strategy.",
    "exposure": {
      "title": "Exposure by sector",
      "empty": "No open Wheel position.",
      "sector": "Sector",
      "assigned": "Assigned",
      "putCash": "Put coverage",
      "total": "Total",
      "share": "Share",
      "unclassified": "Unclassified",
      "other": "Other"
    },
    "capital": {
      "title": "Strategy capital",
      "cumulativePnl": "Cumulative P/L",
      "assigned": "Assigned",
      "allocated": "Allocated",
      "invested": "Cash invested"
    },
    "return": {
      "title": "Monthly return"
    }
```

Créer `apps/web/src/components/stats/WheelCapitalCards.tsx` :

```tsx
import ReactECharts from "echarts-for-react";
import { useTranslation } from "react-i18next";
import type { WheelCapital } from "@ib/ledger";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ib/ui/table";
import { chartColors } from "@/lib/chartColors";
import { formatAmount, formatRate } from "@/lib/format";
import { capitalOption, exposureOption, returnOption, sectorSlices, swatchColor } from "@/lib/wheelCharts";

interface WheelCapitalCardsProps {
  capital: WheelCapital;
  sectorOf: (ticker: string) => string | null;
  isDark: boolean;
}

/**
 * The Wheel's money (spec of sub-project 13, §4): what it ties up per sector now, its capital
 * month by month, and its monthly return on that capital.
 */
export function WheelCapitalCards({ capital, sectorOf, isDark }: WheelCapitalCardsProps) {
  const { t } = useTranslation();
  const colors = chartColors(isDark);
  const slices = sectorSlices(capital.exposure, sectorOf, t("stats.exposure.unclassified"));
  const names = {
    cumulativePnl: t("stats.capital.cumulativePnl"),
    assigned: t("stats.capital.assigned"),
    allocated: t("stats.capital.allocated"),
    invested: t("stats.capital.invested"),
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("stats.exposure.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {slices.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("stats.exposure.empty")}</p>
          ) : (
            <div className="grid items-center gap-4 md:grid-cols-2">
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
                    <TableHead className="text-right">{t("stats.exposure.assigned")}</TableHead>
                    <TableHead className="text-right">{t("stats.exposure.putCash")}</TableHead>
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
                      <TableCell className="text-right font-mono tabular-nums">{formatAmount(slice.assigned)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatAmount(slice.putCash)}</TableCell>
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
      <Card>
        <CardHeader>
          <CardTitle>{t("stats.capital.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div data-testid="capital-chart" className="w-full">
            <ReactECharts option={capitalOption(capital, names, colors)} opts={{ renderer: "svg" }} style={{ height: 300, width: "100%" }} />
          </div>
          {capital.incomplete > 0 && <p className="text-xs text-muted-foreground">{t("stats.incomplete", { count: capital.incomplete })}</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("stats.return.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div data-testid="return-chart" className="w-full">
            <ReactECharts option={returnOption(capital, colors)} opts={{ renderer: "svg" }} style={{ height: 260, width: "100%" }} />
          </div>
        </CardContent>
      </Card>
    </>
  );
}
```

Dans `apps/web/src/pages/StatsPage.tsx` :

1. Remplacer l'import `import { useAccountJournals } from "@/db/AccountDataProvider";` par :

```tsx
import { WheelCapitalCards } from "@/components/stats/WheelCapitalCards";
import { useAccountJournals, useAccountRiskReport } from "@/db/AccountDataProvider";
```

2. Juste après `const view = useAccountJournals();`, ajouter :

```tsx
  const { sectorOf } = useAccountRiskReport();
```

3. Juste après `const stats: StrategyStats | undefined = all.find((s) => s.currency === chosen) ?? all[0];`, ajouter :

```tsx
  const capital = strategy === "wheel" && stats ? view.report.wheelCapital.find((c) => c.currency === stats.currency) : undefined;
```

4. Dans le fragment `<>…</>`, juste après la carte qui contient `<MonthlyChart stats={stats} isDark={isDark} />` (après son `</Card>`), ajouter :

```tsx
          {capital && <WheelCapitalCards capital={capital} sectorOf={sectorOf} isDark={isDark} />}
```

- [x] **Step 4 : lancer les tests, le typage et le lint**

Run: `pnpm --filter web test && pnpm typecheck && pnpm lint`
Expected: PASS ; typage silencieux ; oxlint sans nouvel avertissement.

- [x] **Step 5 : commit**

Cocher les cases de la tâche 5, puis :

```bash
git add apps/web/src docs/plans/2026-09-11-capital-wheel.md
git commit -F - <<'EOF'
feat(web): exposition par secteur, capital et rendement mensuel sur la page Statistiques Wheel

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VABd1De1hBzffj365aJSXy
EOF
```

---

## Tâche 6 : graine, vérification dans la vraie application, documentation, revue, merge

**Files:**
- Modify: `apps/web/src/mocks/journals.ts`, `apps/web/src/mocks/seed.ts`, `apps/web/src/mocks/seed.test.ts`
- Modify: `CLAUDE.md`, `docs/specs/2026-09-11-capital-wheel-design.md`, `docs/points-reportes.md` (si la revue reporte quelque chose)

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: `DEMO_WHEEL_TRANSACTIONS: Transaction[]`, `DEMO_WHEEL_POSITIONS: Position[]`, `DEMO_WHEEL_SECTORS: SectorRecord[]` dans `mocks/journals.ts`.

- [x] **Step 1 : écrire le test de graine qui échoue**

Dans `apps/web/src/mocks/seed.test.ts`, remplacer l'import `import { anchoredBalances } from "@ib/ledger";` par :

```ts
import { anchoredBalances, buildJournals } from "@ib/ledger";
```

et ajouter dans le `describe("seedDemo", …)` :

```ts
  it("seeds on beta a Wheel that matches its snapshot: an open put beside assigned shares, in two sectors", async () => {
    await seedDemo();
    const ledger = await db.transactions.where("accountId").equals("beta").toArray();
    const snapshot = await db.snapshots.where("accountId").equals("beta").first();
    const report = buildJournals(ledger, snapshot ? { asOf: snapshot.asOf, positions: snapshot.positions } : undefined);
    expect(report.reconciliation.differences).toEqual([]);
    expect(report.wheelCapital[0].exposure).toEqual([
      { ticker: "MQZA", assigned: 3400, putCash: 0 },
      { ticker: "XOM", assigned: 0, putCash: 11000 },
    ]);
    const sectors = await db.sectors.bulkGet(["MQZA", "XOM"]);
    expect(sectors.map((s) => s?.category)).toEqual(["Crypto", "Energy"]);
  });
```

Run: `pnpm --filter web test src/mocks/seed.test.ts`
Expected: FAIL — `exposure` ne contient que MQZA, et le secteur de MQZA est `undefined`.

- [x] **Step 2 : la graine**

Dans `apps/web/src/mocks/journals.ts` :

1. Remplacer `import type { SnapshotRecord } from "@/db/schema";` par `import type { SectorRecord, SnapshotRecord } from "@/db/schema";`.
2. Après `const SPY = …`, ajouter `const XOM_PUT = { symbol: "XOM   261016P00110000", right: "P" as const, strike: 110, expiry: "2026-10-16" };`.
3. À la fin du fichier, ajouter :

```ts
/**
 * Demo only, never in the tests' ledger: an XOM put still open, so the Wheel statistics show put
 * cash beside the assigned MQZA shares, and a sector for MQZA, so the exposure pie has two.
 */
export const DEMO_WHEEL_TRANSACTIONS: Transaction[] = [
  trade({ externalId: "flex:trade:117", ...XOM_PUT, quantity: -1, price: 1.2, amount: 120, when: "2026-08-10T14:30:00.000Z" }),
];

export const DEMO_WHEEL_POSITIONS: Position[] = [
  position({ symbol: "XOM", right: "P", strike: 110, expiry: "2026-10-16", quantity: -1, description: "XOM 16OCT26 110 P" }),
];

export const DEMO_WHEEL_SECTORS: SectorRecord[] = [
  { ticker: "MQZA", name: "MQZA Holdings", category: "Crypto", score: null, status: "on", importedAt: "2026-09-03T08:00:00.000Z" },
];
```

Dans `apps/web/src/mocks/seed.ts` :

1. Remplacer l'import de `@/mocks/journals` par :

```ts
import { DEMO_WHEEL_POSITIONS, DEMO_WHEEL_SECTORS, DEMO_WHEEL_TRANSACTIONS, SAMPLE_JOURNAL_SNAPSHOT, SAMPLE_JOURNAL_TRANSACTIONS } from "@/mocks/journals";
```

2. Remplacer le corps de `seedDemo` par :

```ts
  const beta = [...SAMPLE_JOURNAL_TRANSACTIONS, ...DEMO_WHEEL_TRANSACTIONS];
  await seedAccounts();
  await db.transactions.bulkPut(SAMPLE_TRANSACTIONS);
  await db.snapshots.put(SAMPLE_SNAPSHOT);
  await db.sectors.bulkPut([...SAMPLE_SECTORS, ...DEMO_WHEEL_SECTORS]);
  await db.transactions.bulkPut(beta);
  await db.snapshots.put({ ...SAMPLE_JOURNAL_SNAPSHOT, positions: [...SAMPLE_JOURNAL_SNAPSHOT.positions, ...DEMO_WHEEL_POSITIONS] });
  await db.cashPoints.bulkPut([...demoCashPoints("alpha", SAMPLE_TRANSACTIONS), ...demoCashPoints("beta", beta)]);
```

3. Dans le commentaire de `seedDemo`, remplacer « on `beta` a Wheel cycle, a covered LEAPS and a condor » par « on `beta` a Wheel cycle with a put still open, a covered LEAPS and a condor ».

Run: `pnpm --filter web test`
Expected: PASS, `seed.test.ts` compris.

Commit (cocher les steps 1 et 2) :

```bash
git add apps/web/src/mocks docs/plans/2026-09-11-capital-wheel.md
git commit -F - <<'EOF'
feat(web): la graine beta montre un put Wheel ouvert et deux secteurs

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VABd1De1hBzffj365aJSXy
EOF
```

- [x] **Step 3 : `pnpm check`**

Run: `pnpm check`
Expected: lint, typecheck, `check:api-types`, build et tous les Vitest verts. Un échec s'examine avec `superpowers:systematic-debugging`, jamais par un contournement.

- [x] **Step 4 : captures**

Le worktree a son propre port Vite (`tools/dev-env/ports.mjs`) : le driver démarre son serveur au lieu de réutiliser celui de la racine. Lire sa ligne `dev-env: worktree capital-wheel → web :…`.

```bash
SHOTS=/tmp/ib-frontend-shots/capital-wheel
node .claude/skills/run-frontend/driver.mjs /accounts/beta/stats/wheel /accounts/beta/stats/leaps --seed --height=2000 --out=$SHOTS/seed
node .claude/skills/run-frontend/driver.mjs /accounts/beta/stats/wheel --seed --dark --height=2000 --out=$SHOTS/dark
node .claude/skills/run-frontend/driver.mjs /accounts/beta/stats/wheel --seed --width=400 --height=2600 --out=$SHOTS/narrow
```

Lire chaque PNG avec l'outil Read et vérifier :
- `seed/accounts-beta-stats-wheel.png` : sous « Profits/pertes mensuels », la carte « Exposition par secteur » avec deux parts, Energy (bleu, 11,000.00, 76.4%) et Crypto (orange, 3,400.00, 23.6%), et son tableau à côté ; « Capital de la stratégie » sur 2026-06 → 2026-08, quatre courbes lissées nommées en bout de ligne, Alloué 3,400 → 3,400 → 14,400, Cumul 41 → 140 → 259, Cash investi 3,359 → 3,260 → 14,141 ; « Rendement mensuel » à 1.2 %, 2.9 %, 0.8 % au-dessus d'une ligne de base à 0 ; la barre de titre garde Reconstitution en vert ;
- `seed/accounts-beta-stats-leaps.png` : aucune des trois cartes ;
- `dark/…` : parts, courbes, étiquettes et tableau lisibles en thème sombre ;
- `narrow/…` : à 400 px, le tableau passe sous le camembert, les étiquettes de fin de courbe ne sortent pas de la carte, rien ne déborde horizontalement.

Si le driver échoue (délai `networkidle`, Chromium manquant), s'arrêter et le signaler avec sa sortie ; ne pas modifier le driver.

- [x] **Step 5 : `CLAUDE.md` et le spec**

Dans `CLAUDE.md` :

1. Tableau des sous-projets, ajouter après la ligne du 12 :

```markdown
| 13 | Capital et exposition de la Wheel | livré (2026-09-11), en attente de merge |
```

2. Après la règle « **Les journaux sont une vue calculée du ledger, jamais stockée** … », ajouter :

```markdown
- **Le capital de la Wheel se mesure au prix d'entrée, jamais à la valeur de marché** :
  `computeWheelCapital` (`packages/ledger/src/journals/capital.ts`) compte une action au
  `openPrice` de sa ligne — le strike du put qui l'a livrée ou du call qui l'a reprise — et un
  put vendu à `strike × DEFAULT_MULTIPLIER × |quantité|`. Une ligne est ouverte en fin de mois
  selon `startWhen` et `endWhen`, **jamais selon `ongoing`** : un put assigné reste `ongoing`
  tant que ses actions ne sont pas vendues, le lire ouvert compterait deux fois le même argent.
  Ses mois sont ceux de `StrategyStats`, qui courent jusqu'à la dernière transaction du compte.
```

Dans `docs/specs/2026-09-11-capital-wheel-design.md` :
- remplacer `Statut : spec (2026-09-11).` par `Statut : implémenté (2026-09-11).` ;
- au §4.3, remplacer « Infobulle d'axe : `formatPercent`, « — » pour un mois sans rendement. » par « Infobulle d'axe : `formatRate` (une décimale), « — » pour un mois sans rendement. ».

Commit :

```bash
git add CLAUDE.md docs
git commit -F - <<'EOF'
docs: sous-projet 13 livré, règle du capital de la Wheel

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VABd1De1hBzffj365aJSXy
EOF
```

- [x] **Step 6 : revue de branche**

Invoquer `superpowers:requesting-code-review` sur la branche `capital-wheel` contre `main`, avec ce plan et le spec. Corriger chaque constat retenu (TDD, un commit par correction). Un constat jugé non bloquant et reporté délibérément s'écrit dans `docs/points-reportes.md`, sous un titre `## Reporté par le sous-projet 13 (capital de la Wheel)` inséré avant `## Sans échéance`, avec la raison du report. Relancer `pnpm check` après les corrections.

- [x] **Step 7 : merge**

Cocher les cases de la tâche 6 dans le dernier commit de la branche, puis invoquer `superpowers:finishing-a-development-branch`. Après le merge sur `main`, dans `CLAUDE.md`, la ligne du 13 devient `| 13 | Capital et exposition de la Wheel | fait (2026-09-11) |`, puis :

```bash
git add CLAUDE.md
git commit -F - <<'EOF'
docs: sous-projet 13 mergé sur main

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VABd1De1hBzffj365aJSXy
EOF
```
