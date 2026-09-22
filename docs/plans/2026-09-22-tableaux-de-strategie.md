# Sous-projet 29 — Tableaux de la Wheel et des LEAPS par point de contrôle : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal :** ranger les lignes des pages Positions Wheel et LEAPS dans davantage de tableaux, un
par point de contrôle : actions assignées sans call, avec call au-dessus ou en dessous du prix
d'assignation, ventes de calls, ventes de puts ; LEAPS sans call vendu et avec call vendu.

**Architecture :** une vue calculée de plus dans `packages/coverage`. Un nouveau fichier
`strategyBoxes.ts` coupe une ligne d'actions Wheel ou une ligne LEAPS en une part libre et une
part couverte, puis range toutes les lignes de `StrategyPositions` par identifiant d'encadré.
`StrategyLine` gagne `used`, la part de la ligne qu'utilise la couverture. `apps/web` déclare
les encadrés de chaque page, une vue de tri et de filtre par encadré, et les titres. Rien n'est
stocké, aucune table Dexie, aucun serveur.

**Tech Stack :** TypeScript, React 19, react-i18next, Vitest, Testing Library, `fake-indexeddb`.

**Spec :** `docs/specs/2026-09-22-tableaux-de-strategie-design.md`

## Global Constraints

- **Rien dans `apps/api`, aucune table Dexie, aucune migration.** Une tâche qui semble en
  réclamer une est un **signal d'arrêt** : s'arrêter et demander.
- **Une valeur absente reste `null`**, jamais `0`, et s'affiche « — ».
- **Prix moyen d'assignation du ticker pour les deux parts** (arbitré le 2026-09-22), jamais le
  prix des lots FIFO.
- **Une part couverte dont la comparaison est impossible** (`averageCallStrike` ou
  `averageAssignmentPrice` à `null`) va dans `sharesCallBelow`, avec `callStrikeBelowAssignment`
  à `false`.
- **Les graphes ne changent pas** : `PositionChartRow` garde le ticker et la portée de la
  stratégie de la page, quel que soit l'encadré.
- **Condors et Autres ne changent pas** d'encadrés.
- **Textes** : aucune chaîne visible en dur dans un composant ; `fr.json` **et** `en.json` dans
  le même commit.
- **Un test doit échouer si le comportement change.** Aucun hook moqué : les tests de page
  sèment `fake-indexeddb` et rendent le vrai composant.
