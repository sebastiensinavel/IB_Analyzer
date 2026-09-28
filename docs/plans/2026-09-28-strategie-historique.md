# Stratégie dans l'Historique — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter à l'Historique une colonne « Stratégie », un badge par stratégie à laquelle chaque transaction a servi, calculée depuis les journaux.

**Architecture:** Une fonction pure `transactionStrategies(rows)` dans `packages/ledger` lit les `openIds`/`closeIds` des lignes de journal et rend une `Map<externalId, Strategy[]>`. La page Historique la calcule par `useMemo` sur `useAccountJournals()` (journaux déjà calculés dans la coquille) et la passe à la table et aux specs de colonne. Rien n'est stocké.

**Tech Stack:** TypeScript, Vitest, React 19, base-ui/shadcn, Tailwind, i18next.

**Spec:** `docs/specs/2026-09-28-strategie-historique-design.md`

## Global Constraints

- Vue calculée, jamais stockée : aucune table, store ni migration Dexie ; rien côté serveur ni agent.
- Le badge porte le nom de la stratégie seul, jamais une quantité.
- `closeIds` d'une ligne `event === "integrated"` ne comptent pas ; `openIds` comptent toujours.
- Ordre des badges : celui de `STRATEGIES` (`wheel`, `leaps`, `condors`, `others`).
- `packages/ledger` n'écrit aucun texte visible ; libellés dans `apps/web/src/i18n/{fr,en}.json`.
- La cellule garde une hauteur constante (`HISTORY_ROW_HEIGHT`, `h-9 truncate`) : jamais de retour à la ligne.
- Aucune page n'appelle `useJournals` : lecture par `useAccountJournals()` seule.
- Filtre : colonne `enum` multi-valeurs (`[]` ⇒ « — »), `sortable: false`, le filtre lit les valeurs, jamais le texte des badges.
- Les largeurs de `HISTORY_COLUMNS` somment à 100.
- `pnpm check` une seule fois à la fin (tâche 3) ; tests ciblés pendant l'itération (`npx vitest run <motif>` depuis `apps/web` ou le paquet).

## Review Focus

- Journaux en chargement : la cellule reste vide (ni badge ni « — »), jamais une page qui lève une erreur — testé en tâche 2 par le rendu initial.
- Un compte à stratégies actives réduites (`["wheel"]`) : un condor ouvert porte `Autres`, jamais `Condors` — testé en tâche 1.
- Tranches fondues d'un ordre : chaque tranche porte la stratégie, pas seulement la première — testé en tâche 1.
- Une ligne Historique sans stratégie retenue par le filtre « — » et exclue par le filtre Wheel — testé en tâche 2.
- Deux badges côte à côte (`Wheel` + `Autres`) tiennent dans la colonne sans agrandir la ligne — mesuré en tâche 3.

---

### Task 1: `transactionStrategies` dans le moteur

