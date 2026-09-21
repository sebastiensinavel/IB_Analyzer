# Sous-projet 27 — Les graphes de cours dans les tableaux : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** un clic sur une ligne de position ouvre sous elle le graphe du sous-jacent sur deux ans, portant les niveaux de la stratégie de la page.

**Architecture:** un moteur pur dans `packages/ledger` (`journals/levels.ts`) rend des niveaux typés sans couleur ni texte ; `apps/web` leur donne couleur, étiquette et dessin (une primitive de série Lightweight Charts) ; les barres viennent de `/bars` sur l'agent local, sans cache.

**Tech Stack:** TypeScript, Vitest, React 19, Lightweight Charts v5, FastAPI + `ib_async` (déjà livré).

**Spec:** `docs/specs/2026-09-21-graphes-de-cours-design.md`

## Global Constraints

- **`packages/ledger` n'écrit aucun texte visible ni aucune couleur** : les niveaux portent des codes, `apps/web/src/i18n/{fr,en}.json` porte les mots.
- **Une ligne est ouverte selon `endWhen === null`, jamais selon `ongoing`.**
- **Une valeur absente reste `null`**, jamais `0`.
- **Aucun cache de barres** : pas de table Dexie, pas de migration, pas de `localStorage`.
- **L'agent est optionnel** : son absence produit un message, jamais une erreur.
- **Les tests échouent si le comportement change** ; `apps/web` teste sur `fake-indexeddb` avec un ledger semé, jamais en moquant les hooks.
- Couleurs : `chartColors(isDark).series`, index 0 bleu, 1 orange, 2 vert, 3 ambre (`apps/web/src/lib/chartColors.ts`).
- Commits en français, sujet à l'impératif, avec les deux lignes d'attribution de la session.
- `pnpm check` **une seule fois à la fin** (tâche 8) ; pendant l'itération, des tests ciblés.

---

## Task 0: Préparer la branche

**Files:**
- Modify: rien (opérations git)

**Interfaces:**
- Consumes: la branche `prototype-graphes` du worktree `.claude/worktrees/graphes` (trois commits : `/bars` dans l'agent, l'injection prototype, la hauteur du graphe)
- Produces: la branche `graphes-de-cours` dans le même worktree, à jour de `main`, `docs/specs/2026-09-21-graphes-de-cours-design.md` présent

- [ ] **Step 1: Renommer la branche et rapatrier `main`**

```bash
cd /home/seb/IA/IB_Analyzer2/.claude/worktrees/graphes
git branch -m prototype-graphes graphes-de-cours
git merge main -m "Rapatrier la spec du sous-projet 27"
```

- [ ] **Step 2: Vérifier que la spec et le plan sont là**

Run: `ls docs/specs/2026-09-21-graphes-de-cours-design.md docs/plans/2026-09-21-graphes-de-cours.md`
Expected: les deux chemins existent.

- [ ] **Step 3: Vérifier que le socle du prototype est présent**

Run: `grep -c "/bars" apps/tws-agent/ib_tws_agent/main.py && node -e "console.log(require('./apps/web/package.json').dependencies['lightweight-charts'])"`
Expected: un compte non nul, et une version `^5.x`.

---

## Task 1: Les niveaux d'actions et d'options vendues

**Files:**
- Create: `packages/ledger/src/journals/levels.ts`
- Create: `packages/ledger/tests/levels.test.ts`
- Modify: `packages/ledger/src/journals/index.ts` (ajouter `export * from "./levels.ts";`)

**Interfaces:**
- Consumes: `JournalRow`, `Strategy` (`packages/ledger/src/journals/types.ts`), `wheelHoldings` (`packages/ledger/src/journals/holdings.ts`)
- Produces:
  ```ts
  export type ChartLevelKind = "shares" | "shortPut" | "shortCall" | "leapsBuy" | "condor";
  export interface SharesLevel { kind: "shares"; price: number; quantity: number }
  export interface OptionLevel { kind: "shortPut" | "shortCall"; price: number; quantity: number; expiries: string[] }
  export interface LeapsBuyLevel { kind: "leapsBuy"; when: string; quantity: number }
  export interface CondorLevel { kind: "condor"; from: string; to: string; putStrikes: [number, number]; callStrikes: [number, number]; quantity: number }
  export type ChartLevel = SharesLevel | OptionLevel | LeapsBuyLevel | CondorLevel;
  export function strategyLevels(rows: readonly JournalRow[], ticker: string, strategies: readonly Strategy[]): ChartLevel[]
  ```

- [x] **Step 1: Écrire les tests qui échouent**

Créer `packages/ledger/tests/levels.test.ts`. Le helper `row` fabrique une `JournalRow` minimale ; les champs absents ne servent à rien ici.

```ts
import { describe, expect, it } from "vitest";
import { strategyLevels, type ChartLevel } from "../src/journals/levels.ts";
import type { JournalRow, Strategy } from "../src/journals/types.ts";

const ALL: Strategy[] = ["wheel", "leaps", "condors", "others"];

function row(over: Partial<JournalRow> & Pick<JournalRow, "kind" | "strategy">): JournalRow {
  const strike = over.strike ?? null;
  return {
    id: over.id ?? `${over.kind}-${strike ?? "x"}`,
    strategy: over.strategy,
    kind: over.kind,
    ticker: over.ticker ?? "BTDR",
    label: "",
    currency: "USD",
    contract: {
      ticker: over.ticker ?? "BTDR",
      secType: over.kind === "shares" ? "STK" : "OPT",
      right: over.kind === "short_put" ? "P" : over.kind === "shares" ? "" : "C",
      strike,
      expiry: over.contract?.expiry ?? null,
      currency: "USD",
    },
    startWhen: over.startWhen ?? "2026-05-29T14:30:00.000Z",
    quantity: over.quantity ?? null,
    strike,
    openPrice: over.openPrice ?? null,
    openTotal: null,
    openCommission: null,
    openNet: null,
    assigned: over.assigned ?? false,
    endWhen: over.endWhen ?? null,
    closePrice: null,
    closeTotal: null,
    closeCommission: null,
    closeNet: null,
    pnl: null,
    ongoing: over.ongoing ?? true,
    event: over.event ?? null,
    orphan: false,
    note: null,
    openIds: [],
    closeIds: [],
    ...(over.legs ? { legs: over.legs } : {}),
  } as JournalRow;
}

const find = (levels: ChartLevel[], kind: ChartLevel["kind"]) => levels.filter((l) => l.kind === kind);

describe("strategyLevels", () => {
  it("fond deux échéances au même strike en une ligne aux quantités cumulées", () => {
    const rows = [
      row({ kind: "short_put", strategy: "wheel", strike: 17.5, quantity: -4, contract: { expiry: "2026-10-16" } as never }),
      row({ id: "p2", kind: "short_put", strategy: "wheel", strike: 17.5, quantity: -2, contract: { expiry: "2026-11-20" } as never }),
    ];

    const puts = find(strategyLevels(rows, "BTDR", ALL), "shortPut");

    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ price: 17.5, quantity: -6, expiries: ["2026-10-16", "2026-11-20"] });
  });

  it("garde deux strikes distincts séparés, et sépare puts et calls", () => {
    const rows = [
      row({ kind: "short_put", strategy: "wheel", strike: 17.5, quantity: -4, contract: { expiry: "2026-10-16" } as never }),
      row({ id: "p3", kind: "short_put", strategy: "wheel", strike: 15, quantity: -1, contract: { expiry: "2026-10-16" } as never }),
      row({ id: "c1", kind: "short_call", strategy: "wheel", strike: 22, quantity: -3, contract: { expiry: "2026-10-16" } as never }),
    ];

    const levels = strategyLevels(rows, "BTDR", ALL);

    expect(find(levels, "shortPut").map((l) => (l as { price: number }).price)).toEqual([15, 17.5]);
    expect(find(levels, "shortCall")).toMatchObject([{ price: 22, quantity: -3 }]);
  });

  it("ne compte plus un put clos, même s'il reste ongoing après assignation", () => {
    const rows = [
      row({
        kind: "short_put",
        strategy: "wheel",
        strike: 17.5,
        quantity: -4,
        contract: { expiry: "2026-05-15" } as never,
        endWhen: "2026-05-15T20:00:00.000Z",
        event: "assigned",
        assigned: true,
        ongoing: true,
      }),
    ];

    expect(find(strategyLevels(rows, "BTDR", ALL), "shortPut")).toEqual([]);
  });

  it("rend les actions assignées au prix moyen d'assignation", () => {
    const rows = [
      row({ kind: "shares", strategy: "wheel", quantity: 400, openPrice: 17.5, assigned: true }),
      row({ id: "s2", kind: "shares", strategy: "wheel", quantity: 300, openPrice: 14, assigned: true }),
    ];

    const shares = find(strategyLevels(rows, "BTDR", ALL), "shares");

    expect(shares).toHaveLength(1);
    expect(shares[0]).toMatchObject({ quantity: 700 });
    expect((shares[0] as { price: number }).price).toBeCloseTo(16, 10);
  });

  it("ne retient que les lignes du ticker demandé et des stratégies demandées", () => {
    const rows = [
      row({ kind: "short_put", strategy: "wheel", strike: 17.5, quantity: -4, contract: { expiry: "2026-10-16" } as never }),
      row({ id: "o1", kind: "short_put", strategy: "others", strike: 9, quantity: -1, contract: { expiry: "2026-10-16" } as never }),
      row({ id: "x1", ticker: "AAPL", kind: "short_put", strategy: "wheel", strike: 200, quantity: -1, contract: { expiry: "2026-10-16" } as never }),
    ];

    const levels = strategyLevels(rows, "BTDR", ["wheel"]);

    expect(find(levels, "shortPut")).toMatchObject([{ price: 17.5 }]);
  });

  it("ignore une vente d'option sans strike ou sans échéance", () => {
    const rows = [
      row({ kind: "short_put", strategy: "wheel", strike: null, quantity: -4, contract: { expiry: "2026-10-16" } as never }),
      row({ id: "p9", kind: "short_put", strategy: "wheel", strike: 17.5, quantity: -4 }),
    ];

    expect(find(strategyLevels(rows, "BTDR", ALL), "shortPut")).toEqual([]);
  });
});
```