- **Commits en français**, sujet à l'impératif, terminés par
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`, et **la case du plan
  cochée dans le même commit que la tâche**.
- **Commandes de test ciblées** : depuis `packages/coverage`, `npx vitest run <motif>` ; depuis
  `apps/web`, `npx vitest run <motif>`. La forme `pnpm --filter web test -- <motif>` **ne
  filtre pas**.
- **`pnpm check` une seule fois, à la fin** (tâche 4).

## Structure des fichiers

| Fichier | Responsabilité | Tâches |
|---|---|---|
| `packages/coverage/src/strategy.ts` | `StrategyLine.used` | 1 |
| `packages/coverage/src/strategyBoxes.ts` (nouveau) | identifiants d'encadré, découpage, rangement | 1 |
| `packages/coverage/src/strategyBoxes.test.ts` (nouveau) | tests du découpage et du rangement | 1 |
| `packages/coverage/src/index.ts` | export du nouveau fichier | 1 |
| `apps/web/src/lib/riskReport.ts` | badge et filtre Couverture d'une option achetée lus sur `line.used` | 2 |
| `apps/web/src/lib/strategyBoxes.ts` | encadrés déclarés par page | 2 |
| `apps/web/src/hooks/useStrategyBoxViews.ts` | une vue par identifiant | 2 |
| `apps/web/src/pages/StrategyPositionsPage.tsx` | lit `strategyBoxContents` | 2 |
| `apps/web/src/i18n/{fr,en}.json` | titres | 2 |
| `apps/web/src/pages/StrategyPositions*.test.tsx` | tests de page | 2 |
| `CLAUDE.md`, spec | documentation | 3 |

---

### Task 1: Découpage et rangement dans `packages/coverage`

**Files:**
- Modify: `packages/coverage/src/strategy.ts` (interface `StrategyLine`, fonction `line`)
- Create: `packages/coverage/src/strategyBoxes.ts`
- Create: `packages/coverage/src/strategyBoxes.test.ts`
- Modify: `packages/coverage/src/index.ts`
- Test: `packages/coverage/src/strategy.test.ts` (ajuster si un `toEqual` complet casse)

**Interfaces:**
- Consumes: `StrategyLine`, `WheelShareLine`, `StrategyPositions`, `PositionsStrategy` (`strategy.ts`), `DetailGroupId` (`constants.ts`).
- Produces (exportés par `@ib/coverage`) :
  ```ts
  // StrategyLine gains:
  /** Long options only: min(|quantity|, position.usedQuantity); `null` otherwise or without a position. */
  used: number | null;

  export const SHARE_BOX_IDS: readonly ["sharesUncovered", "sharesCallAbove", "sharesCallBelow"];
  export type ShareBoxId = (typeof SHARE_BOX_IDS)[number];
  export const LINE_BOX_IDS: readonly ["long", "optionBuys", "optionSells", "other", "callSells", "putSells", "leapsUncovered", "leapsCovered"];
  export type LineBoxId = (typeof LINE_BOX_IDS)[number];
  export type StrategyBoxId = ShareBoxId | LineBoxId;
  export function isShareBoxId(id: StrategyBoxId): id is ShareBoxId;
  export interface SplitLine<T> { uncovered: T | null; covered: T | null }
  export function splitWheelShares(line: WheelShareLine): SplitLine<WheelShareLine>;
  export function splitLeaps(line: StrategyLine): SplitLine<StrategyLine>;
  export interface StrategyBoxContents { shares: Record<ShareBoxId, WheelShareLine[]>; lines: Record<LineBoxId, StrategyLine[]> }
  export function strategyBoxContents(positions: StrategyPositions, strategy: PositionsStrategy): StrategyBoxContents;
  ```

- [x] **Step 1: Ajouter `used` à `StrategyLine`, avec son test**

Dans `strategy.ts`, ajouter le champ à l'interface `StrategyLine` (après `coverage`) et le
calculer dans `line()` :

```ts
const bought = kind === "long_call" || kind === "long_put";
// ...
used: bought && priced ? Math.min(Math.abs(quantity), priced.analyzed.usedQuantity) : null,
```

Test à ajouter dans `strategy.test.ts`, dans `describe("leapsPositions")` :

```ts
it("tells how much of a LEAPS line the cover uses, capped by the line, null on what is sold", () => {
  const { optionBuys, optionSales } = leapsPositions(rows, snapshot);
  expect(optionBuys[0].used).toBe(1);
  expect(optionSales[0].used).toBeNull();
  expect(leapsPositions(rows, null).optionBuys[0].used).toBeNull();
});
```

Run: `cd packages/coverage && npx vitest run strategy` — le nouveau test échoue d'abord
(`used` indéfini), puis passe. Si un test existant compare une `StrategyLine` entière par
`toEqual`, y ajouter `used` avec la valeur attendue, jamais `expect.anything()`.

- [x] **Step 2: Écrire les tests de `strategyBoxes.test.ts` (échouent : fichier absent)**

```ts
import { describe, expect, it } from "vitest";
import type { ContractKey } from "@ib/ledger";
import type { StrategyLine, StrategyPositions, WheelShareLine } from "./strategy.ts";
import { splitLeaps, splitWheelShares, strategyBoxContents } from "./strategyBoxes.ts";
import { DETAIL_GROUPS, KIND_LABELS, type DetailGroupId, type PositionKind } from "./constants.ts";

function share(overrides: Partial<WheelShareLine> = {}): WheelShareLine {
  return {
    ticker: "XYZ", currency: "USD", quantity: 200, averageAssignmentPrice: 17, assignedTotal: 3400,
    openCallContracts: 1, averageCallStrike: 15, coveredShares: 100, lastPrice: 18, unrealizedPnl: 200,
    dailyPnl: 40, dayChange: 0.01, callStrikeBelowAssignment: true, ...overrides,
  };
}

const opt = (right: "C" | "P", strike: number, expiry: string): ContractKey => ({ ticker: "XYZ", secType: "OPT", right, strike, expiry, currency: "USD" });

function strategyLine(kind: PositionKind, overrides: Partial<StrategyLine> = {}): StrategyLine {
  return {
    contract: opt(kind === "short_put" ? "P" : "C", 15, "2027-06-18"), kind, label: KIND_LABELS[kind], quantity: 2, avgPrice: 3,
    lastPrice: 4, marketValue: 800, unrealizedPnl: 200, dailyPnl: 20, dayChange: 0.05, decision: null, position: null,
    coverage: [], used: 1, ...overrides,
  };
}

