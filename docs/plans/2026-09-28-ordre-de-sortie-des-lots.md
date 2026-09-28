# Sous-projet 33 — L'ordre de sortie des lots d'actions : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal :** les actions longues sortent du carnet au prix, plus au seul FIFO : un call Wheel
assigné livre le lot le plus cher sous son strike (sinon le plus bas), une vente jointe au rachat
d'un call Wheel à 60 s près fait de même avec le strike du call racheté, et toute autre sortie
prend d'abord les actions libres, Autres → LEAPS → Wheel, au prix le plus faible.

**Architecture :** un module pur `journals/exitOrder.ts` calcule des plans de sortie
(`strikePlan`, `coverAttribution`, `salePlan`) sur des lots donnés ; `LotBook.closeOrdered`
exécute un plan sans toucher à l'ordre interne du carnet, qui reste l'ordre de rang des
opérations sur titres. `journals/exits.ts` relie ces plans au contexte du replay ;
`journals/buybacks.ts` apparie ventes et rachats dans la fenêtre. `closePreferring` et
`wheelBuybacks` disparaissent.

**Tech Stack :** TypeScript, Vitest.

**Spec :** `docs/specs/2026-09-28-ordre-de-sortie-des-lots-design.md`

## Global Constraints

- **Tout le travail vit dans `packages/ledger/src/journals/`** (plus CLAUDE.md et la spec à la
  tâche 4). Rien dans `apps/api`, aucune table ni migration Dexie, aucun changement dans
  `packages/coverage` ni `apps/web`. Une tâche qui semble en réclamer est un **signal d'arrêt**.
- **La règle change quels lots sortent, jamais combien** : l'oracle
  `packages/ib-parsers/src/journals.oracle.test.ts` reste à zéro écart sans modification.
- **Le rachat d'actions vendues à découvert reste FIFO** (`LotBook.close`).
- **`takeOverShares`, `splitShortCall`, `insertByRank`, `move`, `insertAfter` ne changent pas de
  comportement.**
- **`WHEEL_BUYBACK_WINDOW_MS = 60_000`** vit une seule fois, dans `journals/types.ts`, à côté de
  `FILL_MERGE_WINDOW_MS`.
- **Ordre des stratégies de R3 : `["others", "leaps", "wheel"]`**, une seule définition
  (`SALE_STRATEGY_ORDER`).
- Un lot sans prix (`openPrice === null`) se range après tous les lots qui en ont un ; à prix égal,
  l'ordre du carnet (l'ordre de la liste reçue) décide.
- Un test existant dont l'attente change doit s'expliquer par R1, R2 ou R3 dans le message de
  commit ; jamais un ajustement au résultat.
- Commandes : `npx vitest run <motif>` depuis `packages/ledger` pendant l'itération ;
  `pnpm check` **une seule fois**, à la tâche 4, depuis la racine du worktree.

## Review Focus

- **Actions fractionnaires ou ratio ≠ 100 après une opération sur titres** : `strikePlan` compte
  le budget en contrats et convertit par `sharesPerContract(lot)` ; un reliquat flottant
  (1e-9) ne doit ni boucler ni produire une ligne fantôme — test à la tâche 1.
- **Un lot touché par deux passes (R2 puis R3, ou libre puis couvert) donne une seule ligne** —
  tests à la tâche 1 (`salePlan`) et à la tâche 3 (`mergePortions` via le replay).
- **Une vente sans aucune action longue** (vente à découvert) ouvre toujours un lot
  `short_shares` pour le reste — test à la tâche 3.
- **Deux ventes dans la fenêtre d'un seul rachat** : la première consomme le budget, la seconde
  passe par R3 — test à la tâche 3.
- **Wheel inactive** (`active = ["leaps"]`) : aucun call n'est couvert par des actions, R3 pur,
  rien ne plante — test à la tâche 3.

---

### Task 1: Le module d'ordre et `LotBook.closeOrdered`

**Files:**
- Create: `packages/ledger/src/journals/exitOrder.ts`
- Create: `packages/ledger/src/journals/exitOrder.test.ts`
- Modify: `packages/ledger/src/journals/book.ts` (ajout de `closeOrdered`, à côté de `close`)
- Modify: `packages/ledger/src/journals/book.test.ts` (tests de `closeOrdered`)

**Interfaces:**
- Consumes: `Lot`, `newLot`, `sharesPerContract`, `ClosedPortion` (`book.ts`) ; `Strategy`
  (`types.ts`) ; `sharesContract` (`contract.ts`).
- Produces:
  - `interface PlanItem { lot: Lot; quantity: number }` — quantité non signée ;
  - `type Coverage = ReadonlyMap<Lot, number>` — actions couvertes par lot ;
  - `interface OpenCall { strike: number; contracts: number }` ;
  - `const SALE_STRATEGY_ORDER: readonly Strategy[]` ;
  - `strikePlan(lots: readonly Lot[], strike: number, contracts: number, reserved?: Coverage, maxShares?: number): PlanItem[]` ;
  - `coverAttribution(wheelLots: readonly Lot[], calls: readonly OpenCall[]): Map<Lot, number>` ;
  - `salePlan(lots: readonly Lot[], covered: Coverage, shares: number): PlanItem[]` ;
  - `LotBook.closeOrdered(plan: readonly PlanItem[]): ClosedPortion[]`.
  Les `lots` passés sont des lots d'actions **longues** ouverts (`remaining > 0`) d'un seul
  contrat, dans l'ordre du carnet.