- [x] **Step 2: Lancer les tests pour les voir échouer**

Run: `cd packages/ledger && npx vitest run tests/levels.test.ts`
Expected: FAIL, `Failed to resolve import "../src/journals/levels.ts"`.

- [x] **Step 3: Écrire `levels.ts`**

```ts
/**
 * Les niveaux d'une stratégie sur un ticker, prêts à être dessinés sur un graphe de cours.
 *
 * Ce module ne rend ni couleur ni texte - `apps/web` s'en charge, comme pour `JournalRow.note`.
 * Une ligne est ouverte selon `endWhen === null`, jamais selon `ongoing` : un put assigné reste
 * `ongoing` tant que ses actions ne sont pas vendues alors qu'il n'est plus une vente en cours.
 */
import { wheelHoldings } from "./holdings.ts";
import type { JournalRow, Strategy } from "./types.ts";

export type ChartLevelKind = "shares" | "shortPut" | "shortCall" | "leapsBuy" | "condor";

/** Les actions Wheel détenues, à leur prix moyen d'assignation. */
export interface SharesLevel {
  kind: "shares";
  price: number;
  quantity: number;
}

/** Une vente d'options en cours : un strike, ses échéances, la quantité cumulée (négative). */
export interface OptionLevel {
  kind: "shortPut" | "shortCall";
  price: number;
  quantity: number;
  /** Jours `YYYY-MM-DD`, croissants, sans doublon. */
  expiries: string[];
}

/**
 * Un achat de call LEAPS. **Sans prix** : le journal connaît le prix payé pour l'option, pas le
 * cours du sous-jacent ce jour-là, qui se lit sur la barre du jour au moment du dessin.
 */
export interface LeapsBuyLevel {
  kind: "leapsBuy";
  /** Jour d'achat, `YYYY-MM-DD`. */
  when: string;
  quantity: number;
}

/** Un condor en cours : sa fenêtre de risque et ses deux paires de strikes, croissantes. */
export interface CondorLevel {
  kind: "condor";
  from: string;
  to: string;
  putStrikes: [number, number];
  callStrikes: [number, number];
  quantity: number;
}

export type ChartLevel = SharesLevel | OptionLevel | LeapsBuyLevel | CondorLevel;

const dayOf = (when: string) => when.slice(0, 10);

/** Une vente d'options par strike : deux échéances au même strike ne font qu'une ligne. */
function optionLevels(rows: readonly JournalRow[], kind: "short_put" | "short_call"): OptionLevel[] {
  const byStrike = new Map<number, OptionLevel>();
  for (const row of rows) {
    if (row.kind !== kind) continue;
    const expiry = row.contract.expiry;
    if (row.strike === null || expiry === null || row.quantity === null) continue;
    const level = byStrike.get(row.strike) ?? {
      kind: kind === "short_put" ? ("shortPut" as const) : ("shortCall" as const),
      price: row.strike,
      quantity: 0,
      expiries: [],
    };
    level.quantity += row.quantity;
    if (!level.expiries.includes(expiry)) level.expiries.push(expiry);
    byStrike.set(row.strike, level);
  }
  return [...byStrike.values()]
    .map((level) => ({ ...level, expiries: [...level.expiries].sort() }))
    .sort((a, b) => a.price - b.price);
}

export function strategyLevels(
  rows: readonly JournalRow[],
  ticker: string,
  strategies: readonly Strategy[],
): ChartLevel[] {
  const scoped = rows.filter(
    (row) => row.ticker === ticker && strategies.includes(row.strategy) && row.endWhen === null,
  );
  const levels: ChartLevel[] = [];

  if (strategies.includes("wheel")) {
    // wheelHoldings lit lui-même les lignes Wheel ouvertes : on lui passe le ledger entier.
    for (const holding of wheelHoldings(rows)) {
      if (holding.ticker !== ticker || holding.quantity === 0 || holding.averageAssignmentPrice === null) continue;
      levels.push({ kind: "shares", price: holding.averageAssignmentPrice, quantity: holding.quantity });
    }
  }

  levels.push(...optionLevels(scoped, "short_put"));
  levels.push(...optionLevels(scoped, "short_call"));
  return levels;
}
```

Puis ajouter l'export dans `packages/ledger/src/journals/index.ts` :

```ts
export * from "./levels.ts";
```

- [x] **Step 4: Lancer les tests pour les voir passer**

Run: `cd packages/ledger && npx vitest run tests/levels.test.ts`
Expected: PASS, 6 tests.

- [x] **Step 5: Commit**

```bash
git add packages/ledger/src/journals/levels.ts packages/ledger/src/journals/index.ts packages/ledger/tests/levels.test.ts docs/plans/2026-09-21-graphes-de-cours.md
git commit -m "feat(ledger): les niveaux d'actions assignées et d'options vendues"
```

---

## Task 2: Les niveaux LEAPS et Condors

**Files:**
- Modify: `packages/ledger/src/journals/levels.ts`
- Modify: `packages/ledger/tests/levels.test.ts`

**Interfaces:**
- Consumes: `strategyLevels`, `LeapsBuyLevel`, `CondorLevel` (tâche 1)
- Produces: `strategyLevels` rend désormais aussi les formes `leapsBuy` et `condor`

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter au `describe` de `packages/ledger/tests/levels.test.ts` :

