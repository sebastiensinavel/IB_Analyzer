# Sous-projet 22 — La part nue quitte les pages de stratégie

> **Pour un agent d'exécution :** SOUS-SKILL OBLIGATOIRE — `superpowers:subagent-driven-development`
> (recommandé) ou `superpowers:executing-plans`, tâche par tâche. Les étapes sont des cases à
> cocher (`- [ ]`), **cochées dans le worktree au fur et à mesure, dans le commit de la tâche**.

**But :** une page de stratégie ne montre que la part **couverte** de ses ventes d'options ; la
part nue, quelle que soit son origine, se lit sur la page Autres et sur la page Positions de la
vue d'ensemble.

**Architecture :** tout se joue dans `strategyPositions`
(`packages/coverage/src/strategy.ts`), qui reçoit déjà **toutes** les lignes de journal. Une
fonction pure, `migratedContracts`, décide contrat par contrat combien de contrats chaque
stratégie couverte perd, plafonnée par l'`uncoveredQuantity` du moteur de couverture. Les lignes
se construisent ensuite sur des contributions pondérées plutôt que sur des lignes de journal
brutes, ce qui permet à la page Autres de fondre en une seule ligne ce qu'elle détient en propre
et ce qui lui arrive d'ailleurs. Le journal, le capital et les statistiques ne changent pas.

**Pile :** TypeScript, Vitest, React 19, Testing Library, fake-indexeddb, pnpm workspaces.

**Spec :** `docs/specs/2026-09-18-part-nue-positions-design.md` — à lire avec ce plan.

## Contraintes globales

- **Le journal ne bouge pas.** `packages/ledger` n'est pas modifié. Une tâche qui semble
  réclamer un changement de `classify.ts`, de `holdings.ts` ou d'une ligne de journal est un
  **signal d'arrêt** : la classification se fait une fois, à la vente.
- **Aucune donnée ne quitte le navigateur.** Aucune table Dexie, aucune migration, aucun
  endpoint, aucun champ nouveau : le resplit est une vue calculée. Une tâche qui semble réclamer
  un modèle ou une route d'API est un signal d'arrêt.
- **Aucune clé i18n nouvelle.** La page Autres réutilise son encadré « Ventes d'options » et son
  badge `UNCOVERED ×n` existants.
- **`packages/coverage` se teste à la main**, jamais contre un oracle Python : il a été retiré au
  sous-projet 2 et ne revient pas.
- **Ordre des stratégies servies** : `wheel`, puis `leaps`, puis `condors` — l'ordre des pages.
- **Une valeur absente reste `null`**, jamais `0`.
- **Travailler dans un worktree** `.claude/worktrees/part-nue` (`superpowers:using-git-worktrees`),
  sur sa propre paire de ports (`tools/dev-env/ports.mjs`). `pnpm check` **une seule fois, à la
  fin** ; pendant l'itération, des tests ciblés (`pnpm --filter @ib/coverage test`,
  `pnpm --filter web test`).

---

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `packages/coverage/src/strategy.ts` | **Modifié.** Gagne `migratedContracts` (pure, exportée), un index des lignes ouvertes par contrat et par stratégie, des lignes bâties sur des contributions, le plafonnement des badges et le recalcul des calls de la carte des actions Wheel. |
| `packages/coverage/src/strategy.test.ts` | **Modifié.** Tests écrits à la main du partage, du plafond, de la fusion sur Autres, de la carte des actions et du put qui ne migre jamais. |
| `packages/coverage/src/index.ts` | **Modifié** si et seulement si `migratedContracts` doit sortir du paquet — elle ne le doit pas ; vérifier qu'il n'exporte rien de neuf. |
| `apps/web/src/pages/StrategyPositionsPage.test.tsx` | **Modifié.** Le scénario complet vu sur les deux pages. |
| `CLAUDE.md`, `docs/points-reportes.md` | **Modifiés** à la dernière tâche. |

Aucun fichier créé.

---

### Task 1 : `migratedContracts`, l'arithmétique du partage

**Files:**
- Modify: `packages/coverage/src/strategy.ts`
- Test: `packages/coverage/src/strategy.test.ts`

**Interfaces:**
- Consomme : `STRATEGY_COVER_SOURCES` et `PositionsStrategy`, déjà dans `strategy.ts` ;
  `CoverageAllocation` de `./types.ts` ; `CoverSource` de `./constants.ts`.
- Produit :
  ```ts
  export const COVERED_STRATEGIES: readonly PositionsStrategy[];
  export function migratedContracts(
    shorts: ReadonlyMap<PositionsStrategy, number>,
    allocations: readonly CoverageAllocation[],
    uncoveredQuantity: number,
  ): Map<PositionsStrategy, number>;
  ```
  `shorts` donne, pour **un** contrat, le nombre de contrats vendus ouverts de chaque stratégie,
  **non signé**, `others` compris. Le retour ne contient que les stratégies qui perdent quelque
  chose, avec un nombre de contrats non signé. Les tâches 2 et 3 s'en servent.

- [x] **Step 1: Écrire les tests qui échouent**

Dans `packages/coverage/src/strategy.test.ts`, ajouter les imports et le bloc ci-dessous. Les
imports existants du fichier (`describe`, `expect`, `it`, `strategyPositions`, …) restent ;
ajouter `migratedContracts` à l'import de `./strategy.ts`, et ces deux-là s'il manquent :

```ts
import type { CoverSource } from "./constants.ts";
import type { CoverageAllocation } from "./types.ts";
```

`PositionsStrategy` s'importe depuis `./strategy.ts`, à côté de `strategyPositions` et
`PricedSnapshot` que le fichier importe déjà ; ne pas passer par `./index.ts`.