- [ ] **Step 1: Write the failing tests** — `exitOrder.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { newLot, type Lot } from "./book.ts";
import { sharesContract } from "./contract.ts";
import { coverAttribution, salePlan, strikePlan } from "./exitOrder.ts";
import type { Strategy } from "./types.ts";

const SHARES = sharesContract("AISP", "USD");

function shares(id: string, strategy: Strategy, price: number | null, quantity = 100, ratio: number | null = null): Lot {
  return newLot({
    id,
    contract: SHARES,
    strategy,
    kind: "shares",
    openWhen: "2026-01-01T15:00:00.000Z",
    openPrice: price,
    openAmount: price === null ? null : -price * quantity,
    openCommission: 0,
    quantity,
    openIds: [id],
    ratio,
  });
}

const ids = (plan: { lot: Lot; quantity: number }[]) => plan.map((p) => [p.lot.id, p.quantity]);

describe("strikePlan (R1)", () => {
  it("delivers the dearest lot at or below the strike, not the oldest", () => {
    const six = shares("six", "wheel", 6);
    const five = shares("five", "wheel", 5);
    expect(ids(strikePlan([six, five], 5, 1))).toEqual([["five", 100]]);
  });

  it("takes the dearest of several lots below the strike", () => {
    expect(ids(strikePlan([shares("four", "wheel", 4), shares("six", "wheel", 6), shares("five", "wheel", 5)], 7, 1))).toEqual([["six", 100]]);
  });

  it("falls back on the cheapest lot when none is at or below the strike", () => {
    expect(ids(strikePlan([shares("seven", "wheel", 7), shares("six", "wheel", 6)], 5, 1))).toEqual([["six", 100]]);
  });

  it("keeps book order between equal prices", () => {
    expect(ids(strikePlan([shares("a", "wheel", 5), shares("b", "wheel", 5)], 5, 1))).toEqual([["a", 100]]);
  });

  it("ranks a lot without a price after every priced lot", () => {
    expect(ids(strikePlan([shares("none", "wheel", null), shares("seven", "wheel", 7)], 5, 1))).toEqual([["seven", 100]]);
  });

  it("chains lots when one is not enough, each chosen by the same rule", () => {
    expect(ids(strikePlan([shares("four", "wheel", 4), shares("five", "wheel", 5), shares("eight", "wheel", 8)], 5, 3))).toEqual([
      ["five", 100],
      ["four", 100],
      ["eight", 100],
    ]);
  });

  it("leaves out what `reserved` holds and stops at `maxShares`", () => {
    const five = shares("five", "wheel", 5, 200);
    const four = shares("four", "wheel", 4);
    expect(ids(strikePlan([five, four], 5, 2, new Map([[five, 100]])))).toEqual([
      ["five", 100],
      ["four", 100],
    ]);
    expect(ids(strikePlan([five, four], 5, 2, new Map(), 150))).toEqual([["five", 150]]);
  });

  it("counts a contract with the lot's own ratio", () => {
    expect(ids(strikePlan([shares("adj", "wheel", 5, 300, 150)], 5, 1))).toEqual([["adj", 150]]);
  });

  it("returns nothing, without looping, when there is nothing to take", () => {
    expect(strikePlan([], 5, 1)).toEqual([]);
    expect(strikePlan([shares("a", "wheel", 5)], 5, 1e-12)).toEqual([]);
  });
});

describe("coverAttribution (spec 33 §2)", () => {
  it("serves the calls by rising strike, each by R1", () => {
    const five = shares("five", "wheel", 5);
    const six = shares("six", "wheel", 6);
    const covered = coverAttribution([six, five], [
      { strike: 7, contracts: 1 },
      { strike: 5, contracts: 1 },
    ]);
    expect(covered.get(five)).toBe(100);
    expect(covered.get(six)).toBe(100);
  });

  it("covers part of a lot, and never more than the lots hold", () => {
    const five = shares("five", "wheel", 5, 200);
    expect(coverAttribution([five], [{ strike: 6, contracts: 1 }]).get(five)).toBe(100);
    expect(coverAttribution([five], [{ strike: 6, contracts: 5 }]).get(five)).toBe(200);
  });
});

describe("salePlan (R3)", () => {
  it("sells free shares Others first, then LEAPS, then the Wheel, whatever the price", () => {
    const wheel = shares("wheel", "wheel", 5);
    const leaps = shares("leaps", "leaps", 2);
    const others = shares("others", "others", 9);
    expect(ids(salePlan([wheel, leaps, others], new Map(), 300))).toEqual([
      ["others", 100],
      ["leaps", 100],
      ["wheel", 100],
    ]);
  });

  it("sells the cheapest lot first within a strategy", () => {
    expect(ids(salePlan([shares("eight", "others", 8), shares("four", "others", 4)], new Map(), 100))).toEqual([["four", 100]]);
  });

  it("touches covered shares only once every free share is gone", () => {
    const three = shares("three", "wheel", 3);
    const eight = shares("eight", "others", 8);
    const covered = new Map([[three, 100]]);
    expect(ids(salePlan([three, eight], covered, 100))).toEqual([["eight", 100]]);
    expect(ids(salePlan([three, eight], covered, 200))).toEqual([
      ["eight", 100],
      ["three", 100],
    ]);
  });

  it("returns a half-covered lot as one item when both passes reach it", () => {
    const five = shares("five", "wheel", 5, 200);
    expect(ids(salePlan([five], new Map([[five, 100]]), 200))).toEqual([["five", 200]]);
  });

  it("sells covered shares cheapest first", () => {
    const four = shares("four", "wheel", 4);
    const five = shares("five", "wheel", 5);
    expect(ids(salePlan([five, four], new Map([[four, 100], [five, 100]]), 100))).toEqual([["four", 100]]);
  });

  it("stops when the lots run out: the caller opens the rest", () => {
    expect(ids(salePlan([shares("a", "others", 4)], new Map(), 250))).toEqual([["a", 100]]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run exitOrder` (depuis `packages/ledger`)
Expected: FAIL — `Failed to resolve import "./exitOrder.ts"`.

- [ ] **Step 3: Implement `exitOrder.ts`**