```ts
  it("rend un achat de call LEAPS au jour de l'achat, sans prix", () => {
    const rows = [
      row({
        kind: "long_call",
        strategy: "leaps",
        strike: 12,
        quantity: 2,
        openPrice: 4.2,
        startWhen: "2026-03-17T15:02:00.000Z",
        contract: { expiry: "2027-01-15" } as never,
      }),
    ];

    expect(find(strategyLevels(rows, "BTDR", ALL), "leapsBuy")).toEqual([
      { kind: "leapsBuy", when: "2026-03-17", quantity: 2 },
    ]);
  });

  it("ne rend pas un call acheté hors LEAPS", () => {
    const rows = [
      row({ kind: "long_call", strategy: "others", strike: 12, quantity: 1, contract: { expiry: "2026-10-16" } as never }),
    ];

    expect(find(strategyLevels(rows, "BTDR", ALL), "leapsBuy")).toEqual([]);
  });

  it("rend un condor de son ouverture à son échéance, strikes croissants", () => {
    const legs = [
      row({ id: "lp", kind: "long_put", strategy: "condors", strike: 8, quantity: 1 }),
      row({ id: "sp", kind: "short_put", strategy: "condors", strike: 10, quantity: -1 }),
      row({ id: "sc", kind: "short_call", strategy: "condors", strike: 16, quantity: -1 }),
      row({ id: "lc", kind: "long_call", strategy: "condors", strike: 18, quantity: 1 }),
    ];
    const rows = [
      row({
        id: "ic",
        kind: "condor",
        strategy: "condors",
        quantity: -1,
        startWhen: "2026-04-02T13:45:00.000Z",
        contract: { expiry: "2026-06-19" } as never,
        legs,
      }),
      ...legs,
    ];

    expect(find(strategyLevels(rows, "BTDR", ALL), "condor")).toEqual([
      {
        kind: "condor",
        from: "2026-04-02",
        to: "2026-06-19",
        putStrikes: [8, 10],
        callStrikes: [16, 18],
        quantity: -1,
      },
    ]);
  });

  it("ignore un condor dont une jambe n'a pas de strike", () => {
    const legs = [
      row({ id: "lp", kind: "long_put", strategy: "condors", strike: null, quantity: 1 }),
      row({ id: "sp", kind: "short_put", strategy: "condors", strike: 10, quantity: -1 }),
      row({ id: "sc", kind: "short_call", strategy: "condors", strike: 16, quantity: -1 }),
      row({ id: "lc", kind: "long_call", strategy: "condors", strike: 18, quantity: 1 }),
    ];
    const rows = [
      row({ id: "ic", kind: "condor", strategy: "condors", quantity: -1, contract: { expiry: "2026-06-19" } as never, legs }),
    ];

    expect(find(strategyLevels(rows, "BTDR", ALL), "condor")).toEqual([]);
  });
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `cd packages/ledger && npx vitest run tests/levels.test.ts`
Expected: FAIL sur les quatre nouveaux tests (tableaux vides).

- [ ] **Step 3: Compléter `levels.ts`**

Ajouter les deux fonctions et leurs appels :

```ts
/** Les achats de calls LEAPS ouverts : un niveau par ligne, le prix viendra de la barre du jour. */
function leapsBuyLevels(rows: readonly JournalRow[]): LeapsBuyLevel[] {
  return rows
    .filter((row) => row.strategy === "leaps" && row.kind === "long_call" && row.quantity !== null)
    .map((row) => ({ kind: "leapsBuy" as const, when: dayOf(row.startWhen), quantity: row.quantity as number }))
    .sort((a, b) => a.when.localeCompare(b.when));
}

/**
 * Les condors en cours, de leur ouverture à leur échéance - la fenêtre de risque, pas la
 * fenêtre vécue. Les quatre jambes sont dans l'ordre garanti par `condor.ts` : long put,
 * short put, short call, long call, strikes croissants.
 */
function condorLevels(rows: readonly JournalRow[]): CondorLevel[] {
  const levels: CondorLevel[] = [];
  for (const row of rows) {
    if (row.kind !== "condor" || row.quantity === null) continue;
    const expiry = row.contract.expiry;
    const legs = row.legs;
    if (expiry === null || legs === undefined || legs.length !== 4) continue;
    const strikes = legs.map((leg) => leg.strike);
    if (strikes.some((strike) => strike === null)) continue;
    const [longPut, shortPut, shortCall, longCall] = strikes as number[];
    levels.push({
      kind: "condor",
      from: dayOf(row.startWhen),
      to: expiry,
      putStrikes: [longPut, shortPut],
      callStrikes: [shortCall, longCall],
      quantity: row.quantity,
    });
  }
  return levels;
}
```

Et dans `strategyLevels`, après les ventes d'options :

```ts
  levels.push(...leapsBuyLevels(scoped));
  levels.push(...condorLevels(scoped));
```

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `cd packages/ledger && npx vitest run tests/levels.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/ledger/src/journals/levels.ts packages/ledger/tests/levels.test.ts
git commit -m "feat(ledger): les niveaux des achats LEAPS et des condors"
```

---

## Task 3: Couleurs, étiquettes et prix LEAPS

**Files:**
- Create: `apps/web/src/lib/chartLevels.ts`
- Create: `apps/web/src/lib/chartLevels.test.ts`
- Modify: `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`

**Interfaces:**
- Consumes: `ChartLevel`, `ChartLevelKind` (`@ib/ledger`), `chartColors` (`apps/web/src/lib/chartColors.ts`), `PriceBar` (`apps/web/src/agent/client.ts`)
- Produces:
  ```ts
  export function levelColor(kind: ChartLevelKind, isDark: boolean): string
  export function levelPrice(level: ChartLevel, bars: readonly PriceBar[]): number | null
  export function formatLevelValue(value: number, locale: string): string
  export function levelLabel(level: ChartLevel, price: number, kindWord: string, locale: string): string
  ```

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `apps/web/src/lib/chartLevels.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { ChartLevel } from "@ib/ledger";
import { CHART_COLORS } from "@/lib/chartColors";
import { formatLevelValue, levelColor, levelLabel, levelPrice } from "@/lib/chartLevels";

const bar = (date: string, high: number, low: number) => ({ date, open: low, high, low, close: high, volume: 1 });