```ts
const alloc = (source: CoverSource, quantity: number): CoverageAllocation => ({ source, quantity, detail: "" });
const shortsOf = (entries: [PositionsStrategy, number][]) => new Map<PositionsStrategy, number>(entries);

describe("migratedContracts", () => {
  it("migrates nothing when the engine says nothing is naked", () => {
    expect(migratedContracts(shortsOf([["wheel", 2]]), [alloc("stock", 2)], 0)).toEqual(new Map());
  });

  it("migrates the part of a Wheel call its own shares no longer cover", () => {
    expect(migratedContracts(shortsOf([["wheel", 2]]), [alloc("stock", 1)], 1)).toEqual(new Map([["wheel", 1]]));
  });

  it("counts what Others already holds against the naked total", () => {
    // IB holds 3 short: shares cover 2, one is naked — and that one is already Others' own line.
    expect(migratedContracts(shortsOf([["wheel", 2], ["others", 1]]), [alloc("stock", 2)], 1)).toEqual(new Map());
  });

  it("never migrates more than the engine calls naked, serving wheel before leaps", () => {
    // The journal is longer than the IB position: 4 contracts of journal, 2 of position, 1 naked.
    expect(migratedContracts(shortsOf([["wheel", 2], ["leaps", 2]]), [alloc("stock", 1)], 1)).toEqual(new Map([["wheel", 1]]));
  });

  it("leaves alone a line covered by a source that is not the strategy's own", () => {
    expect(migratedContracts(shortsOf([["wheel", 1]]), [alloc("leaps", 1)], 0)).toEqual(new Map());
  });

  it("migrates a whole line when nothing covers it", () => {
    expect(migratedContracts(shortsOf([["wheel", 1]]), [], 1)).toEqual(new Map([["wheel", 1]]));
  });

  it("migrates from the condors too", () => {
    expect(migratedContracts(shortsOf([["condors", 2]]), [alloc("spread", 1)], 1)).toEqual(new Map([["condors", 1]]));
  });
});
```

- [x] **Step 2: Lancer les tests pour les voir échouer**

Run: `pnpm --filter @ib/coverage test -- strategy`
Expected: FAIL — `migratedContracts is not a function` / l'import n'existe pas.

- [x] **Step 3: Écrire l'implémentation**

Dans `packages/coverage/src/strategy.ts`, juste après la déclaration de
`STRATEGY_COVER_SOURCES` :

```ts
/** The strategies that own a cover, in the order the pages are served when the cap bites. */
export const COVERED_STRATEGIES: readonly PositionsStrategy[] = ["wheel", "leaps", "condors"];

/**
 * How many contracts each covered strategy loses on one contract, the naked part the page Autres
 * takes over (spec of sub-project 22, §3.1). `shorts` counts the open sold contracts of each
 * strategy on that contract, unsigned, Others included.
 *
 * A strategy keeps what its own sources cover (`STRATEGY_COVER_SOURCES`), capped by its own
 * quantity: the allocations describe the whole IB position, which may exceed the strategy's part.
 * The total that migrates never exceeds what the engine itself calls naked, minus what Others
 * already holds — naked by construction, `splitShortCall` having put it there at the sale. That
 * cap is what keeps the page Autres from contradicting the title bar.
 */
export function migratedContracts(
  shorts: ReadonlyMap<PositionsStrategy, number>,
  allocations: readonly CoverageAllocation[],
  uncoveredQuantity: number,
): Map<PositionsStrategy, number> {
  const taken = new Map<PositionsStrategy, number>();
  let migrable = Math.max(0, uncoveredQuantity - (shorts.get("others") ?? 0));
  for (const strategy of COVERED_STRATEGIES) {
    if (migrable <= 0) break;
    const held = shorts.get(strategy) ?? 0;
    if (held <= 0) continue;
    const sources = STRATEGY_COVER_SOURCES[strategy];
    const own = allocations.reduce((sum, a) => (sources.includes(a.source) ? sum + a.quantity : sum), 0);
    const take = Math.min(held - Math.min(held, own), migrable);
    if (take > 0) {
      taken.set(strategy, take);
      migrable -= take;
    }
  }
  return taken;
}
```

Ajouter `import type { CoverageAllocation } from "./types.ts";` s'il n'est pas déjà là — le
fichier importe déjà `AnalyzedPosition`, `CoverageAllocation` et `RiskReport` depuis
`./types.ts`, donc vérifier avant d'ajouter.

- [x] **Step 4: Lancer les tests pour les voir passer**

Run: `pnpm --filter @ib/coverage test -- strategy`
Expected: PASS, tous les tests du fichier, anciens compris.

- [x] **Step 5: Commit**

```bash
git add packages/coverage/src/strategy.ts packages/coverage/src/strategy.test.ts docs/plans/2026-09-18-part-nue-positions.md
git commit -m "Partage de la part nue : migratedContracts"
```

---

### Task 2 : les lignes d'une stratégie portent leur quantité couverte

**Files:**
- Modify: `packages/coverage/src/strategy.ts`
- Test: `packages/coverage/src/strategy.test.ts`

**Interfaces:**
- Consomme : `migratedContracts` et `COVERED_STRATEGIES` de la tâche 1.
- Produit, pour la tâche 3 :
  ```ts
  interface Contribution { quantity: number; openPrice: number | null }
  interface LineInput {
    contract: ContractKey;
    kind: PositionKind;
    contributions: readonly Contribution[];
    /** Contracts that left this line for Others; positive, 0 everywhere else. */
    migrated: number;
  }
  function line(input: LineInput, priced: Priced | null, sources: readonly CoverSource[]): StrategyLine;
  function weightedPrice(contributions: readonly Contribution[]): number | null;
  type OpenRows = Map<string, Map<PositionsStrategy, JournalRow[]>>;
  function openRowsByContract(rows: readonly JournalRow[]): OpenRows;
  ```
  Tout reste privé au module ; seule `migratedContracts` est exportée.

- [x] **Step 1: Écrire les tests qui échouent**

Ajouter dans `packages/coverage/src/strategy.test.ts`, après les blocs existants. Les aides
`row`, `opt`, `shares`, `priced`, `option`, `stock`, `wheelPositions` sont déjà dans le fichier.

Poser `MARA_CALL_15` et `nakedCallLedger` **au niveau du module**, à côté de `MARA_CALL` et
`XOM_PUT` : les tâches 3 et 4 les réutilisent.