```ts
import { sharesPerContract, type Lot } from "./book.ts";
import type { Strategy } from "./types.ts";

/** One step of an exit plan: close `quantity` shares (unsigned) of `lot`. */
export interface PlanItem {
  lot: Lot;
  quantity: number;
}

/** Shares of each Wheel lot that back an open covered call (spec 33 §2). */
export type Coverage = ReadonlyMap<Lot, number>;

/** An open covered call of the Wheel, as the attribution sees it. */
export interface OpenCall {
  strike: number;
  /** Unsigned. */
  contracts: number;
}

/** R3: free shares leave Others first, then LEAPS, then the Wheel (spec 33 §3). */
export const SALE_STRATEGY_ORDER: readonly Strategy[] = ["others", "leaps", "wheel"];

/** Below this a residue of shares or contracts is floating-point noise, not a position. */
const EPSILON = 1e-9;

const priceOf = (lot: Lot): number => lot.openPrice ?? Number.POSITIVE_INFINITY;

/** Cheapest first, a lot without a price last, stable: equal prices keep book order. */
function byPrice(a: Lot, b: Lot): number {
  const pa = priceOf(a);
  const pb = priceOf(b);
  return pa === pb ? 0 : pa < pb ? -1 : 1;
}

function add(plan: PlanItem[], lot: Lot, quantity: number): void {
  const item = plan.find((p) => p.lot === lot);
  if (item) item.quantity += quantity;
  else plan.push({ lot, quantity });
}

/**
 * R1 (spec 33 §3): the shares a call of `strike` hands over, up to `contracts`
 * contracts — each lot counted with `sharesPerContract` — and `maxShares`
 * shares. The dearest lot at or below the strike, otherwise the cheapest; the
 * next lot by the same rule when one is not enough. `reserved` shares are not
 * available.
 */
export function strikePlan(lots: readonly Lot[], strike: number, contracts: number, reserved: Coverage = new Map(), maxShares = Number.POSITIVE_INFINITY): PlanItem[] {
  const plan: PlanItem[] = [];
  const used = new Map<Lot, number>();
  const available = (lot: Lot) => lot.remaining - (reserved.get(lot) ?? 0) - (used.get(lot) ?? 0);
  let budget = contracts;
  let shares = maxShares;
  while (budget > EPSILON && shares > EPSILON) {
    const candidates = lots.filter((lot) => available(lot) > EPSILON);
    if (candidates.length === 0) break;
    const below = candidates.filter((lot) => lot.openPrice !== null && lot.openPrice <= strike);
    const lot = below.length > 0
      ? below.reduce((best, l) => (priceOf(l) > priceOf(best) ? l : best))
      : candidates.reduce((best, l) => (byPrice(l, best) < 0 ? l : best));
    const per = sharesPerContract(lot);
    const take = Math.min(available(lot), shares, budget * per);
    if (take <= EPSILON) break;
    used.set(lot, (used.get(lot) ?? 0) + take);
    budget -= take / per;
    shares -= take;
    add(plan, lot, take);
  }
  return plan;
}

/**
 * Which Wheel shares back the open covered calls (spec 33 §2): the calls by
 * rising strike — the most constrained first —, each given its shares by R1
 * among those not yet given. Never stored: recomputed at each exit.
 */
export function coverAttribution(wheelLots: readonly Lot[], calls: readonly OpenCall[]): Map<Lot, number> {
  const covered = new Map<Lot, number>();
  const ordered = [...calls].sort((a, b) => a.strike - b.strike);
  for (const call of ordered) {
    for (const { lot, quantity } of strikePlan(wheelLots, call.strike, call.contracts, covered)) {
      covered.set(lot, (covered.get(lot) ?? 0) + quantity);
    }
  }
  return covered;
}

/**
 * R3 (spec 33 §3): free shares first, strategy by strategy in
 * `SALE_STRATEGY_ORDER`, cheapest first within each; covered shares last,
 * cheapest first. A lot reached by both passes is one item. Less than
 * `shares` when the lots run out: the caller opens the rest.
 */
export function salePlan(lots: readonly Lot[], covered: Coverage, shares: number): PlanItem[] {
  const plan: PlanItem[] = [];
  let left = shares;
  const strategies = [...SALE_STRATEGY_ORDER, ...new Set(lots.map((lot) => lot.strategy).filter((s) => !SALE_STRATEGY_ORDER.includes(s)))];
  for (const strategy of strategies) {
    for (const lot of lots.filter((l) => l.strategy === strategy).sort(byPrice)) {
      if (left <= EPSILON) return plan;
      const take = Math.min(lot.remaining - (covered.get(lot) ?? 0), left);
      if (take <= EPSILON) continue;
      add(plan, lot, take);
      left -= take;
    }
  }
  for (const lot of lots.filter((l) => (covered.get(l) ?? 0) > 0).sort(byPrice)) {
    if (left <= EPSILON) return plan;
    const take = Math.min(covered.get(lot) ?? 0, left);
    if (take <= EPSILON) continue;
    add(plan, lot, take);
    left -= take;
  }
  return plan;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run exitOrder`
Expected: PASS.

- [ ] **Step 5: Test and implement `LotBook.closeOrdered`** — dans `book.test.ts`, nouveau
  `describe("LotBook.closeOrdered")` :

```ts
describe("LotBook.closeOrdered", () => {
  it("closes the planned quantities in the planned order, whatever the book order", () => {
    const book = new LotBook();
    const a = lot("a", -2);
    const b = lot("b", -3);
    book.open(a);
    book.open(b);
    expect(book.closeOrdered([{ lot: b, quantity: 2 }, { lot: a, quantity: 1 }])).toEqual([
      { lot: b, quantity: 2 },
      { lot: a, quantity: 1 },
    ]);
    expect(a.remaining).toBe(-1);
    expect(b.remaining).toBe(-1);
    expect(book.openLots(PUT)).toEqual([a, b]);
  });

  it("refuses to close more than a lot holds", () => {
    const book = new LotBook();
    const a = lot("a", -1);
    book.open(a);
    expect(() => book.closeOrdered([{ lot: a, quantity: 2 }])).toThrow();
  });
});
```

Implémentation, dans `LotBook` juste après `close` (importer `PlanItem` en type depuis
`./exitOrder.ts`) :

```ts
  /**
   * Closes exactly what `plan` says, in its order, without moving any lot: the
   * list stays in rank order for the corporate actions (spec 33 §5.1). The
   * plan's quantities are unsigned and each is at most what its lot holds.
   */
  closeOrdered(plan: readonly PlanItem[]): ClosedPortion[] {
    return plan.map(({ lot, quantity }) => {
      if (quantity > Math.abs(lot.remaining) + 1e-9) throw new Error(`closeOrdered: ${quantity} exceeds lot ${lot.id}`);
      const take = Math.min(quantity, Math.abs(lot.remaining));
      lot.remaining -= Math.sign(lot.remaining) * take;
      return { lot, quantity: take };
    });
  }
```

Run: `npx vitest run book exitOrder` — Expected: PASS.

- [ ] **Step 6: Commit** (cocher les cases de la tâche 1 dans ce plan, même commit)

```bash
git add packages/ledger/src/journals/exitOrder.ts packages/ledger/src/journals/exitOrder.test.ts packages/ledger/src/journals/book.ts packages/ledger/src/journals/book.test.ts docs/plans/2026-09-28-ordre-de-sortie-des-lots.md
git commit -m "Journaux : le module d'ordre de sortie des lots (R1, attribution, R3) et LotBook.closeOrdered"
```

---

### Task 2: R1 et R3 à la livraison d'actions

**Files:**
- Create: `packages/ledger/src/journals/exits.ts`
- Modify: `packages/ledger/src/journals/replay.ts` (`deliverShares`)
- Test: `packages/ledger/src/journals/replay.test.ts` (nouveau `describe`)

**Interfaces:**
- Consumes: tâche 1 (`strikePlan`, `coverAttribution`, `salePlan`, `closeOrdered`) ;
  `isWheelCoveredCall`, `isWheelShares`, `sharesPerContract`, `ClosedPortion` (`book.ts`) ;
  `ReplayContext` (`context.ts`).