describe("chartLevels", () => {
  it("donne à chaque nature la teinte du ton de journal correspondant", () => {
    expect(levelColor("shares", false)).toBe(CHART_COLORS.light.series[0]);
    expect(levelColor("shortCall", false)).toBe(CHART_COLORS.light.series[1]);
    expect(levelColor("shortPut", false)).toBe(CHART_COLORS.light.series[2]);
    expect(levelColor("leapsBuy", false)).toBe(CHART_COLORS.light.series[3]);
    expect(levelColor("shortPut", true)).toBe(CHART_COLORS.dark.series[2]);
  });

  it("lit le prix d'un achat LEAPS au milieu haut-bas de la barre du jour", () => {
    const level: ChartLevel = { kind: "leapsBuy", when: "2026-03-17", quantity: 2 };

    expect(levelPrice(level, [bar("2026-03-16", 9, 7), bar("2026-03-17", 10, 8)])).toBe(9);
  });

  it("rend null quand le jour d'achat n'a pas de barre", () => {
    const level: ChartLevel = { kind: "leapsBuy", when: "2024-01-02", quantity: 2 };

    expect(levelPrice(level, [bar("2026-03-17", 10, 8)])).toBeNull();
  });

  it("rend le prix porté par le niveau pour les autres natures", () => {
    expect(levelPrice({ kind: "shortPut", price: 17.5, quantity: -6, expiries: [] }, [])).toBe(17.5);
    expect(levelPrice({ kind: "condor", from: "", to: "", putStrikes: [8, 10], callStrikes: [16, 18], quantity: -1 }, [])).toBeNull();
  });

  it("écrit les nombres court, sans zéros inutiles, dans la locale", () => {
    expect(formatLevelValue(22, "fr")).toBe("22");
    expect(formatLevelValue(17.5, "fr")).toBe("17,5");
    expect(formatLevelValue(17.5, "en")).toBe("17.5");
  });

  it("compose l'étiquette : le niveau, la nature, la quantité signée", () => {
    expect(levelLabel({ kind: "shortPut", price: 17.5, quantity: -6, expiries: [] }, 17.5, "Put", "fr")).toBe("17,5 Put: -6");
    expect(levelLabel({ kind: "shares", price: 14.8, quantity: 700 }, 14.8, "Long", "fr")).toBe("14,8 Long: 700");
    expect(levelLabel({ kind: "leapsBuy", when: "2026-03-17", quantity: 2 }, 9, "LEAPS", "fr")).toBe("9 LEAPS: 2");
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `cd apps/web && npx vitest run src/lib/chartLevels.test.ts`
Expected: FAIL, module introuvable.

- [ ] **Step 3: Écrire `chartLevels.ts`**

```ts
/**
 * Ce que `packages/ledger` ne dit pas d'un niveau : sa couleur et son étiquette.
 *
 * Les teintes sont celles de la palette des graphiques, que les tons du journal empruntent
 * déjà (`lib/journalTone.ts`) : le bleu des actions assignées, l'orange des calls vendus, le
 * vert des puts vendus, et l'ambre, libre, pour les achats LEAPS.
 */
import type { ChartLevel, ChartLevelKind } from "@ib/ledger";
import type { PriceBar } from "@/agent/client";
import { chartColors } from "@/lib/chartColors";

const SERIES_INDEX: Record<ChartLevelKind, number> = {
  shares: 0,
  shortCall: 1,
  shortPut: 2,
  leapsBuy: 3,
  condor: 0,
};

export function levelColor(kind: ChartLevelKind, isDark: boolean): string {
  return chartColors(isDark).series[SERIES_INDEX[kind]];
}

/**
 * Le prix d'une horizontale. Un achat LEAPS n'en porte pas : il se lit au milieu haut-bas de
 * la barre de son jour d'achat, et vaut `null` si ce jour n'a pas de barre. Un condor n'a pas
 * d'horizontale du tout : ses strikes sont les bords de ses rectangles.
 */
export function levelPrice(level: ChartLevel, bars: readonly PriceBar[]): number | null {
  if (level.kind === "condor") return null;
  if (level.kind !== "leapsBuy") return level.price;
  const bar = bars.find((candidate) => candidate.date === level.when);
  return bar ? (bar.high + bar.low) / 2 : null;
}

/** `22`, `17,5` : deux décimales au plus, aucun zéro inutile, la virgule de la locale. */
export function formatLevelValue(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

/** `17,5 Put: -6`. Le mot vient de l'i18n, jamais d'ici. */
export function levelLabel(level: ChartLevel, price: number, kindWord: string, locale: string): string {
  return `${formatLevelValue(price, locale)} ${kindWord}: ${formatLevelValue(level.quantity, locale)}`;
}
```

- [ ] **Step 4: Ajouter les mots dans les deux i18n**

Dans `apps/web/src/i18n/fr.json`, à la racine de l'objet, un bloc `charts` (ou le compléter s'il existe) :

```json
  "charts": {
    "levels": {
      "shares": "Long",
      "shortPut": "Put",
      "shortCall": "Call",
      "leapsBuy": "LEAPS"
    },
    "noAgent": "Ce graphe demande l'agent local",
    "noAgentLink": "Comment l'installer",
    "twsDown": "TWS ne répond pas sur le port {{port}}",
    "noBars": "Interactive Brokers ne rend aucun historique pour {{ticker}}",
    "loading": "Chargement du graphe…"
  },
```

Le même bloc dans `apps/web/src/i18n/en.json` :

```json
  "charts": {
    "levels": {
      "shares": "Long",
      "shortPut": "Put",
      "shortCall": "Call",
      "leapsBuy": "LEAPS"
    },
    "noAgent": "This chart needs the local agent",
    "noAgentLink": "How to install it",
    "twsDown": "TWS is not answering on port {{port}}",
    "noBars": "Interactive Brokers returns no history for {{ticker}}",
    "loading": "Loading the chart…"
  },
```

- [ ] **Step 5: Lancer les tests pour les voir passer**

Run: `cd apps/web && npx vitest run src/lib/chartLevels.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/chartLevels.ts apps/web/src/lib/chartLevels.test.ts apps/web/src/i18n/fr.json apps/web/src/i18n/en.json
git commit -m "feat(web): couleurs, étiquettes et prix des niveaux"
```

---

## Task 4: La primitive qui dessine les niveaux

**Files:**
- Create: `apps/web/src/lib/levelsPrimitive.ts`
- Create: `apps/web/src/lib/levelsPrimitive.test.ts`

**Interfaces:**
- Consumes: `ChartLevel` (`@ib/ledger`), `IChartApi`, `ISeriesApi`, `Time` (`lightweight-charts`)
- Produces:
  ```ts
  export interface DrawnLevel { level: ChartLevel; color: string; price: number | null; label: string | null }
  export function timeExtent(bars: readonly PriceBar[], levels: readonly ChartLevel[]): string[]
  export class LevelsPrimitive {
    constructor(drawn: readonly DrawnLevel[]);
    attached(param: { chart: IChartApi; series: ISeriesApi<"Candlestick">; requestUpdate: () => void }): void;
    detached(): void;
    updateAllViews(): void;
    paneViews(): unknown[];
    timeAxisViews(): unknown[];
  }
  ```

- [ ] **Step 1: Écrire le test qui échoue**

`timeExtent` est la seule partie calculable sans canevas : elle rend les jours vides à ajouter après la dernière barre pour que chaque date dessinée ait une coordonnée. Créer `apps/web/src/lib/levelsPrimitive.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { ChartLevel } from "@ib/ledger";
import { timeExtent } from "@/lib/levelsPrimitive";

const bar = (date: string) => ({ date, open: 1, high: 1, low: 1, close: 1, volume: 1 });

describe("timeExtent", () => {
  it("prolonge l'axe jusqu'à l'échéance la plus lointaine, jours ouvrés seulement", () => {
    const levels: ChartLevel[] = [
      { kind: "shortPut", price: 17.5, quantity: -4, expiries: ["2026-09-25"] },
      { kind: "shortCall", price: 22, quantity: -1, expiries: ["2026-09-23"] },
    ];

    const days = timeExtent([bar("2026-09-21"), bar("2026-09-22")], levels);

    expect(days).toEqual(["2026-09-23", "2026-09-24", "2026-09-25"]);
  });

  it("ne prolonge rien quand tout est déjà couvert par les barres", () => {
    const levels: ChartLevel[] = [{ kind: "shortPut", price: 17.5, quantity: -4, expiries: ["2026-09-21"] }];

    expect(timeExtent([bar("2026-09-21"), bar("2026-09-22")], levels)).toEqual([]);
  });

  it("compte l'échéance d'un condor comme une date à couvrir", () => {
    const levels: ChartLevel[] = [
      { kind: "condor", from: "2026-04-02", to: "2026-09-24", putStrikes: [8, 10], callStrikes: [16, 18], quantity: -1 },
    ];

    expect(timeExtent([bar("2026-09-22")], levels)).toEqual(["2026-09-23", "2026-09-24"]);
  });

  it("ne prolonge rien sans barre : il n'y a alors rien à dessiner", () => {
    const levels: ChartLevel[] = [{ kind: "shortPut", price: 17.5, quantity: -4, expiries: ["2026-12-18"] }];

    expect(timeExtent([], levels)).toEqual([]);
  });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run: `cd apps/web && npx vitest run src/lib/levelsPrimitive.test.ts`
Expected: FAIL, module introuvable.

- [ ] **Step 3: Écrire `levelsPrimitive.ts`**

```ts
/**
 * Le dessin des niveaux sur le graphe : horizontales, verticales, rectangles de condors et
 * étiquettes de gauche.
 *
 * Lightweight Charts v5 ne sait poser qu'une ligne de prix horizontale, dont l'étiquette va sur
 * l'échelle de droite. Tout le reste - une date, un rectangle, une étiquette à gauche - se
 * peint donc nous-mêmes, dans une primitive de série, à chaque redessin du panneau.
 */
import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";
import type { ChartLevel } from "@ib/ledger";
import type { PriceBar } from "@/agent/client";

export interface DrawnLevel {
  level: ChartLevel;
  color: string;
  /** `null` pour un condor, et pour un achat LEAPS dont le jour n'a pas de barre. */
  price: number | null;
  /** `null` quand le niveau n'en porte pas : les condors. */
  label: string | null;
}

const MS_PER_DAY = 86_400_000;

/** Les dates que le dessin réclame : les échéances, les jours d'achat, les fins de condors. */
function datesOf(level: ChartLevel): string[] {
  switch (level.kind) {
    case "shortPut":
    case "shortCall":
      return level.expiries;
    case "leapsBuy":
      return [level.when];
    case "condor":
      return [level.from, level.to];
    default:
      return [];
  }
}

/**
 * Les jours vides à ajouter après la dernière barre pour qu'une échéance future ait une
 * coordonnée : sans eux, `timeToCoordinate` rend `null` et la verticale n'est pas tracée. Les
 * week-ends sont sautés, comme les barres elles-mêmes. Sans barre, rien n'est prolongé : il
 * n'y a alors aucun graphe.
 */
export function timeExtent(bars: readonly PriceBar[], levels: readonly ChartLevel[]): string[] {
  if (bars.length === 0) return [];
  const last = bars[bars.length - 1].date;
  const furthest = levels.flatMap(datesOf).reduce((max, date) => (date > max ? date : max), last);
  if (furthest <= last) return [];
  const days: string[] = [];
  for (let time = Date.parse(`${last}T00:00:00Z`) + MS_PER_DAY; time <= Date.parse(`${furthest}T00:00:00Z`); time += MS_PER_DAY) {
    const day = new Date(time);
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    days.push(day.toISOString().slice(0, 10));
  }
  return days;
}

interface Scope {
  context: CanvasRenderingContext2D;
  bitmapSize: { width: number; height: number };
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
}

interface Placed {
  drawn: DrawnLevel;
  y: number | null;
  /** Coordonnées des dates du niveau, dans l'ordre de `datesOf`. */
  xs: (number | null)[];
  /** Pour un condor : les quatre ordonnées, long put, short put, short call, long call. */
  rect: (number | null)[];
}

const LABEL_PADDING = 4;
const LABEL_HEIGHT = 16;

class LevelsRenderer {
  private readonly placed: readonly Placed[];

  constructor(placed: readonly Placed[]) {
    this.placed = placed;
  }

  draw(target: { useBitmapCoordinateSpace: (cb: (scope: Scope) => void) => void }) {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      ctx.save();
      for (const item of this.placed) {
        const color = item.drawn.color;
        if (item.drawn.level.kind === "condor") {
          this.drawCondor(ctx, item, hr, vr);
          continue;
        }
        if (item.y !== null) {
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1, Math.floor(vr));
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(0, Math.round(item.y * vr) + 0.5);
          ctx.lineTo(scope.bitmapSize.width, Math.round(item.y * vr) + 0.5);
          ctx.stroke();
          if (item.drawn.label !== null) this.drawLabel(ctx, item.drawn.label, item.y * vr, color, hr, vr);
        }
        for (const x of item.xs) {
          if (x === null) continue;
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1, Math.floor(hr));
          ctx.setLineDash([6 * vr, 4 * vr]);
          ctx.beginPath();
          ctx.moveTo(Math.round(x * hr) + 0.5, 0);
          ctx.lineTo(Math.round(x * hr) + 0.5, scope.bitmapSize.height);
          ctx.stroke();
        }
      }
      ctx.restore();
    });
  }

  /** Deux rectangles translucides : les strikes de puts, ceux de calls, de l'ouverture à l'échéance. */
  private drawCondor(ctx: CanvasRenderingContext2D, item: Placed, hr: number, vr: number) {
    const [from, to] = item.xs;
    const [longPut, shortPut, shortCall, longCall] = item.rect;
    if (from === null || to === null) return;
    ctx.fillStyle = `${item.drawn.color}33`;
    for (const [top, bottom] of [
      [shortPut, longPut],
      [longCall, shortCall],
    ]) {
      if (top === null || bottom === null) continue;
      ctx.fillRect(from * hr, Math.min(top, bottom) * vr, (to - from) * hr, Math.abs(bottom - top) * vr);
    }
  }

  /** Le cadre de gauche, à la manière de l'étiquette de dernier cours. */
  private drawLabel(ctx: CanvasRenderingContext2D, text: string, y: number, color: string, hr: number, vr: number) {
    ctx.font = `${11 * vr}px ui-monospace, SFMono-Regular, monospace`;

    const width = ctx.measureText(text).width + 2 * LABEL_PADDING * hr;
    const height = LABEL_HEIGHT * vr;
    ctx.fillStyle = color;
    ctx.fillRect(0, y - height / 2, width, height);
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(text, LABEL_PADDING * hr, y);
  }
}