```ts
const MARA_CALL_15 = opt("MQZA", "C", 15, "2026-10-16");

/** 100 Wheel shares left under two Wheel calls: the engine covers one, the other is naked. */
function nakedCallLedger(): { rows: JournalRow[]; snapshot: PricedSnapshot } {
  const rows = [
    row({ id: "s#1", contract: shares("MQZA"), kind: "shares", quantity: 100, openPrice: 17, strike: null }),
    row({ id: "c#1", contract: MARA_CALL_15, kind: "short_call", quantity: -2, openPrice: 0.7 }),
  ];
  const snapshot = priced([
    stock({ symbol: "MQZA", quantity: 100, avgPrice: 17, marketPrice: 18, marketValue: 1800 }),
    option({ symbol: "MQZA", right: "C", strike: 15, expiry: "2026-10-16", quantity: -2, avgPrice: 0.7, marketPrice: 1, marketValue: -200 }),
  ]);
  return { rows, snapshot };
}

describe("strategyPositions — the naked part leaves the strategy", () => {
  it("shows the Wheel only the contracts its shares still cover", () => {
    const { rows, snapshot } = nakedCallLedger();
    const { optionSales } = wheelPositions(rows, snapshot);
    expect(optionSales).toHaveLength(1);
    expect(optionSales[0]).toMatchObject({ quantity: -1, avgPrice: 0.7, lastPrice: 1, marketValue: -100, unrealizedPnl: -30 });
    expect(optionSales[0].coverage).toEqual([expect.objectContaining({ source: "stock", quantity: 1 })]);
  });

  it("drops the line entirely when nothing covers it any more", () => {
    const rows = [row({ id: "c#1", contract: MARA_CALL_15, kind: "short_call", quantity: -1, openPrice: 0.7 })];
    const snapshot = priced([option({ symbol: "MQZA", right: "C", strike: 15, expiry: "2026-10-16", quantity: -1, marketPrice: 1, marketValue: -100 })]);
    expect(wheelPositions(rows, snapshot).optionSales).toEqual([]);
  });

  it("caps a badge at the quantity the line shows", () => {
    // IB holds 2 short calls against 200 shares: stock ×2. The Wheel's line is one of them.
    const rows = [
      row({ id: "s#1", contract: shares("MQZA"), kind: "shares", quantity: 200, openPrice: 17, strike: null }),
      row({ id: "c#1", contract: MARA_CALL_15, kind: "short_call", quantity: -1, openPrice: 0.7 }),
      row({ id: "o#1", contract: MARA_CALL_15, strategy: "others", kind: "short_call", quantity: -1, openPrice: 0.7 }),
    ];
    const snapshot = priced([
      stock({ symbol: "MQZA", quantity: 200, avgPrice: 17, marketPrice: 18, marketValue: 3600 }),
      option({ symbol: "MQZA", right: "C", strike: 15, expiry: "2026-10-16", quantity: -2, marketPrice: 1, marketValue: -200 }),
    ]);
    const { optionSales } = wheelPositions(rows, snapshot);
    expect(optionSales[0].quantity).toBe(-1);
    expect(optionSales[0].coverage).toEqual([expect.objectContaining({ source: "stock", quantity: 1 })]);
  });

  it("never migrates a sold put: the engine always secures it with cash", () => {
    const rows = [row({ contract: XOM_PUT, quantity: -2, openPrice: 2 })];
    const snapshot = priced([option({ symbol: "XOM", right: "P", strike: 100, expiry: "2026-10-16", quantity: -2, marketPrice: 1.5, marketValue: -300 })]);
    expect(wheelPositions(rows, snapshot).optionSales[0].quantity).toBe(-2);
    expect(strategyPositions(rows, "others", snapshot).groups.optionSells).toEqual([]);
  });

  it("migrates nothing without a snapshot, nor on a contract the snapshot lacks", () => {
    const { rows } = nakedCallLedger();
    expect(wheelPositions(rows, null).optionSales[0].quantity).toBe(-2);
    const elsewhere = priced([stock({ symbol: "AAPL", quantity: 10 })]);
    expect(wheelPositions(rows, elsewhere).optionSales[0].quantity).toBe(-2);
  });

  it("leaves a long position alone", () => {
    const rows = [row({ id: "l#1", contract: opt("ZZZ", "C", 15, "2027-06-18"), strategy: "leaps", kind: "long_call", quantity: 1, openPrice: 3 })];
    const snapshot = priced([option({ symbol: "ZZZ", right: "C", strike: 15, expiry: "2027-06-18", quantity: 1, marketPrice: 4, marketValue: 400 })]);
    expect(strategyPositions(rows, "leaps", snapshot).groups.optionBuys[0].quantity).toBe(1);
  });
});
```

- [x] **Step 2: Lancer les tests pour les voir échouer**

Run: `pnpm --filter @ib/coverage test -- strategy`
Expected: FAIL — le premier test attend `quantity: -1` et reçoit `-2`.

- [x] **Step 3: Écrire l'implémentation**

Dans `packages/coverage/src/strategy.ts` :

a) Remplacer la fonction `line` par sa version sur contributions, et en extraire le prix moyen :

