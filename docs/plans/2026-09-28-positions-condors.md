# Sous-projet 34 — La page Positions Condors, un condor par ligne : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal :** la page Positions Condors montre une ligne par condor ouvert du journal — crédit, coût
de clôture, P/L total, décision de rachat — avec ses quatre jambes dépliables, au lieu des jambes
éparpillées dans « Options achetées » et « Options vendues ».

**Architecture :** une vue calculée pure `condorPositions(rows, snapshot, active)` dans
`packages/coverage/src/condors.ts` lit les lignes composites ouvertes du journal et prix leurs
jambes au snapshot par `contractId`, en réutilisant `pricedByContract`, `dayShare` et la part nue
de `migratedContracts` exportés de `strategy.ts`. La page `StrategyPositionsPage` déclare pour les
Condors un seul encadré `condors`, rendu par un composant propre (ligne de condor + jambes), avec
ses propres `ColumnSpec<CondorLine>` sur les douze colonnes de `POSITION_COLUMNS`.

**Tech Stack :** TypeScript, React 19, Vitest, Testing Library, fake-indexeddb.

**Spec :** `docs/specs/2026-09-28-positions-condors-design.md`

## Global Constraints

- **Rien dans `apps/api`, aucune table ni migration Dexie, aucun stockage** : la vue est calculée
  à chaque rendu. Une tâche qui semble en réclamer est un **signal d'arrêt**.
- **Le moteur de journaux (`packages/ledger`) ne change pas**, ni `strategyPositions` pour les
  autres pages : la page Autres montre toujours la part nue des jambes de condor.
- **Colonnes : les douze de `POSITION_COLUMNS`, dans leur ordre** — position, type, sector,
  marketValue, quantity, avgPrice, lastPrice, dayChange, dailyPnl, unrealizedPnl, decision,
  coverage. Aucune colonne ajoutée ni retirée.
- **Une valeur absente reste `null`**, jamais `0`, et s'affiche « — ».
- **Libellés de type du moteur en anglais, tels quels** : `iron condor`, `partial iron condor`
  (`CONDOR_KIND_LABELS`), comme `KIND_LABELS`.
- `BUYBACK_RATIO` n'est jamais recodé : la décision passe par `evaluateBuyback`.
- shadcn ici est **base-ui** : `render={<X/>}`, jamais `asChild`.
- Commandes : `npx vitest run <motif>` depuis `packages/coverage` ou `apps/web` pendant
  l'itération ; `pnpm check` **une seule fois**, à la tâche 3, depuis la racine du worktree.

## Review Focus

- **Deux condors sur les mêmes strikes, l'un complet, l'autre dont l'aile call est fermée** : la
  part nue IB va au second, même s'il est le plus récent — test à la tâche 1.
- **Une jambe ouverte sans prix au snapshot** : coût de clôture, valeur, P/L et décision `null`,
  jamais 0 — test à la tâche 1.
- **Un clic sur le chevron ne doit pas aussi ouvrir le graphe** (propagation du clic vers la
  ligne) — test à la tâche 2.
- **La recherche par ticker et le tri gardent les jambes sous leur condor** : on filtre et trie
  les `CondorLine`, jamais les jambes — test à la tâche 2.
- **Un condor sans snapshot** paraît quand même, prix « — » — test à la tâche 1.

---

### Task 1: La vue calculée `condorPositions`

**Files:**
- Modify: `packages/coverage/src/strategy.ts` (exporter `Priced`, `pricedByContract`, `dayShare` ; ajouter `condorsNakedByContract`)
- Create: `packages/coverage/src/condors.ts`
- Modify: `packages/coverage/src/index.ts` (ajouter `export * from "./condors.ts";`)
- Test: `packages/coverage/src/condors.test.ts`

**Interfaces:**
- Consumes: `JournalRow` (`@ib/ledger`), `PricedSnapshot`, `migratedContracts` (existant).
- Produces (exportés par `@ib/coverage`) :

```ts
export const CONDOR_KINDS = ["iron_condor", "partial_iron_condor"] as const;
export type CondorKind = (typeof CONDOR_KINDS)[number];
export const CONDOR_KIND_LABELS: Record<CondorKind, string>; // "iron condor", "partial iron condor"

export interface CondorLegLine {
  contract: ContractKey;
  kind: PositionKind;           // short_put | short_call | long_put | long_call
  label: string;                // KIND_LABELS[kind]
  quantity: number;             // signée, celle de la ligne de journal
  openPrice: number | null;
  closed: boolean;
  lastPrice: number | null;     // ouverte : marketPrice du snapshot ; fermée : closePrice du journal
  marketValue: number | null;   // null si fermée
  dayChange: number | null;     // null si fermée
  dailyPnl: number | null;      // null si fermée
  pnl: number | null;           // ouverte : latent ; fermée : row.pnl (réalisé)
  naked: number;                // contrats nus de cette jambe (0 sauf jambe vendue ouverte)
}

export interface CondorLine {
  id: string;                   // id de la ligne composite du journal
  contract: ContractKey;        // contrat du composite : ticker, expiry, right "", strike null
  title: string;                // row.label, p. ex. "SPY Aug29'26 IC 620/625/660/665"
  kind: CondorKind;
  label: string;                // CONDOR_KIND_LABELS[kind]
  quantity: number;             // quantité du composite, négative
  credit: number | null;        // openPrice du composite
  closingCost: number | null;   // Σ −signe(q) × lastPrice des jambes ouvertes
  marketValue: number | null;   // Σ des jambes ouvertes
  dailyPnl: number | null;      // Σ des jambes ouvertes
  pnl: number | null;           // réalisé + latent
  realizedPnl: number | null;   // Σ pnl des jambes fermées ; 0 pour un condor complet
  decision: "buy back" | "keep" | null;
  naked: number;                // Σ naked des jambes
  legs: CondorLegLine[];
}

export function condorPositions(
  rows: readonly JournalRow[],
  snapshot: PricedSnapshot | null,
  active?: readonly ActivableStrategy[], // défaut ACTIVABLE_STRATEGIES
): CondorLine[];

// strategy.ts, nouvellement exportés :
export interface Priced { position: Position; analyzed: AnalyzedPosition }
export function pricedByContract(snapshot: PricedSnapshot | null): Map<string, Priced>;
export function dayShare(position: Position | null, quantity: number): { dailyPnl: number | null; dayChange: number | null };
export function condorsNakedByContract(rows: readonly JournalRow[], snapshot: PricedSnapshot | null, active: readonly ActivableStrategy[]): Map<string, number>;
```