export class LevelsPrimitive {
  private readonly drawn: readonly DrawnLevel[];
  private chart: IChartApi | null = null;
  private series: ISeriesApi<"Candlestick"> | null = null;
  private placed: Placed[] = [];

  constructor(drawn: readonly DrawnLevel[]) {
    this.drawn = drawn;
  }

  attached(param: { chart: IChartApi; series: ISeriesApi<"Candlestick"> }) {
    this.chart = param.chart;
    this.series = param.series;
  }

  detached() {
    this.chart = null;
    this.series = null;
  }

  updateAllViews() {
    const chart = this.chart;
    const series = this.series;
    if (!chart || !series) {
      this.placed = [];
      return;
    }
    const x = (day: string) => chart.timeScale().timeToCoordinate(day as Time) as number | null;
    const y = (price: number | null) => (price === null ? null : (series.priceToCoordinate(price) as number | null));
    this.placed = this.drawn.map((drawn) => ({
      drawn,
      y: y(drawn.price),
      xs: datesOf(drawn.level).map(x),
      rect:
        drawn.level.kind === "condor"
          ? [drawn.level.putStrikes[0], drawn.level.putStrikes[1], drawn.level.callStrikes[0], drawn.level.callStrikes[1]].map(y)
          : [],
    }));
  }

  paneViews() {
    const placed = this.placed;
    return [{ renderer: () => new LevelsRenderer(placed), zOrder: () => "top" as const }];
  }

  /** Les dates des verticales, sous l'axe du temps, dans la couleur de leur ligne. */
  timeAxisViews() {
    return this.drawn.flatMap((drawn) =>
      datesOf(drawn.level)
        .filter(() => drawn.level.kind !== "condor")
        .map((day) => ({
          coordinate: () => (this.chart ? ((this.chart.timeScale().timeToCoordinate(day as Time) as number | null) ?? -100) : -100),
          text: () => day.slice(5),
          textColor: () => "#ffffff",
          backColor: () => drawn.color,
          visible: () => true,
          tickVisible: () => true,
        })),
    );
  }
}
```

- [ ] **Step 4: Lancer le test pour le voir passer**

Run: `cd apps/web && npx vitest run src/lib/levelsPrimitive.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/levelsPrimitive.ts apps/web/src/lib/levelsPrimitive.test.ts
git commit -m "feat(web): la primitive qui dessine niveaux, verticales et condors"
```

---

## Task 5: Le graphe porte les niveaux

**Files:**
- Modify: `apps/web/src/components/PriceChart.tsx`
- Create: `apps/web/src/components/PriceChart.test.tsx`

**Interfaces:**
- Consumes: `LevelsPrimitive`, `timeExtent`, `DrawnLevel` (tâche 4) ; `levelColor`, `levelLabel`, `levelPrice` (tâche 3)
- Produces:
  ```ts
  export interface PriceChartProps { bars: readonly PriceBar[]; levels: readonly ChartLevel[]; isDark: boolean; height?: number }
  export const CHART_HEIGHT = 650;
  export function drawnLevels(levels: readonly ChartLevel[], bars: readonly PriceBar[], isDark: boolean, word: (kind: ChartLevelKind) => string, locale: string): DrawnLevel[]
  ```

- [ ] **Step 1: Écrire le test qui échoue**

`drawnLevels` est la couture testable : elle assemble couleur, prix et étiquette. Créer `apps/web/src/components/PriceChart.test.tsx` :

```tsx
import { describe, expect, it } from "vitest";
import type { ChartLevel, ChartLevelKind } from "@ib/ledger";
import { CHART_COLORS } from "@/lib/chartColors";
import { drawnLevels } from "@/components/PriceChart";