```ts
/** One journal line's part of a position line: what it brings, and at what price. */
interface Contribution {
  quantity: number;
  openPrice: number | null;
}

interface LineInput {
  contract: ContractKey;
  kind: PositionKind;
  contributions: readonly Contribution[];
  /** Contracts that left this line for Others; positive, and 0 on everything but a covered strategy's sales. */
  migrated: number;
}

const toContribution = (row: JournalRow): Contribution => ({ quantity: row.quantity as number, openPrice: row.openPrice });

/** Σ openPrice × |quantity| ÷ Σ |quantity|; `null` when a contribution has no price or nothing weighs. */
function weightedPrice(contributions: readonly Contribution[]): number | null {
  const weight = contributions.reduce((n, c) => n + Math.abs(c.quantity), 0);
  if (weight === 0 || contributions.some((c) => c.openPrice === null)) return null;
  return contributions.reduce((n, c) => n + (c.openPrice as number) * Math.abs(c.quantity), 0) / weight;
}

/**
 * The strategy's own cover, cut down to the contracts the line actually shows: the allocations
 * describe the whole IB position, so nothing stops `stock ×2` from landing on a line of one
 * contract without this (spec of sub-project 22, §3.2).
 */
function cappedCoverage(priced: Priced, sources: readonly CoverSource[], quantity: number): CoverageAllocation[] {
  const capped: CoverageAllocation[] = [];
  let capacity = Math.abs(quantity);
  for (const allocation of priced.analyzed.allocations) {
    if (capacity <= 0) break;
    if (!sources.includes(allocation.source)) continue;
    const take = Math.min(capacity, allocation.quantity);
    if (take <= 0) continue;
    capped.push(take === allocation.quantity ? allocation : { ...allocation, quantity: take });
    capacity -= take;
  }
  return capped;
}

function line({ contract, kind, contributions, migrated }: LineInput, priced: Priced | null, sources: readonly CoverSource[]): StrategyLine {
  // A sale's quantity is negative, so what migrates brings it back towards zero.
  const quantity = contributions.reduce((n, c) => n + c.quantity, 0) + migrated;
  const avgPrice = weightedPrice(contributions);
  const multiplier = kind === "long_stock" || kind === "short_stock" ? 1 : priced ? contractMultiplier(priced.position) : DEFAULT_MULTIPLIER;
  const lastPrice = priced?.position.marketPrice ?? null;
  const sold = kind === "short_put" || kind === "short_call";
  return {
    contract,
    kind,
    label: KIND_LABELS[kind],
    quantity,
    avgPrice,
    lastPrice,
    marketValue: lastPrice === null ? null : lastPrice * quantity * multiplier,
    unrealizedPnl: lastPrice === null || avgPrice === null ? null : (lastPrice - avgPrice) * quantity * multiplier,
    decision: sold && lastPrice !== null && avgPrice !== null ? evaluateBuyback(avgPrice, lastPrice) : null,
    position: priced?.analyzed ?? null,
    coverage: sold && priced ? cappedCoverage(priced, sources, quantity) : [],
  };
}
```

b) Ajouter l'index des lignes ouvertes et le partage, au-dessus de `linesByGroup` :

```ts
/** Every open journal line a page can show, by contract id then by strategy. */
type OpenRows = Map<string, Map<PositionsStrategy, JournalRow[]>>;

function openRowsByContract(rows: readonly JournalRow[]): OpenRows {
  const open: OpenRows = new Map();
  for (const row of flatten(rows)) {
    if (row.endWhen !== null || row.quantity === null) continue;
    if (LINE_KIND[row.kind] === undefined) continue;
    const id = contractId(row.contract);
    const byStrategy = open.get(id) ?? new Map<PositionsStrategy, JournalRow[]>();
    byStrategy.set(row.strategy, [...(byStrategy.get(row.strategy) ?? []), row]);
    open.set(id, byStrategy);
  }
  return open;
}

const isSold = (row: JournalRow) => LINE_KIND[row.kind] === "short_call" || LINE_KIND[row.kind] === "short_put";

/** What each covered strategy loses on each contract, `migratedContracts` applied to the book. */
function migratedByContract(open: OpenRows, priced: Map<string, Priced>): Map<string, Map<PositionsStrategy, number>> {
  const taken = new Map<string, Map<PositionsStrategy, number>>();
  for (const [id, byStrategy] of open) {
    const position = priced.get(id)?.analyzed;
    if (!position) continue;
    const shorts = new Map<PositionsStrategy, number>();
    for (const [strategy, rows] of byStrategy) {
      const held = rows.filter(isSold).reduce((n, r) => n + Math.abs(r.quantity as number), 0);
      if (held > 0) shorts.set(strategy, held);
    }
    const migrated = migratedContracts(shorts, position.allocations, position.uncoveredQuantity);
    if (migrated.size > 0) taken.set(id, migrated);
  }
  return taken;
}
```

c) Réécrire `linesByGroup` pour lire l'index et le partage :

```ts
/** The open lines of `strategy`, one per contract, grouped by the DETAIL_GROUPS the page shows. */
function linesByGroup(
  open: OpenRows,
  strategy: PositionsStrategy,
  priced: Map<string, Priced>,
  taken: Map<string, Map<PositionsStrategy, number>>,
): Record<DetailGroupId, StrategyLine[]> {
  const lines: StrategyLine[] = [];
  for (const [id, byStrategy] of open) {
    const rows = byStrategy.get(strategy) ?? [];
    if (rows.length === 0) continue;
    const migrated = taken.get(id)?.get(strategy) ?? 0;
    if (migrated >= rows.reduce((n, r) => n + Math.abs(r.quantity as number), 0)) continue;
    lines.push(
      line(
        { contract: rows[0].contract, kind: LINE_KIND[rows[0].kind] as PositionKind, contributions: rows.map(toContribution), migrated },
        priced.get(id) ?? null,
        STRATEGY_COVER_SOURCES[strategy],
      ),
    );
  }
  lines.sort(compareLines);
  const byGroup = Object.fromEntries(DETAIL_GROUPS.map((group) => [group.id, [] as StrategyLine[]])) as Record<DetailGroupId, StrategyLine[]>;
  for (const candidate of lines) {
    const group = DETAIL_GROUPS.find((entry) => entry.kinds?.has(candidate.kind)) ?? DETAIL_GROUPS[DETAIL_GROUPS.length - 1];
    byGroup[group.id].push(candidate);
  }
  return byGroup;
}
```

d) Brancher `strategyPositions` :

```ts
export function strategyPositions(rows: readonly JournalRow[], strategy: PositionsStrategy, snapshot: PricedSnapshot | null): StrategyPositions {
  const priced = pricedByContract(snapshot);
  const open = openRowsByContract(rows);
  const taken = migratedByContract(open, priced);
  const groups = linesByGroup(open, strategy, priced, taken);
  // …suite inchangée pour l'instant : la carte des actions Wheel est la tâche 4.
```

La règle « un contrat migré entièrement ne se rend pas » est la ligne `if (migrated >= …) continue;`.

- [x] **Step 4: Lancer les tests pour les voir passer**