- Produces, dans `exits.ts` :
  - `longLots(ctx: ReplayContext, shares: ContractKey): Lot[]` ;
  - `coverageOf(ctx: ReplayContext, shares: ContractKey): Map<Lot, number>` ;
  - `sellAtStrike(ctx: ReplayContext, shares: ContractKey, strike: number, contracts: number, maxShares: number): ClosedPortion[]` — R1 sur les actions Wheel ;
  - `sellFree(ctx: ReplayContext, shares: ContractKey, quantity: number): ClosedPortion[]` — R3 ;
  - `mergePortions(...lists: ClosedPortion[][]): ClosedPortion[]` — un lot, une portion ;
  - `sharesOf(portions: ClosedPortion[]): number` et `contractsOf(portions: ClosedPortion[]): number`.

- [ ] **Step 1: Write the failing replay tests** — dans `replay.test.ts`, après le
  `describe` du sous-projet 17 :

```ts
describe("buildJournals — the order shares leave in (spec 33)", () => {
  const T = "AISP";
  const put = (strike: number, expiry: string) => ({ ticker: T, right: "P" as const, strike, expiry });
  const call = (strike: number, expiry: string) => ({ ticker: T, right: "C" as const, strike, expiry });
  const soldShares = (report: JournalsReport, strategy = "wheel") =>
    report.rows.filter((r) => r.kind === "shares" && r.strategy === strategy && r.endWhen !== null).map((r) => [r.openPrice, r.closePrice, r.quantity]);
  const heldShares = (report: JournalsReport, strategy = "wheel") =>
    report.rows.filter((r) => r.kind === "shares" && r.strategy === strategy && r.endWhen === null).map((r) => [r.openPrice, r.quantity]);
  const assignedPut = (strike: number, expiry: string, sold: string) => [
    option({ ...put(strike, expiry), quantity: -1, price: 0.3, when: sold }),
    ...deliver({ ...put(strike, expiry), quantity: 1 }),
  ];

  it("§4.1: a call at 5 delivers the lot at 5, not the older lot at 6", () => {
    const report = buildJournals([
      ...assignedPut(6, "2026-01-16", "2026-01-05T15:00:00.000Z"),
      ...assignedPut(5, "2026-02-20", "2026-02-02T15:00:00.000Z"),
      option({ ...call(5, "2026-03-20"), quantity: -1, price: 0.2, when: "2026-03-02T15:00:00.000Z" }),
      ...deliver({ ...call(5, "2026-03-20"), quantity: 1 }),
    ]);
    expect(soldShares(report)).toEqual([[5, 5, 100]]);
    expect(heldShares(report)).toEqual([[6, 100]]);
  });

  it("§4.2: with no lot at or below the strike, the cheapest leaves", () => {
    const report = buildJournals([
      ...assignedPut(7, "2026-01-16", "2026-01-05T15:00:00.000Z"),
      ...assignedPut(6, "2026-02-20", "2026-02-02T15:00:00.000Z"),
      option({ ...call(5, "2026-03-20"), quantity: -1, price: 0.2, when: "2026-03-02T15:00:00.000Z" }),
      ...deliver({ ...call(5, "2026-03-20"), quantity: 1 }),
    ]);
    expect(soldShares(report)).toEqual([[6, 5, 100]]);
    expect(heldShares(report)).toEqual([[7, 100]]);
  });

  it("§4.3: two calls, each delivers the lot closest below its strike", () => {
    const report = buildJournals([
      ...assignedPut(5, "2026-01-16", "2026-01-05T15:00:00.000Z"),
      ...assignedPut(6, "2026-02-20", "2026-02-02T15:00:00.000Z"),
      option({ ...call(5, "2026-04-17"), quantity: -1, price: 0.2, when: "2026-03-02T15:00:00.000Z" }),
      option({ ...call(7, "2026-03-20"), quantity: -1, price: 0.1, when: "2026-03-03T15:00:00.000Z" }),
      ...deliver({ ...call(7, "2026-03-20"), quantity: 1 }),
      ...deliver({ ...call(5, "2026-04-17"), quantity: 1 }),
    ]);
    expect(soldShares(report)).toEqual(expect.arrayContaining([[6, 7, 100], [5, 5, 100]]));
    expect(soldShares(report)).toHaveLength(2);
  });

  it("delivers what the Wheel lacks by R3: free shares of Others before the Wheel's own", () => {
    // Wheel inactive at the call sale: the call goes naked to Others, the assignment is not a Wheel call.
    const report = buildJournals(
      [
        stock({ ticker: T, quantity: 100, price: 9, when: "2026-01-02T15:00:00.000Z" }),
        stock({ ticker: T, quantity: 100, price: 4, when: "2026-01-03T15:00:00.000Z" }),
        option({ ...call(5, "2026-03-20"), quantity: -1, price: 0.2, when: "2026-03-02T15:00:00.000Z" }),
        ...deliver({ ...call(5, "2026-03-20"), quantity: 1 }),
      ],
      undefined,
      undefined,
      ["leaps"],
    );
    expect(soldShares(report, "others")).toEqual([[4, 5, 100]]);
    expect(heldShares(report, "others")).toEqual([[9, 100]]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run replay -t "spec 33"`
Expected: FAIL — §4.1 livre le lot à 6 (FIFO), §4.3 livre 5 au call à 7, le dernier vend le lot à 9.

- [ ] **Step 3: Implement `exits.ts`**

