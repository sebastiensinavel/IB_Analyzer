# Décision de rachat dans le temps — plan d'implémentation (sous-projet 38)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** « buy back » n'est proposé que si C ≤ S × min(½, r/T), et le badge de décision porte une infobulle « Rachat rentable sous 0.42 USD : 12 j restants sur 30 ».

**Architecture:** une fonction pure `evaluateBuyback` dans `packages/coverage/src/buyback.ts` rend un avis (`BuybackAdvice`) ; `analyze`/`buildRiskReport`, `strategyPositions` et `condorPositions` la nourrissent d'une date moyenne de vente lue dans les journaux et de l'`asOf` du snapshot ; `apps/web` passe la table des dates de vente au rapport de risque depuis `AccountDataProvider` et rend l'infobulle par un composant `DecisionBadge`.

**Tech Stack:** TypeScript / Vitest (`packages/coverage`), React 19 / Dexie / base-ui / i18next (`apps/web`, Vitest + `fake-indexeddb`).

**Spec:** `docs/specs/2026-09-28-decision-rachat-design.md`

## Global Constraints

- Worktree `.claude/worktrees/decision-rachat`, branche `decision-rachat` ; toutes les commandes s'y lancent.
- Règle : **racheter si C ≤ S × min(½, r / T)**, S et C en valeur absolue ; ½ = `1 / BUYBACK_RATIO`, jamais recodé.
- Temps en jours calendaires fractionnaires (`86_400_000` ms). Échéance `YYYY-MM-DD` = `${expiry}T16:00:00.000Z` ; un `asOf` réduit à un jour vaut de même 16:00 ce jour-là. Toutes les dates sont l'heure de New York stampée UTC : **aucune conversion de fuseau**.
- r ≤ 0 → `keep`, seuil 0. T ≤ 0, ou asOf antérieur à la vente, ou une date manquante/illisible → seule règle des 50 %, jours `null`. S ≤ 0 → `keep`, seuil 0, jours `null`.
- Pas de plancher de fin de vie, pas de commission.
- `decision: "buy back" | "keep" | null` reste sur `AnalyzedPosition`, `StrategyLine`, `CondorLine` (tri et filtre le lisent) ; `buyback: BuybackAdvice | null` s'ajoute à côté, non nul exactement quand `decision` l'est, et `decision === buyback?.decision`.
- Rien n'est stocké : ni Dexie, ni `localStorage`, ni serveur. `apps/api` n'est pas touché.
- Infobulles — fr : « Rachat rentable sous {{price}} : {{remaining}} j restants sur {{total}} » / « Rachat rentable sous {{price}} : 50 % de la prime » ; en : « Buy back pays below {{price}}: {{remaining}} d left of {{total}} » / « Buy back pays below {{price}}: 50% of the premium ». `price` = `` `${formatPrice(threshold)} ${currency}` ``, jours `Math.round`.
- `pnpm check` une seule fois à la fin (tâche 4) ; pendant l'itération `npx vitest run <motif>` depuis le paquet (`packages/coverage` ou `apps/web`).
- Chaque tâche coche ses cases dans ce fichier, dans le même commit que son code. Commits en français, terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Snapshot de fin de journée le jour de l'échéance, option à 0** : r = 0 → « keep », jamais « buy back » — test tâche 1.
2. **`positions.map(analyze)` passerait l'index en second argument** une fois `analyze` doté d'un paramètre optionnel : `buildRiskReport` sans table doit rester la règle des 50 % — test tâche 1.
3. **Journaux en cours de chargement** : la page Positions affiche la règle des 50 % puis les jours, sans erreur — test tâche 3.
4. **Jambe de condor sur la page Positions** : sa date vient de la jambe du journal (les composites sont aplatis) — test tâche 1.
5. **Ligne d'Autres faite de contrats migrés** : sa date moyenne est celle des lignes de la stratégie d'origine — test tâche 2.

---

### Task 0: Worktree

- [x] **Step 1:** depuis la racine, sur `main` propre : `git worktree add .claude/worktrees/decision-rachat -b decision-rachat`
- [x] **Step 2:** `cd .claude/worktrees/decision-rachat && pnpm install --frozen-lockfile`
- [x] **Step 3:** `cd packages/coverage && npx vitest run` → PASS (base saine).