function positions(shares: WheelShareLine[], groups: Partial<Record<DetailGroupId, StrategyLine[]>>): StrategyPositions {
  const empty = Object.fromEntries(DETAIL_GROUPS.map((group) => [group.id, [] as StrategyLine[]])) as Record<DetailGroupId, StrategyLine[]>;
  return { shares, groups: { ...empty, ...groups } };
}

describe("splitWheelShares", () => {
  it("cuts 200 shares under one call into 100 free and 100 covered, prorating the amounts", () => {
    const { uncovered, covered } = splitWheelShares(share());
    expect(uncovered).toEqual(share({
      quantity: 100, assignedTotal: 1700, openCallContracts: 0, averageCallStrike: null, coveredShares: 0,
      unrealizedPnl: 100, dailyPnl: 20, callStrikeBelowAssignment: false,
    }));
    expect(covered).toEqual(share({ quantity: 100, assignedTotal: 1700, coveredShares: 100, unrealizedPnl: 100, dailyPnl: 20 }));
  });

  it("keeps a null amount null in both parts", () => {
    const { uncovered, covered } = splitWheelShares(share({ assignedTotal: null, averageAssignmentPrice: null, unrealizedPnl: null, dailyPnl: null, dayChange: null }));
    expect(uncovered).toMatchObject({ assignedTotal: null, unrealizedPnl: null, dailyPnl: null });
    expect(covered).toMatchObject({ assignedTotal: null, unrealizedPnl: null, dailyPnl: null });
  });

  it("has no free part when everything is covered, and no covered part without a call", () => {
    expect(splitWheelShares(share({ quantity: 100, coveredShares: 100 })).uncovered).toBeNull();
    expect(splitWheelShares(share({ openCallContracts: 0, averageCallStrike: null, coveredShares: 0, callStrikeBelowAssignment: false })).covered).toBeNull();
  });
});

describe("splitLeaps", () => {
  it("cuts 2 LEAPS with 1 used into 1 free and 1 covered, prorating the amounts", () => {
    const { uncovered, covered } = splitLeaps(strategyLine("long_call"));
    expect(uncovered).toEqual(strategyLine("long_call", { quantity: 1, marketValue: 400, unrealizedPnl: 100, dailyPnl: 10, used: 0 }));
    expect(covered).toEqual(strategyLine("long_call", { quantity: 1, marketValue: 400, unrealizedPnl: 100, dailyPnl: 10, used: 1 }));
  });

  it("leaves a LEAPS the snapshot does not hold whole in the free part, without a used count", () => {
    const line = strategyLine("long_call", { used: null, lastPrice: null, marketValue: null, unrealizedPnl: null, dailyPnl: null, dayChange: null });
    expect(splitLeaps(line)).toEqual({ uncovered: line, covered: null });
  });

  it("has no free part when every LEAPS is used", () => {
    expect(splitLeaps(strategyLine("long_call", { used: 2 })).uncovered).toBeNull();
  });
});

describe("strategyBoxContents — Wheel", () => {
  it("routes the free part, then the covered part by the call against the assignment price", () => {
    const below = share({ ticker: "BLW" });
    const above = share({ ticker: "ABV", averageCallStrike: 20, callStrikeBelowAssignment: false });
    const equal = share({ ticker: "EQL", averageCallStrike: 17, callStrikeBelowAssignment: false });
    const unknown = share({ ticker: "UNK", averageAssignmentPrice: null, assignedTotal: null, callStrikeBelowAssignment: false });
    const boxes = strategyBoxContents(positions([above, below, equal, unknown], {}), "wheel");
    expect(boxes.shares.sharesUncovered.map((line) => line.ticker)).toEqual(["ABV", "BLW", "EQL", "UNK"]);
    expect(boxes.shares.sharesCallAbove.map((line) => line.ticker)).toEqual(["ABV", "EQL"]);
    expect(boxes.shares.sharesCallBelow.map((line) => [line.ticker, line.callStrikeBelowAssignment])).toEqual([["BLW", true], ["UNK", false]]);
  });

  it("splits the option sales into calls and puts", () => {
    const call = strategyLine("short_call", { quantity: -1, used: null });
    const put = strategyLine("short_put", { quantity: -1, used: null });
    const boxes = strategyBoxContents(positions([], { optionSells: [call, put] }), "wheel");
    expect(boxes.lines.callSells).toEqual([call]);
    expect(boxes.lines.putSells).toEqual([put]);
  });
});