const WORDS: Record<ChartLevelKind, string> = {
  shares: "Long",
  shortPut: "Put",
  shortCall: "Call",
  leapsBuy: "LEAPS",
  condor: "",
};
const word = (kind: ChartLevelKind) => WORDS[kind];
const bar = (date: string, high: number, low: number) => ({ date, open: low, high, low, close: high, volume: 1 });

describe("drawnLevels", () => {
  it("assemble couleur, prix et étiquette d'une vente de puts", () => {
    const levels: ChartLevel[] = [{ kind: "shortPut", price: 17.5, quantity: -6, expiries: ["2026-10-16"] }];

    expect(drawnLevels(levels, [], false, word, "fr")).toEqual([
      { level: levels[0], color: CHART_COLORS.light.series[2], price: 17.5, label: "17,5 Put: -6" },
    ]);
  });

  it("résout le prix d'un achat LEAPS sur la barre du jour", () => {
    const levels: ChartLevel[] = [{ kind: "leapsBuy", when: "2026-03-17", quantity: 2 }];

    expect(drawnLevels(levels, [bar("2026-03-17", 10, 8)], false, word, "fr")[0]).toMatchObject({ price: 9, label: "9 LEAPS: 2" });
  });

  it("laisse un condor sans prix ni étiquette", () => {
    const levels: ChartLevel[] = [
      { kind: "condor", from: "2026-04-02", to: "2026-06-19", putStrikes: [8, 10], callStrikes: [16, 18], quantity: -1 },
    ];

    expect(drawnLevels(levels, [], false, word, "fr")[0]).toMatchObject({ price: null, label: null });
  });

  it("laisse sans étiquette un achat LEAPS dont le jour n'a pas de barre", () => {
    const levels: ChartLevel[] = [{ kind: "leapsBuy", when: "2024-01-02", quantity: 2 }];

    expect(drawnLevels(levels, [bar("2026-03-17", 10, 8)], false, word, "fr")[0]).toMatchObject({ price: null, label: null });
  });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run: `cd apps/web && npx vitest run src/components/PriceChart.test.tsx`
Expected: FAIL, `drawnLevels` n'est pas exporté.

- [ ] **Step 3: Réécrire `PriceChart.tsx`**

Remplacer les props `level`/`eventDate` et la classe `VerticalLine` du prototype par les niveaux et la primitive. Le corps du composant :

```tsx
export function drawnLevels(
  levels: readonly ChartLevel[],
  bars: readonly PriceBar[],
  isDark: boolean,
  word: (kind: ChartLevelKind) => string,
  locale: string,
): DrawnLevel[] {
  return levels.map((level) => {
    const price = levelPrice(level, bars);
    return {
      level,
      color: levelColor(level.kind, isDark),
      price,
      label: price === null || level.kind === "condor" ? null : levelLabel(level, price, word(level.kind), locale),
    };
  });
}

export function PriceChart({ bars, levels, isDark, height = CHART_HEIGHT }: PriceChartProps) {
  const { t, i18n } = useTranslation();
  const holder = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    // … création du graphe, inchangée depuis le prototype …
  }, [height, isDark]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    const candles = bars.map((bar) => ({
      time: bar.date as Time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    }));
    // Les jours vides prolongent l'échelle du temps jusqu'à l'échéance la plus lointaine :
    // sans eux, une date future n'a pas de coordonnée et sa verticale n'est pas tracée.
    const empty = timeExtent(bars, levels).map((day) => ({ time: day as Time }));
    series.setData([...candles, ...empty]);
    const primitive = new LevelsPrimitive(
      drawnLevels(levels, bars, isDark, (kind) => t(`charts.levels.${kind}`), i18n.language),
    );
    series.attachPrimitive(primitive as never);
    chart.timeScale().fitContent();
    return () => {
      series.detachPrimitive(primitive as never);
    };
  }, [bars, levels, isDark, t, i18n.language]);

  return <div ref={holder} className="w-full" style={{ height }} data-testid="price-chart" />;
}
```

- [ ] **Step 4: Lancer le test pour le voir passer**

Run: `cd apps/web && npx vitest run src/components/PriceChart.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/PriceChart.tsx apps/web/src/components/PriceChart.test.tsx
git commit -m "feat(web): le graphe porte les niveaux et prolonge son axe"
```

---

## Task 6: La ligne du graphe, ses états et la fin du prototype

**Files:**
- Modify: `apps/web/src/components/PositionChartRow.tsx`
- Delete: `apps/web/src/lib/chartPrototype.ts`
- Create: `apps/web/src/components/PositionChartRow.test.tsx`

**Interfaces:**
- Consumes: `fetchBars` (`apps/web/src/agent/client.ts`), `useAccountJournals` (`apps/web/src/db/AccountDataProvider.tsx`), `strategyLevels` (`@ib/ledger`), `PriceChart` (tâche 5)
- Produces:
  ```ts
  export interface PositionChartRowProps { ticker: string; strategies: readonly Strategy[]; columnCount: number }
  export function PositionChartRow(props: PositionChartRowProps): JSX.Element
  ```

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `apps/web/src/components/PositionChartRow.test.tsx`. Lightweight Charts est bouchonné (jsdom n'a pas de canevas) ; `fetchBars` est joint par `vi.spyOn` sur le module de l'agent, qui est la frontière réseau, jamais un hook.

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import i18n from "@/i18n";
import { db } from "@/db/schema";
import * as agent from "@/agent/client";
import { PositionChartRow } from "@/components/PositionChartRow";
import { WithAccountData } from "@/test/WithAccountData";

vi.mock("lightweight-charts", () => {
  const series = {
    setData: vi.fn(),
    attachPrimitive: vi.fn(),
    detachPrimitive: vi.fn(),
    priceToCoordinate: vi.fn(() => 10),
  };
  return {
    CandlestickSeries: {},
    createChart: vi.fn(() => ({
      addSeries: vi.fn(() => series),
      timeScale: vi.fn(() => ({ fitContent: vi.fn(), timeToCoordinate: vi.fn(() => 10) })),
      remove: vi.fn(),
    })),
  };
});

function renderRow() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={["/accounts/alpha/positions"]}>
        <Routes>
          <Route
            path="/accounts/:accountId/positions"
            element={
              <WithAccountData>
                <table>
                  <tbody>
                    <PositionChartRow ticker="BTDR" strategies={["wheel"]} columnCount={12} />
                  </tbody>
                </table>
              </WithAccountData>
            }
          />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

const BARS = [{ date: "2026-09-21", open: 13, high: 14, low: 12, close: 13.5, volume: 1 }];

beforeEach(async () => {
  vi.restoreAllMocks();
  await db.accounts.update("alpha", { twsPort: undefined });
});

describe("PositionChartRow", () => {
  it("dit d'installer l'agent quand le compte n'a pas de port TWS", async () => {
    renderRow();

    expect(await screen.findByText("Ce graphe demande l'agent local")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Comment l'installer" })).toHaveAttribute("href", "/help");
  });

  it("dit que TWS ne répond pas quand l'agent rend 503", async () => {
    await db.accounts.update("alpha", { twsPort: 7501 });
    vi.spyOn(agent, "fetchBars").mockResolvedValue({ ok: false, code: "tws-unreachable" });

    renderRow();

    expect(await screen.findByText("TWS ne répond pas sur le port 7501")).toBeInTheDocument();
  });

  it("dit qu'IB ne rend aucun historique quand la réponse est vide", async () => {
    await db.accounts.update("alpha", { twsPort: 7501 });
    vi.spyOn(agent, "fetchBars").mockResolvedValue({
      ok: true,
      payload: { symbol: "BTDR", fetchedAt: "2026-09-21T20:00:00Z", bars: [] },
    });

    renderRow();

    expect(await screen.findByText("Interactive Brokers ne rend aucun historique pour BTDR")).toBeInTheDocument();
  });

  it("dessine le graphe quand les barres arrivent", async () => {
    await db.accounts.update("alpha", { twsPort: 7501 });
    vi.spyOn(agent, "fetchBars").mockResolvedValue({
      ok: true,
      payload: { symbol: "BTDR", fetchedAt: "2026-09-21T20:00:00Z", bars: BARS },
    });

    renderRow();

    expect(await screen.findByTestId("price-chart")).toBeInTheDocument();
    expect(screen.queryByText(/agent local/)).not.toBeInTheDocument();
  });

  it("occupe toute la largeur de la table", async () => {
    renderRow();

    const cell = (await screen.findByTestId("position-chart-row")).querySelector("td");
    expect(cell).toHaveAttribute("colspan", "12");
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `cd apps/web && npx vitest run src/components/PositionChartRow.test.tsx`
Expected: FAIL — le composant porte encore les props du prototype et la série inventée.

- [ ] **Step 3: Réécrire `PositionChartRow.tsx`**

```tsx
/**
 * La ligne injectée sous une position cliquée : le graphe du sous-jacent, avec les niveaux de
 * la stratégie de la page.
 *
 * L'agent local est optionnel (spec §2) : son absence n'est jamais une erreur, seulement un
 * message qui dit quoi installer. La ligne s'ouvre toujours, tout de suite : un clic fait
 * toujours quelque chose.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type { Strategy } from "@ib/ledger";
import { strategyLevels } from "@ib/ledger";
import { TableCell, TableRow } from "@ib/ui/table";
import { fetchBars, type PriceBar } from "@/agent/client";
import { PriceChart } from "@/components/PriceChart";
import { useAccountJournals } from "@/db/AccountDataProvider";
import { useAccount } from "@/db/hooks";
import { useTheme } from "@/hooks/useTheme";

export interface PositionChartRowProps {
  ticker: string;
  strategies: readonly Strategy[];
  columnCount: number;
}

type State =
  | { status: "loading" }
  | { status: "bars"; bars: PriceBar[] }
  | { status: "no-agent" }
  | { status: "tws-down"; port: number }
  | { status: "no-bars" };

export function PositionChartRow({ ticker, strategies, columnCount }: PositionChartRowProps) {
  const { t } = useTranslation();
  const { accountId = "" } = useParams<{ accountId: string }>();
  const account = useAccount(accountId);
  // `useAccountJournals` rend une union discriminée : `{ status: "loading" }` ou
  // `{ status: "ready", report, identityIssues }` (apps/web/src/db/hooks.ts).
  const journals = useAccountJournals();
  const { isDark } = useTheme();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (account === undefined) return;
    const port = account?.twsPort;
    if (port === undefined) {
      setState({ status: "no-agent" });
      return;
    }
    let cancelled = false;
    // Aucun cache : chaque ouverture interroge TWS, barre du jour comprise.
    void fetchBars(port, ticker).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setState(result.code === "tws-unreachable" ? { status: "tws-down", port } : { status: "no-agent" });
        return;
      }
      setState(result.payload.bars.length === 0 ? { status: "no-bars" } : { status: "bars", bars: result.payload.bars });
    });
    return () => {
      cancelled = true;
    };
  }, [account, ticker]);

  const levels = journals.status === "ready" ? strategyLevels(journals.report.rows, ticker, strategies) : [];

  return (
    <TableRow data-testid="position-chart-row" className="hover:bg-transparent">
      <TableCell colSpan={columnCount} className="bg-muted/30 p-4">
        {state.status === "bars" ? (
          <PriceChart bars={state.bars} levels={levels} isDark={isDark} />
        ) : (
          <div className="flex h-24 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            {state.status === "loading" && <span>{t("charts.loading")}</span>}
            {state.status === "no-agent" && (
              <>
                <span>{t("charts.noAgent")}</span>
                <Link to="/help" className="underline">
                  {t("charts.noAgentLink")}
                </Link>
              </>
            )}
            {state.status === "tws-down" && <span>{t("charts.twsDown", { port: state.port })}</span>}
            {state.status === "no-bars" && <span>{t("charts.noBars", { ticker })}</span>}
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
```

Puis supprimer le prototype :

```bash
git rm apps/web/src/lib/chartPrototype.ts
```

- [ ] **Step 4: Adapter l'appelant existant**

`apps/web/src/components/PositionGroupCard.tsx` passe encore `columnCount` seul. Lui donner le ticker et la portée :

```tsx
        {openKey === position.description && (
          <PositionChartRow ticker={position.symbol} strategies={ALL_STRATEGIES} columnCount={POSITION_COLUMNS.length} />
        )}
```

avec, en tête de fichier :

```tsx
const ALL_STRATEGIES = ["wheel", "leaps", "condors", "others"] as const;
```

- [ ] **Step 5: Lancer les tests pour les voir passer**

Run: `cd apps/web && npx vitest run src/components/PositionChartRow.test.tsx src/pages/PositionsChart.test.tsx`
Expected: PASS — 5 tests neufs, et les 4 du prototype toujours verts, sauf celui qui attendait « Données de démonstration », à supprimer de `PositionsChart.test.tsx` dans ce même commit.

- [ ] **Step 6: Commit**

```bash
git add -A apps/web/src
git commit -m "feat(web): la ligne du graphe, ses trois états sans données"
```

---

## Task 7: Le graphe dans les quatre tableaux

**Files:**
- Create: `apps/web/src/hooks/useOpenChart.ts`
- Modify: `apps/web/src/components/PositionGroupCard.tsx`, `apps/web/src/pages/PositionsPage.tsx`
- Modify: `apps/web/src/pages/StrategyPositionsPage.tsx`
- Modify: `apps/web/src/components/PositionSuggestionsCard.tsx`
- Modify: `apps/web/src/pages/PositionsChart.test.tsx`
- Create: `apps/web/src/pages/StrategyPositionsChart.test.tsx`

**Interfaces:**
- Consumes: `PositionChartRow` (tâche 6)
- Produces:
  ```ts
  export interface OpenChart { openKey: string | null; toggle: (key: string) => void; isOpen: (key: string) => boolean }
  export function useOpenChart(): OpenChart
  ```

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `apps/web/src/pages/StrategyPositionsChart.test.tsx`, sur le même patron que `PositionsChart.test.tsx` (bouchon de `lightweight-charts`, ledger semé, rendu de `StrategyPositionsPage strategy="wheel"`), avec :

```tsx
  it("ouvre le graphe sous une vente d'options de la stratégie", async () => {
    const user = userEvent.setup();
    renderStrategy("wheel");
    const row = await rowFor("XOM Mar20'26 100 Put");

    await user.click(row);

    expect(row.nextElementSibling).toBe(await screen.findByTestId("position-chart-row"));
  });

  it("ouvre le graphe sous une ligne d'actions assignées, sur onze colonnes", async () => {
    const user = userEvent.setup();
    renderStrategy("wheel");
    const row = await rowFor("AAPL");

    await user.click(row);

    const cell = (await screen.findByTestId("position-chart-row")).querySelector("td");
    expect(cell).toHaveAttribute("colspan", "11");
  });

  it("ferme le graphe d'un encart quand on clique une ligne d'un autre", async () => {
    const user = userEvent.setup();
    renderStrategy("wheel");

    await user.click(await rowFor("AAPL"));
    await screen.findByTestId("position-chart-row");
    await user.click(await rowFor("XOM Mar20'26 100 Put"));

    expect(screen.getAllByTestId("position-chart-row")).toHaveLength(1);
  });
```

Et dans `apps/web/src/components/PositionSuggestionsCard.test.tsx` (à créer si absent) :

```tsx
  it("ouvre le graphe du ticker suggéré sous sa ligne, sur six colonnes", async () => {
    const user = userEvent.setup();
    renderSuggestions();
    const row = (await screen.findByText("BTDR")).closest("tr") as HTMLTableRowElement;

    await user.click(row);

    const cell = (await screen.findByTestId("position-chart-row")).querySelector("td");
    expect(cell).toHaveAttribute("colspan", "6");
  });
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `cd apps/web && npx vitest run src/pages/StrategyPositionsChart.test.tsx src/components/PositionSuggestionsCard.test.tsx`
Expected: FAIL — aucune ligne de graphe n'apparaît.

- [ ] **Step 3: Écrire `useOpenChart`**

```ts
/**
 * Une seule ligne de graphe ouverte par page, quel que soit l'encart : ouvrir ailleurs ferme
 * la précédente. La clé est celle de la ligne, préfixée de l'identifiant de son encart - deux
 * encarts peuvent porter le même contrat.
 */
import { useCallback, useState } from "react";

export interface OpenChart {
  openKey: string | null;
  toggle: (key: string) => void;
  isOpen: (key: string) => boolean;
}

export function useOpenChart(): OpenChart {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const toggle = useCallback((key: string) => setOpenKey((current) => (current === key ? null : key)), []);
  const isOpen = useCallback((key: string) => openKey === key, [openKey]);
  return { openKey, toggle, isOpen };
}
```

`PositionsPage.tsx` remplace son `useState` local par `useOpenChart()` et passe `chart={chart}` à chaque `PositionGroupCard` ; `PositionGroupCard` prend `chart: OpenChart` et `boxId: string` au lieu de `openKey`/`onToggle`, et compose sa clé `` `${boxId}|${position.description}` ``.

- [ ] **Step 4: Brancher les deux encarts des pages de stratégie**

Dans `apps/web/src/pages/StrategyPositionsPage.tsx`, la page appelle `useOpenChart()` une fois et le passe à `LinesBox` et `SharesBox`. Dans `LinesBox`, le `renderRow` devient :

```tsx
        renderRow={(line) => {
          const key = `${boxId}|${contractId(line.contract)}`;
          return (
            <Fragment>
              <PositionRow onClick={() => chart.toggle(key)} expanded={chart.isOpen(key)} values={{ /* inchangé */ }} />
              {chart.isOpen(key) && (
                <PositionChartRow ticker={line.contract.ticker} strategies={[strategy]} columnCount={POSITION_COLUMNS.length} />
              )}
            </Fragment>
          );
        }}
```

Dans `SharesBox`, la même chose avec `line.ticker`, `strategies={["wheel"]}` et `WHEEL_SHARE_COLUMNS.length`, en passant `onClick` et `expanded` à `WheelShareRow`, qui les accepte comme `PositionRow` (mêmes deux props, même `data-state`).

- [ ] **Step 5: Brancher la carte Suggestion de position**

`apps/web/src/components/PositionSuggestionsCard.tsx` a sa table à lui : l'injection y est écrite à la main, dans le `map` des lignes.

```tsx
      {suggestions.map((suggestion) => {
        const key = `suggestions|${suggestion.ticker}`;
        return (
          <Fragment key={suggestion.ticker}>
            <TableRow onClick={() => chart.toggle(key)} data-state={chart.isOpen(key) ? "selected" : undefined} className="cursor-pointer">
              {/* cellules inchangées */}
            </TableRow>
            {chart.isOpen(key) && (
              <PositionChartRow ticker={suggestion.ticker} strategies={ALL_STRATEGIES} columnCount={COLUMNS.length} />
            )}
          </Fragment>
        );
      })}
```

avec `const chart = useOpenChart();` dans le composant.

- [ ] **Step 6: Lancer les tests pour les voir passer**

Run: `cd apps/web && npx vitest run src/pages/PositionsChart.test.tsx src/pages/StrategyPositionsChart.test.tsx src/components/PositionSuggestionsCard.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A apps/web/src
git commit -m "feat(web): le graphe s'ouvre dans les quatre tableaux"
```

---

## Task 8: Vérification et mise à jour de la mémoire du dépôt

**Files:**
- Modify: `CLAUDE.md` (tableau des sous-projets, et une règle si besoin)
- Modify: `docs/points-reportes.md` (ce qui est reporté)

**Interfaces:**
- Consumes: tout ce qui précède
- Produces: une branche prête à être relue

- [ ] **Step 1: Vérification visuelle**

Lancer le driver sur la page Positions et sur Positions Wheel, en clair et en sombre, puis **ouvrir chaque PNG avec l'outil Read** — une capture blanche ne se voit pas autrement. Le clic sur une ligne demande un script Playwright court, le driver ne cliquant pas : reprendre celui du prototype (`/tmp/claude-1001/.../scratchpad/click-chart.mjs`), copié à la racine du worktree le temps du run.

Attendu : la ligne s'ouvre sous celle cliquée, les horizontales portent leur étiquette à gauche, les verticales leur date sous l'axe, le logo TradingView est visible.

- [ ] **Step 2: `pnpm check`**

Run: `pnpm check`
Expected: lint, typage, build et tous les tests verts.

- [ ] **Step 3: Les tests de l'agent**

Run: `pnpm test:agent`
Expected: PASS — `/bars` n'a pas bougé, c'est une non-régression.

- [ ] **Step 4: Mettre à jour `CLAUDE.md`**

Ajouter la ligne du sous-projet au tableau :

```markdown
| 27 | Les graphes de cours dans les tableaux de positions | fait (2026-09-__) |
```

Et une règle dans « Règles qui mordent si on les oublie » :

```markdown
- **Les graphes de cours viennent de TWS par l'agent, jamais d'un fournisseur tiers ni du
  serveur** : `/bars` (`apps/tws-agent`), deux ans de journalier `TRADES`, sans cache. Les
  niveaux dessinés sont une vue calculée des journaux (`strategyLevels`,
  `packages/ledger/src/journals/levels.ts`), sans couleur ni texte : `apps/web/src/lib/chartLevels.ts`
  donne la teinte de la palette et l'étiquette traduite. Une page de stratégie ne dessine que
  la sienne ; Positions et Suggestion de position dessinent les quatre. Les barres `TRADES`
  d'IB sont ajustées des splits et les options n'ont pas d'historique de fin de journée : les
  graphes ne montrent que des sous-jacents, splits non traités (spec §3).
```

- [ ] **Step 5: Noter ce qui est reporté**

Dans `docs/points-reportes.md`, sous un titre `## Sous-projet 27`, ce qui a été vu et laissé : l'ajustement des splits, le cache de barres, et tout ce que la relecture aura soulevé sans le corriger.

- [ ] **Step 6: Commit et instance de dev**

```bash
git add CLAUDE.md docs/points-reportes.md
git commit -m "docs: le sous-projet 27 et sa règle"
pnpm dev:start
```

Donner les deux URL à Seb : il regarde la branche avant de décider du merge.

---

## Notes d'exécution

- **Ordre imposé** : 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Les tâches 1 et 2 touchent le même fichier, 3 à 5 s'enchaînent sur le dessin, 6 dépend de 5, 7 dépend de 6.
- **Chaque tâche coche ses cases dans ce fichier, dans le même commit que son code.**
- Un doute sur une donnée qui n'existe pas dans le ledger est un **signal d'arrêt** : demander, ne pas inventer un champ.