---

### Task 1: Le moteur de l'avis et le rapport de risque

**Files:**
- Create: `packages/coverage/src/buyback.ts`, `packages/coverage/src/buyback.test.ts`
- Modify: `packages/coverage/src/classify.ts` (retirer `evaluateBuyback`, `analyze` prend `sales`), `packages/coverage/src/types.ts` (`AnalyzedPosition.buyback`), `packages/coverage/src/report.ts`, `packages/coverage/src/index.ts`, `packages/coverage/src/analyze.test.ts`, `packages/coverage/src/report.test.ts`

**Interfaces:**
- Produces (exportés par `@ib/coverage`) :
  ```ts
  interface BuybackAdvice { decision: "buy back" | "keep"; threshold: number; remainingDays: number | null; totalDays: number | null }
  interface BuybackTiming { soldAt: string; expiry: string; asOf: string }
  interface SaleTiming { asOf: string; soldAt: ReadonlyMap<string, string> }   // contractId → date moyenne de vente
  function evaluateBuyback(salePrice: number, currentPrice: number, timing: BuybackTiming | null): BuybackAdvice
  function averageSaleInstant(parts: readonly { when: string; quantity: number }[]): string | null
  function saleInstants(rows: readonly JournalRow[]): Map<string, string>
  function analyze(pos: Position, sales?: SaleTiming | null): AnalyzedPosition
  function buildRiskReport(positions: readonly Position[], cashAvailable: number | null, sales?: SaleTiming | null): RiskReport
  // AnalyzedPosition gagne : buyback: BuybackAdvice | null
  ```