describe("strategyBoxContents — LEAPS", () => {
  it("splits the LEAPS bought into free and covered, keeps the call sales, and never loses a put sale", () => {
    const leaps = strategyLine("long_call");
    const call = strategyLine("short_call", { quantity: -1, used: null });
    const put = strategyLine("short_put", { quantity: -1, used: null });
    const boxes = strategyBoxContents(positions([], { optionBuys: [leaps], optionSells: [call, put] }), "leaps");
    expect(boxes.lines.leapsUncovered.map((line) => line.quantity)).toEqual([1]);
    expect(boxes.lines.leapsCovered.map((line) => line.quantity)).toEqual([1]);
    expect(boxes.lines.callSells).toEqual([call]);
    expect(boxes.lines.other).toEqual([put]);
  });
});

describe("strategyBoxContents — Condors and Others", () => {
  it("passes the Positions groups through untouched", () => {
    const wing = strategyLine("long_put", { used: 1 });
    const boxes = strategyBoxContents(positions([], { optionBuys: [wing] }), "condors");
    expect(boxes.lines.optionBuys).toEqual([wing]);
    expect(boxes.lines.leapsUncovered).toEqual([]);
    expect(boxes.shares.sharesUncovered).toEqual([]);
  });
});
```

Run: `cd packages/coverage && npx vitest run strategyBoxes` — Expected: FAIL (module introuvable).

- [x] **Step 3: Écrire `strategyBoxes.ts`**

```ts
import { DETAIL_GROUPS, type DetailGroupId } from "./constants.ts";
import type { PositionsStrategy, StrategyLine, StrategyPositions, WheelShareLine } from "./strategy.ts";

/** The boxes that show the Wheel's assigned shares, in WHEEL_SHARE_COLUMNS (spec of sub-project 29, §2). */
export const SHARE_BOX_IDS = ["sharesUncovered", "sharesCallAbove", "sharesCallBelow"] as const;
export type ShareBoxId = (typeof SHARE_BOX_IDS)[number];

/** The boxes that show StrategyLines: the Positions groups, then the checkpoints of sub-project 29. */
export const LINE_BOX_IDS = ["long", "optionBuys", "optionSells", "other", "callSells", "putSells", "leapsUncovered", "leapsCovered"] as const;
export type LineBoxId = (typeof LINE_BOX_IDS)[number];

export type StrategyBoxId = ShareBoxId | LineBoxId;

export function isShareBoxId(id: StrategyBoxId): id is ShareBoxId {
  return (SHARE_BOX_IDS as readonly string[]).includes(id);
}

/** One line cut in two: what nothing uses, and what a sold call uses. A part of quantity 0 is `null`. */
export interface SplitLine<T> {
  uncovered: T | null;
  covered: T | null;
}

const scale = (value: number | null, ratio: number): number | null => (value === null ? null : value * ratio);

/**
 * The Wheel's shares of one ticker cut into the free part and the part its calls cover (spec §4).
 * Both parts keep the ticker's average assignment price, never the price of the lots the journal
 * would deliver: the split finds forgotten shares, it does not predict a realized P/L.
 */
export function splitWheelShares(line: WheelShareLine): SplitLine<WheelShareLine> {
  const part = (quantity: number): WheelShareLine => {
    const ratio = quantity / line.quantity;
    return {
      ...line,
      quantity,
      assignedTotal: scale(line.assignedTotal, ratio),
      unrealizedPnl: scale(line.unrealizedPnl, ratio),
      dailyPnl: scale(line.dailyPnl, ratio),
    };
  };
  const free = line.quantity - line.coveredShares;
  return {
    uncovered: free > 0 ? { ...part(free), openCallContracts: 0, averageCallStrike: null, coveredShares: 0, callStrikeBelowAssignment: false } : null,
    covered: line.coveredShares > 0 ? { ...part(line.coveredShares), coveredShares: line.coveredShares } : null,
  };
}

/** A LEAPS line cut into the free part and the part the cover uses (`used`, spec §3). */
export function splitLeaps(line: StrategyLine): SplitLine<StrategyLine> {
  const total = Math.abs(line.quantity);
  const used = line.used ?? 0;
  const part = (count: number, partUsed: number | null): StrategyLine => {
    const ratio = count / total;
    return {
      ...line,
      quantity: Math.sign(line.quantity) * count,
      marketValue: scale(line.marketValue, ratio),
      unrealizedPnl: scale(line.unrealizedPnl, ratio),
      dailyPnl: scale(line.dailyPnl, ratio),
      used: partUsed,
    };
  };
  const free = total - used;
  return {
    uncovered: free > 0 ? (free === total && line.used === null ? line : part(free, line.used === null ? null : 0)) : null,
    covered: used > 0 ? part(used, used) : null,
  };
}