- [ ] **Step 1: Write the failing tests**

Créer `packages/coverage/src/condors.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { ContractKey, JournalRow, Position } from "@ib/ledger";
import { condorPositions } from "./condors.ts";
import { option } from "./fixtures.ts";
import { buildRiskReport } from "./report.ts";
import type { PricedSnapshot } from "./strategy.ts";

const EXPIRY = "2026-08-29";
const SPY = (right: "C" | "P", strike: number): ContractKey => ({ ticker: "SPY", secType: "OPT", right, strike, expiry: EXPIRY, currency: "USD" });
const COMPOSITE: ContractKey = { ticker: "SPY", secType: "OPT", right: "", strike: null, expiry: EXPIRY, currency: "USD" };

function row(overrides: Partial<JournalRow> & Pick<JournalRow, "contract">): JournalRow {
  const { contract } = overrides;
  return {
    id: "x#1", strategy: "condors", kind: "short_put", ticker: contract.ticker, label: "", currency: contract.currency,
    startWhen: "2026-08-03T14:30:00.000Z", quantity: -1, strike: contract.strike, openPrice: 1, openTotal: 100, openCommission: -1, openNet: 99,
    assigned: false, endWhen: null, closePrice: null, closeTotal: null, closeCommission: null, closeNet: null, pnl: null,
    ongoing: true, event: null, orphan: false, note: null, openIds: [], closeIds: [], ...overrides,
  };
}

const kindOf = (contract: ContractKey, quantity: number): JournalRow["kind"] =>
  quantity < 0 ? (contract.right === "P" ? "short_put" : "short_call") : contract.right === "P" ? "long_put" : "long_call";

/**
 * One SPY 620/625/660/665 condor sold at 0.5 net: wings bought at 0.3, body sold at 0.6 and 0.5.
 * `closed` maps a strike to the overrides that close that leg.
 */
function condor(id: string, startWhen: string, closed: Record<number, Partial<JournalRow>> = {}): JournalRow {
  const leg = (contract: ContractKey, quantity: number, openPrice: number) =>
    row({ id: `${id}-leg${contract.strike}`, contract, kind: kindOf(contract, quantity), quantity, openPrice, startWhen, ...closed[contract.strike as number] });
  return row({
    id,
    kind: "condor",
    contract: COMPOSITE,
    label: "SPY Aug29'26 IC 620/625/660/665",
    startWhen,
    quantity: -1,
    strike: null,
    openPrice: 0.5,
    legs: [leg(SPY("P", 620), 1, 0.3), leg(SPY("P", 625), -1, 0.6), leg(SPY("C", 660), -1, 0.5), leg(SPY("C", 665), 1, 0.3)],
  });
}

const CLOSED_665: Partial<JournalRow> = { endWhen: "2026-08-10T14:30:00.000Z", closePrice: 0.1, pnl: -21, ongoing: false, event: "sold" };

const leg = (right: "C" | "P", strike: number, quantity: number, marketPrice: number | null, extra: Partial<Position> = {}): Position =>
  option({ symbol: "SPY", right, strike, expiry: EXPIRY, quantity, avgPrice: 0, marketPrice, marketValue: marketPrice === null ? null : marketPrice * quantity * 100, ...extra });

function priced(positions: Position[]): PricedSnapshot {
  return { positions, report: buildRiskReport(positions, null) };
}

/** Cost to close 0.15 against a 0.5 credit: under half, so buy back. */
const CHEAP = () => priced([leg("P", 620, 1, 0.05), leg("P", 625, -1, 0.15), leg("C", 660, -1, 0.1), leg("C", 665, 1, 0.05)]);

describe("condorPositions", () => {
  it("gives one line per open condor: credit, closing cost, value, total P/L and buyback decision", () => {
    const [line] = condorPositions([condor("ic#1", "2026-08-03T14:30:00.000Z")], CHEAP());
    expect(line).toMatchObject({ id: "ic#1", title: "SPY Aug29'26 IC 620/625/660/665", kind: "iron_condor", label: "iron condor", quantity: -1, credit: 0.5, decision: "buy back", naked: 0 });
    expect(line.closingCost).toBeCloseTo(0.15);
    expect(line.marketValue).toBeCloseTo(-15);
    // 0.5 credit − 0.15 to close, on 100 shares.
    expect(line.pnl).toBeCloseTo(35);
    expect(line.realizedPnl).toBe(0);
    expect(line.legs.map((l) => [l.contract.right, l.contract.strike, l.quantity, l.closed])).toEqual([
      ["P", 620, 1, false], ["P", 625, -1, false], ["C", 660, -1, false], ["C", 665, 1, false],
    ]);
    expect(line.legs.map((l) => l.pnl)).toEqual([expect.closeTo(-25), expect.closeTo(45), expect.closeTo(40), expect.closeTo(-25)]);
  });

  it("keeps a condor whose closing cost is above half its credit", () => {
    const snapshot = priced([leg("P", 620, 1, 0.1), leg("P", 625, -1, 0.4), leg("C", 660, -1, 0.3), leg("C", 665, 1, 0.1)]);
    expect(condorPositions([condor("ic#1", "2026-08-03T14:30:00.000Z")], snapshot)[0].decision).toBe("keep");
  });

  it("sums the day P&L of the open legs and never gives the condor a day change", () => {
    const snapshot = priced([
      leg("P", 620, 1, 0.05, { dailyPnl: -1, dayChange: -0.1 }),
      leg("P", 625, -1, 0.15, { dailyPnl: 4, dayChange: -0.2 }),
      leg("C", 660, -1, 0.1, { dailyPnl: 3, dayChange: -0.3 }),
      leg("C", 665, 1, 0.05, { dailyPnl: -2, dayChange: -0.4 }),
    ]);
    const [line] = condorPositions([condor("ic#1", "2026-08-03T14:30:00.000Z")], snapshot);
    expect(line.dailyPnl).toBeCloseTo(4);
    expect(line.legs[0].dayChange).toBe(-0.1);
    expect("dayChange" in line).toBe(false);
  });

  it("adds what the closed legs realized to what the open ones would, and gives no decision", () => {
    const [line] = condorPositions([condor("ic#1", "2026-08-03T14:30:00.000Z", { 665: CLOSED_665 })], CHEAP());
    expect(line).toMatchObject({ kind: "partial_iron_condor", label: "partial iron condor", decision: null, realizedPnl: -21 });
    // Open legs: −25 + 45 + 40 = 60, plus −21 realized.
    expect(line.pnl).toBeCloseTo(39);
    // Only the open legs: 0.15 + 0.1 − 0.05.
    expect(line.closingCost).toBeCloseTo(0.2);
    const closed = line.legs[3];
    expect(closed).toMatchObject({ closed: true, lastPrice: 0.1, marketValue: null, dailyPnl: null, dayChange: null, pnl: -21 });
  });

  it("shows only the open composite of a condor partly bought back", () => {
    const shut = { ...condor("ic#2", "2026-08-03T14:30:00.000Z"), endWhen: "2026-08-20T14:30:00.000Z" };
    const lines = condorPositions([condor("ic#1", "2026-08-03T14:30:00.000Z"), shut], null);
    expect(lines.map((l) => l.id)).toEqual(["ic#1"]);
  });

  it("leaves every priced figure null when an open leg has no price, never 0", () => {
    const snapshot = priced([leg("P", 620, 1, 0.05), leg("P", 625, -1, 0.15), leg("C", 660, -1, 0.1), leg("C", 665, 1, null)]);
    const [line] = condorPositions([condor("ic#1", "2026-08-03T14:30:00.000Z")], snapshot);
    expect(line).toMatchObject({ closingCost: null, marketValue: null, pnl: null, decision: null, dailyPnl: null });
  });

  it("still lists a condor without a snapshot, unpriced", () => {
    const [line] = condorPositions([condor("ic#1", "2026-08-03T14:30:00.000Z")], null);
    expect(line).toMatchObject({ credit: 0.5, closingCost: null, marketValue: null, pnl: null, decision: null, naked: 0 });
  });

  it("gives two condors on the same strikes, opened apart, a line each", () => {
    const lines = condorPositions([condor("ic#1", "2026-08-03T14:30:00.000Z"), condor("ic#2", "2026-08-05T14:30:00.000Z")], null);
    expect(lines.map((l) => l.id)).toEqual(["ic#1", "ic#2"]);
  });

  it("marks the sold leg left naked by a closed wing, on the leg and on its condor", () => {
    // The 665 wing is gone from IB: the 660 call is naked there.
    const snapshot = priced([leg("P", 620, 1, 0.05), leg("P", 625, -1, 0.15), leg("C", 660, -1, 0.1)]);
    const [line] = condorPositions([condor("ic#1", "2026-08-03T14:30:00.000Z", { 665: CLOSED_665 })], snapshot);
    expect(line.naked).toBe(1);
    expect(line.legs.map((l) => l.naked)).toEqual([0, 0, 1, 0]);
  });

  it("gives the naked part to the condor whose wing is closed, even when it opened last", () => {
    // Two condors; the later one sold its 665 wing. IB: 660 ×−2 against 665 ×+1, one naked.
    const snapshot = priced([leg("P", 620, 2, 0.05), leg("P", 625, -2, 0.15), leg("C", 660, -2, 0.1), leg("C", 665, 1, 0.05)]);
    const lines = condorPositions(
      [condor("ic#1", "2026-08-03T14:30:00.000Z"), condor("ic#2", "2026-08-05T14:30:00.000Z", { 665: CLOSED_665 })],
      snapshot,
    );
    expect(lines.map((l) => [l.id, l.naked])).toEqual([["ic#1", 0], ["ic#2", 1]]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/coverage && npx vitest run condors`