- [x] **Step 1: Écrire les tests qui échouent** — `packages/coverage/src/buyback.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { JournalRow } from "@ib/ledger";
import { averageSaleInstant, evaluateBuyback, saleInstants } from "./buyback.ts";

// Sold 2026-09-01 16:00, expiry 2026-10-01 16:00: T = 30 days.
const timing = (asOf: string) => ({ soldAt: "2026-09-01T16:00:00.000Z", expiry: "2026-10-01", asOf });

describe("evaluateBuyback", () => {
  it("with 10 days left of 30, a 30 sale buys back at 10 and no higher", () => {
    const at = "2026-09-21T16:00:00.000Z";
    expect(evaluateBuyback(30, 10, timing(at))).toEqual({ decision: "buy back", threshold: 10, remainingDays: 10, totalDays: 30 });
    expect(evaluateBuyback(30, 10.01, timing(at)).decision).toBe("keep");
  });

  it("keeps 40% of the premium at 3 days from expiry", () => {
    const advice = evaluateBuyback(30, 12, timing("2026-09-28T16:00:00.000Z"));
    expect(advice.decision).toBe("keep");
    expect(advice.threshold).toBeCloseTo(3, 10);
  });

  it("caps the threshold at half the sale in the first half of the life", () => {
    const advice = evaluateBuyback(30, 15, timing("2026-09-06T16:00:00.000Z")); // 25 days left
    expect(advice).toEqual({ decision: "buy back", threshold: 15, remainingDays: 25, totalDays: 30 });
  });

  it("switches to the time rule at mid-life", () => {
    expect(evaluateBuyback(30, 15, timing("2026-09-16T16:00:00.000Z")).threshold).toBe(15);
    expect(evaluateBuyback(30, 15, timing("2026-09-17T16:00:00.000Z")).decision).toBe("keep");
  });

  it("reads a day-only asOf as that day's 16:00 close", () => {
    expect(evaluateBuyback(30, 10, timing("2026-09-21"))).toEqual({ decision: "buy back", threshold: 10, remainingDays: 10, totalDays: 30 });
  });

  it("keeps an option expired at the price's instant, even at 0", () => {
    expect(evaluateBuyback(30, 0, timing("2026-10-01"))).toEqual({ decision: "keep", threshold: 0, remainingDays: 0, totalDays: 30 });
    expect(evaluateBuyback(30, 0, timing("2026-10-02")).decision).toBe("keep");
  });

  it("falls back to the 50% rule without timing, or with incoherent dates", () => {
    const half = { decision: "buy back", threshold: 15, remainingDays: null, totalDays: null };
    expect(evaluateBuyback(30, 15, null)).toEqual(half);
    expect(evaluateBuyback(30, 15, { soldAt: "2026-10-02T10:00:00.000Z", expiry: "2026-10-01", asOf: "2026-10-01" })).toEqual(half); // T <= 0
    expect(evaluateBuyback(30, 15, timing("2026-08-30T10:00:00.000Z"))).toEqual(half); // asOf before the sale
    expect(evaluateBuyback(30, 15, { soldAt: "nonsense", expiry: "2026-10-01", asOf: "2026-09-21" })).toEqual(half);
  });

  it("uses absolute prices and keeps a zero sale", () => {
    expect(evaluateBuyback(-30, -10, timing("2026-09-21T16:00:00.000Z")).decision).toBe("buy back");
    expect(evaluateBuyback(0, 0, null)).toEqual({ decision: "keep", threshold: 0, remainingDays: null, totalDays: null });
  });
});

describe("averageSaleInstant", () => {
  it("weights each sale by its unsigned quantity", () => {
    expect(
      averageSaleInstant([
        { when: "2026-09-01T00:00:00.000Z", quantity: -1 },
        { when: "2026-09-05T00:00:00.000Z", quantity: -3 },
      ]),
    ).toBe("2026-09-04T00:00:00.000Z");
  });

  it("is null for nothing to weigh", () => {
    expect(averageSaleInstant([])).toBeNull();
    expect(averageSaleInstant([{ when: "2026-09-01T00:00:00.000Z", quantity: 0 }])).toBeNull();
  });
});

describe("saleInstants", () => {
  const contract = (right: "C" | "P", strike: number) => ({ ticker: "SPY", secType: "OPT", right, strike, expiry: "2026-10-16", currency: "USD" });
  const row = (over: Partial<JournalRow>): JournalRow =>
    ({ id: "r", strategy: "wheel", kind: "short_put", ticker: "SPY", label: "", currency: "USD", contract: contract("P", 600),
       startWhen: "2026-09-01T10:00:00.000Z", quantity: -1, strike: 600, openPrice: 1, openTotal: null, openCommission: null,
       openNet: null, assigned: false, endWhen: null, closePrice: null, closeTotal: null, closeCommission: null, closeNet: null,
       pnl: null, ongoing: true, event: null, orphan: false, note: null, openIds: [], closeIds: [], ...over }) as JournalRow;

  it("averages the open sold option lines of every strategy by contract", () => {
    const map = saleInstants([
      row({ id: "a", strategy: "wheel", startWhen: "2026-09-01T00:00:00.000Z", quantity: -1 }),
      row({ id: "b", strategy: "others", startWhen: "2026-09-03T00:00:00.000Z", quantity: -1 }),
      row({ id: "closed", endWhen: "2026-09-02T00:00:00.000Z", startWhen: "2026-08-01T00:00:00.000Z" }),
      row({ id: "long", kind: "long_call", contract: contract("C", 700), quantity: 1 }),
    ]);
    expect([...map.entries()]).toEqual([[expect.any(String), "2026-09-02T00:00:00.000Z"]]);
  });

  it("reads a condor's sold legs, never its composite", () => {
    const leg = row({ id: "leg", strategy: "condors", kind: "short_call", contract: contract("C", 660), startWhen: "2026-09-10T00:00:00.000Z" });
    const composite = row({ id: "ic", strategy: "condors", kind: "condor", contract: { ...contract("C", 0), right: "", strike: null }, legs: [leg] });
    expect([...saleInstants([composite]).values()]).toEqual(["2026-09-10T00:00:00.000Z"]);
  });
});
```

Dans `analyze.test.ts`, les appels `evaluateBuyback(sale, current)` deviennent `evaluateBuyback(sale, current, null).decision` (import depuis `./buyback.ts`), sans rien changer à leurs attentes. Ajouter dans `report.test.ts` :