/** The covered part goes above only when both prices are known and the call is at or above. */
function isCallAbove(line: WheelShareLine): boolean {
  return line.averageCallStrike !== null && line.averageAssignmentPrice !== null && line.averageCallStrike >= line.averageAssignmentPrice;
}

/**
 * Every line of a strategy's page, by box id (spec of sub-project 29). The Positions groups pass
 * through for every strategy; the Wheel and the LEAPS pages declare the checkpoint boxes instead
 * (apps/web/src/lib/strategyBoxes.ts). Computed, never stored.
 */
export function strategyBoxContents(positions: StrategyPositions, strategy: PositionsStrategy): StrategyBoxContents {
  const shares = Object.fromEntries(SHARE_BOX_IDS.map((id) => [id, [] as WheelShareLine[]])) as Record<ShareBoxId, WheelShareLine[]>;
  const lines = Object.fromEntries(LINE_BOX_IDS.map((id) => [id, [] as StrategyLine[]])) as Record<LineBoxId, StrategyLine[]>;
  for (const group of DETAIL_GROUPS) lines[group.id as DetailGroupId] = [...positions.groups[group.id]];

  const sells = positions.groups.optionSells;
  lines.callSells = sells.filter((line) => line.kind === "short_call");
  lines.putSells = sells.filter((line) => line.kind === "short_put");

  if (strategy === "wheel") {
    for (const line of positions.shares) {
      const { uncovered, covered } = splitWheelShares(line);
      if (uncovered) shares.sharesUncovered.push(uncovered);
      if (covered) (isCallAbove(covered) ? shares.sharesCallAbove : shares.sharesCallBelow).push(covered);
    }
  }
  if (strategy === "leaps") {
    for (const line of positions.groups.optionBuys) {
      const { uncovered, covered } = splitLeaps(line);
      if (uncovered) lines.leapsUncovered.push(uncovered);
      if (covered) lines.leapsCovered.push(covered);
    }
    // The LEAPS journal sells calls only; a sold put, should one appear, is never lost silently.
    lines.other = [...lines.other, ...sells.filter((line) => line.kind !== "short_call")];
  }
  return { shares, lines };
}

export interface StrategyBoxContents {
  shares: Record<ShareBoxId, WheelShareLine[]>;
  lines: Record<LineBoxId, StrategyLine[]>;
}
```

Ajouter `export * from "./strategyBoxes.ts";` à `packages/coverage/src/index.ts`.

- [x] **Step 4: Lancer les tests du paquet**

Run: `cd packages/coverage && npx vitest run` — Expected: PASS, tous. Puis
`npx tsc --noEmit -p packages/coverage` depuis la racine (ou le script `typecheck` du paquet
s'il existe) : aucun appelant de `StrategyLine` ne doit manquer `used`.

- [x] **Step 5: Cocher les cases de la tâche 1 et commiter**

```bash
git add packages/coverage docs/plans/2026-09-22-tableaux-de-strategie.md
git commit -m "Coupe les lignes Wheel et LEAPS en part libre et part couverte

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Les encadrés des pages Wheel et LEAPS

**Files:**
- Modify: `apps/web/src/lib/riskReport.ts` (`strategyCoverageBadges`, `strategyCoverageValues`)
- Modify: `apps/web/src/lib/strategyBoxes.ts`
- Modify: `apps/web/src/hooks/useStrategyBoxViews.ts`
- Modify: `apps/web/src/pages/StrategyPositionsPage.tsx`
- Modify: `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`
- Test: `apps/web/src/pages/StrategyPositionsPage.test.tsx`, `apps/web/src/pages/StrategyPositionsChart.test.tsx`, `apps/web/src/lib/strategyColumns.test.ts` si besoin

**Interfaces:**
- Consumes (tâche 1) : `strategyBoxContents`, `isShareBoxId`, `SHARE_BOX_IDS`, `LINE_BOX_IDS`, `StrategyBoxId`, `ShareBoxId`, `LineBoxId`, `StrategyLine.used`.
- Produces : `STRATEGY_BOXES: Record<PositionsStrategy, readonly StrategyBoxDef[]>` avec `StrategyBoxDef { id: StrategyBoxId; titleKey: string }` ; `useStrategyBoxViews(...)` → `Record<StrategyBoxId, TableViewState>`.

- [x] **Step 1: Réécrire les tests de page Wheel et LEAPS (échouent)**

Dans `StrategyPositionsPage.test.tsx`, les titres « Actions assignées », « Ventes d'options » et
« Achats d'options » des pages Wheel et LEAPS disparaissent. Le seed (`seed()`) donne 200 MQZA
assignées à 17 sous un call 15, un put XOM et, côté LEAPS, 1 LEAPS ZZZ utilisé par 1 call.
Remplacer les attentes ainsi :