Expected: FAIL — `Cannot find module './condors.ts'` (ou équivalent).

- [ ] **Step 3: Export the helpers from `strategy.ts`**

Dans `packages/coverage/src/strategy.ts` :
- `interface Priced` → `export interface Priced` ;
- `function pricedByContract` → `export function pricedByContract` ;
- `function dayShare` → `export function dayShare` ;
- ajouter, juste après `migratedByContract` :

```ts
/**
 * The Condors' naked part on each contract: what `migratedContracts` takes from them for the page
 * Autres. The Condors page keeps those legs in their condor and badges them with this very number,
 * so the two pages never disagree (spec of sub-project 34, §5).
 */
export function condorsNakedByContract(
  rows: readonly JournalRow[],
  snapshot: PricedSnapshot | null,
  active: readonly ActivableStrategy[],
): Map<string, number> {
  const naked = new Map<string, number>();
  for (const [id, taken] of migratedByContract(openRowsByContract(rows), pricedByContract(snapshot), active)) {
    const count = taken.get("condors") ?? 0;
    if (count > 0) naked.set(id, count);
  }
  return naked;
}
```

- [ ] **Step 4: Write `condors.ts`**

```ts
import { ACTIVABLE_STRATEGIES, contractId, type ActivableStrategy, type ContractKey, type JournalRow } from "@ib/ledger";
import { contractMultiplier, evaluateBuyback } from "./classify.ts";
import { DEFAULT_MULTIPLIER, KIND_LABELS, type PositionKind } from "./constants.ts";
import { condorsNakedByContract, dayShare, pricedByContract, type Priced, type PricedSnapshot } from "./strategy.ts";

export const CONDOR_KINDS = ["iron_condor", "partial_iron_condor"] as const;
export type CondorKind = (typeof CONDOR_KINDS)[number];

/** The Type column of a condor, English and shown as is, like KIND_LABELS. */
export const CONDOR_KIND_LABELS: Record<CondorKind, string> = {
  iron_condor: "iron condor",
  partial_iron_condor: "partial iron condor",
};

/** (interfaces CondorLegLine et CondorLine exactement comme dans le bloc Interfaces ci-dessus, avec leurs commentaires) */

function sum(values: readonly (number | null)[]): number | null {
  let total = 0;
  for (const value of values) {
    if (value === null) return null;
    total += value;
  }
  return total;
}

function openLeg(row: JournalRow, priced: Priced | undefined): CondorLegLine {
  const quantity = row.quantity as number;
  const kind = row.kind as PositionKind;
  const lastPrice = priced?.position.marketPrice ?? null;
  const multiplier = priced ? contractMultiplier(priced.position) : DEFAULT_MULTIPLIER;
  const marketValue = lastPrice === null ? null : lastPrice * quantity * multiplier;
  const day = dayShare(priced?.position ?? null, quantity);
  return {
    contract: row.contract,
    kind,
    label: KIND_LABELS[kind],
    quantity,
    openPrice: row.openPrice,
    closed: false,
    lastPrice,
    marketValue,
    dayChange: day.dayChange,
    dailyPnl: day.dailyPnl,
    // marketValue − openPrice × quantity × multiplier, the formula of strategyPositions.
    pnl: marketValue === null || row.openPrice === null ? null : marketValue - row.openPrice * quantity * multiplier,
    naked: 0,
  };
}

function closedLeg(row: JournalRow): CondorLegLine {
  const kind = row.kind as PositionKind;
  return {
    contract: row.contract,
    kind,
    label: KIND_LABELS[kind],
    quantity: row.quantity as number,
    openPrice: row.openPrice,
    closed: true,
    lastPrice: row.closePrice,
    marketValue: null,
    dayChange: null,
    dailyPnl: null,
    pnl: row.pnl,
    naked: 0,
  };
}

const isSoldLeg = (leg: CondorLegLine) => leg.quantity < 0;

/** The bought wing on the same side as `leg` is closed: IB sees `leg` naked. */
function wingClosed(legs: readonly CondorLegLine[], leg: CondorLegLine): boolean {
  return legs.some((other) => other.quantity > 0 && other.contract.right === leg.contract.right && other.closed);
}

/**
 * Hands each contract's naked count to the open sold legs that hold it, each at most its own
 * quantity: first those whose wing is closed — the ones IB actually sees naked —, then the others,
 * condors in the order they opened (spec §5).
 */
function spreadNaked(lines: CondorLine[], naked: Map<string, number>): void {
  const remaining = new Map(naked);
  const candidates = lines.flatMap((line) =>
    line.legs.filter((leg) => isSoldLeg(leg) && !leg.closed).map((leg) => ({ line, leg, first: wingClosed(line.legs, leg) })),
  );
  // Stable sort: `lines` is already in opening order within each rank.
  candidates.sort((a, b) => Number(b.first) - Number(a.first));
  for (const { line, leg } of candidates) {
    const id = contractId(leg.contract);
    const left = remaining.get(id) ?? 0;
    if (left <= 0) continue;
    const take = Math.min(left, Math.abs(leg.quantity));
    leg.naked = take;
    line.naked += take;
    remaining.set(id, left - take);
  }
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * What the Condors hold open, one line per open composite row of their journal — exactly the
 * condors the journal shows open — its legs priced from the snapshot (spec of sub-project 34).
 * Computed, never stored.
 */
export function condorPositions(
  rows: readonly JournalRow[],
  snapshot: PricedSnapshot | null,
  active: readonly ActivableStrategy[] = ACTIVABLE_STRATEGIES,
): CondorLine[] {
  const priced = pricedByContract(snapshot);
  const composites = rows
    .filter((row) => row.strategy === "condors" && row.kind === "condor" && row.endWhen === null && row.legs)
    .sort((a, b) => compareText(a.startWhen, b.startWhen) || compareText(a.id, b.id));
  const lines = composites.map((row): CondorLine => {
    const legs = (row.legs ?? []).map((leg) => (leg.endWhen === null ? openLeg(leg, priced.get(contractId(leg.contract))) : closedLeg(leg)));
    const open = legs.filter((leg) => !leg.closed);
    const partial = open.length < legs.length;
    const kind: CondorKind = partial ? "partial_iron_condor" : "iron_condor";
    const closingCost = sum(open.map((leg) => (leg.lastPrice === null ? null : -Math.sign(leg.quantity) * leg.lastPrice)));
    const realizedPnl = sum(legs.filter((leg) => leg.closed).map((leg) => leg.pnl));
    const latent = sum(open.map((leg) => leg.pnl));
    return {
      id: row.id,
      contract: row.contract,
      title: row.label,
      kind,
      label: CONDOR_KIND_LABELS[kind],
      quantity: row.quantity as number,
      credit: row.openPrice,
      closingCost,
      marketValue: sum(open.map((leg) => leg.marketValue)),
      dailyPnl: sum(open.map((leg) => leg.dailyPnl)),
      pnl: latent === null || realizedPnl === null ? null : latent + realizedPnl,
      realizedPnl,
      decision: !partial && row.openPrice !== null && closingCost !== null ? evaluateBuyback(row.openPrice, closingCost) : null,
      naked: 0,
      legs,
    };
  });
  spreadNaked(lines, condorsNakedByContract(rows, snapshot, active));
  // Ticker, then expiry; Array.prototype.sort is stable, so the opening order stays within.
  return lines.sort((a, b) => compareText(a.contract.ticker, b.contract.ticker) || compareText(a.contract.expiry ?? "", b.contract.expiry ?? ""));
}
```