**Files:**
- Create: `packages/ledger/src/journals/transactionStrategies.ts`
- Create: `packages/ledger/src/journals/transactionStrategies.test.ts`
- Modify: `packages/ledger/src/journals/index.ts` (ajout d'un export)

**Interfaces:**
- Consumes: `JournalRow`, `Strategy`, `STRATEGIES` (`./types.ts`) ; `buildJournals` (`./replay.ts`) dans les tests ; fixtures `option`, `stock`, `resetIds` (`./fixtures.ts`), `tx` (`../fixtures.ts`).
- Produces: `export function transactionStrategies(rows: readonly JournalRow[]): Map<string, Strategy[]>`, exporté depuis `@ib/ledger`.

- [x] **Step 1: Écrire les tests qui échouent**

`packages/ledger/src/journals/transactionStrategies.test.ts` :

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { tx } from "../fixtures.ts";
import { option, resetIds, stock } from "./fixtures.ts";
import { buildJournals } from "./replay.ts";
import { transactionStrategies } from "./transactionStrategies.ts";

beforeEach(resetIds);

const BUY = "2026-03-02T14:30:00.000Z";
const SELL_CALL = "2026-08-03T14:30:00.000Z";
const LATER = "2026-08-10T14:30:00.000Z";
const CALL = { right: "C" as const, strike: 20, expiry: "2026-09-18" };
const SPY = { ticker: "SPY", expiry: "2026-08-29" };

function ironCondor(when = "2026-08-01T14:30:00.000Z") {
  return [
    option({ ...SPY, id: "leg1", right: "P", strike: 620, quantity: 1, price: 0.3, when }),
    option({ ...SPY, id: "leg2", right: "P", strike: 625, quantity: -1, price: 0.6, when }),
    option({ ...SPY, id: "leg3", right: "C", strike: 660, quantity: -1, price: 0.5, when }),
    option({ ...SPY, id: "leg4", right: "C", strike: 665, quantity: 1, price: 0.3, when }),
  ];
}

describe("transactionStrategies", () => {
  it("gives a takeover's original purchase both strategies, Wheel first, and the call Wheel alone", () => {
    const report = buildJournals([
      stock({ id: "buy", quantity: 100, price: 10, when: BUY }),
      option({ ...CALL, id: "call", quantity: -1, price: 0.5, when: SELL_CALL }),
    ]);
    const map = transactionStrategies(report.rows);
    expect(map.get("buy")).toEqual(["wheel", "others"]);
    // The integrated close of the Others lot names the call: it must not bring Others in.
    expect(map.get("call")).toEqual(["wheel"]);
  });

  it("gives a share sale cut between Others and the Wheel both strategies", () => {
    const report = buildJournals([
      stock({ id: "buy", quantity: 300, price: 10, when: BUY }),
      option({ ...CALL, id: "call", quantity: -1, price: 0.5, when: SELL_CALL }),
      stock({ id: "sell", quantity: -300, price: 12, when: LATER }),
    ]);
    expect(transactionStrategies(report.rows).get("sell")).toEqual(["wheel", "others"]);
  });

  it("gives every leg of a condor Condors", () => {
    const map = transactionStrategies(buildJournals(ironCondor()).rows);
    for (const id of ["leg1", "leg2", "leg3", "leg4"]) expect(map.get(id)).toEqual(["condors"]);
  });

  it("never names an inactive strategy: without Condors the legs are Others", () => {
    const map = transactionStrategies(buildJournals(ironCondor(), undefined, undefined, ["wheel"]).rows);
    for (const id of ["leg1", "leg2", "leg3", "leg4"]) expect(map.get(id)).toEqual(["others"]);
  });

  it("gives every slice of a folded order the strategy of its line", () => {
    const map = transactionStrategies(
      buildJournals([
        stock({ id: "slice1", quantity: 50, price: 10, when: "2026-03-02T14:30:00.000Z" }),
        stock({ id: "slice2", quantity: 50, price: 10, when: "2026-03-02T14:30:01.000Z" }),
      ]).rows,
    );
    expect(map.get("slice1")).toEqual(["others"]);
    expect(map.get("slice2")).toEqual(["others"]);
  });

  it("leaves a deposit out of the map", () => {
    const deposit = tx({ externalId: "dep", kind: "transfer", symbol: "", secType: "", quantity: null, price: null, amount: 1000, commission: null, when: BUY });
    const report = buildJournals([deposit, stock({ id: "buy", quantity: 100, price: 10, when: LATER })]);
    const map = transactionStrategies(report.rows);
    expect(map.has("dep")).toBe(false);
    expect(map.get("buy")).toEqual(["others"]);
  });
});
```

- [x] **Step 2: Vérifier l'échec**

Run: `cd packages/ledger && npx vitest run transactionStrategies`
Expected: FAIL, module `./transactionStrategies.ts` introuvable.

- [x] **Step 3: Implémentation minimale**

`packages/ledger/src/journals/transactionStrategies.ts` :

```ts
import { STRATEGIES, type JournalRow, type Strategy } from "./types.ts";

/**
 * The strategies each transaction served, by `externalId`, in the order of STRATEGIES; a
 * transaction no journal line names is absent (spec of sub-project 37, §2). A line's `openIds`
 * always count for its strategy, its `closeIds` too except on a takeover's `integrated` close:
 * those ids are the covered call's, a Wheel operation that must not bring the lot's original
 * strategy in. A condor's composite already carries its legs' ids, so `legs` is not read.
 */
export function transactionStrategies(rows: readonly JournalRow[]): Map<string, Strategy[]> {
  const sets = new Map<string, Set<Strategy>>();
  const add = (id: string, strategy: Strategy) => {
    const set = sets.get(id);
    if (set) set.add(strategy);
    else sets.set(id, new Set([strategy]));
  };
  for (const row of rows) {
    for (const id of row.openIds) add(id, row.strategy);
    if (row.event !== "integrated") for (const id of row.closeIds) add(id, row.strategy);
  }
  return new Map([...sets].map(([id, set]) => [id, STRATEGIES.filter((strategy) => set.has(strategy))]));
}
```

Dans `packages/ledger/src/journals/index.ts`, ajouter :

```ts
export { transactionStrategies } from "./transactionStrategies.ts";
```

- [x] **Step 4: Vérifier le succès**

Run: `cd packages/ledger && npx vitest run transactionStrategies`
Expected: PASS (6 tests). Si un scénario ne rend pas ce que le test attend, lire `report.rows` avant de toucher au test : le test décrit la spec, un écart est soit un défaut de la fonction, soit un scénario mal construit (par ex. la vente de `sell` reprise par R2 si elle tombait à moins de 60 s d'un rachat — ce n'est pas le cas ici).

- [x] **Step 5: Commit**

```bash
git add packages/ledger/src/journals/transactionStrategies.ts packages/ledger/src/journals/transactionStrategies.test.ts packages/ledger/src/journals/index.ts docs/plans/2026-09-28-strategie-historique.md
git commit -m "Stratégie dans l'Historique : transactionStrategies, les stratégies de chaque transaction"
```

(Cocher les cases de cette tâche dans ce plan, dans le même commit.)

---

### Task 2: La colonne Stratégie de l'Historique

**Files:**
- Create: `apps/web/src/lib/strategyBadges.ts`
- Create: `apps/web/src/lib/strategyBadges.test.ts`
- Modify: `apps/web/src/lib/historyColumns.ts` (colonne `strategy` après `symbol`, largeurs provisoires, paramètre `strategiesOf`)
- Modify: `apps/web/src/lib/historyColumns.test.ts`
- Modify: `apps/web/src/components/history/HistoryTable.tsx` (prop `strategiesOf`, cellule de badges)
- Modify: `apps/web/src/pages/HistoryPage.tsx` (map, facets `strategy`)
- Modify: `apps/web/src/pages/HistoryPage.test.tsx` (enveloppe `WithAccountData`, indices de colonnes décalés, nouveaux tests)
- Modify: `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`

**Interfaces:**
- Consumes: `transactionStrategies` et `type Strategy` de `@ib/ledger` (tâche 1) ; `useAccountJournals()` (`@/db/AccountDataProvider`, rend `JournalsView` : `{status:"loading"} | {status:"ready"; report}`) ; `Badge` de `@ib/ui/badge` ; `WithAccountData` (`@/test/WithAccountData`).
- Produces:
  - `export type StrategiesOf = ((externalId: string) => readonly Strategy[]) | null` dans `historyColumns.ts` — `null` tant que les journaux chargent.
  - `historyColumnSpecs(t: Translate, strategiesOf: StrategiesOf): ColumnSpec<LedgerRow>[]` — douze colonnes.
  - `STRATEGY_BADGE: Record<Strategy, { variant: "success" | "warning" | "outline"; className?: string }>` dans `strategyBadges.ts`.
  - `HistoryTable` prend `strategiesOf: StrategiesOf`.

- [x] **Step 1: Tests qui échouent — badges et specs**

`apps/web/src/lib/strategyBadges.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { STRATEGIES } from "@ib/ledger";
import { STRATEGY_BADGE } from "@/lib/strategyBadges";

describe("STRATEGY_BADGE", () => {
  it("gives each strategy its role's hue, Others a neutral outline", () => {
    expect(Object.keys(STRATEGY_BADGE).sort()).toEqual([...STRATEGIES].sort());
    expect(STRATEGY_BADGE.wheel.variant).toBe("success");
    expect(STRATEGY_BADGE.condors.variant).toBe("warning");
    expect(STRATEGY_BADGE.others.variant).toBe("outline");
    expect(STRATEGY_BADGE.leaps.className).toContain("#7b5ce5");
    expect(STRATEGY_BADGE.leaps.className).toContain("#a28bf5");
  });
});
```

Dans `apps/web/src/lib/historyColumns.test.ts`, remplacer le test « types every column » et compléter « compares what the cells show » :

```ts
const ready = (id: string) => (id === "flex:trade:4" ? (["wheel", "others"] as const) : []);

it("types every column of the table, in its order", () => {
  const specs = historyColumnSpecs(t, ready);
  expect(specs.map((spec) => spec.key)).toEqual(HISTORY_COLUMNS.map((column) => column.key));
  expect(specs.map((spec) => spec.key).slice(2, 4)).toEqual(["symbol", "strategy"]);
  expect(specs.map((spec) => spec.type)).toEqual(["date", "enum", "text", "enum", "number", "number", "number", "number", "number", "text", "number", "number"]);
  expect(specs.filter((spec) => !spec.sortable).map((spec) => spec.key)).toEqual(["strategy"]);
});

it("reads a row's strategies, an empty list for none and while the journals load", () => {
  const strategy = historyColumnSpecs(t, ready).find((spec) => spec.key === "strategy")!;
  expect(strategy.value(row())).toEqual(["wheel", "others"]);
  expect(strategy.value(row(SAMPLE_DEPOSIT))).toEqual([]);
  expect(strategy.label?.("others")).toBe("t:history.strategies.others");
  expect(historyColumnSpecs(t, null).find((spec) => spec.key === "strategy")!.value(row())).toEqual([]);
});
```

Remplacer aussi tous les autres `historyColumnSpecs(t)` / `historyColumnSpecs(translate)` du fichier par `historyColumnSpecs(t, ready)` / `historyColumnSpecs(translate, null)`.

- [x] **Step 2: Vérifier l'échec**

Run: `cd apps/web && npx vitest run strategyBadges historyColumns`
Expected: FAIL (module `strategyBadges` absent, clé `strategy` absente).

- [x] **Step 3: Implémenter badges, specs, textes**

`apps/web/src/lib/strategyBadges.ts` :

```ts
import type { Strategy } from "@ib/ledger";

/**
 * The badge of each strategy in the history (spec of sub-project 37, §3): the hue of its role in
 * the palette — the Wheel the teal of an open line, LEAPS the violet of series 3, Condors the amber
 * of the `spread` cover badge —, Others a neutral outline. A Record, so a new strategy without its
 * badge does not compile. The violet mirrors CHART_COLORS.series[3] in both themes.
 */
export const STRATEGY_BADGE: Record<Strategy, { variant: "success" | "warning" | "outline"; className?: string }> = {
  wheel: { variant: "success" },
  leaps: { variant: "success", className: "bg-[#7b5ce5]/10 text-[#7b5ce5] dark:bg-[#a28bf5]/20 dark:text-[#a28bf5]" },
  condors: { variant: "warning" },
  others: { variant: "outline" },
};
```

Dans `apps/web/src/lib/historyColumns.ts` :

1. Imports : `import { tickerOf, type LedgerRow, type Strategy } from "@ib/ledger";`
2. `HISTORY_COLUMNS` devient (largeurs **provisoires**, somme 100, finalisées en tâche 3) :

```ts
export const HISTORY_COLUMNS = [
  { key: "dateTime", width: "16.25%", numeric: false, balance: false },
  { key: "type", width: "8%", numeric: false, balance: false },
  { key: "symbol", width: "13%", numeric: false, balance: false },
  { key: "strategy", width: "11%", numeric: false, balance: false },
  { key: "quantity", width: "5.5%", numeric: true, balance: false },
  { key: "price", width: "5.25%", numeric: true, balance: false },
  { key: "totalPrice", width: "8.5%", numeric: true, balance: false },
  { key: "fee", width: "5.25%", numeric: true, balance: false },
  { key: "cash", width: "5.5%", numeric: true, balance: false },
  { key: "currency", width: "5.75%", numeric: false, balance: false },
  { key: "usdCash", width: "8%", numeric: true, balance: true },
  { key: "eurCash", width: "8%", numeric: true, balance: true },
] as const satisfies readonly { key: string; width: string; numeric: boolean; balance: boolean }[];
```

   et le commentaire au-dessus dit « twelve columns ».
3. Avant `historyColumnSpecs` :

```ts
/**
 * The strategies a transaction served, by its externalId (`transactionStrategies`), or `null` while
 * the journals load. Never stored: the page derives it from the shell's journals.
 */
export type StrategiesOf = ((externalId: string) => readonly Strategy[]) | null;
```

4. `historyColumnSpecs(t: Translate, strategiesOf: StrategiesOf)`, et juste après la spec `symbol` :

```ts
    {
      key: "strategy",
      type: "enum",
      // Several values per row, like Positions' Coverage: the view engine sorts no list.
      sortable: false,
      value: (row) => strategiesOf?.(row.transaction.externalId) ?? [],
      label: (strategy) => t(`history.strategies.${strategy}`),
    },
```

Dans `apps/web/src/i18n/fr.json`, bloc `history` : `"strategy": "Stratégie"` dans `columns` (après `symbol`), et à côté de `kinds` :

```json
    "strategies": { "wheel": "Wheel", "leaps": "LEAPS", "condors": "Condors", "others": "Autres" }
```

Dans `en.json`, mêmes clés : `"strategy": "Strategy"`, `"strategies": { "wheel": "Wheel", "leaps": "LEAPS", "condors": "Condors", "others": "Others" }`.

- [x] **Step 4: Vérifier le succès des tests unitaires**

Run: `cd apps/web && npx vitest run strategyBadges historyColumns`
Expected: PASS.

- [x] **Step 5: Tests de page qui échouent**

Dans `apps/web/src/pages/HistoryPage.test.tsx` :

1. Importer `WithAccountData` (`@/test/WithAccountData`) et envelopper la route :
   `<Route path="/accounts/:accountId/history" element={<WithAccountData><HistoryPage /></WithAccountData>} />`.
   `AccountDataProvider` lit aussi le compte, le snapshot et les contrats : si le `beforeEach` ne vide pas `db.snapshots`/`db.contracts`, rien à ajouter (tables vides = pas de snapshot) ; s'il le faut, les vider aussi.
2. Décaler d'un les constantes de colonne après `symbol` : `CASH_CELL = 8`, `CURRENCY_CELL = 9`, `USD_CASH_CELL = 10`, `EUR_CASH_CELL = 11`, et ajouter `const STRATEGY_CELL = 3;`. Mettre à jour le commentaire d'ordre des colonnes. Chercher tout autre indice de cellule en dur (`getAllByRole("cell")[n]`) au-delà de 2 et le décaler.
3. Ajouter :

```ts
/**
 * 100 MQZA bought, then one covered call sold on them: the Wheel takes the shares over at the
 * strike, so the purchase serves Others and the Wheel, the call the Wheel alone; plus a deposit.
 * The account row is required: without it the active strategies, hence the journals, never load.
 */
async function seedTakeover() {
  await db.accounts.put({ id: "alpha", label: "alpha", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [], strategies: ["wheel", "leaps", "condors"] });
  await db.transactions.bulkAdd([
    { ...SAMPLE_TRANSACTIONS[0], accountId: "alpha", externalId: "flex:trade:buy", symbol: "MQZA", quantity: 100, price: 10, amount: -1000, when: "2026-03-02T14:30:00.000Z" },
    { ...SAMPLE_TRANSACTIONS[0], accountId: "alpha", externalId: "flex:trade:call", symbol: "MQZA  260918C00020000", secType: "OPT", right: "C", strike: 20, expiry: "2026-09-18", quantity: -1, price: 0.5, amount: 50, when: "2026-08-03T14:30:00.000Z" },
    { ...SAMPLE_DEPOSIT, accountId: "alpha" },
  ]);
}

function strategyCell(row: HTMLTableRowElement): string {
  return within(row).getAllByRole("cell")[STRATEGY_CELL].textContent ?? "";
}

describe("strategy column", () => {
  it("shows a badge per strategy, Wheel first, and a dash for a deposit", async () => {
    await seedTakeover();
    renderHistory();
    const buy = await rowFor("MQZA");
    await waitFor(() => expect(strategyCell(buy)).toBe("WheelAutres"));
    expect(strategyCell(await rowFor("ELECTRONIC FUND TRANSFER"))).toBe("—");
    expect(within(buy).getAllByText(/^(Wheel|Autres)$/)).toHaveLength(2);
  });

  it("filters on a strategy's value: Wheel keeps both trades, the dash keeps the deposit alone", async () => {
    await seedTakeover();
    renderHistory();
    const buy = await rowFor("MQZA");
    await waitFor(() => expect(strategyCell(buy)).toBe("WheelAutres"));
    const user = userEvent.setup();
    await openPanel(user, "Stratégie");
    await user.click(await screen.findByRole("checkbox", { name: /Wheel/ }));
    await waitFor(() => expect(rowSymbols()).toHaveLength(2));
    expect(rowSymbols()).not.toContain("ELECTRONIC FUND TRANSFER");
    await user.click(screen.getByRole("checkbox", { name: /Wheel/ }));
    await user.click(screen.getByRole("checkbox", { name: /—/ }));
    await waitFor(() => expect(rowSymbols()).toEqual(["ELECTRONIC FUND TRANSFER"]));
  });
});
```

   `rowFor("MQZA")` trouve la ligne dont une cellule vaut exactement `MQZA` : l'achat (l'option s'affiche par `formatContract`, un autre texte). Si la case « — » du panneau porte un autre nom accessible (le composant traduit l'entrée `null` des facets), lire `ColumnHeader`/le panneau de filtre pour prendre son libellé réel — jamais changer le comportement pour faire passer le test.

- [x] **Step 6: Vérifier l'échec**

Run: `cd apps/web && npx vitest run HistoryPage`
Expected: FAIL (colonne absente de la table).

- [x] **Step 7: Brancher la page et la table**

`apps/web/src/pages/HistoryPage.tsx` :

```ts
import { anchoredBalances, transactionStrategies } from "@ib/ledger";
import { useAccountJournals } from "@/db/AccountDataProvider";
import { historyColumnSpecs, historyTicker, type StrategiesOf } from "@/lib/historyColumns";
// …
  const journals = useAccountJournals();
  const strategiesOf = useMemo<StrategiesOf>(() => {
    if (journals.status !== "ready") return null;
    const map = transactionStrategies(journals.report.rows);
    return (externalId) => map.get(externalId) ?? NO_STRATEGY;
  }, [journals]);
  const specs = useMemo(() => historyColumnSpecs((key, options) => t(key, options), strategiesOf), [t, strategiesOf]);
```

avec, au niveau module : `const NO_STRATEGY: readonly Strategy[] = [];` (import `type Strategy` de `@ib/ledger`) — un tableau stable, pour que la ligne mémoïsée ne se re-rende pas.

Facets : ajouter `strategy` à côté de `type`, calculé sur `rows` comme `type`, avec les valeurs cochées de `table.view.criteria.strategy` :

```ts
  const strategySpec = specs.find((spec) => spec.key === "strategy")!;
  const strategyCriterion = table.view.criteria.strategy;
  const checkedStrategiesKey = JSON.stringify(Array.isArray(strategyCriterion) ? strategyCriterion : []);
  const facets = useMemo(
    () => ({
      type: rows ? facetValues(rows, typeSpec, JSON.parse(checkedKey) as (string | null)[]) : [],
      strategy: rows ? facetValues(rows, strategySpec, JSON.parse(checkedStrategiesKey) as (string | null)[]) : [],
    }),
    [rows, typeSpec, checkedKey, strategySpec, checkedStrategiesKey],
  );
```

Passer `strategiesOf={strategiesOf}` à `<HistoryTable>`.

`apps/web/src/components/history/HistoryTable.tsx` :

- Prop `strategiesOf: StrategiesOf` (import depuis `@/lib/historyColumns`), documentée « `null` while the journals load ».
- `<TransactionRow key={item.key} row={rows[item.index]} strategies={strategiesOf ? strategiesOf(rows[item.index].transaction.externalId) : null} />`
- `TransactionRow` prend `strategies: readonly Strategy[] | null` ; juste après la cellule `symbol` :

```tsx
      {/* The strategies this transaction served, from the journals; empty while they load. One line,
          clipped rather than wrapped: every row is HISTORY_ROW_HEIGHT tall. */}
      <TableCell className={CELL}>
        {strategies === null ? null : strategies.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <div className="flex gap-1 overflow-hidden">
            {strategies.map((strategy) => (
              <Badge key={strategy} variant={STRATEGY_BADGE[strategy].variant} className={STRATEGY_BADGE[strategy].className}>
                {t(`history.strategies.${strategy}`)}
              </Badge>
            ))}
          </div>
        )}
      </TableCell>