- « lists the assigned shares… » devient deux attentes :
  ```ts
  const free = await rowIn("Actions assignées sans call", "MQZA");
  expect(texts(free)).toEqual(["MQZA", "", "100", "17.00", "—", "$1,700.00", "18.00", "—", "—", "$100.00", "unused"]);
  const covered = await rowIn("Actions assignées, call < assignation", "MQZA");
  expect(texts(covered)).toEqual(["MQZA", "", "100", "17.00", "15.00", "$1,700.00", "18.00", "—", "—", "$100.00", "used 100/100"]);
  expect(cells(covered)[4]).toHaveClass("bg-warning/25");
  expect(screen.queryByLabelText("Actions assignées, call ≥ assignation")).not.toBeInTheDocument();
  ```
- « lists the option sales… » : le call dans `"Ventes de calls"`, le put dans `"Ventes de puts"`,
  mêmes `texts` qu'avant ; le call ZZZ absent de `"Ventes de calls"`.
- « shows no box at all… » : vérifier l'absence des cinq titres Wheel.
- « shows the day's move… » : `"Ventes de calls"`.
- « prorates the assigned shares' day P&L… » : 100 actions sous 1 call, tout est couvert : la
  ligne est dans `"Actions assignées, call < assignation"`, `+1.0%` et `$20.00` comme avant, et
  `"Actions assignées sans call"` est absent.
- LEAPS : la ligne ZZZ est dans `"LEAPS avec call vendu"`, mêmes `texts` qu'avant (`used 1/1`) ;
  `"LEAPS sans call vendu"` absent ; le call ZZZ dans `"Ventes de calls"` ; `"Actions"` absent.
- « a call that lost its cover » : call dans `"Ventes de calls"`, actions dans
  `"Actions assignées, call < assignation"` avec les mêmes `texts` qu'avant (`used 100/100`).
- Recherche, échéances, filtres : `"Actions assignées"` → `"Actions assignées sans call"` ;
  « keeps a box its own column filter empties » sur `"Ventes de puts"` (le XOM revient) ;
  « filters every box on the chosen expiry and drops the shares » : les deux encadrés
  d'actions disparaissent, `"Ventes de calls"` porte le chip `Position : Oct16'26` ;
  « sorts the assigned shares » sur `"Actions assignées sans call"`.
- « remembers each box's view under its own key » : clé
  `ib2:tableView:beta:positions:wheel:callSells` avec `criteria: { position: "XOM" }` ; attendre
  que `"Ventes de calls"` affiche « Aucune position ne correspond. » et que `"Ventes de puts"`
  montre toujours `XOM Oct16'26 110 Put`.

Ajouter un test pour l'encadré du dessus, avec un call 20 au lieu du 15 :

```ts
/** A MQZA 20 call sold on the 200 Wheel shares assigned at 17: struck above the assignment price. */
const MARA_CALL_20: Transaction = { ...MARA_CALL, externalId: "flex:trade:405", symbol: "MQZA  261016C00020000", strike: 20 };

it("puts shares under a call struck above the assignment price in their own box", async () => {
  await db.transactions.bulkAdd([...SAMPLE_JOURNAL_TRANSACTIONS, MARA_CALL_20]);
  await db.snapshots.put({
    ...SNAPSHOT,
    positions: SNAPSHOT.positions.map((position) =>
      position === SNAPSHOT.positions[4] ? { ...position, strike: 20, description: "MQZA 16OCT26 20 C" } : position,
    ),
  });
  renderPage("wheel");
  const covered = await rowIn("Actions assignées, call ≥ assignation", "MQZA");
  expect(texts(covered)).toEqual(["MQZA", "", "100", "17.00", "20.00", "$1,700.00", "18.00", "—", "—", "$100.00", "used 100/100"]);
  expect(cells(covered)[4]).not.toHaveClass("bg-warning/25");
  expect(screen.queryByLabelText("Actions assignées, call < assignation")).not.toBeInTheDocument();
});
```