Ajouter `export * from "./condors.ts";` à `packages/coverage/src/index.ts`, après `./strategyBoxes.ts`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/coverage && npx vitest run condors strategy`
Expected: PASS, `strategy.test.ts` inchangé et vert.

Si « gives the naked part to the condor whose wing is closed » échoue parce que
`uncoveredQuantity` du 660 ne vaut pas 1 dans ce snapshot, lire `pairLegs`
(`packages/coverage/src/coverage.ts`) et ajuster **le snapshot du test** (jamais le code) pour
qu'IB voie exactement un 660 nu ; noter la raison dans le commit.

- [ ] **Step 6: Commit** (cocher les cases de la tâche 1 dans ce plan, même commit)

```bash
git add packages/coverage/src docs/plans/2026-09-28-positions-condors.md
git commit -m "Condors : vue calculée condorPositions, un condor par ligne avec ses jambes"
```

---

### Task 2: La page Positions Condors, un encadré de condors dépliables

**Files:**
- Modify: `packages/coverage/src/strategyBoxes.ts` (identifiant d'encadré `condors`)
- Modify: `apps/web/src/lib/strategyBoxes.ts` (Condors : un seul encadré)
- Create: `apps/web/src/lib/condorColumns.ts`
- Modify: `apps/web/src/hooks/useStrategyBoxViews.ts` (douzième vue, `condors`)
- Modify: `apps/web/src/lib/riskReport.ts` (ajouter `uncoveredBadge`)
- Create: `apps/web/src/components/CondorRows.tsx`
- Modify: `apps/web/src/pages/StrategyPositionsPage.tsx`
- Modify: `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`
- Test: `apps/web/src/pages/StrategyPositionsPage.test.tsx` (remplacer le `describe("StrategyPositionsPage — Condors")`), `apps/web/src/lib/condorColumns.test.ts`

**Interfaces:**
- Consumes: `condorPositions`, `CondorLine`, `CondorLegLine`, `CONDOR_KIND_LABELS` (tâche 1).
- Produces:

```ts
// packages/coverage/src/strategyBoxes.ts
export const CONDOR_BOX_ID = "condors" as const;
export type CondorBoxId = typeof CONDOR_BOX_ID;
export type StrategyBoxId = ShareBoxId | LineBoxId | CondorBoxId;
export function isCondorBoxId(id: StrategyBoxId): id is CondorBoxId;