```ts
import { isWheelCoveredCall, isWheelShares, sharesPerContract, type ClosedPortion, type Lot } from "./book.ts";
import type { ContractKey } from "./contract.ts";
import type { ReplayContext } from "./context.ts";
import { coverAttribution, salePlan, strikePlan, type OpenCall } from "./exitOrder.ts";

/** Long share lots still open on `shares`, in book order. */
export function longLots(ctx: ReplayContext, shares: ContractKey): Lot[] {
  return ctx.book.openLots(shares).filter((lot) => lot.remaining > 0);
}

/** The Wheel shares backing the covered calls open on this underlying right now (spec 33 §2). */
export function coverageOf(ctx: ReplayContext, shares: ContractKey): Map<Lot, number> {
  const calls: OpenCall[] = ctx.book
    .allOpen()
    .filter((lot) => isWheelCoveredCall(lot) && lot.contract.ticker === shares.ticker && lot.contract.currency === shares.currency && lot.contract.strike !== null)
    .map((lot) => ({ strike: lot.contract.strike as number, contracts: Math.abs(lot.remaining) }));
  return coverAttribution(longLots(ctx, shares).filter(isWheelShares), calls);
}

/** R1 on the Wheel's shares: what a call of `strike` hands over (spec 33 §3). */
export function sellAtStrike(ctx: ReplayContext, shares: ContractKey, strike: number, contracts: number, maxShares: number): ClosedPortion[] {
  return ctx.book.closeOrdered(strikePlan(longLots(ctx, shares).filter(isWheelShares), strike, contracts, new Map(), maxShares));
}

/** R3: free shares Others → LEAPS → Wheel, cheapest first, covered ones last (spec 33 §3). */
export function sellFree(ctx: ReplayContext, shares: ContractKey, quantity: number): ClosedPortion[] {
  return ctx.book.closeOrdered(salePlan(longLots(ctx, shares), coverageOf(ctx, shares), quantity));
}

/** One portion per lot, in first-seen order: a lot reached by two passes makes one row. */
export function mergePortions(...lists: ClosedPortion[][]): ClosedPortion[] {
  const merged = new Map<Lot, number>();
  for (const list of lists) for (const { lot, quantity } of list) merged.set(lot, (merged.get(lot) ?? 0) + quantity);
  return [...merged].map(([lot, quantity]) => ({ lot, quantity }));
}

export function sharesOf(portions: ClosedPortion[]): number {
  return portions.reduce((n, p) => n + p.quantity, 0);
}

export function contractsOf(portions: ClosedPortion[]): number {
  return portions.reduce((n, p) => n + p.quantity / sharesPerContract(p.lot), 0);
}
```

- [ ] **Step 4: Rewire `deliverShares`** (`replay.ts`) — remplacer les lignes

```ts
  // A Wheel covered call hands over Wheel shares first (spec 17, §4.2): the
  // Wheel may cover a call with shares ranked behind a lot it never took over.
  const wheelCall = delivery.sign < 0 && isWheelCoveredCall(lot);
  const { closed } = ctx.book.closePreferring(contract, delivery.sign * delivery.shares, isWheelShares, wheelCall ? delivery.shares / delivery.ratio : 0);
```

par

```ts
  // Shares leaving: a Wheel covered call hands over by R1, what it lacks and
  // any other delivery by R3 (spec 33 §3). Shares coming in close shorts FIFO.
  let closed: ClosedPortion[];
  if (delivery.sign < 0) {
    const strike = lot.contract.strike;
    const first = isWheelCoveredCall(lot) && strike !== null ? sellAtStrike(ctx, contract, strike, delivery.shares / delivery.ratio, delivery.shares) : [];
    const rest = delivery.shares - sharesOf(first);
    closed = mergePortions(first, rest > 1e-9 ? sellFree(ctx, contract, rest) : []);
  } else {
    closed = ctx.book.close(contract, delivery.shares);
  }
```

Ajouter `type ClosedPortion` à l'import de `./book.ts` et importer `mergePortions`,
`sellAtStrike`, `sellFree`, `sharesOf` depuis `./exits.ts`. `isWheelShares` reste importé tant
que la boucle des actions l'utilise (tâche 3).

- [ ] **Step 5: Run the new tests, then the whole package**

Run: `npx vitest run replay -t "spec 33"` — Expected: PASS.
Run: `npx vitest run` (dans `packages/ledger`). Tout test existant qui change d'attente :
vérifier qu'une règle l'explique (R1 : un call Wheel livre désormais le lot le plus proche sous
son strike ; R3 : une livraison hors Wheel prend Autres puis LEAPS puis Wheel), mettre l'attente
à jour et noter la règle dans le message de commit. Sinon, c'est un bug : le corriger.
Run: `npx vitest run journals.oracle` dans `packages/ib-parsers` — Expected: PASS sans modification.

- [ ] **Step 6: Commit** (cases cochées dans le même commit)

```bash
git add packages/ledger/src/journals/exits.ts packages/ledger/src/journals/replay.ts packages/ledger/src/journals/replay.test.ts docs/plans/2026-09-28-ordre-de-sortie-des-lots.md
git commit -m "Journaux : une assignation livre ses actions par R1, le reste par R3"
```

---

### Task 3: R2 et R3 aux ventes d'actions ; la fin de `closePreferring`

**Files:**
- Create: `packages/ledger/src/journals/buybacks.ts`
- Create: `packages/ledger/src/journals/buybacks.test.ts`
- Modify: `packages/ledger/src/journals/types.ts` (`WHEEL_BUYBACK_WINDOW_MS`)
- Modify: `packages/ledger/src/journals/context.ts` (trois champs)
- Modify: `packages/ledger/src/journals/replay.ts` (`buildJournals`, `replayGroup`)
- Modify: `packages/ledger/src/journals/book.ts` (retrait de `closePreferring`, `PreferredClose`)
- Modify: `packages/ledger/src/journals/book.test.ts` (retrait du `describe` de `closePreferring`)
- Test: `packages/ledger/src/journals/replay.test.ts`

**Interfaces:**
- Consumes: tâche 2 (`sellAtStrike`, `sellFree`, `mergePortions`, `sharesOf`, `contractsOf`).
- Produces:
  - `WHEEL_BUYBACK_WINDOW_MS = 60_000` (`types.ts`) ;
  - `pairBuybacks(sorted: readonly Transaction[]): Map<Transaction, Transaction[]>` — par vente,
    ses rachats de la fenêtre, du plus proche au plus lointain, puis par `externalId` ;
  - `ReplayContext.buybacks: Map<Transaction, Transaction[]>`,
    `ReplayContext.buybackBudget: Map<Transaction, number>` (contrats restants par rachat),
    `ReplayContext.buybackClosed: Map<Transaction, number>` (contrats Wheel couverts fermés par
    un rachat au moment de son rejeu).