```ts
it("dates a short option from the sale table, and keeps the 50% rule without it", () => {
  const put = /* reprendre la fabrique de position du fichier : un short_put SPY 2026-10-01 P 600,
                 quantity -1, avgPrice 30, marketPrice 12 */;
  const id = contractId(contractOf(put));
  const dated = buildRiskReport([put], 0, { asOf: "2026-09-28T16:00:00.000Z", soldAt: new Map([[id, "2026-09-01T16:00:00.000Z"]]) });
  expect(dated.positions[0].decision).toBe("keep");
  expect(dated.positions[0].buyback).toMatchObject({ remainingDays: 3, totalDays: 30 });
  const plain = buildRiskReport([put], 0);
  expect(plain.positions[0].decision).toBe("buy back");
  expect(plain.positions[0].buyback).toEqual({ decision: "buy back", threshold: 15, remainingDays: null, totalDays: null });
});
```

(`contractId`, `contractOf` s'importent de `@ib/ledger`. Utiliser la fabrique de positions déjà présente dans `report.test.ts` ou `analyze.test.ts`.)

- [x] **Step 2:** `cd packages/coverage && npx vitest run buyback report analyze` → FAIL (`./buyback.ts` introuvable).

- [x] **Step 3: Implémenter** — `packages/coverage/src/buyback.ts` :

```ts
import { contractId, type JournalRow } from "@ib/ledger";
import { BUYBACK_RATIO } from "./constants.ts";

/** What the Décision column says of a sold option, and why (spec of sub-project 38, §3). */
export interface BuybackAdvice {
  decision: "buy back" | "keep";
  /** Per-unit buyback price at or under which buying back pays: S × min(½, r/T), or S / 2 without the time. */
  threshold: number;
  /** Days left and total life, fractional; `null` when the time rule could not apply. */
  remainingDays: number | null;
  totalDays: number | null;
}

/** New York wall clock stamped UTC, like every IB time (IB_REPORT_TIME_ZONE). */
export interface BuybackTiming {
  /** The quantity-weighted average sale instant. */
  soldAt: string;
  /** YYYY-MM-DD; the option expires at 16:00 that day. */
  expiry: string;
  /** The instant the current price was read: the snapshot's asOf, an instant or a day (its 16:00 close). */
  asOf: string;
}

/** The snapshot's instant and the average sale instant of each contract, keyed by `contractId`. */
export interface SaleTiming {
  asOf: string;
  soldAt: ReadonlyMap<string, string>;
}

const DAY_MS = 86_400_000;
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** An expiry, or a day-only asOf, counts at the 16:00 New York close. */
const CLOSE = "T16:00:00.000Z";

const instantOf = (value: string): number => Date.parse(DAY_ONLY.test(value) ? `${value}${CLOSE}` : value);

function lifeOf({ soldAt, expiry, asOf }: BuybackTiming): { remaining: number; total: number } | null {
  const sold = instantOf(soldAt);
  const end = instantOf(expiry);
  const now = instantOf(asOf);
  if (Number.isNaN(sold) || Number.isNaN(end) || Number.isNaN(now)) return null;
  // A sale at or after expiry, or a price read before the sale: incoherent, the time says nothing.
  if (end <= sold || now < sold) return null;
  return { remaining: Math.max(0, (end - now) / DAY_MS), total: (end - sold) / DAY_MS };
}

/**
 * "buy back" when C <= S × min(½, r/T) (spec of sub-project 38, §1): the premium captured runs
 * ahead of the time elapsed — equivalently, what is left earns less per day than the sale did.
 * Without the time, the 50% rule alone. An option expired at the price's instant is kept: there
 * is nothing left to buy back.
 */
export function evaluateBuyback(salePrice: number, currentPrice: number, timing: BuybackTiming | null): BuybackAdvice {
  const sale = Math.abs(salePrice);
  const current = Math.abs(currentPrice);
  if (sale <= 0) return { decision: "keep", threshold: 0, remainingDays: null, totalDays: null };
  const half = sale / BUYBACK_RATIO;
  const life = timing ? lifeOf(timing) : null;
  if (!life) return { decision: current <= half ? "buy back" : "keep", threshold: half, remainingDays: null, totalDays: null };
  if (life.remaining <= 0) return { decision: "keep", threshold: 0, remainingDays: 0, totalDays: life.total };
  const threshold = Math.min(half, (sale * life.remaining) / life.total);
  return { decision: current <= threshold ? "buy back" : "keep", threshold, remainingDays: life.remaining, totalDays: life.total };
}

/** Σ instant × |quantity| ÷ Σ |quantity|, ISO; `null` when nothing weighs. */
export function averageSaleInstant(parts: readonly { when: string; quantity: number }[]): string | null {
  let weight = 0;
  let total = 0;
  for (const part of parts) {
    const w = Math.abs(part.quantity);
    if (w === 0) continue;
    weight += w;
    total += Date.parse(part.when) * w;
  }
  return weight === 0 ? null : new Date(Math.round(total / weight)).toISOString();
}

const SOLD_OPTION_KINDS = new Set(["short_put", "short_call"]);

/**
 * The average sale instant of every contract still sold open in the journals, every strategy
 * together, Others included: what the Positions page dates its IB positions with. A condor is
 * read on its legs, never on its composite, which has neither right nor strike.
 */
export function saleInstants(rows: readonly JournalRow[]): Map<string, string> {
  const byContract = new Map<string, { when: string; quantity: number }[]>();
  for (const row of rows.flatMap((r) => r.legs ?? [r])) {
    if (row.endWhen !== null || row.quantity === null || row.quantity >= 0 || !SOLD_OPTION_KINDS.has(row.kind)) continue;
    const id = contractId(row.contract);
    byContract.set(id, [...(byContract.get(id) ?? []), { when: row.startWhen, quantity: row.quantity }]);
  }
  const instants = new Map<string, string>();
  for (const [id, parts] of byContract) {
    const at = averageSaleInstant(parts);
    if (at !== null) instants.set(id, at);
  }
  return instants;
}
```

Dans `classify.ts` : supprimer `evaluateBuyback` et l'import de `BUYBACK_RATIO` ; importer `evaluateBuyback, type BuybackTiming, type SaleTiming` depuis `./buyback.ts` et `contractId, contractOf` depuis `@ib/ledger` ; puis :

```ts
/** The time a short option has run, from the sale table; `null` when anything is missing. */
function timingOf(pos: Position, sales: SaleTiming | null): BuybackTiming | null {
  if (!sales || !pos.expiry) return null;
  const soldAt = sales.soldAt.get(contractId(contractOf(pos)));
  return soldAt ? { soldAt, expiry: pos.expiry, asOf: sales.asOf } : null;
}

export function analyze(pos: Position, sales: SaleTiming | null = null): AnalyzedPosition {
  ...
  // An unknown sale price counts as 0 for the rule only: sale 0 -> "keep". An unknown current
  // price makes the decision itself unknown: never fabricate a "buy back" from a missing markPrice.
  const buyback =
    action === "to evaluate" && pos.marketPrice !== null ? evaluateBuyback(pos.avgPrice ?? 0, pos.marketPrice, timingOf(pos, sales)) : null;
  return { ..., decision: buyback?.decision ?? null, buyback, ... };
}
```

Dans `types.ts`, `AnalyzedPosition` gagne, sous `decision` : `/** Why the decision: its threshold and the days it was measured on (spec of sub-project 38). */ buyback: BuybackAdvice | null;` (import type depuis `./buyback.ts`). Dans `report.ts` :

```ts
export function buildRiskReport(positions: readonly Position[], cashAvailable: number | null, sales: SaleTiming | null = null): RiskReport {
  // Never `positions.map(analyze)`: map would hand the index to `sales`.
  const analyzed = positions.map((position) => analyze(position, sales));
```

Dans `index.ts` : `export * from "./buyback.ts";`. Toute autre construction d'`AnalyzedPosition` littérale dans les tests du paquet reçoit `buyback: null` (le typage les signale).

- [x] **Step 4:** `cd packages/coverage && npx vitest run && npx tsc --noEmit -p .` → PASS (les appelants `strategy.ts`/`condors.ts` passent `null` en troisième argument à ce stade : `evaluateBuyback(avgPrice, lastPrice, null).decision`, remplacés à la tâche 2).
- [x] **Step 5:** cocher les cases de la tâche 1 et commit : `Décision de rachat : l'avis tient compte du temps`.

---

### Task 2: Pages de stratégie et Condors

**Files:**
- Modify: `packages/coverage/src/strategy.ts`, `packages/coverage/src/condors.ts`
- Test: `packages/coverage/src/strategy.test.ts`, `packages/coverage/src/condors.test.ts`

**Interfaces:**
- Consumes: `evaluateBuyback`, `averageSaleInstant`, `BuybackAdvice`, `BuybackTiming` (tâche 1).
- Produces: `PricedSnapshot` gagne `asOf?: string` ; `StrategyLine.buyback: BuybackAdvice | null` ; `CondorLine.buyback: BuybackAdvice | null`.

- [x] **Step 1: Écrire les tests qui échouent.** Dans `strategy.test.ts`, en reprenant les fabriques du fichier (journal + snapshot) :
  - une Wheel qui a vendu un put SPY d'échéance `E` en deux lignes ouvertes (−1 à `t1`, −3 à `t2`), un snapshot `{ positions, report, asOf }` : la ligne a `buyback.totalDays` égal à `(E 16:00 − moyenne pondérée) / 1 j` et `decision === buyback.decision` ; sans `asOf` dans le `PricedSnapshot`, `buyback.remainingDays` est `null` et le seuil vaut `avgPrice / 2`.
  - une ligne d'Autres faite uniquement de contrats migrés (reprendre le cas de migration existant du fichier, compte réduit au strict nécessaire) : son `buyback.totalDays` se mesure depuis le `startWhen` des lignes de la stratégie d'origine.
  - un call acheté : `buyback` et `decision` `null`.

  Dans `condors.test.ts`, sur le condor complet existant du fichier, avec `asOf` dans le snapshot : `buyback.totalDays` se mesure du `startWhen` du composite à l'échéance du condor, `decision === buyback.decision` ; le cas existant « negative closing cost » garde `decision: "buy back"` et a `buyback.threshold === 0` ; un condor partiel a `buyback: null`.

- [x] **Step 2:** `npx vitest run strategy condors` → FAIL.

- [x] **Step 3: Implémenter.** `strategy.ts` :

```ts
/** The snapshot's positions and the risk report built from them, index for index. */
export interface PricedSnapshot {
  positions: readonly Position[];
  report: RiskReport;
  /** The snapshot's asOf: the instant its prices were read, which a buyback decision is timed on. */
  asOf?: string;
}

interface Contribution {
  quantity: number;
  openPrice: number | null;
  /** The instant it was opened; for contracts taken over by Others, their strategy's average. */
  when: string | null;
}

const toContribution = (row: JournalRow): Contribution => ({ quantity: row.quantity as number, openPrice: row.openPrice, when: row.startWhen });
```

Dans `contributionsTakenIn`, la contribution poussée gagne `when: averageSaleInstant((byStrategy.get(strategy) ?? []).map((r) => ({ when: r.startWhen, quantity: r.quantity as number })))`. `linesByGroup` passe `asOf` à `line` (paramètre de `strategyPositions` → `snapshot?.asOf`). Dans `line` :

```ts
function timingOf(contract: ContractKey, contributions: readonly Contribution[], asOf: string | undefined): BuybackTiming | null {
  if (!asOf || !contract.expiry || contributions.some((c) => c.when === null)) return null;
  const soldAt = averageSaleInstant(contributions.map((c) => ({ when: c.when as string, quantity: c.quantity })));
  return soldAt ? { soldAt, expiry: contract.expiry, asOf } : null;
}
...
  const buyback = sold && lastPrice !== null && avgPrice !== null ? evaluateBuyback(avgPrice, lastPrice, timingOf(contract, contributions, asOf)) : null;
  return { ..., decision: buyback?.decision ?? null, buyback, ... };
```

`StrategyLine` gagne `buyback: BuybackAdvice | null` sous `decision` (doc : « the advice behind `decision` »). `condors.ts` :

```ts
      const timing =
        snapshot?.asOf && row.contract.expiry ? { soldAt: row.startWhen, expiry: row.contract.expiry, asOf: snapshot.asOf } : null;
      const advice = !partial && row.openPrice !== null && closingCost !== null ? evaluateBuyback(row.openPrice, closingCost, timing) : null;
      // closingCost <= 0 means IB would pay to close: always a buyback, whatever the rule says of
      // |closingCost| against a small credit.
      const buyback = advice && closingCost !== null && closingCost <= 0 ? { ...advice, decision: "buy back" as const, threshold: 0 } : advice;
      ... decision: buyback?.decision ?? null, buyback,
```

`CondorLine` gagne `buyback: BuybackAdvice | null`.

- [x] **Step 4:** `npx vitest run && npx tsc --noEmit -p .` depuis `packages/coverage` → PASS.
- [x] **Step 5:** cocher et commit : `Décision de rachat : pages de stratégie et Condors datés`.

---

### Task 3: L'application — table des dates de vente et infobulle

**Files:**
- Create: `apps/web/src/components/DecisionBadge.tsx`, `apps/web/src/components/DecisionBadge.test.tsx`
- Modify: `apps/web/src/db/hooks.ts` (`useRiskReport`), `apps/web/src/db/AccountDataProvider.tsx`, `apps/web/src/pages/StrategyPositionsPage.tsx` (`pricedSnapshot` + valeurs de ligne), `apps/web/src/components/PositionRow.tsx`, `apps/web/src/components/PositionGroupCard.tsx`, `apps/web/src/components/CondorRows.tsx`, `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`
- Test: `apps/web/src/db/hooks.test.tsx`

**Interfaces:**
- Consumes: `saleInstants`, `BuybackAdvice`, `SaleTiming`, `buildRiskReport(..., sales)`, `PricedSnapshot.asOf`, `StrategyLine.buyback`, `CondorLine.buyback`, `AnalyzedPosition.buyback`.
- Produces: `useRiskReport(accountId: string, soldAt?: ReadonlyMap<string, string>): RiskReportView` ; `<DecisionBadge decision advice currency />` ; `PositionRowValues` gagne `buyback: BuybackAdvice | null` et `currency: string`.

- [ ] **Step 1: Écrire les tests qui échouent.**
  - `DecisionBadge.test.tsx` : rendu avec `decision "keep"`, `advice { decision: "keep", threshold: 0.42, remainingDays: 11.6, totalDays: 30.2 }`, `currency "USD"` ; au survol du badge (reprendre la façon dont un test existant ouvre une infobulle base-ui — `grep -rn "TooltipContent\|hover" apps/web/src --include=*.test.tsx`), le texte « Rachat rentable sous 0.42 USD : 12 j restants sur 30 » paraît (i18n fr, comme les autres tests) ; avec `remainingDays: null`, « Rachat rentable sous 0.75 USD : 50 % de la prime » ; `decision null` ne rend rien ; `advice null` rend le badge sans infobulle.
  - `hooks.test.tsx`, bloc `useRiskReport` : sur la graine existante, avec une table `new Map([[contractId(contractOf(put)), "<une date avant l'asOf>"]])` pour un put vendu du snapshot, `report.positions[i].buyback.remainingDays` n'est pas `null` ; sans table, il l'est et le seuil vaut `avgPrice / 2` (Review Focus 3 : le chargement des journaux).

- [ ] **Step 2:** `cd apps/web && npx vitest run DecisionBadge hooks` → FAIL.

- [ ] **Step 3: Implémenter.**

`hooks.ts` :

```ts
/** The risk report of the snapshot, its sold options timed on `soldAt` (contractId → average sale
 * instant, spec of sub-project 38 §4); without it — journals still loading — the 50% rule alone. */
export function useRiskReport(accountId: string, soldAt?: ReadonlyMap<string, string>): RiskReportView {
  const snapshot = useSnapshot(accountId);
  const sectors = useSectors();
  const report = useMemo(
    () => (snapshot ? buildRiskReport(snapshot.positions, snapshot.cashAvailable, soldAt ? { asOf: snapshot.asOf, soldAt } : null) : snapshot),
    [snapshot, soldAt],
  );
```

`AccountDataProvider.tsx` :

```ts
  const journals = useJournals(accountId, strategies);
  // Built once per journals, so the report is rebuilt only when a sale date can have moved.
  const soldAt = useMemo(() => (journals.status === "ready" ? saleInstants(journals.report.rows) : undefined), [journals]);
  const { snapshot, report, sectorOf } = useRiskReport(accountId, soldAt);
```

`StrategyPositionsPage.tsx` : `pricedSnapshot` rend `{ positions: snapshot.positions, report, asOf: snapshot.asOf }` ; les valeurs de ligne gagnent `buyback: line.buyback, currency: line.contract.currency`. `PositionGroupCard.tsx` : `buyback: position.buyback, currency: position.currency`.

`DecisionBadge.tsx` :

```tsx
import { useTranslation } from "react-i18next";
import type { BuybackAdvice } from "@ib/coverage";
import { Badge } from "@ib/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ib/ui/tooltip";
import { formatPrice } from "@/lib/format";
import { decisionBadge } from "@/lib/riskReport";

/** The Décision column: the badge, and the price under which a buyback pays (spec of sub-project 38, §5). */
export function DecisionBadge({ decision, advice, currency }: { decision: "buy back" | "keep" | null; advice: BuybackAdvice | null; currency: string }) {
  const { t } = useTranslation();
  const badge = decisionBadge(decision);
  if (!badge) return null;
  const node = <Badge variant={badge.variant}>{badge.label}</Badge>;
  if (!advice) return node;
  const price = `${formatPrice(advice.threshold)} ${currency}`;
  const text =
    advice.remainingDays !== null && advice.totalDays !== null
      ? t("positions.buyback.timed", { price, remaining: Math.round(advice.remainingDays), total: Math.round(advice.totalDays) })
      : t("positions.buyback.half", { price });
  return (
    <Tooltip>
      <TooltipTrigger render={node} />
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}
```

(Vérifier les chemins d'import de `Badge` en lisant ceux de `PositionRow.tsx`.) `PositionRow.tsx` : la cellule Décision devient `<TableCell><DecisionBadge decision={values.decision} advice={values.buyback} currency={values.currency} /></TableCell>`, l'appel local à `decisionBadge` disparaît ; `PositionRowValues` gagne `/** The advice behind `decision`, for its tooltip. */ buyback: BuybackAdvice | null;` et `/** The position's currency, which the tooltip's price is in. */ currency: string;`. `CondorRows.tsx` : même cellule avec `decision={line.decision} advice={line.buyback} currency={line.contract.currency}`. Les autres constructeurs de `PositionRowValues` (le typage les signale) passent les mêmes champs.

i18n, sous `positions` :

```json
"buyback": {
  "timed": "Rachat rentable sous {{price}} : {{remaining}} j restants sur {{total}}",
  "half": "Rachat rentable sous {{price}} : 50 % de la prime"
}
```

```json
"buyback": {
  "timed": "Buy back pays below {{price}}: {{remaining}} d left of {{total}}",
  "half": "Buy back pays below {{price}}: 50% of the premium"
}
```

- [ ] **Step 4:** `cd apps/web && npx vitest run DecisionBadge hooks PositionRow PositionGroupCard CondorRows StrategyPositionsPage riskReport && npx tsc --noEmit -p .` → PASS.
- [ ] **Step 5:** cocher et commit : `Décision de rachat : infobulle du seuil, pages datées par les journaux`.

---

### Task 4: Documentation, vérification, instance de relecture

**Files:**
- Modify: `CLAUDE.md` (registre + une règle), `docs/specs/2026-09-28-decision-rachat-design.md` (statut)

- [ ] **Step 1:** `CLAUDE.md` : ligne `| 38 | La décision de rachat tient compte du temps | fait (<date>) |` au registre ; dans « Constantes métier » ou juste après, une puce :
  « **La décision de rachat se mesure au temps, jamais au seul prix** (sous-projet 38) : `evaluateBuyback` (`packages/coverage/src/buyback.ts`) rachète si C ≤ S × min(½, r/T), T depuis la date moyenne de vente pondérée par la quantité, r depuis l'`asOf` du snapshot — jamais l'horloge —, échéance à 16:00 New York ; échue à l'`asOf`, garder. La page Positions date ses positions par `saleInstants` des journaux, passé par `AccountDataProvider` à `useRiskReport` ; sans journaux, la seule règle des 50 %. Ni plancher de fin de vie ni commission. L'infobulle du badge (`DecisionBadge`) dit le seuil. »
  Spec : `Statut : implémenté (<date>).`
- [ ] **Step 2:** `pnpm check` depuis la racine du worktree → tout vert. Corriger ce qui ne l'est pas.
- [ ] **Step 3:** cocher et commit : `Décision de rachat : documentation`.
- [ ] **Step 4:** `pnpm dev:start` dans le worktree ; donner les deux URL à Seb (`pnpm dev:status`).