// apps/web/src/lib/condorColumns.ts
export function condorColumnSpecs(sectorOf: (symbol: string) => string | null): ColumnSpec<CondorLine>[];

// apps/web/src/lib/riskReport.ts
export function uncoveredBadge(quantity: number): CoverageBadge; // { variant: "destructive", label: `UNCOVERED ×${quantity}`, tooltip: null }

// apps/web/src/hooks/useStrategyBoxViews.ts — nouvelle signature
useStrategyBoxViews(accountId, strategy, lineColumns, shareColumns, condorColumns): Record<StrategyBoxId, TableViewState>
```

- [ ] **Step 1: Write the failing tests**

(a) `apps/web/src/lib/condorColumns.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { CondorLine } from "@ib/coverage";
import { condorColumnSpecs } from "@/lib/condorColumns";
import { POSITION_COLUMNS } from "@/lib/positionColumns";

const LINE = {
  id: "ic#1", title: "SPY Aug29'26 IC 620/625/660/665", kind: "partial_iron_condor", label: "partial iron condor",
  contract: { ticker: "SPY", secType: "OPT", right: "", strike: null, expiry: "2026-08-29", currency: "USD" },
  quantity: -1, credit: 0.5, closingCost: 0.2, marketValue: -15, dailyPnl: 4, pnl: 39, realizedPnl: -21, decision: null, naked: 1, legs: [],
} as CondorLine;

describe("condorColumnSpecs", () => {
  it("reads the twelve shared columns, in POSITION_COLUMNS order, on a condor line", () => {
    const specs = condorColumnSpecs(() => "ETF");
    expect(specs.map((s) => s.key)).toEqual(POSITION_COLUMNS.map((c) => c.key));
    const value = (key: string) => specs.find((s) => s.key === key)!.value(LINE);
    expect(value("position")).toBe("SPY Aug29'26 IC 620/625/660/665");
    expect(value("type")).toBe("partial_iron_condor");
    expect(value("sector")).toBe("ETF");
    expect(value("avgPrice")).toBe(0.5);
    expect(value("lastPrice")).toBe(0.2);
    expect(value("dayChange")).toBeNull();
    expect(value("unrealizedPnl")).toBe(39);
    expect(value("coverage")).toEqual(["UNCOVERED"]);
  });
});
```

(Si `POSITION_COLUMNS` n'expose pas `key`, lire `apps/web/src/lib/positionColumns.ts` et
comparer au champ qui porte la clé — les clés sont celles de `strategyColumnSpecs`.)

(b) Dans `apps/web/src/pages/StrategyPositionsPage.test.tsx`, remplacer tout le bloc
`describe("StrategyPositionsPage — Condors", …)` par (garder `QQQ_LEG`, `QQQ_POSITIONS`,
`seedCondor` tels quels) :

```ts
describe("StrategyPositionsPage — Condors", () => {
  // Demo condor: 480/485/520/525 sold for 0.75 net (0.75 + 0.5 − 0.25 − 0.25). Snapshot legs:
  // 480 at 0.1, 485 at 0.3, 520 at 0.2, 525 at 0.1 → 0.3 to close, under half: buy back.
  const TITLE = "QQQ Oct16'26 IC 480/485/520/525";

  it("shows one line per condor: credit, closing cost, total P/L and the buyback decision", async () => {
    await seedCondor();
    renderPage("condors");
    const line = await rowIn("Condors en cours", TITLE);
    // Position, Type, Sector, Value, Qty, Credit, To close, Day %, Day P&L, P/L, Decision, Coverage.
    expect(texts(line)).toEqual([TITLE, "iron condor", "", "-$30.00", "-1", "0.75", "0.30", "—", "—", "$45.00", "buy back", ""]);
    expect(screen.queryByLabelText("Achats d'options")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Ventes d'options")).not.toBeInTheDocument();
  });

  it("unfolds the four legs under their condor on the chevron, without opening the chart", async () => {
    await seedCondor();
    renderPage("condors");
    const line = await rowIn("Condors en cours", TITLE);
    expect(screen.queryByText("QQQ Oct16'26 480 Put")).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(within(line).getByRole("button", { name: "Voir les jambes" }));
    const legs = screen.getAllByTestId("condor-leg");
    expect(legs.map((leg) => cells(leg)[0].textContent)).toEqual([
      "QQQ Oct16'26 480 Put", "QQQ Oct16'26 485 Put", "QQQ Oct16'26 520 Call", "QQQ Oct16'26 525 Call",
    ]);
    // Leg P/L: −15, +45, +30, −15, summing to the condor's $45.00.
    expect(legs.map((leg) => texts(leg)[9])).toEqual(["-$15.00", "$45.00", "$30.00", "-$15.00"]);
    // The chevron folds and unfolds; it never opens the price chart (its row has no chart below).
    expect(line).not.toHaveAttribute("data-state", "selected");
    await user.click(within(line).getByRole("button", { name: "Masquer les jambes" }));
    expect(screen.queryAllByTestId("condor-leg")).toHaveLength(0);
  });

  it("searches by ticker on the condors and keeps the legs with them", async () => {
    await seedCondor();
    renderPage("condors");
    const line = await rowIn("Condors en cours", TITLE);
    const user = userEvent.setup();
    await user.click(within(line).getByRole("button", { name: "Voir les jambes" }));
    await user.type(screen.getByRole("searchbox"), "QQQ{Enter}");
    expect(await rowIn("Condors en cours", TITLE)).toBeInTheDocument();
    expect(screen.getAllByTestId("condor-leg")).toHaveLength(4);
    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "SPY{Enter}");
    await waitFor(() => expect(screen.queryByText(TITLE)).not.toBeInTheDocument());
  });
});
```

Avant de figer les attentes, lire `PageSearchInput` (`apps/web/src/components/table/PageSearchInput.tsx`)
pour le rôle réel du champ et la façon dont la recherche s'applique (touche Entrée ou saisie
directe), et adapter **seulement le moyen d'y saisir**, pas les attentes. `P&L jour` vaut « — » :
les positions de démonstration n'ont pas de `dailyPnl`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && npx vitest run condorColumns StrategyPositionsPage`
Expected: FAIL — module `@/lib/condorColumns` introuvable, et l'encadré « Condors en cours » absent.