- [ ] **Step 1: Failing tests for `pairBuybacks`** — `buybacks.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { expire, option, resetIds, stock } from "./fixtures.ts";
import { pairBuybacks } from "./buybacks.ts";

beforeEach(resetIds);

const C = { ticker: "AISP", right: "C" as const, strike: 5, expiry: "2026-03-20" };
const at = (s: string) => `2026-03-02T10:${s}.000Z`;

describe("pairBuybacks", () => {
  it("pairs a share sale with a call buyback within 60 s, before or after", () => {
    const sale = stock({ ticker: "AISP", quantity: -100, price: 5.5, when: at("00:00") });
    const after = option({ ...C, quantity: 1, price: 0.1, when: at("00:40") });
    const before = option({ ...C, strike: 6, quantity: 1, price: 0.1, when: "2026-03-02T09:59:30.000Z" });
    expect(pairBuybacks([before, sale, after]).get(sale)).toEqual([before, after]);
  });

  it("ignores a buyback more than 60 s away, another ticker, a put, a sale of a call, a settlement leg", () => {
    const sale = stock({ ticker: "AISP", quantity: -100, price: 5.5, when: at("00:00") });
    const txs = [
      sale,
      option({ ...C, quantity: 1, price: 0.1, when: at("01:01") }),
      option({ ...C, ticker: "OTHER", quantity: 1, price: 0.1, when: at("00:10") }),
      option({ ...C, right: "P", quantity: 1, price: 0.1, when: at("00:10") }),
      option({ ...C, quantity: -1, price: 0.1, when: at("00:10") }),
      expire({ ...C, quantity: 1, when: at("00:10") }),
    ];
    expect(pairBuybacks(txs).get(sale) ?? []).toEqual([]);
  });

  it("pairs only sales that pay a commission, never a purchase", () => {
    const delivery = stock({ ticker: "AISP", quantity: -100, price: 5, when: at("00:00"), commission: 0 });
    const purchase = stock({ ticker: "AISP", quantity: 100, price: 5, when: at("00:00") });
    const buyback = option({ ...C, quantity: 1, price: 0.1, when: at("00:10") });
    const pairs = pairBuybacks([delivery, purchase, buyback]);
    expect(pairs.has(delivery)).toBe(false);
    expect(pairs.has(purchase)).toBe(false);
  });
});
```

Run: `npx vitest run buybacks` — Expected: FAIL (module absent).

- [ ] **Step 2: Implement `buybacks.ts` and the constant**

Dans `types.ts`, juste après `FILL_MERGE_WINDOW_MS` :

```ts
/**
 * A share sale this close to the buyback of a Wheel covered call, before or
 * after, is that call's exit done by hand: it sells Wheel shares by R1 at the
 * call's strike (spec 33 §3, R2).
 */
export const WHEEL_BUYBACK_WINDOW_MS = 60_000;
```

`buybacks.ts` :

```ts
import type { Transaction } from "../types.ts";
import { contractOf } from "./contract.ts";
import { WHEEL_BUYBACK_WINDOW_MS } from "./types.ts";

const isSale = (tx: Transaction) => tx.secType === "STK" && (tx.quantity ?? 0) < 0 && !!tx.commission;
const isCallBuyback = (tx: Transaction) => tx.secType === "OPT" && tx.right === "C" && (tx.quantity ?? 0) > 0 && !!tx.commission;
const underlying = (tx: Transaction) => {
  const c = contractOf(tx);
  return `${c.ticker}|${c.currency}`;
};

/**
 * For each share sale, the call buybacks of its underlying within
 * `WHEEL_BUYBACK_WINDOW_MS`, before or after, nearest first (spec 33 §3, R2).
 * Whether a buyback closes a Wheel covered call is only known during the
 * replay: this pairs by shape alone.
 */
export function pairBuybacks(sorted: readonly Transaction[]): Map<Transaction, Transaction[]> {
  const buybacks = sorted.filter(isCallBuyback);
  const pairs = new Map<Transaction, Transaction[]>();
  for (const sale of sorted.filter(isSale)) {
    const at = Date.parse(sale.when);
    const key = underlying(sale);
    const near = buybacks
      .map((tx) => ({ tx, gap: Math.abs(Date.parse(tx.when) - at) }))
      .filter(({ tx, gap }) => gap <= WHEEL_BUYBACK_WINDOW_MS && underlying(tx) === key)
      .sort((a, b) => a.gap - b.gap || (a.tx.externalId < b.tx.externalId ? -1 : a.tx.externalId > b.tx.externalId ? 1 : 0))
      .map(({ tx }) => tx);
    if (near.length > 0) pairs.set(sale, near);
  }
  return pairs;
}
```

Run: `npx vitest run buybacks` — Expected: PASS.

- [ ] **Step 3: Context fields** — dans `ReplayContext` (`context.ts`) :

```ts
  /** Per share sale, the call buybacks within the R2 window, nearest first (spec 33 §3). */
  buybacks: Map<Transaction, Transaction[]>;
  /** Per buyback, the Wheel covered contracts its sales may still sell by R2. */
  buybackBudget: Map<Transaction, number>;
  /** Per buyback already replayed, the Wheel covered contracts it closed. */
  buybackClosed: Map<Transaction, number>;
```

et dans `newContext` : `buybacks: new Map(), buybackBudget: new Map(), buybackClosed: new Map()`.
Dans `buildJournals`, juste après `const ctx = newContext(ids, active);` :
`ctx.buybacks = pairBuybacks(sorted);`.

- [ ] **Step 4: Failing replay tests** — dans le `describe` « spec 33 » de la tâche 2 :