Run: `pnpm --filter @ib/coverage test -- strategy`
Expected: PASS. Le test de la tâche 3 n'existe pas encore ; tous les autres, anciens compris,
passent — vérifier en particulier que « keeps only the Wheel's part of a call shared with
Others » passe toujours : sa position IB a `uncoveredQuantity: 1` mais Autres en détient déjà
un, donc rien ne migre.

- [x] **Step 5: Commit**

```bash
git add packages/coverage/src/strategy.ts packages/coverage/src/strategy.test.ts docs/plans/2026-09-18-part-nue-positions.md
git commit -m "Les lignes d'une stratégie portent leur quantité couverte"
```

---

### Task 3 : la page Autres absorbe la part nue

**Files:**
- Modify: `packages/coverage/src/strategy.ts`
- Test: `packages/coverage/src/strategy.test.ts`

**Interfaces:**
- Consomme : `Contribution`, `weightedPrice`, `line`, `OpenRows`, `toContribution` et `isSold` de
  la tâche 2 ; `COVERED_STRATEGIES` de la tâche 1. Côté test, l'aide `nakedCallLedger` et la
  constante `MARA_CALL_15` posées **au niveau du module** par la tâche 2, hors de tout `describe`.
- Produit : rien de nouveau à l'extérieur. `strategyPositions(rows, "others", snapshot)` rend
  désormais, dans `groups.optionSells`, une ligne par contrat nu, fondue.

- [x] **Step 1: Écrire les tests qui échouent**

```ts
describe("strategyPositions — Others takes the naked part in", () => {
  const othersSales = (rows: readonly JournalRow[], snapshot: PricedSnapshot | null) =>
    strategyPositions(rows, "others", snapshot).groups.optionSells;

  it("shows the contract the Wheel no longer covers, without saying where it comes from", () => {
    const { rows, snapshot } = nakedCallLedger();
    const sales = othersSales(rows, snapshot);
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({
      contract: MARA_CALL_15, kind: "short_call", label: "sell of call",
      quantity: -1, avgPrice: 0.7, lastPrice: 1, marketValue: -100, unrealizedPnl: -30,
    });
    expect(sales[0].coverage).toEqual([]);
  });

  it("melts what it already holds of the contract into one line, prices weighted", () => {
    const rows = [
      row({ id: "s#1", contract: shares("MQZA"), kind: "shares", quantity: 100, openPrice: 17, strike: null }),
      row({ id: "c#1", contract: MARA_CALL_15, kind: "short_call", quantity: -2, openPrice: 0.9 }),
      row({ id: "o#1", contract: MARA_CALL_15, strategy: "others", kind: "short_call", quantity: -1, openPrice: 0.3 }),
    ];
    const snapshot = priced([
      stock({ symbol: "MQZA", quantity: 100, avgPrice: 17, marketPrice: 18, marketValue: 1800 }),
      option({ symbol: "MQZA", right: "C", strike: 15, expiry: "2026-10-16", quantity: -3, marketPrice: 1, marketValue: -300 }),
    ]);
    const sales = othersSales(rows, snapshot);
    expect(sales).toHaveLength(1);
    // One contract of its own at 0.30, one taken over at the Wheel line's 0.90.
    expect(sales[0]).toMatchObject({ quantity: -2, avgPrice: 0.6 });
    expect(wheelPositions(rows, snapshot).optionSales[0].quantity).toBe(-1);
  });

  it("has no price when a contributing line has none", () => {
    const rows = [
      row({ id: "c#1", contract: MARA_CALL_15, kind: "short_call", quantity: -1, openPrice: null }),
      row({ id: "o#1", contract: MARA_CALL_15, strategy: "others", kind: "short_call", quantity: -1, openPrice: 0.3 }),
    ];
    const snapshot = priced([option({ symbol: "MQZA", right: "C", strike: 15, expiry: "2026-10-16", quantity: -2, marketPrice: 1, marketValue: -200 })]);
    expect(othersSales(rows, snapshot)[0]).toMatchObject({ quantity: -2, avgPrice: null, unrealizedPnl: null });
  });

  it("keeps its own lines untouched when nothing migrates", () => {
    const rows = [row({ id: "o#1", contract: MARA_CALL_15, strategy: "others", kind: "short_call", quantity: -1, openPrice: 0.3 })];
    const snapshot = priced([option({ symbol: "MQZA", right: "C", strike: 15, expiry: "2026-10-16", quantity: -1, marketPrice: 1, marketValue: -100 })]);
    expect(othersSales(rows, snapshot)[0]).toMatchObject({ quantity: -1, avgPrice: 0.3 });
  });
});
```

- [x] **Step 2: Lancer les tests pour les voir échouer**

Run: `pnpm --filter @ib/coverage test -- strategy`
Expected: FAIL — le premier test reçoit `[]` : la page Autres ne voit rien migrer.

- [x] **Step 3: Écrire l'implémentation**

Dans `linesByGroup`, remplacer la boucle par une version qui, pour `others`, ajoute les
contributions venues d'ailleurs :

```ts
  for (const [id, byStrategy] of open) {
    const rows = byStrategy.get(strategy) ?? [];
    const migrated = taken.get(id)?.get(strategy) ?? 0;
    const takenIn = strategy === "others" ? contributionsTakenIn(id, byStrategy, taken) : [];
    if (rows.length === 0 && takenIn.length === 0) continue;
    const held = rows.reduce((n, r) => n + Math.abs(r.quantity as number), 0);
    if (takenIn.length === 0 && migrated >= held) continue;
    const source = rows[0] ?? firstSoldRow(byStrategy, taken.get(id));
    lines.push(
      line(
        {
          contract: source.contract,
          kind: LINE_KIND[source.kind] as PositionKind,
          contributions: [...rows.map(toContribution), ...takenIn],
          migrated,
        },
        priced.get(id) ?? null,
        STRATEGY_COVER_SOURCES[strategy],
      ),
    );
  }
```

et ajouter, au-dessus de `linesByGroup` :