- [ ] **Step 3: The box id and the page's box declaration**

`packages/coverage/src/strategyBoxes.ts`, après `LineBoxId` :

```ts
/** The Condors page's one box: a condor per line, its legs underneath (spec of sub-project 34). */
export const CONDOR_BOX_ID = "condors" as const;
export type CondorBoxId = typeof CONDOR_BOX_ID;

export type StrategyBoxId = ShareBoxId | LineBoxId | CondorBoxId;

export function isCondorBoxId(id: StrategyBoxId): id is CondorBoxId {
  return id === CONDOR_BOX_ID;
}
```

(remplacer l'ancienne ligne `export type StrategyBoxId = ShareBoxId | LineBoxId;`).

`apps/web/src/lib/strategyBoxes.ts` : `condors: [{ id: "condors", titleKey: "strategyPositions.groups.condors" }],`
et, dans le commentaire du haut, remplacer « Condors and Others keep the Positions groups
(sub-project 21) » par « The Condors show one box of condors, their legs underneath (sub-project
34); Others keeps the Positions groups (sub-project 21) ».

i18n — `fr.json`, sous `strategyPositions.groups` : `"condors": "Condors en cours"` ; sous
`strategyPositions` : `"closedLeg": "fermée"`, `"realizedPart": "dont réalisé {{amount}}"`.
`en.json` : `"condors": "Open condors"`, `"closedLeg": "closed"`, `"realizedPart": "of which realized {{amount}}"`.

- [ ] **Step 4: `condorColumns.ts` and `uncoveredBadge`**

```ts
import { CONDOR_KIND_LABELS, COVER_NONE, type CondorKind, type CondorLine } from "@ib/coverage";
import type { ColumnSpec } from "@/lib/tableView";

type SectorOf = (symbol: string) => string | null;

/**
 * What the twelve shared columns read on a condor line (spec of sub-project 34, §3): same keys and
 * order as POSITION_COLUMNS. The average price is the credit, the last price the cost to close,
 * the P/L the condor's total; a day move means nothing on a condor, so it is always null.
 */
export function condorColumnSpecs(sectorOf: SectorOf): ColumnSpec<CondorLine>[] {
  return [
    { key: "position", type: "text", sortable: true, value: (line) => line.title },
    { key: "type", type: "enum", sortable: true, value: (line) => line.kind, label: (kind) => CONDOR_KIND_LABELS[kind as CondorKind] ?? kind },
    { key: "sector", type: "enum", sortable: true, value: (line) => sectorOf(line.contract.ticker) },
    { key: "marketValue", type: "number", sortable: true, value: (line) => line.marketValue },
    { key: "quantity", type: "number", sortable: true, value: (line) => line.quantity },
    { key: "avgPrice", type: "number", sortable: true, value: (line) => line.credit },
    { key: "lastPrice", type: "number", sortable: true, value: (line) => line.closingCost },
    { key: "dayChange", type: "number", sortable: true, value: () => null },
    { key: "dailyPnl", type: "number", sortable: true, value: (line) => line.dailyPnl },
    { key: "unrealizedPnl", type: "number", sortable: true, value: (line) => line.pnl },
    { key: "decision", type: "enum", sortable: true, value: (line) => line.decision },
    { key: "coverage", type: "enum", sortable: false, value: (line) => (line.naked > 0 ? [COVER_NONE] : []) },
  ];
}
```

Dans `apps/web/src/lib/riskReport.ts`, à côté de `usedBadge` :

```ts
/** A condor leg left naked by its closed wing, or the condor that holds it (spec of sub-project 34, §5). */
export function uncoveredBadge(quantity: number): CoverageBadge {
  return { variant: COVERAGE_SOURCE_VARIANT[COVER_NONE], label: `${COVER_NONE} ×${quantity}`, tooltip: null };
}
```

- [ ] **Step 5: The twelfth view**

`useStrategyBoxViews` prend un cinquième paramètre `condorColumns: readonly ColumnMeta[]` et
ajoute, après `sharesCallBelow` :

```ts
  const condors = useTableView(tableViewKey(accountId, `${prefix}:condors`), condorColumns);
```

puis `condors` dans l'objet rendu. Mettre à jour le commentaire (« Twelve `useTableView` »).

- [ ] **Step 6: `CondorRows.tsx`**

```tsx
import { Fragment } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CondorLegLine, CondorLine } from "@ib/coverage";
import { formatContractLabel } from "@ib/ledger";
import { Badge } from "@ib/ui/badge";
import { Button } from "@ib/ui/button";
import { TableCell, TableRow } from "@ib/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ib/ui/tooltip";
import { NUMERIC, toneOf } from "@/components/PositionRow";
import { formatDayChange, formatMoney, formatPrice } from "@/lib/format";
import { decisionBadge, uncoveredBadge } from "@/lib/riskReport";
import { cn } from "@/lib/utils";

/**
 * One condor and, unfolded, its four legs, on the twelve POSITION_COLUMNS (spec of sub-project 34,
 * §3–§4). A click on the row opens the chart like any position line; the chevron only folds.
 */
export function CondorRows({
  line,
  sector,
  unfolded,
  onFold,
  onChart,
  charted,
}: {
  line: CondorLine;
  sector: string | null;
  unfolded: boolean;
  onFold: () => void;
  onChart: () => void;
  charted: boolean;
}) {
  const { t } = useTranslation();
  const decision = decisionBadge(line.decision);
  const partial = line.realizedPnl !== null && line.realizedPnl !== 0;
  const pnl = formatMoney(line.pnl);
  return (
    <Fragment>
      <TableRow onClick={onChart} data-state={charted ? "selected" : undefined} className="cursor-pointer">
        <TableCell className="font-medium">
          <span className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={(event) => {
                event.stopPropagation();
                onFold();
              }}
              aria-label={t(unfolded ? "journal.collapse" : "journal.expand")}
            >
              {unfolded ? <ChevronDown /> : <ChevronRight />}
            </Button>
            {line.title}
          </span>
        </TableCell>
        <TableCell className="text-muted-foreground">{line.label}</TableCell>
        <TableCell>{sector && <Badge variant="outline">{sector}</Badge>}</TableCell>
        <TableCell className={NUMERIC}>{formatMoney(line.marketValue)}</TableCell>
        <TableCell className={NUMERIC}>{line.quantity}</TableCell>
        <TableCell className={NUMERIC}>{formatPrice(line.credit)}</TableCell>
        <TableCell className={NUMERIC}>{formatPrice(line.closingCost)}</TableCell>
        <TableCell className={NUMERIC}>{formatDayChange(null)}</TableCell>
        <TableCell className={cn(NUMERIC, toneOf(line.dailyPnl))}>{formatMoney(line.dailyPnl)}</TableCell>
        <TableCell className={cn(NUMERIC, toneOf(line.pnl))}>
          {partial ? (
            <Tooltip>
              <TooltipTrigger render={<span>{pnl}</span>} />
              <TooltipContent>{t("strategyPositions.realizedPart", { amount: formatMoney(line.realizedPnl) })}</TooltipContent>
            </Tooltip>
          ) : (
            pnl
          )}
        </TableCell>
        <TableCell>{decision && <Badge variant={decision.variant}>{decision.label}</Badge>}</TableCell>
        <TableCell>{line.naked > 0 && <NakedBadge quantity={line.naked} />}</TableCell>
      </TableRow>
      {unfolded && line.legs.map((leg) => <LegRow key={`${leg.contract.right}${leg.contract.strike}`} leg={leg} sector={sector} />)}
    </Fragment>
  );
}

function NakedBadge({ quantity }: { quantity: number }) {
  const badge = uncoveredBadge(quantity);
  return <Badge variant={badge.variant}>{badge.label}</Badge>;
}

function LegRow({ leg, sector }: { leg: CondorLegLine; sector: string | null }) {
  const { t } = useTranslation();
  return (
    <TableRow data-testid="condor-leg" className="text-muted-foreground">
      <TableCell className="pl-10">{formatContractLabel(leg.contract)}</TableCell>
      <TableCell>{leg.closed ? `${leg.label} · ${t("strategyPositions.closedLeg")}` : leg.label}</TableCell>
      <TableCell>{sector && <Badge variant="outline">{sector}</Badge>}</TableCell>
      <TableCell className={NUMERIC}>{formatMoney(leg.marketValue)}</TableCell>
      <TableCell className={NUMERIC}>{leg.quantity}</TableCell>
      <TableCell className={NUMERIC}>{formatPrice(leg.openPrice)}</TableCell>
      <TableCell className={NUMERIC}>{formatPrice(leg.lastPrice)}</TableCell>
      <TableCell className={cn(NUMERIC, toneOf(leg.dayChange))}>{formatDayChange(leg.dayChange)}</TableCell>
      <TableCell className={cn(NUMERIC, toneOf(leg.dailyPnl))}>{formatMoney(leg.dailyPnl)}</TableCell>
      <TableCell className={cn(NUMERIC, toneOf(leg.pnl))}>{formatMoney(leg.pnl)}</TableCell>
      <TableCell />
      <TableCell>{leg.naked > 0 && <NakedBadge quantity={leg.naked} />}</TableCell>
    </TableRow>
  );
}
```

Vérifier que `formatDayChange(null)` rend « — » (sinon écrire `"—"`), et que `Button` accepte
`size="icon-xs"` (c'est ce qu'utilise `JournalPage`).

- [ ] **Step 7: Wire the page**

Dans `StrategyPositionsPage.tsx` :

1. Importer `condorPositions`, `isCondorBoxId`, `type CondorLine` de `@ib/coverage`,
   `condorColumnSpecs` de `@/lib/condorColumns`, `CondorRows` de `@/components/CondorRows`,
   et `useState` de `react`.
2. `const condorSpecs = useMemo(() => condorColumnSpecs(sectorOf), [sectorOf]);` et passer
   `condorSpecs` en cinquième argument de `useStrategyBoxViews`.
3. À côté de `boxes` :

```ts
  const condors = useMemo(
    () => (ready && active !== undefined && strategy === "condors" ? condorPositions(rows, pricedSnapshot(snapshot, report), active) : []),
    [ready, rows, strategy, snapshot, report, active],
  );
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
```

(le `useState` **avant** le `return` anticipé de chargement : les hooks ne varient jamais).

4. Les encadrés de lignes excluent maintenant les condors :
   `defs.filter((def) => !isShareBoxId(def.id) && !isCondorBoxId(def.id))`, et un troisième flux :

```ts
  const searchedCondors = searchBoxes(
    defs.filter((def) => isCondorBoxId(def.id)).map((def) => ({ id: def.id, title: t(def.titleKey), all: condors })),
    condorSpecs,
    { text: search.applied, ticker: (line: CondorLine) => line.contract.ticker },
  );
```

5. `expiryChoices` reçoit aussi les échéances des condors :
   `[...searchedLines.flatMap(...), ...searchedCondors.flatMap((box) => box.searched.map((line) => ({ expiry: line.contract.expiry })))]`.
6. `const condorBoxes = new Map(filterBoxes(searchedCondors, condorSpecs, viewOf, expiry !== null).map((box) => [box.id, box]));`
   et la carte « aucun résultat » teste aussi `condorBoxes.size === 0`.
7. Dans la boucle `defs.map`, avant `lines.get` :

```tsx
        const condorBox = condorBoxes.get(def.id);
        if (condorBox) {
          return (
            <CondorsBox
              key={def.id}
              box={condorBox}
              specs={condorSpecs}
              table={views[def.id]}
              scope={scope}
              sectorOf={sectorOf}
              chart={chart}
              unfolded={unfolded}
              onFold={(id) =>
                setUnfolded((current) => {
                  const next = new Set(current);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
            />
          );
        }
```

8. Le composant, dans le même fichier, après `LinesBox` :

```tsx
function CondorsBox({
  box,
  specs,
  table,
  scope,
  sectorOf,
  chart,
  unfolded,
  onFold,
}: {
  box: PreparedBox<CondorLine>;
  specs: ReturnType<typeof condorColumnSpecs>;
  table: TableViewState;
  scope: readonly PositionsStrategy[];
  sectorOf: SectorOf;
  chart: OpenChart;
  unfolded: ReadonlySet<string>;
  onFold: (id: string) => void;
}) {
  return (
    <FilteredTableBox
      title={box.title}
      columns={POSITION_COLUMNS}
      labelKey="positions.columns"
      minWidth="70rem"
      specs={specs}
      facetRows={box.facetRows}
      rows={box.rows}
      table={table}
      emptyKey="positions.noResults"
      rowKey={(line) => line.id}
      renderRow={(line) => {
        const key = `condors|${line.id}`;
        return (
          <Fragment>
            <CondorRows
              line={line}
              sector={sectorOf(line.contract.ticker)}
              unfolded={unfolded.has(line.id)}
              onFold={() => onFold(line.id)}
              onChart={() => chart.toggle(key)}
              charted={chart.isOpen(key)}
            />
            {chart.isOpen(key) && (
              <PositionChartRow ticker={line.contract.ticker} strategies={scope} columnCount={POSITION_COLUMNS.length} currency={line.contract.currency} />
            )}
          </Fragment>
        );
      }}
    />
  );
}
```

9. Le doc-commentaire de `StrategyPositionsPage` mentionne la page Condors : « the Condors show
   one line per open condor of their journal, legs unfolded under it (sub-project 34) ».

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd apps/web && npx vitest run condorColumns StrategyPositionsPage useStrategyBoxViews strategyBoxes`
Expected: PASS. Puis `npx tsc -p . --noEmit` depuis `apps/web` (typage de `StrategyBoxId`
élargi : tout `Record<StrategyBoxId, …>` doit maintenant avoir `condors`).

- [ ] **Step 9: Commit** (cocher les cases de la tâche 2, même commit)

```bash
git add apps/web/src packages/coverage/src docs/plans/2026-09-28-positions-condors.md
git commit -m "Positions Condors : un condor par ligne, jambes dépliables, P/L total et décision"
```

---

### Task 3: Documentation, vérification réelle, `pnpm check`

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/specs/2026-09-28-positions-condors-design.md` (statut)
- Modify: `docs/points-reportes.md` (section du sous-projet 34, si la revue en laisse)

- [ ] **Step 1: CLAUDE.md**

Dans la règle « **Les positions d'une stratégie sont une vue calculée** », après la phrase qui se
termine par « …servies par un seul composant : ses encadrés sont déclarés dans `STRATEGY_BOXES` … et un encadré
sans ligne ne se rend pas. », remplacer « **Un condor se lit sur ses jambes** — son composite n'a ni right ni
strike, donc rien ne le valorise — » par :

« **La page Condors montre un condor par ligne** (sous-projet 34) : `condorPositions`
(`packages/coverage/src/condors.ts`) lit les composites ouverts du journal et prix leurs jambes au
snapshot par `contractId`, dépliables sous le condor ; prix init. = crédit, dernier prix = coût
net de clôture des jambes ouvertes, P/L = réalisé des jambes fermées + latent des ouvertes, décision
`evaluateBuyback(crédit, coût)` pour un condor complet seulement, variation du jour toujours « — ».
**Une jambe nue y reste dans son condor**, par exception à la part nue qui quitte une page de
stratégie : badge `UNCOVERED ×n` du nombre que `migratedContracts` retire aux Condors
(`condorsNakedByContract`), donné d'abord aux jambes dont l'aile est fermée ; la page Autres la
montre aussi. Pour tout le reste, un condor se lit sur ses jambes — son composite n'a ni right ni
strike, donc rien ne le valorise — »

Dans le registre des sous-projets, ajouter la ligne :
`| 34 | La page Positions Condors, un condor par ligne | fait (2026-09-28) |`

- [ ] **Step 2: Spec**

Statut : `Statut : livré (2026-09-28).`

- [ ] **Step 3: `pnpm check`**

Run: `pnpm check` (racine du worktree), **une seule fois**.
Expected: lint, typage, build et tous les tests verts. Corriger ce qui casse (un test d'une autre
page qui listait les encadrés Condors, `router.test.tsx`, `AppLayout.test.tsx`…) en expliquant
dans le commit pourquoi l'attente change.

- [ ] **Step 4: Vérification réelle**

Depuis la racine du dépôt principal, `run-frontend` avec `--seed` et `--agent`, capture de
`/accounts/<compte démo>/positions/condors` avant et après un clic sur le chevron du condor QQQ.
Vérifier : une ligne « QQQ Oct16'26 IC 480/485/520/525 », quatre jambes dépliées, colonnes
alignées sur celles des autres pages.

- [ ] **Step 5: Commit** (cocher les cases de la tâche 3, même commit)

```bash
git add CLAUDE.md docs
git commit -m "Sous-projet 34 : CLAUDE.md, registre et statut de la spec"
```