```ts
  const wheelAt5And6 = () => [
    ...assignedPut(6, "2026-01-16", "2026-01-05T15:00:00.000Z"),
    ...assignedPut(5, "2026-02-20", "2026-02-02T15:00:00.000Z"),
    option({ ...call(5, "2026-04-17"), quantity: -1, price: 0.2, when: "2026-03-02T15:00:00.000Z" }),
  ];
  const sale = (when: string, quantity = -100) => stock({ ticker: T, quantity, price: 5.5, when });
  const buyback = (when: string) => option({ ...call(5, "2026-04-17"), quantity: 1, price: 0.05, when });

  it("§4.4: a sale 40 s before the buyback sells the lot the call would have delivered", () => {
    const report = buildJournals([...wheelAt5And6(), sale("2026-03-10T15:00:00.000Z"), buyback("2026-03-10T15:00:40.000Z")]);
    expect(soldShares(report)).toEqual([[5, 5.5, 100]]);
  });

  it("R2 also holds when the sale follows the buyback: the call's strike picks the lot, not the lowest price", () => {
    const call6 = call(6, "2026-04-17");
    const report = buildJournals([
      ...assignedPut(5, "2026-01-16", "2026-01-05T15:00:00.000Z"),
      ...assignedPut(6, "2026-02-20", "2026-02-02T15:00:00.000Z"),
      option({ ...call6, quantity: -1, price: 0.2, when: "2026-03-02T15:00:00.000Z" }),
      option({ ...call6, quantity: 1, price: 0.05, when: "2026-03-10T15:00:00.000Z" }),
      sale("2026-03-10T15:00:30.000Z"),
    ]);
    // R3 would sell the cheapest free lot, at 5; R1 at the call's strike picks 6.
    expect(soldShares(report)).toEqual([[6, 5.5, 100]]);
  });

  it("§4.5: two minutes apart, the sale is ordinary and sells the free lot at 6", () => {
    const report = buildJournals([...wheelAt5And6(), sale("2026-03-10T15:00:00.000Z"), buyback("2026-03-10T15:02:00.000Z")]);
    expect(soldShares(report)).toEqual([[6, 5.5, 100]]);
  });

  it("two sales in one buyback's window: the first takes it, the second is ordinary", () => {
    const report = buildJournals([
      ...wheelAt5And6(),
      sale("2026-03-10T15:00:00.000Z"),
      buyback("2026-03-10T15:00:10.000Z"),
      sale("2026-03-10T15:00:20.000Z"),
    ]);
    expect(soldShares(report)).toEqual(expect.arrayContaining([[5, 5.5, 100], [6, 5.5, 100]]));
    expect(soldShares(report)).toHaveLength(2);
  });

  it("§4.6: a market sale takes Others' shares before the Wheel's taken-over ones", () => {
    const report = buildJournals([
      stock({ ticker: T, quantity: 200, price: 4, when: "2026-01-02T15:00:00.000Z" }),
      option({ ...call(7, "2026-04-17"), quantity: -1, price: 0.2, when: "2026-03-02T15:00:00.000Z" }),
      stock({ ticker: T, quantity: -100, price: 6, when: "2026-03-10T15:00:00.000Z" }),
    ]);
    expect(soldShares(report, "others")).toEqual([[4, 6, 100]]);
    expect(heldShares(report)).toEqual([[7, 100]]);
  });

  it("§4.7: never a covered share while a free one exists", () => {
    const report = buildJournals([
      ...assignedPut(3, "2026-01-16", "2026-01-05T15:00:00.000Z"),
      option({ ...call(4, "2026-04-17"), quantity: -1, price: 0.2, when: "2026-02-02T15:00:00.000Z" }),
      stock({ ticker: T, quantity: 100, price: 8, when: "2026-02-03T15:00:00.000Z" }),
      stock({ ticker: T, quantity: -100, price: 5, when: "2026-02-10T15:00:00.000Z" }),
    ]);
    expect(soldShares(report, "others")).toEqual([[8, 5, 100]]);
    expect(heldShares(report)).toEqual([[3, 100]]);
  });

  it("§4.8: free shares leave Others, then LEAPS, then the Wheel, whatever the price", () => {
    const leaps = { ticker: T, right: "C" as const, strike: 2, expiry: "2027-01-15" };
    const report = buildJournals([
      ...assignedPut(5, "2026-01-16", "2026-01-05T15:00:00.000Z"),
      option({ ...leaps, quantity: 1, price: 3, when: "2026-01-20T15:00:00.000Z" }),
      ...deliver({ ...leaps, quantity: -1, when: "2026-01-21T20:00:00.000Z" }),
      stock({ ticker: T, quantity: 100, price: 9, when: "2026-01-22T15:00:00.000Z" }),
      stock({ ticker: T, quantity: -100, price: 6, when: "2026-02-10T15:00:00.000Z" }),
      stock({ ticker: T, quantity: -100, price: 6, when: "2026-02-11T15:00:00.000Z" }),
      stock({ ticker: T, quantity: -100, price: 6, when: "2026-02-12T15:00:00.000Z" }),
    ]);
    const exits = report.rows
      .filter((r) => r.kind === "shares" && r.endWhen !== null)
      .sort((a, b) => ((a.endWhen as string) < (b.endWhen as string) ? -1 : 1))
      .map((r) => [r.strategy, r.openPrice]);
    expect(exits).toEqual([["others", 9], ["leaps", 2], ["wheel", 5]]);
  });

  it("§4.9: covered shares leave last, and the call stays in the Wheel", () => {
    const txs = [
      ...assignedPut(5, "2026-01-16", "2026-01-05T15:00:00.000Z"),
      ...assignedPut(4, "2026-02-20", "2026-02-02T15:00:00.000Z"),
      option({ ...call(6, "2026-04-17"), quantity: -1, price: 0.2, when: "2026-03-02T15:00:00.000Z" }),
    ];
    const one = buildJournals([...txs, sale("2026-03-10T15:00:00.000Z")]);
    expect(soldShares(one)).toEqual([[4, 5.5, 100]]);
    const both = buildJournals([...txs, sale("2026-03-10T15:00:00.000Z", -200)]);
    expect(soldShares(both)).toEqual(expect.arrayContaining([[4, 5.5, 100], [5, 5.5, 100]]));
    expect(both.rows.find((r) => r.kind === "short_call")).toMatchObject({ strategy: "wheel", endWhen: null });
  });

  it("a sale larger than every long lot still opens a short for the rest", () => {
    const report = buildJournals([stock({ ticker: T, quantity: 100, price: 4, when: "2026-01-02T15:00:00.000Z" }), sale("2026-01-10T15:00:00.000Z", -150)]);
    const short = report.rows.find((r) => r.kind === "short_shares");
    expect(short?.endWhen).toBeNull();
    expect(Math.abs(short?.quantity ?? 0)).toBe(50);
  });

  it("with the Wheel inactive, a sale is plain R3", () => {
    const report = buildJournals(
      [
        stock({ ticker: T, quantity: 100, price: 8, when: "2026-01-02T15:00:00.000Z" }),
        stock({ ticker: T, quantity: 100, price: 4, when: "2026-01-03T15:00:00.000Z" }),
        option({ ...call(5, "2026-04-17"), quantity: -1, price: 0.2, when: "2026-02-02T15:00:00.000Z" }),
        sale("2026-02-10T15:00:00.000Z"),
      ],
      undefined,
      undefined,
      ["leaps"],
    );
    expect(soldShares(report, "others")).toEqual([[4, 5.5, 100]]);
  });
```

Run: `npx vitest run replay -t "spec 33"` — Expected: FAIL sur §4.4 (fenêtre), §4.6, §4.7,
§4.8, §4.9 et « Wheel inactive » (FIFO).

- [ ] **Step 5: Rewire the share loop of `replayGroup`**

Dans la boucle des options, remplacer le bloc qui remplit `wheelBuybacks` par :

```ts
    if (!isSettlementShape(tx) && quantity > 0) {
      const wheel = closed.filter(({ lot }) => isWheelCoveredCall(lot)).reduce((n, c) => n + c.quantity, 0);
      ctx.buybackClosed.set(tx, wheel);
    }
```