```ts
/**
 * What Others takes over on one contract: for each covered strategy that loses contracts, one
 * contribution at that strategy's own average price (spec of sub-project 22, §3.3). Its sign is
 * that of a sale, negative, like the rows it stands for.
 */
function contributionsTakenIn(
  id: string,
  byStrategy: ReadonlyMap<PositionsStrategy, JournalRow[]>,
  taken: Map<string, Map<PositionsStrategy, number>>,
): Contribution[] {
  const migrated = taken.get(id);
  if (!migrated) return [];
  const contributions: Contribution[] = [];
  for (const strategy of COVERED_STRATEGIES) {
    const count = migrated.get(strategy) ?? 0;
    if (count <= 0) continue;
    contributions.push({ quantity: -count, openPrice: weightedPrice((byStrategy.get(strategy) ?? []).map(toContribution)) });
  }
  return contributions;
}

/** The contract and kind of a line Others holds nothing of: read off the rows that migrate to it. */
function firstSoldRow(byStrategy: ReadonlyMap<PositionsStrategy, JournalRow[]>, migrated: Map<PositionsStrategy, number> | undefined): JournalRow {
  for (const strategy of COVERED_STRATEGIES) {
    if ((migrated?.get(strategy) ?? 0) <= 0) continue;
    const row = (byStrategy.get(strategy) ?? []).find(isSold);
    if (row) return row;
  }
  throw new Error("a contract migrates to Others without a sold line to name it");
}
```

- [x] **Step 4: Lancer les tests pour les voir passer**

Run: `pnpm --filter @ib/coverage test -- strategy`
Expected: PASS, tout le fichier.

- [x] **Step 5: Commit**

```bash
git add packages/coverage/src/strategy.ts packages/coverage/src/strategy.test.ts docs/plans/2026-09-18-part-nue-positions.md
git commit -m "La page Autres absorbe la part nue des autres stratégies"
```

---

### Task 4 : la carte « Actions assignées » ne compte que les calls couverts

**Files:**
- Modify: `packages/coverage/src/strategy.ts`
- Test: `packages/coverage/src/strategy.test.ts`

**Interfaces:**
- Consomme : `groups.optionSells` de la Wheel, déjà resplité par les tâches 2 et 3. Côté test,
  `nakedCallLedger` et `MARA_CALL_15` de la tâche 2, au niveau du module.
- Produit : `WheelShareLine` inchangé dans sa forme ; `openCallContracts`, `averageCallStrike`,
  `coveredShares` et `callStrikeBelowAssignment` sont désormais calculés sur les calls couverts.

- [x] **Step 1: Écrire les tests qui échouent**

```ts
describe("strategyPositions — the Wheel's shares card counts only the covered calls", () => {
  it("turns 'used 100/100' honest when a call has lost its shares", () => {
    const { rows, snapshot } = nakedCallLedger();
    const { shares: held } = wheelPositions(rows, snapshot);
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({
      ticker: "MQZA", quantity: 100, averageAssignmentPrice: 17, assignedTotal: 1700,
      openCallContracts: 1, averageCallStrike: 15, coveredShares: 100,
      lastPrice: 18, unrealizedPnl: 100, callStrikeBelowAssignment: true,
    });
  });

  it("averages the strikes of the covered calls only", () => {
    const rows = [
      row({ id: "s#1", contract: shares("MQZA"), kind: "shares", quantity: 100, openPrice: 17, strike: null }),
      row({ id: "c#1", contract: MARA_CALL_15, kind: "short_call", quantity: -1, openPrice: 0.7 }),
      row({ id: "c#2", contract: opt("MQZA", "C", 25, "2026-10-16"), kind: "short_call", quantity: -1, openPrice: 0.2 }),
    ];
    const snapshot = priced([
      stock({ symbol: "MQZA", quantity: 100, avgPrice: 17, marketPrice: 18, marketValue: 1800 }),
      option({ symbol: "MQZA", right: "C", strike: 15, expiry: "2026-10-16", quantity: -1, marketPrice: 1, marketValue: -100 }),
      option({ symbol: "MQZA", right: "C", strike: 25, expiry: "2026-10-16", quantity: -1, marketPrice: 0.1, marketValue: -10 }),
    ]);
    // The engine covers the nearest expiry, lowest strike first: the 15 call keeps the shares.
    const { shares: held } = wheelPositions(rows, snapshot);
    expect(held[0]).toMatchObject({ openCallContracts: 1, averageCallStrike: 15, coveredShares: 100 });
  });

  it("leaves the card alone when every call is still covered", () => {
    const rows = [
      row({ id: "s#1", contract: shares("MQZA"), kind: "shares", quantity: 200, openPrice: 17, strike: null }),
      row({ id: "c#1", contract: MARA_CALL_15, kind: "short_call", quantity: -1, openPrice: 0.7 }),
    ];
    const snapshot = priced([
      stock({ symbol: "MQZA", quantity: 200, avgPrice: 17, marketPrice: 18, marketValue: 3600 }),
      option({ symbol: "MQZA", right: "C", strike: 15, expiry: "2026-10-16", quantity: -1, marketPrice: 1, marketValue: -100 }),
    ]);
    expect(wheelPositions(rows, snapshot).shares[0]).toMatchObject({ openCallContracts: 1, coveredShares: 100 });
  });
});
```

- [x] **Step 2: Lancer les tests pour les voir échouer**

Run: `pnpm --filter @ib/coverage test -- strategy`
Expected: FAIL — `openCallContracts` vaut 2 et `coveredShares` 100/… lu sur deux contrats.

- [x] **Step 3: Écrire l'implémentation**

Remplacer la fin de `strategyPositions` :