Et un test d'ordre des encadrés de la Wheel : les titres des encadrés présents, lus dans l'ordre
du document, valent `["Actions assignées sans call", "Actions assignées, call < assignation",
"Ventes de calls", "Ventes de puts"]` avec `seed()`. Lire les titres par le même moyen que
`findByLabelText` (l'étiquette ARIA de `FilteredTableBox`) — regarder
`apps/web/src/components/table/FilteredTableBox.tsx` pour savoir quel élément la porte.

Dans `StrategyPositionsChart.test.tsx`, remplacer les titres de la même manière (l'ouverture sous
une ligne d'actions assignées se fait dans `"Actions assignées sans call"`).

Run: `cd apps/web && npx vitest run StrategyPositions` — Expected: FAIL (titres inconnus).

- [x] **Step 2: Badge et filtre Couverture d'une option achetée lus sur `line.used`**

Dans `apps/web/src/lib/riskReport.ts` :

```ts
// strategyCoverageBadges, branche des options achetées :
if (line.kind === "long_call" || line.kind === "long_put") return line.used === null ? [] : [usedBadge(line.used, Math.abs(line.quantity))];
// strategyCoverageValues, même branche :
if (line.kind === "long_call" || line.kind === "long_put") return line.used === null ? [] : [line.used > 0 ? "used" : "unused"];
```

Mettre à jour le commentaire des deux fonctions : le badge d'une option achetée dit la part de
*la ligne* qu'utilise la couverture, plafonnée par sa quantité, comme la couverture d'une vente
depuis le sous-projet 22. Une aile de condor qui détient toute la position IB garde le même
badge qu'avant.

- [x] **Step 3: Déclarer les encadrés et les titres**

`apps/web/src/lib/strategyBoxes.ts` :

```ts
import type { PositionsStrategy, StrategyBoxId } from "@ib/coverage";

export type { StrategyBoxId };

export interface StrategyBoxDef {
  id: StrategyBoxId;
  titleKey: string;
}

/**
 * Which boxes each strategy's positions page carries, in which order, under which title. The Wheel
 * and the LEAPS pages sort their lines by checkpoint (spec of sub-project 29): forgotten shares or
 * LEAPS first, then the calls against the assignment price, then the sales. Condors and Others keep
 * the Positions groups (sub-project 21). A declared box with no line never renders.
 */
export const STRATEGY_BOXES: Record<PositionsStrategy, readonly StrategyBoxDef[]> = {
  wheel: [
    { id: "sharesUncovered", titleKey: "strategyPositions.groups.sharesUncovered" },
    { id: "sharesCallAbove", titleKey: "strategyPositions.groups.sharesCallAbove" },
    { id: "sharesCallBelow", titleKey: "strategyPositions.groups.sharesCallBelow" },
    { id: "callSells", titleKey: "strategyPositions.groups.callSells" },
    { id: "putSells", titleKey: "strategyPositions.groups.putSells" },
  ],
  leaps: [
    { id: "leapsUncovered", titleKey: "strategyPositions.groups.leapsUncovered" },
    { id: "leapsCovered", titleKey: "strategyPositions.groups.leapsCovered" },
    { id: "callSells", titleKey: "strategyPositions.groups.callSells" },
    { id: "long", titleKey: "strategyPositions.groups.shares" },
    { id: "other", titleKey: "positions.groups.other" },
  ],
  condors: [
    { id: "optionBuys", titleKey: "positions.groups.optionBuys" },
    { id: "optionSells", titleKey: "positions.groups.optionSells" },
  ],
  others: [
    { id: "long", titleKey: "positions.groups.long" },
    { id: "optionBuys", titleKey: "positions.groups.optionBuys" },
    { id: "optionSells", titleKey: "positions.groups.optionSells" },
    { id: "other", titleKey: "positions.groups.other" },
  ],
};
```

`fr.json`, sous `strategyPositions.groups` (remplacer `assignedShares`, garder `shares`) :

```json
"sharesUncovered": "Actions assignées sans call",
"sharesCallAbove": "Actions assignées, call ≥ assignation",
"sharesCallBelow": "Actions assignées, call < assignation",
"callSells": "Ventes de calls",
"putSells": "Ventes de puts",
"leapsUncovered": "LEAPS sans call vendu",
"leapsCovered": "LEAPS avec call vendu",
"shares": "Actions"
```

`en.json`, mêmes clés : `"Assigned shares without a call"`, `"Assigned shares, call ≥ assignment"`,
`"Assigned shares, call < assignment"`, `"Call sales"`, `"Put sales"`,
`"LEAPS without a sold call"`, `"LEAPS with a sold call"`, et `shares` inchangé.
Supprimer `assignedShares` des deux fichiers après avoir vérifié par `grep -rn assignedShares
apps/web/src` qu'il n'a plus d'usage.

- [x] **Step 4: Une vue par identifiant**

`apps/web/src/hooks/useStrategyBoxViews.ts` : un `useTableView` explicite par identifiant de
`SHARE_BOX_IDS` (colonnes `shareColumns`) et de `LINE_BOX_IDS` (colonnes `lineColumns`), jamais
dans une boucle (règle des hooks), clé `tableViewKey(accountId, \`${prefix}:${id}\`)`, retour
typé `Record<StrategyBoxId, TableViewState>` pour qu'un identifiant ajouté sans hook ne compile
pas. Mettre à jour le commentaire (onze vues au lieu de cinq).

- [x] **Step 5: La page lit `strategyBoxContents`**

Dans `StrategyPositionsPage.tsx` :

```ts
import { isShareBoxId, strategyBoxContents, type LineBoxId, type ShareBoxId, ... } from "@ib/coverage";

const boxes = useMemo(
  () => (ready ? strategyBoxContents(strategyPositions(rows, strategy, pricedSnapshot(snapshot, report)), strategy) : null),
  [ready, rows, strategy, snapshot, report],
);
// ...
const searchedLines = searchBoxes(
  defs.filter((def) => !isShareBoxId(def.id)).map((def) => ({ id: def.id, title: t(def.titleKey), all: boxes.lines[def.id as LineBoxId] })),
  lineSpecs,
  { text: search.applied, ticker: (line: StrategyLine) => line.contract.ticker },
);
const searchedShares = searchBoxes(
  defs.filter((def) => isShareBoxId(def.id)).map((def) => ({ id: def.id, title: t(def.titleKey), all: boxes.shares[def.id as ShareBoxId] })),
  shareSpecs,
  { text: search.applied, ticker: (line: WheelShareLine) => line.ticker },
);
```

Le reste du rendu ne change pas : `shares.get(def.id)` rend un `SharesBox`, sinon
`lines.get(def.id)` un `LinesBox`. Retirer l'import devenu inutile de `DetailGroupId`. Les
graphes gardent `scope` et `WHEEL_SCOPE`. La clé d'ouverture du graphe
`${boxId}|…` distingue déjà deux parts du même ticker dans deux encadrés.

- [x] **Step 6: Lancer les tests ciblés**

Run: `cd apps/web && npx vitest run StrategyPositions riskReport strategyColumns tableBoxes` —
Expected: PASS. Puis `npx tsc --noEmit -p apps/web` (ou le script `typecheck` d'`apps/web`).

- [x] **Step 7: Cocher les cases de la tâche 2 et commiter**

```bash
git add apps/web docs/plans/2026-09-22-tableaux-de-strategie.md
git commit -m "Range les pages Wheel et LEAPS par point de contrôle

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/specs/2026-09-22-tableaux-de-strategie-design.md` (statut)

- [ ] **Step 1: `CLAUDE.md`**

- Registre : ajouter la ligne `| 29 | Les tableaux de la Wheel et des LEAPS rangés par point de contrôle | fait (<date du merge>) |`.
- Règle « Les tableaux de la page Positions partagent leurs colonnes » : « seule la table
  « Actions assignées » de la Wheel » devient « seules les trois tables d'actions assignées de
  la Wheel ».
- Règle « Les positions d'une stratégie sont une vue calculée » : ajouter à la fin une phrase :
  **Les pages Wheel et LEAPS rangent leurs lignes par point de contrôle** :
  `strategyBoxContents` (`packages/coverage/src/strategyBoxes.ts`) coupe les actions Wheel d'un
  ticker en part libre et part couverte — la couverte au-dessus ou en dessous selon le prix
  moyen des calls contre le prix moyen d'assignation du ticker, jamais celui des lots FIFO, une
  comparaison impossible en dessous — et un LEAPS en part libre et part utilisée (`used`,
  plafonnée par la ligne). Les graphes ne changent pas d'un encadré à l'autre. Remplacer aussi
  « La carte « Actions assignées » de la Wheel ne compte que les calls couverts » par « Les
  cartes d'actions assignées de la Wheel ne comptent que les calls couverts ».

- [ ] **Step 2: Spec** — `Statut : livré (<date>).`

- [ ] **Step 3: Cocher et commiter**

```bash
git add CLAUDE.md docs
git commit -m "Documente le sous-projet 29

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Vérification finale et instance de relecture

- [ ] **Step 1:** `pnpm check` à la racine du worktree — Expected: lint, typage, build et tous
  les tests verts. Corriger toute erreur dans un commit à part.
- [ ] **Step 2:** `pnpm dev:start` dans le worktree ; relever les deux URL (Vite, Django) pour
  Seb. Ne pas arrêter l'instance.
- [ ] **Step 3:** Cocher et commiter le plan.