```

   (imports : `Badge` de `@ib/ui/badge`, `STRATEGY_BADGE` de `@/lib/strategyBadges`, `type Strategy` de `@ib/ledger`). Mettre à jour le commentaire « ~11 cells ».

- [x] **Step 8: Vérifier le succès**

Run: `cd apps/web && npx vitest run HistoryPage historyColumns strategyBadges`
Expected: PASS. Puis `cd apps/web && npx tsc --noEmit -p .` : aucune erreur (d'autres appelants de `historyColumnSpecs` ou de `HistoryTable` ailleurs dans `apps/web` — `grep -rn "historyColumnSpecs\|<HistoryTable" apps/web/src` — doivent recevoir le nouvel argument).

- [x] **Step 9: Commit**

```bash
git add apps/web/src docs/plans/2026-09-28-strategie-historique.md
git commit -m "Stratégie dans l'Historique : la colonne, ses badges et son filtre"
```

---

### Task 3: Largeurs mesurées, documentation, vérification

**Files:**
- Script de mesure jetable, écrit hors du dépôt (dossier temporaire de la session), jamais committé
- Modify: `apps/web/src/lib/historyColumns.ts` (largeurs finales, commentaire)
- Modify: `CLAUDE.md` (règle + ligne 37 du registre)
- Modify: `docs/specs/2026-09-28-strategie-historique-design.md` (statut)

**Interfaces:**
- Consumes: `HISTORY_COLUMNS` (tâche 2), instance de dev du worktree (`pnpm dev:start`), le skill `run-frontend` (`--seed`) pour peupler une base.

- [x] **Step 1: Mesurer en une passe**

Instance de dev démarrée (`pnpm dev:start` dans le worktree), écrire un script Playwright qui ouvre l'Historique semé (`run-frontend --seed`, fenêtre 1280 px, langue fr) et mesure, pour chacune des douze colonnes : la largeur de l'en-tête (libellé + chevron de tri/filtre, comme mesuré au sous-projet 20) et celle de la donnée la plus longue ; pour `strategy`, la largeur du groupe `Wheel` + `Autres` (deux `Badge` et `gap-1`) plus le padding de cellule. Le script sort les pourcentages de la table à sa largeur minimale 64rem (1024 px). Une seule passe, pas d'itération sur captures.

- [x] **Step 2: Fixer les largeurs**

Reporter les pourcentages dans `HISTORY_COLUMNS` selon la règle du commentaire existant (en-tête entier sur une ligne, puis `dateTime` entier, puis `symbol`, puis les montants), somme 100. Mettre à jour le commentaire : douze colonnes, et la ligne sur `strategy` (« sized on `Wheel` + `Autres` side by side, the longest pair a takeover leaves »). `npx vitest run historyColumns` : PASS.

- [x] **Step 3: Documentation**

Dans `CLAUDE.md`, section « Règles qui mordent », après la règle « L'Historique ne pagine pas », ajouter :

```markdown
- **La stratégie d'une ligne de l'Historique est calculée, jamais stockée** (sous-projet 37) :
  `transactionStrategies` (`packages/ledger/src/journals/transactionStrategies.ts`) lit les
  `openIds`/`closeIds` des lignes de journal — jamais les `closeIds` d'une clôture `integrated`,
  qui sont ceux du call couvert — et la page Historique la dérive de `useAccountJournals`. Le badge
  porte le nom seul, jamais une quantité : des tranches fondues puis réparties ne disent pas
  laquelle est allée où. Teintes dans `STRATEGY_BADGE` (`lib/strategyBadges.ts`) ; la colonne se
  filtre sur ses valeurs et ne se trie pas, comme la Couverture.
```

Dans la même règle « L'Historique ne pagine pas » / la règle des filtres, rien d'autre ne change. Ajouter au registre :

```markdown
| 37 | La stratégie de chaque ligne de l'Historique | fait (2026-09-28) |
```

Dans la spec, `Statut : implémenté (2026-09-28).`

- [x] **Step 4: `pnpm check`**

Run: `pnpm check` à la racine du worktree (une seule fois).
Expected: lint, typage, build et tous les tests verts. Corriger tout échec avant de continuer.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/lib/historyColumns.ts CLAUDE.md docs/specs/2026-09-28-strategie-historique-design.md docs/plans/2026-09-28-strategie-historique.md
git commit -m "Stratégie dans l'Historique : largeurs mesurées et documentation"
```