```ts
  if (strategy !== "wheel") return { shares: [], groups };
  const covered = coveredCallsByTicker(groups.optionSells);
  const shares = wheelHoldings(rows).map((holding): WheelShareLine => {
    const calls = covered.get(`${holding.ticker}|${holding.currency}`) ?? { contracts: 0, strikeTotal: 0, unstruck: false };
    const averageCallStrike = calls.contracts === 0 || calls.unstruck ? null : calls.strikeTotal / calls.contracts;
    const lastPrice = priced.get(contractId(sharesContract(holding.ticker, holding.currency)))?.position.marketPrice ?? null;
    const { averageAssignmentPrice } = holding;
    return {
      ...holding,
      openCallContracts: calls.contracts,
      averageCallStrike,
      coveredShares: Math.min(holding.quantity, calls.contracts * DEFAULT_MULTIPLIER),
      lastPrice,
      unrealizedPnl: lastPrice === null || averageAssignmentPrice === null ? null : (lastPrice - averageAssignmentPrice) * holding.quantity,
      callStrikeBelowAssignment: averageCallStrike !== null && averageAssignmentPrice !== null && averageCallStrike < averageAssignmentPrice,
    };
  });
  // The Wheel's shares are its long positions, shown by their own table: never twice.
  return { shares, groups: { ...groups, long: [] } };
}

/**
 * The Wheel's calls that still have shares behind them, by ticker and currency: the shares card
 * counts these, not the journal's, so that "used 100/100" says what the page shows
 * (spec of sub-project 22, §3.4).
 */
function coveredCallsByTicker(sales: readonly StrategyLine[]): Map<string, { contracts: number; strikeTotal: number; unstruck: boolean }> {
  const covered = new Map<string, { contracts: number; strikeTotal: number; unstruck: boolean }>();
  for (const sale of sales) {
    if (sale.kind !== "short_call") continue;
    const key = `${sale.contract.ticker}|${sale.contract.currency}`;
    const entry = covered.get(key) ?? { contracts: 0, strikeTotal: 0, unstruck: false };
    const contracts = Math.abs(sale.quantity);
    covered.set(key, {
      contracts: entry.contracts + contracts,
      strikeTotal: entry.strikeTotal + (sale.contract.strike ?? 0) * contracts,
      unstruck: entry.unstruck || sale.contract.strike === null,
    });
  }
  return covered;
}
```

`wheelHoldings` reste inchangé dans `@ib/ledger` : ses champs `openCallContracts`,
`averageCallStrike` et `coveredShares` gardent leur sens de journal et sont ici recouverts.

- [x] **Step 4: Lancer les tests pour les voir passer**

Run: `pnpm --filter @ib/coverage test -- strategy`
Expected: PASS, tout le fichier.

- [x] **Step 5: Commit**

```bash
git add packages/coverage/src/strategy.ts packages/coverage/src/strategy.test.ts docs/plans/2026-09-18-part-nue-positions.md
git commit -m "La carte des actions Wheel ne compte que les calls couverts"
```

---

### Task 5 : le scénario complet, vu sur les deux pages

**Files:**
- Test: `apps/web/src/pages/StrategyPositionsPage.test.tsx`

**Interfaces:**
- Consomme : le comportement des tâches 1 à 4, par `strategyPositions`. Aucun code de production
  n'est modifié par cette tâche — si un test échoue autrement que sur ses chiffres attendus,
  c'est une tâche précédente qui est incomplète.

- [x] **Step 1: Écrire les tests qui échouent**

Ajouter dans `apps/web/src/pages/StrategyPositionsPage.test.tsx`, après le bloc
`describe("StrategyPositionsPage — LEAPS", …)`. `trade`, `renderPage`, `rowIn`, `texts` et le
`beforeEach` global du fichier existent déjà ; les transactions ci-dessous se construisent sur
le même modèle que `MARA_CALL` en tête de fichier.

```ts
/** A second MQZA 15 call, sold while the 200 assigned shares still covered two. */
const MARA_CALL_2: Transaction = { ...MARA_CALL, externalId: "flex:trade:403", price: 0.6, amount: 60, when: "2026-08-26T14:30:00.000Z" };

/** 100 of the 200 assigned shares sold afterwards: one of the two calls loses its cover. */
const MARA_SHARES_SOLD: Transaction = {
  ...MARA_CALL,
  externalId: "flex:trade:404",
  symbol: "MQZA",
  secType: "STK",
  right: "",
  strike: null,
  expiry: null,
  quantity: -100,
  price: 18,
  amount: 1800,
  when: "2026-08-27T14:30:00.000Z",
};

/** What IB holds then: 100 shares and the two calls, one of which nothing covers. */
const NAKED_SNAPSHOT: SnapshotRecord = {
  ...SAMPLE_JOURNAL_SNAPSHOT,
  positions: [
    { ...maraShares, quantity: 100, marketPrice: 18, marketValue: 1800 },
    { ...zzzLeaps, marketPrice: 4, marketValue: 400 },
    { ...zzzCall, marketPrice: 0.25, marketValue: -25 },
    aapl,
    { ...zzzLeaps, symbol: "MQZA", strike: 15, expiry: "2026-10-16", quantity: -2, marketPrice: 1, marketValue: -200, description: "MQZA 16OCT26 15 C" },
  ],
};

async function seedNaked() {
  await db.transactions.bulkAdd([...SAMPLE_JOURNAL_TRANSACTIONS, MARA_CALL, MARA_CALL_2, MARA_SHARES_SOLD]);
  await db.snapshots.put(NAKED_SNAPSHOT);
}

describe("StrategyPositionsPage — a call that lost its cover", () => {
  it("shows the Wheel only the covered call, and its shares card says used 100/100", async () => {
    await seedNaked();
    renderPage("wheel");
    const call = await rowIn("Ventes d'options", "MQZA Oct16'26 15 Call");
    expect(texts(call)).toEqual(["MQZA Oct16'26 15 Call", "sell of call", "", "-$100.00", "-1", "0.70", "1.00", "-$30.00", "keep", "stock ×1"]);
    const held = await rowIn("Actions assignées", "MQZA");
    expect(texts(held)).toEqual(["MQZA", "", "100", "17.00", "15.00", "$1,700.00", "18.00", "$100.00", "used 100/100"]);
  });

  it("shows the naked contract on Others, without naming where it comes from", async () => {
    await seedNaked();
    renderPage("others");
    const call = await rowIn("Ventes d'options", "MQZA Oct16'26 15 Call");
    expect(texts(call)).toEqual(["MQZA Oct16'26 15 Call", "sell of call", "", "-$100.00", "-1", "0.70", "1.00", "-$30.00", "keep", "UNCOVERED ×1"]);
    expect(within(screen.getByLabelText("Ventes d'options")).queryByText("Wheel")).not.toBeInTheDocument();
  });
});
```