et supprimer la déclaration de `wheelBuybacks` et son commentaire. Dans la boucle des actions,
remplacer

```ts
    const budget = left < 0 ? (wheelBuybacks.get(contractId(contract)) ?? 0) : 0;
    const { closed, preferredContracts } = ctx.book.closePreferring(contract, left, isWheelShares, budget);
    if (preferredContracts > 0) wheelBuybacks.set(contractId(contract), budget - preferredContracts);
```

par

```ts
    const closed = left < 0 ? sellShares(ctx, tx, contract, -left) : ctx.book.close(contract, left);
```

et ajouter dans `exits.ts` :

```ts
/** Contracts a buyback may still hand to R2: set at its first use (spec 33 §5.3). */
function budgetOf(ctx: ReplayContext, buyback: Transaction): number {
  const known = ctx.buybackBudget.get(buyback);
  if (known !== undefined) return known;
  const replayed = ctx.buybackClosed.get(buyback);
  const option = contractOf(buyback);
  const open = ctx.book.openLots(option).filter(isWheelCoveredCall).reduce((n, lot) => n + Math.abs(lot.remaining), 0);
  const budget = replayed ?? Math.min(buyback.quantity ?? 0, open);
  ctx.buybackBudget.set(buyback, budget);
  return budget;
}

/** A long-share sale: R2 against its paired buybacks, nearest first, then R3 (spec 33 §3). */
export function sellShares(ctx: ReplayContext, sale: Transaction, shares: ContractKey, quantity: number): ClosedPortion[] {
  let left = quantity;
  const parts: ClosedPortion[][] = [];
  for (const buyback of ctx.buybacks.get(sale) ?? []) {
    if (left <= 1e-9) break;
    const budget = budgetOf(ctx, buyback);
    if (budget <= 1e-9 || buyback.strike === null) continue;
    const part = sellAtStrike(ctx, shares, buyback.strike, budget, left);
    ctx.buybackBudget.set(buyback, budget - contractsOf(part));
    left -= sharesOf(part);
    parts.push(part);
  }
  if (left > 1e-9) parts.push(sellFree(ctx, shares, left));
  return mergePortions(...parts);
}
```

(imports : `Transaction` depuis `../types.ts`, `contractOf` depuis `./contract.ts`). Le reste de
la boucle (`closeLot` par portion, `rest` ouvert en lot neuf) ne change pas.

Enfin, retirer `closePreferring` et `PreferredClose` de `book.ts`, le `describe("LotBook.closePreferring")`
de `book.test.ts`, et les imports devenus inutiles (`isWheelShares` dans `replay.ts` s'il n'y
sert plus). Mettre à jour les commentaires de `insertAfter` et du champ `rankWhen` de `Lot` :
le rang sert aux opérations sur titres ; l'ordre de sortie, lui, se choisit par
`exitOrder.ts` (spec 33).

- [ ] **Step 6: Run everything in the package, then the oracle**

Run: `npx vitest run` (dans `packages/ledger`) — tout test existant qui change d'attente est
justifié par R2 ou R3 dans le message de commit, sinon corrigé comme un bug. Les deux
chronologies du sous-projet 17 (« 500 in the Wheel, 5 in Others » et « nothing in the Wheel, 75
in Others ») doivent passer **sans modification** : elles comptent des quantités.
Run: `npx vitest run journals` dans `packages/ib-parsers` — Expected: PASS sans modification.

- [ ] **Step 7: Commit** (cases cochées dans le même commit)

```bash
git add packages/ledger/src/journals docs/plans/2026-09-28-ordre-de-sortie-des-lots.md
git commit -m "Journaux : une vente jointe au rachat d'un call Wheel sort par R2, toute autre par R3"
```

---

### Task 4: Documentation, vérifications réelles, `pnpm check`

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/specs/2026-09-28-ordre-de-sortie-des-lots-design.md` (statut)

- [ ] **Step 1: CLAUDE.md** — dans la règle « Un call vendu sur des actions détenues… » :
  - remplacer « laisser la part reprise en fin de file ferait livrer les mauvaises actions à
    l'assignation » par « laisser la part reprise en fin de file la ferait passer derrière son
    reste à la prochaine opération sur titres » ;
  - remplacer le passage de « **Un call Wheel fait sortir d'abord des actions Wheel** » à « …
    jamais sur `openWhen`. » par :

    « **Les actions longues sortent au prix, jamais au seul FIFO** (sous-projet 33,
    `journals/exitOrder.ts`) : un call couvert de la Wheel assigné livre le lot Wheel le plus
    cher dont le prix ne dépasse pas son strike, sinon le plus bas (R1) ; une vente à
    `WHEEL_BUYBACK_WINDOW_MS` (60 s) ou moins du rachat d'un tel call, avant ou après, sort des
    actions Wheel par R1 au strike du call racheté (R2) ; toute autre sortie prend d'abord les
    actions libres — qu'aucun call Wheel ouvert ne couvre selon `coverAttribution`, recalculée à
    chaque sortie et jamais stockée —, Autres puis LEAPS puis Wheel, le prix le plus faible
    d'abord, les actions couvertes en dernier recours (R3). À prix égal, l'ordre du carnet ; le
    rachat d'actions vendues à découvert reste FIFO. `LotBook.closeOrdered` exécute un plan sans
    réordonner le carnet : le rang d'un lot est `rankWhen`, que les deux morceaux d'une coupe
    héritent, et une opération sur titres trie sur lui, jamais sur `openWhen`. »
  - ajouter au registre la ligne `| 33 | L'ordre de sortie des lots d'actions | fait (<date du merge>) |`.

- [ ] **Step 2: Statut de la spec** — `Statut : implémenté (<date>).`

- [ ] **Step 3: Données réelles, si `private/` existe dans le checkout principal**

Run (depuis `packages/ib-parsers`) : `npx vitest run private` puis, depuis `apps/web`,
`npx vitest run alpha.private` — les tests sautent d'eux-mêmes sans les fichiers. Expected :
PASS, reconstitution inchangée. Un échec est un bug du moteur, jamais une attente à ajuster.

- [ ] **Step 4: `pnpm check`** depuis la racine du worktree, une seule fois. Expected : vert.

- [ ] **Step 5: Commit** (cases cochées dans le même commit)

```bash
git add CLAUDE.md docs/specs/2026-09-28-ordre-de-sortie-des-lots-design.md docs/plans/2026-09-28-ordre-de-sortie-des-lots.md
git commit -m "Sous-projet 33 : CLAUDE.md et spec à jour"
```