- [x] **Step 2: Lancer les tests pour les voir échouer**

Run: `pnpm --filter web test -- StrategyPositionsPage`
Expected: FAIL si les tâches 1 à 4 ne sont pas faites. **Si elles le sont, ces tests doivent
passer du premier coup** : c'est leur rôle, cloue le comportement de bout en bout. S'ils
échouent alors, corriger les chiffres attendus **seulement** après avoir vérifié à la main que le
comportement observé est celui de la spec — sinon c'est le code qui est faux.

- [x] **Step 3: Vérifier les colonnes attendues**

Les dix colonnes d'une ligne d'option sont, dans l'ordre : contrat, type, secteur, valeur de
marché, position, prix d'entrée, dernier prix, P&L latent, décision, couverture. Les neuf d'une
ligne d'actions Wheel : ticker, secteur, quantité, prix d'assignation, strike du call, valeur,
dernier prix, P&L latent, couverture. Les chiffres attendus se lisent ainsi : la ligne d'option
porte deux calls vendus à 0,80 et 0,60, donc un prix moyen de 0,70 sur les deux pages ; la
quantité affichée est `-1` de chaque côté ; `marketValue = 1,00 × −1 × 100` ; `unrealizedPnl =
(1,00 − 0,70) × −1 × 100`.

- [x] **Step 4: Lancer toute la suite web du fichier**

Run: `pnpm --filter web test -- StrategyPositionsPage`
Expected: PASS, y compris les tests existants qui utilisent `seed()` et `SNAPSHOT` — ils gardent
200 actions et un seul call, donc « used 100/200 » et `stock ×1` inchangés.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/pages/StrategyPositionsPage.test.tsx docs/plans/2026-09-18-part-nue-positions.md
git commit -m "Test de bout en bout : la part nue passe de la Wheel à Autres"
```

---

### Task 6 : documentation, vérification et instance de relecture

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/points-reportes.md`

**Interfaces:**
- Consomme : le comportement livré par les tâches 1 à 5.
- Produit : rien de code.

- [ ] **Step 1: Mettre à jour `CLAUDE.md`**

Dans la puce « **Les positions d'une stratégie sont une vue calculée, jamais stockée** », après
la phrase sur `STRATEGY_COVER_SOURCES`, ajouter :

```markdown
  **Une page de stratégie ne montre que sa part couverte** : `migratedContracts`
  (`packages/coverage/src/strategy.ts`) retranche d'une vente d'options les contrats que la
  couverture du snapshot ne porte plus, et la page Autres les reprend, fondus par contrat et sans
  badge d'origine — une position nue n'appartient à aucune stratégie. Le total repris ne dépasse
  jamais l'`uncoveredQuantity` du moteur, moins ce qu'Autres détient déjà, donc la page Autres ne
  peut pas contredire la barre de titre ; sans snapshot rien ne migre. La quantité d'une telle
  ligne ne vaut alors plus celle du Journal de la stratégie, qui reste le registre des lots : la
  classification se fait une fois, à la vente. La carte « Actions assignées » de la Wheel ne
  compte que les calls couverts, ce qui rend « used x/y » vrai.
```

Ajouter la ligne au tableau des sous-projets :

```markdown
| 22 | La part nue quitte les pages de stratégie | fait (2026-09-18) |
```

- [ ] **Step 2: Mettre à jour `docs/points-reportes.md`**

Dans la section du sous-projet 21, remplacer la dernière puce (« La page Autres ne montre pas
toute la part nue du portefeuille ») par :

```markdown
- ~~**La page Autres ne montre pas toute la part nue du portefeuille**~~ — **fermé par le
  sous-projet 22** (2026-09-18) : une page de stratégie ne montre que sa part couverte, et la
  page Autres reprend le reste.
```

Dans la section du sous-projet 16, remplacer la puce « Le badge « used » des actions Wheel est
vert quand les calls Wheel ouverts dépassent les actions » par :

```markdown
- ~~**Le badge « used » des actions Wheel est vert quand les calls Wheel ouverts dépassent les
  actions**~~ — **fermé par le sous-projet 22** (2026-09-18) : la carte ne compte plus que les
  calls couverts, donc « used 100/100 » dit vrai et le call sans rien derrière lui est sur la
  page Autres.
```

Ajouter une section pour le sous-projet 22, avant « Sans échéance » :

```markdown
## Reporté par le sous-projet 22 (la part nue quitte les pages de stratégie)

- **Un call Wheel réellement couvert par un LEAPS long garde une cellule de couverture vide** sur
  la page Wheel : sa couverture vient de `leaps`, qui n'est pas une source de la Wheel
  (`STRATEGY_COVER_SOURCES`). Le plafond de `migratedContracts` l'empêche de migrer à tort vers
  Autres — rien n'est faux, seulement muet. C'était déjà le comportement avant ce sous-projet.
  L'élargir demande de décider ce qu'une page de stratégie dit d'une couverture qui ne lui
  appartient pas.
- **Un put vendu ne migre jamais**, `secureShortPuts` (`packages/coverage/src/coverage.ts`) lui
  allouant toujours `cash` sans regarder le cash disponible ; un manque de cash reste un problème
  global du rapport. La règle est écrite sur les ventes d'options en général et suivra le moteur
  s'il change.

---
```

- [ ] **Step 3: Vérifier tout, une seule fois**

Run: `pnpm check`
Expected: PASS — lint, typage, build et tous les tests.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/points-reportes.md docs/plans/2026-09-18-part-nue-positions.md
git commit -m "Documenter le sous-projet 22 et fermer les points reportés 16 et 21"
```

- [ ] **Step 5: Démarrer l'instance de relecture**

Run: `pnpm dev:start` **dans le worktree**
Expected: Vite et Django détachés sur les ports du worktree. Donner les deux URL à Seb : il
regarde la branche avant de décider du merge. `pnpm dev:stop` **avant** le merge et le
`git worktree remove`, jamais après.
