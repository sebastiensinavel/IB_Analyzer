# Sous-projet 2 — Couverture et positions au palier 2 : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les pages Positions et Dashboard fonctionnent sans serveur ni agent : un import Flex avec Open Positions et Cash Report suffit à voir chaque position, sa couverture, la décision de rachat, le cash requis contre le cash disponible et les positions non couvertes.

**Architecture:** `packages/coverage` (TS pur) est le port ligne à ligne du moteur Python `ib_analysis`, vérifié par des fixtures d'oracle générées par ce même Python gelé dans `tools/coverage-oracle`. `packages/ib-parsers` lit Open Positions et Cash Report du Flex XML et rend un `FlexSnapshot`. `apps/web` cache le snapshot en IndexedDB (un document par compte), la table sectorielle dans une table unique, calcule le `RiskReport` dans le navigateur et reprend les pages de la première version.

**Tech Stack:** Node 22 (type stripping natif), pnpm, TypeScript 6, Vitest 4, React 19, react-router 8, Dexie 4, dexie-react-hooks, fake-indexeddb, echarts 6 + echarts-for-react 3, uv + Python 3.14 (oracle seulement), Playwright (skill `run-frontend`).

**Spec:** `docs/specs/2026-09-03-couverture-positions-design.md` (lire aussi `docs/specs/2026-09-03-architecture-design.md` §6.4, §6.7, §6.8 et `CLAUDE.md`).

## Global Constraints

- `private/` n'est jamais versionné ; aucun identifiant de compte, jeton ou montant réel dans un fichier committé. La fixture Flex régénérée est **contrôlée à la main** avant commit (tâche 6).
- Une valeur absente reste `null`, jamais `0`, et s'affiche « — ».
- `BUYBACK_RATIO = 2`, `MAX_STRUCTURE_LOSS = 1000`, `DEFAULT_MULTIPLIER = 100`, les libellés `KIND_LABELS`, les sources de couverture et les sortes de structures sont définis **une seule fois** dans `packages/coverage/src/constants.ts`. Un test de `apps/web` le vérifie (tâche 12).
- Le port TS est vérifié par l'oracle : **un écart entre `buildRiskReport` et une fixture d'oracle est un bug du port**, jamais de l'oracle. Trois écarts sont voulus et testés à part (spec §3.3) : `avgPrice` par unité, `null` en entrée, `cashAvailable: null`.
- `Position.avgPrice` est par unité ; `Position.expiry` est `YYYY-MM-DD` ; `Position.symbol` est le sous-jacent pour une option.
- Le snapshot est un document par compte, remplacé quand `asOf` du fichier est supérieur ou égal à celui en base.
- Comptes jamais combinés : toute clé IndexedDB et toute route est scopée par `accountId`. La table `sectors` est la seule exception voulue : une table pour l'utilisateur.
- shadcn est **base-ui** : `render={<X />}` au lieu de `asChild`. Un lien stylé en bouton est un `<Link className={buttonVariants(...)}>`.
- Code et commentaires en anglais ; documentation, i18n et messages de commit en français. Les libellés produits par le moteur (`label`, `detail`, `issues`) restent l'anglais du Python.
- Un test doit échouer si le comportement change, pas seulement couvrir des lignes. `apps/web` teste sur `fake-indexeddb` avec un snapshot semé en base, jamais en moquant les hooks.
- Versions : TypeScript `~6.0.3`, Vitest `^4.1.11`, React `^19.2.8`, Dexie `^4.4.5`, `echarts ^6.1.0`, `echarts-for-react ^3.0.6`, `jsdom ^30.0.1`, `@types/node ^22.0.0`, pytest `>=8`.
- Chaque commit se termine par les deux lignes :
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LJLvsD7TGEDB8mTSTxfmwy
  ```
- Le travail se fait dans un worktree `.claude/worktrees/couverture-positions` (skill `superpowers:using-git-worktrees`), branche `couverture-positions`, mergé sur `main` après revue.

---

## Structure des fichiers

```
package.json                              script "oracle"
packages/ledger/src/types.ts              + interface Position

packages/coverage/
  package.json                            "@ib/coverage", dépend de @ib/ledger
  tsconfig.json, vitest.config.ts         copiés de ledger (environment node)
  src/index.ts                            ré-exports
  src/constants.ts                        BUYBACK_RATIO, MAX_STRUCTURE_LOSS, DEFAULT_MULTIPLIER, kinds, labels, sources, structures, DETAIL_GROUPS
  src/types.ts                            CoverageAllocation, AnalyzedPosition, Structure, RiskReport
  src/format.ts                           fmtNum (:g), fmtFixed2 (:.2f), fmtMoney (:,.2f)
  src/classify.ts                         classify, contractMultiplier, describeContract, evaluateBuyback, analyze
  src/coverage.ts                         normalizeExpiry, fmtExpiry, computeCoverage (trois passes)
  src/report.ts                           buildRiskReport et les fonctions pures du rapport, groupedPositions
  src/fixtures.ts                         option(), stock() : fabriques de Position pour les tests
  src/*.test.ts                           format, classify, analyze, coverage, report, deviations, oracle
  scripts/extract-corpus.mjs              fixture Flex anonymisée -> tools/coverage-oracle/corpus/flex-sample.json
  tests/oracle/*.json                     { input, expected } générés par l'oracle, committés

tools/coverage-oracle/
  pyproject.toml, .python-version, uv.lock
  README.md
  engine/ib_analysis/__init__.py          copie verbatim du moteur de la première version
  engine/tests/{conftest,test_*}.py       copie verbatim des 115 tests
  generate.py                             corpus/*.json -> packages/coverage/tests/oracle/*.json
  corpus/*.json                           portefeuilles synthétiques + flex-sample.json

packages/ib-parsers/
  src/flex.ts                             + FlexSnapshot, parseOpenPositions, parseCashReport, checkSections étendu
  src/flex.test.ts, src/flex.fixture.test.ts
  scripts/anonymize-flex.mjs              + attributs monétaires de Cash Report
  tests/fixtures/flex_activity_sample.xml régénérée

apps/web/
  package.json                            + echarts, echarts-for-react
  src/db/schema.ts                        version 2 : snapshots, sectors ; ImportRecord.positions/cashAvailable
  src/db/hooks.ts                         + useSnapshot, useSectors, useRiskReport
  src/db/accounts.ts                      deleteAccount efface aussi le snapshot
  src/db/importFile.ts                    écrit le snapshot dans la même transaction
  src/db/sectors.ts                       parseSectorCsv, importSectorCsv
  src/lib/format.ts                       formatMoney/formatPrice acceptent null -> "—"
  src/lib/riskReport.ts                   decisionBadge, coverageBadges, groupTitleKey
  src/pages/PositionsPage.tsx             reprise de la première version
  src/pages/DashboardPage.tsx             reprise de la première version
  src/pages/SourcesPage.tsx               + carte Table sectorielle
  src/components/ImportReportCard.tsx     + positions, cash, snapshot ignoré
  src/mocks/positions.ts                  SAMPLE_POSITIONS, SAMPLE_SNAPSHOT, SAMPLE_SECTORS
  src/mocks/seed.ts                       sème aussi snapshot et secteurs
  src/i18n/{en,fr}.json                   clés positions, dashboard, sources.sectors, sources.report
  src/routes/router.tsx                   dashboard et positions branchées
  src/lib/businessConstants.test.ts       aucune constante métier hors de coverage

.claude/skills/run-frontend/driver.mjs    + --import=, --sectors=, --ib-account=
.claude/skills/run-frontend/SKILL.md
CLAUDE.md, docs/specs/2026-09-03-architecture-design.md, docs/points-reportes.md
```

---

## Tâche 1 : worktree, type `Position`, squelette de `packages/coverage`, constantes et formatage

**Files:**
- Create: `packages/coverage/package.json`, `packages/coverage/tsconfig.json`, `packages/coverage/vitest.config.ts`, `packages/coverage/src/index.ts`, `packages/coverage/src/constants.ts`, `packages/coverage/src/types.ts`, `packages/coverage/src/format.ts`
- Modify: `packages/ledger/src/types.ts`
- Test: `packages/coverage/src/format.test.ts`, `packages/coverage/src/constants.test.ts`

**Interfaces:**
- Produces: `Position` (`@ib/ledger`) ; `BUYBACK_RATIO`, `MAX_STRUCTURE_LOSS`, `DEFAULT_MULTIPLIER`, `POSITION_KINDS`, `PositionKind`, `KIND_LABELS`, `EVALUATE_KINDS`, `CoverSource`, `COVER_CASH|STOCK|LEAPS|SPREAD|NONE`, `StructureKind`, `STRUCT_IRON_CONDOR|CALL_SPREAD|PUT_SPREAD`, `DETAIL_GROUPS`, `DetailGroupId` ; `CoverageAllocation`, `AnalyzedPosition`, `Structure`, `RiskReport` ; `fmtNum(value: number | null): string`, `fmtFixed2(value: number): string`, `fmtMoney(value: number): string`.

- [x] **Étape 1 : worktree**

Invoquer `superpowers:using-git-worktrees` : worktree `.claude/worktrees/couverture-positions`, branche `couverture-positions` depuis `main`. Puis `pnpm install` dans le worktree.

- [x] **Étape 2 : type `Position` dans `ledger`**

Ajouter à la fin de `packages/ledger/src/types.ts` :

```ts
/**
 * One holding of one account at a point in time, whatever the source
 * (Flex Open Positions today, the local agent later). Money fields are
 * `null` when the source did not provide them: unknown is never zero.
 */
export interface Position {
  /** Underlying for an option, the security's own symbol otherwise. */
  symbol: string;
  /** "STK", "OPT", "FOP", "WAR"… as the source reports it. */
  secType: string;
  right: "C" | "P" | "";
  strike: number | null;
  /** YYYY-MM-DD */
  expiry: string | null;
  multiplier: number | null;
  /** Signed: a short position is negative. */
  quantity: number;
  /** Per unit: per share, or per unit of underlying for an option. Never per contract. */
  avgPrice: number | null;
  marketPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  currency: string;
  /** IB contract id; "" when the source does not give one. */
  conid: string;
  description: string;
}
```

- [x] **Étape 3 : squelette du paquet**

`packages/coverage/package.json` :

```json
{
  "name": "@ib/coverage",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@ib/ledger": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "~6.0.3",
    "vitest": "^4.1.11"
  }
}
```

`packages/coverage/tsconfig.json` et `vitest.config.ts` : copies de ceux de `packages/ledger` (`"types": []`, `include: ["src"]`, `environment: "node"`).

`packages/coverage/src/index.ts` :

```ts
export * from "./constants.ts";
export * from "./types.ts";
export * from "./format.ts";
```

(Les lignes `classify`, `coverage`, `report` s'ajoutent aux tâches 2 et 3.)

- [x] **Étape 4 : constantes et types**

`packages/coverage/src/constants.ts` :

```ts
// The one place where the business constants of the coverage engine live.
// Nothing outside this package may redefine them (apps/web has a test for it).

/** A short option is bought back when current <= sale / BUYBACK_RATIO. */
export const BUYBACK_RATIO = 2;

/** Options multiplier when the contract does not report one. */
export const DEFAULT_MULTIPLIER = 100;

/** A defined-risk structure must not be able to lose more than this, in USD. */
export const MAX_STRUCTURE_LOSS = 1000;

export const POSITION_KINDS = [
  "short_call",
  "short_put",
  "long_call",
  "long_put",
  "long_stock",
  "short_stock",
  "other",
] as const;
export type PositionKind = (typeof POSITION_KINDS)[number];

/** Human-readable labels, shown as is (English, as the Python engine produced them). */
export const KIND_LABELS: Record<PositionKind, string> = {
  short_call: "sell of call",
  short_put: "sell of put",
  long_call: "buy of call",
  long_put: "buy of put",
  long_stock: "long position",
  short_stock: "short position",
  other: "other",
};

/** Kinds that get a buy-back decision. Everything else is ignored. */
export const EVALUATE_KINDS: ReadonlySet<PositionKind> = new Set<PositionKind>(["short_call", "short_put"]);

export const COVER_SOURCES = ["cash", "stock", "leaps", "spread", "UNCOVERED"] as const;
export type CoverSource = (typeof COVER_SOURCES)[number];
export const COVER_CASH: CoverSource = "cash"; // short put fully secured by USD cash
export const COVER_STOCK: CoverSource = "stock"; // short call covered by long shares
export const COVER_LEAPS: CoverSource = "leaps"; // short call covered by a longer-dated long call
export const COVER_SPREAD: CoverSource = "spread"; // leg of a same-expiry defined-risk structure
export const COVER_NONE: CoverSource = "UNCOVERED"; // nothing behind the leg

export const STRUCTURE_KINDS = ["iron condor", "call spread", "put spread"] as const;
export type StructureKind = (typeof STRUCTURE_KINDS)[number];
export const STRUCT_IRON_CONDOR: StructureKind = "iron condor";
export const STRUCT_CALL_SPREAD: StructureKind = "call spread";
export const STRUCT_PUT_SPREAD: StructureKind = "put spread";

export type DetailGroupId = "long" | "optionBuys" | "optionSells" | "other";

export interface DetailGroup {
  id: DetailGroupId;
  /** English title, as the Python engine named the group. */
  title: string;
  /** `null` catches every kind the other groups do not. */
  kinds: ReadonlySet<PositionKind> | null;
}

/** Sub-sections of the position table, in display order. */
export const DETAIL_GROUPS: readonly DetailGroup[] = [
  { id: "long", title: "Long positions", kinds: new Set<PositionKind>(["long_stock"]) },
  { id: "optionBuys", title: "Option buys", kinds: new Set<PositionKind>(["long_call", "long_put"]) },
  { id: "optionSells", title: "Option sells", kinds: new Set<PositionKind>(["short_call", "short_put"]) },
  { id: "other", title: "Other positions", kinds: null },
];
```

`packages/coverage/src/types.ts` :

```ts
import type { CoverSource, PositionKind, StructureKind } from "./constants.ts";

/** One slice of coverage attributed to a short option leg. */
export interface CoverageAllocation {
  source: CoverSource;
  /** Number of short contracts covered by this slice. */
  quantity: number;
  /** Human-readable origin of the coverage. */
  detail: string;
}

export interface AnalyzedPosition {
  description: string;
  kind: PositionKind;
  label: string;
  marketValue: number | null;
  /** Signed. */
  quantity: number;
  /** Per unit. */
  avgPrice: number | null;
  lastPrice: number | null;
  unrealizedPnl: number | null;
  action: "to evaluate" | "ignore";
  decision: "buy back" | "keep" | null;
  symbol: string;
  secType: string;
  /** "C", "P" or "". */
  right: string;
  /** 0 when the contract has none. */
  strike: number;
  /** YYYY-MM-DD, "" when the contract has none. */
  expiry: string;
  multiplier: number;
  // Filled in by the coverage engine.
  allocations: CoverageAllocation[];
  uncoveredQuantity: number;
  usedQuantity: number;
  requiredCash: number;
  riskNotes: string[];
}

/** A same-expiry defined-risk structure with a capped maximum loss. */
export interface Structure {
  symbol: string;
  /** YYYY-MM-DD */
  expiry: string;
  kind: StructureKind;
  /** Number of short contracts inside the structure. */
  contracts: number;
  callRisk: number;
  putRisk: number;
  /** Net premium collected when the structure was opened. */
  credit: number;
}

export interface RiskReport {
  /** USD; `null` when the source gave no cash figure. */
  cashAvailable: number | null;
  positions: AnalyzedPosition[];
  structures: Structure[];
}
```

- [x] **Étape 5 : tests de formatage (échec attendu)**

`packages/coverage/src/format.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { fmtFixed2, fmtMoney, fmtNum } from "./format.ts";

// These three reproduce Python's f"{x:g}", f"{x:.2f}" and f"{x:,.2f}": the
// strings they build end up in the RiskReport and are compared to the
// oracle character for character.
describe("fmtNum (Python :g)", () => {
  it.each([
    [150, "150"],
    [452.5, "452.5"],
    [2.5, "2.5"],
    [0.5, "0.5"],
    [100, "100"],
    [12.345678, "12.3457"],
    [1234567, "1234567"],
    [1234567.5, "1.23457e+06"],
    [0.00001234, "1.234e-05"],
    [-7.25, "-7.25"],
  ])("formats %s as %s", (value, expected) => {
    expect(fmtNum(value)).toBe(expected);
  });

  it("formats null as an empty string, like _fmt_num(None)", () => {
    expect(fmtNum(null)).toBe("");
  });
});

describe("fmtFixed2 (Python :.2f)", () => {
  it.each([
    [140, "140.00"],
    [165.5, "165.50"],
    [1.005, "1.00"],
    [2.675, "2.67"],
    [0.145, "0.14"],
    [-3.5, "-3.50"],
    [-0.001, "-0.00"],
  ])("rounds %s to %s like Python", (value, expected) => {
    expect(fmtFixed2(value)).toBe(expected);
  });

  it.each([
    [0.125, "0.12"],
    [0.375, "0.38"],
    [0.625, "0.62"],
    [0.875, "0.88"],
    [1234.125, "1234.12"],
    [-0.625, "-0.62"],
  ])("rounds the exact tie %s to even (%s), where toFixed would round up", (value, expected) => {
    expect(fmtFixed2(value)).toBe(expected);
    expect(fmtFixed2(value)).not.toBe(value.toFixed(2));
  });
});

describe("fmtMoney (Python :,.2f)", () => {
  it.each([
    [0, "0.00"],
    [999.5, "999.50"],
    [1000, "1,000.00"],
    [20000, "20,000.00"],
    [1234567.891, "1,234,567.89"],
    [-1234.5, "-1,234.50"],
  ])("formats %s as %s", (value, expected) => {
    expect(fmtMoney(value)).toBe(expected);
  });
});
```

`packages/coverage/src/constants.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { DETAIL_GROUPS, EVALUATE_KINDS, KIND_LABELS, POSITION_KINDS } from "./constants.ts";

describe("constants", () => {
  it("gives every kind a label", () => {
    for (const kind of POSITION_KINDS) expect(KIND_LABELS[kind]).toBeTruthy();
  });

  it("evaluates short options and nothing else", () => {
    expect([...EVALUATE_KINDS].sort()).toEqual(["short_call", "short_put"]);
  });

  it("has exactly one catch-all group, last", () => {
    const catchAll = DETAIL_GROUPS.filter((g) => g.kinds === null);
    expect(catchAll).toHaveLength(1);
    expect(DETAIL_GROUPS.at(-1)?.kinds).toBeNull();
  });
});
```

Run: `pnpm --filter @ib/coverage test`
Expected: FAIL, `./format.ts` introuvable.

- [x] **Étape 6 : `format.ts`**

```ts
/**
 * Python's f"{value:g}" for the numbers a strike or a share count takes:
 * six significant digits, no trailing zeros, exponent below 1e-4 or from
 * 1e6. `""` for null, as `_fmt_num(None)`.
 */
export function fmtNum(value: number | null): string {
  if (value === null) return "";
  if (Number.isInteger(value)) return String(value);
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  if (exponent < -4 || exponent >= 6) {
    const [mantissa, exp] = value.toExponential(5).split("e");
    const sign = exp.startsWith("-") ? "-" : "+";
    return `${mantissa.replace(/\.?0+$/, "")}e${sign}${exp.slice(1).padStart(2, "0")}`;
  }
  return String(Number(value.toPrecision(6)));
}

/**
 * Python's f"{value:.2f}". Both languages round the exact binary value
 * correctly; they differ only on an exact tie, which Python rounds to even
 * and `toFixed` rounds up. A tie at two decimals is exactly an odd multiple
 * of 1/8 (0.125, 2.375…), and `value * 8` is exact for any double.
 */
export function fmtFixed2(value: number): string {
  const negative = value < 0 || Object.is(value, -0);
  const magnitude = Math.abs(value);
  const eighths = magnitude * 8;
  let text: string;
  if (Number.isInteger(eighths) && eighths % 2 === 1) {
    const floor = Math.floor(magnitude * 100);
    const cents = floor % 2 === 0 ? floor : floor + 1;
    text = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
  } else {
    text = magnitude.toFixed(2);
  }
  return negative ? `-${text}` : text;
}

/** Python's f"{value:,.2f}". */
export function fmtMoney(value: number): string {
  const [whole, fraction] = fmtFixed2(value).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}
```

- [x] **Étape 7 : vérifier et committer**

Run: `pnpm --filter @ib/coverage test && pnpm --filter @ib/coverage typecheck && pnpm --filter @ib/ledger typecheck`
Expected: PASS.

```bash
git add packages/coverage packages/ledger/src/types.ts pnpm-lock.yaml
git commit -m "feat(coverage): type Position, constantes métier et formatage à la Python

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LJLvsD7TGEDB8mTSTxfmwy"
```

---

## Tâche 2 : classification, description de contrat, règle de rachat, `analyze`

**Files:**
- Create: `packages/coverage/src/classify.ts`, `packages/coverage/src/fixtures.ts`
- Modify: `packages/coverage/src/index.ts`
- Test: `packages/coverage/src/classify.test.ts`, `packages/coverage/src/analyze.test.ts`

**Interfaces:**
- Consumes: `Position` (`@ib/ledger`), constantes et types de la tâche 1.
- Produces: `classify(pos: Position): PositionKind`, `contractMultiplier(pos: Position): number`, `describeContract(pos: Position): string`, `evaluateBuyback(salePrice: number, currentPrice: number): "buy back" | "keep"`, `analyze(pos: Position): AnalyzedPosition` ; fabriques `option(overrides?)` et `stock(overrides?)` (`fixtures.ts`).

- [x] **Étape 1 : fabriques de test**

`packages/coverage/src/fixtures.ts` (mêmes valeurs par défaut que `make_option` et `make_stock` du Python, `avgPrice` déjà par unité) :

```ts
import type { Position } from "@ib/ledger";

/** A short call, one contract, sold at 2.00 per unit, worth 1.00 now. */
export function option(overrides: Partial<Position> = {}): Position {
  return {
    symbol: "AAPL",
    secType: "OPT",
    right: "C",
    strike: 150,
    expiry: "2026-01-16",
    multiplier: 100,
    quantity: -1,
    avgPrice: 2,
    marketPrice: 1,
    marketValue: -100,
    unrealizedPnl: 100,
    currency: "USD",
    conid: "",
    description: "",
    ...overrides,
  };
}

/** 100 shares bought at 140, worth 150 now. */
export function stock(overrides: Partial<Position> = {}): Position {
  return {
    symbol: "AAPL",
    secType: "STK",
    right: "",
    strike: null,
    expiry: null,
    multiplier: 1,
    quantity: 100,
    avgPrice: 140,
    marketPrice: 150,
    marketValue: 15000,
    unrealizedPnl: 1000,
    currency: "USD",
    conid: "",
    description: "",
    ...overrides,
  };
}
```

- [x] **Étape 2 : tests de classification (port de `test_classification.py`)**

`packages/coverage/src/classify.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { Position } from "@ib/ledger";
import { DEFAULT_MULTIPLIER } from "./constants.ts";
import { classify, contractMultiplier, describeContract } from "./classify.ts";
import { option, stock } from "./fixtures.ts";

// `right` is typed "C" | "P" | "" on Position; the engine still tolerates the
// full word and lower case the way the Python did, so the adapters of the
// next sub-projects cannot break it. The cast keeps those cases in the suite.
const right = (value: string) => value as Position["right"];

describe("classify", () => {
  it.each([
    ["C", -1, "short_call"],
    ["C", 1, "long_call"],
    ["P", -1, "short_put"],
    ["P", 1, "long_put"],
    ["CALL", -2, "short_call"],
    ["PUT", 3, "long_put"],
    ["c", -1, "short_call"],
    ["put", -1, "short_put"],
  ])("classifies right=%s quantity=%s as %s", (r, quantity, expected) => {
    expect(classify(option({ right: right(r), quantity }))).toBe(expected);
  });

  it("treats a futures option exactly like an option", () => {
    expect(classify(option({ secType: "FOP", right: "C", quantity: -1 }))).toBe("short_call");
  });

  it.each(["", "X"])("classifies an option without a usable right (%j) as other", (r) => {
    expect(classify(option({ right: right(r), quantity: -1 }))).toBe("other");
  });

  it.each([
    [100, "long_stock"],
    [-100, "short_stock"],
    [0, "other"],
  ])("classifies a stock with quantity %s as %s", (quantity, expected) => {
    expect(classify(stock({ quantity }))).toBe(expected);
  });

  it("classifies a zero-quantity option as long, not short", () => {
    expect(classify(option({ right: "C", quantity: 0 }))).toBe("long_call");
  });
});

describe("contractMultiplier", () => {
  it.each([
    [100, 100],
    [50, 50],
    [12.5, 12.5],
    [null, DEFAULT_MULTIPLIER],
    [0, DEFAULT_MULTIPLIER],
    [-100, DEFAULT_MULTIPLIER],
  ])("maps a reported multiplier of %s to %s", (multiplier, expected) => {
    expect(contractMultiplier(option({ multiplier }))).toBe(expected);
  });
});

describe("describeContract", () => {
  it("formats expiry and strike", () => {
    expect(describeContract(option({ symbol: "AAPL", right: "C", strike: 150, expiry: "2026-01-16" }))).toBe(
      "AAPL 2026-01-16 C 150",
    );
  });

  it("keeps a decimal strike", () => {
    expect(describeContract(option({ symbol: "SPY", right: "P", strike: 452.5, expiry: "2026-03-20" }))).toBe(
      "SPY 2026-03-20 P 452.5",
    );
  });

  it("truncates a full right word", () => {
    expect(describeContract(option({ symbol: "MSFT", right: right("CALL"), strike: 400, expiry: "2026-12-18" }))).toBe(
      "MSFT 2026-12-18 C 400",
    );
  });

  it.each(["", "2026-01"])("passes an expiry through as given (%j)", (expiry) => {
    expect(describeContract(option({ symbol: "AAPL", right: "C", strike: 150, expiry }))).toBe(`AAPL ${expiry} C 150`);
  });

  it("describes a stock by its symbol and security type", () => {
    expect(describeContract(stock({ symbol: "AAPL" }))).toBe("AAPL (STK)");
  });

  it("leaves a double space when the option has no right", () => {
    expect(describeContract(option({ symbol: "AAPL", right: "", strike: 150, expiry: "2026-01-16" }))).toBe(
      "AAPL 2026-01-16  150",
    );
  });

  it("writes nothing for a missing strike", () => {
    expect(describeContract(option({ strike: null }))).toBe("AAPL 2026-01-16 C ");
  });
});
```

- [x] **Étape 3 : tests de rachat et d'`analyze` (port de la moitié de `test_analysis.py`)**

`packages/coverage/src/analyze.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { BUYBACK_RATIO, DEFAULT_MULTIPLIER, KIND_LABELS } from "./constants.ts";
import { analyze, describeContract, evaluateBuyback } from "./classify.ts";
import { option, stock } from "./fixtures.ts";

describe("evaluateBuyback", () => {
  it.each([
    [2.0, 1.0, "buy back"],
    [2.0, 0.99, "buy back"],
    [2.0, 0.1, "buy back"],
    [2.0, 1.01, "keep"],
    [2.0, 2.0, "keep"],
    [2.0, 5.0, "keep"],
    [0.5, 0.25, "buy back"],
    [0.5, 0.26, "keep"],
  ])("sold at %s, now %s -> %s", (sale, current, expected) => {
    expect(evaluateBuyback(sale, current)).toBe(expected);
  });

  it("follows BUYBACK_RATIO, not a hard-coded 2", () => {
    const sale = 3;
    const threshold = sale / BUYBACK_RATIO;
    expect(evaluateBuyback(sale, threshold)).toBe("buy back");
    expect(evaluateBuyback(sale, threshold * 1.01)).toBe("keep");
  });

  it.each([
    [-2.0, 1.0],
    [2.0, -1.0],
    [-2.0, -1.0],
  ])("ignores signs (%s, %s): IB bookkeeping, the rule compares magnitudes", (sale, current) => {
    expect(evaluateBuyback(sale, current)).toBe("buy back");
  });

  it.each([0, -0])("stays safe on a zero sale price (%s)", (sale) => {
    expect(evaluateBuyback(sale, 0)).toBe("keep");
  });

  it("buys back a worthless option", () => {
    expect(evaluateBuyback(1.5, 0)).toBe("buy back");
  });
});

describe("analyze", () => {
  it("evaluates a short call and decides to buy it back", () => {
    const result = analyze(option({ right: "C", quantity: -1, avgPrice: 2, marketPrice: 0.8 }));
    expect(result).toMatchObject({
      kind: "short_call",
      label: "sell of call",
      action: "to evaluate",
      avgPrice: 2,
      lastPrice: 0.8,
      decision: "buy back",
    });
  });

  it("keeps a short put above the threshold", () => {
    const result = analyze(option({ right: "P", quantity: -2, avgPrice: 3, marketPrice: 2.5 }));
    expect(result).toMatchObject({ kind: "short_put", action: "to evaluate", decision: "keep" });
  });

  it.each([
    { right: "C", quantity: 1 },
    { right: "P", quantity: 1 },
  ] as const)("ignores a long option %j", (overrides) => {
    const result = analyze(option(overrides));
    expect(result.action).toBe("ignore");
    expect(result.decision).toBeNull();
  });

  it("ignores a stock and keeps its average cost", () => {
    const result = analyze(stock({ quantity: 100, avgPrice: 140, marketPrice: 150 }));
    expect(result).toMatchObject({ kind: "long_stock", action: "ignore", decision: null, avgPrice: 140 });
  });

  // Spec §3.3, deviation 1: Position.avgPrice is already per unit. The
  // Python divided IB's per-contract averageCost here; that division now
  // belongs to the agent adapter of sub-project 4.
  it("keeps the per-unit average price of an option as given, whatever the multiplier", () => {
    expect(analyze(option({ avgPrice: 5, multiplier: 50, quantity: -1 })).avgPrice).toBe(5);
    expect(analyze(option({ avgPrice: 5, multiplier: null, quantity: -1 })).avgPrice).toBe(5);
  });

  it("falls back to the default multiplier when the contract has none", () => {
    expect(analyze(option({ multiplier: null })).multiplier).toBe(DEFAULT_MULTIPLIER);
  });

  it("copies the market fields verbatim", () => {
    const result = analyze(option({ quantity: -3, marketValue: -450, unrealizedPnl: 150, marketPrice: 1.5 }));
    expect(result).toMatchObject({ marketValue: -450, quantity: -3, unrealizedPnl: 150, lastPrice: 1.5 });
  });

  it("describes the contract with describeContract", () => {
    const pos = option({ symbol: "TSLA", right: "P", strike: 250, expiry: "2026-09-18" });
    expect(analyze(pos).description).toBe(describeContract(pos));
  });

  it("uses the label table", () => {
    expect(analyze(option({ right: "C", quantity: -1 })).label).toBe(KIND_LABELS.short_call);
  });

  it("starts with an empty coverage", () => {
    expect(analyze(option())).toMatchObject({
      allocations: [],
      uncoveredQuantity: 0,
      usedQuantity: 0,
      requiredCash: 0,
      riskNotes: [],
    });
  });

  it("maps a missing strike to 0 and a missing expiry to an empty string", () => {
    expect(analyze(stock())).toMatchObject({ strike: 0, expiry: "", right: "" });
  });
});
```

Run: `pnpm --filter @ib/coverage test`
Expected: FAIL, `./classify.ts` introuvable.

- [x] **Étape 4 : `classify.ts`**

```ts
import type { Position } from "@ib/ledger";
import { BUYBACK_RATIO, DEFAULT_MULTIPLIER, EVALUATE_KINDS, KIND_LABELS, type PositionKind } from "./constants.ts";
import { fmtNum } from "./format.ts";
import type { AnalyzedPosition } from "./types.ts";

function isOption(pos: Position): boolean {
  return pos.secType === "OPT" || pos.secType === "FOP";
}

/** IB's sign convention: quantity > 0 is long (bought), < 0 is short (sold). */
export function classify(pos: Position): PositionKind {
  if (isOption(pos)) {
    const right = pos.right.toUpperCase();
    if (right.startsWith("C")) return pos.quantity < 0 ? "short_call" : "long_call";
    if (right.startsWith("P")) return pos.quantity < 0 ? "short_put" : "long_put";
    return "other";
  }
  if (pos.quantity > 0) return "long_stock";
  if (pos.quantity < 0) return "short_stock";
  return "other";
}

/** The contract multiplier (100 for standard equity options). */
export function contractMultiplier(pos: Position): number {
  return pos.multiplier !== null && pos.multiplier > 0 ? pos.multiplier : DEFAULT_MULTIPLIER;
}

/** "AAPL 2026-01-16 C 150" for an option, "AAPL (STK)" otherwise. */
export function describeContract(pos: Position): string {
  if (isOption(pos)) {
    const right = pos.right.toUpperCase().slice(0, 1);
    return `${pos.symbol} ${pos.expiry ?? ""} ${right} ${fmtNum(pos.strike)}`;
  }
  return `${pos.symbol} (${pos.secType})`;
}

/**
 * "buy back" when the current price is at least BUYBACK_RATIO times lower
 * than the sale price, i.e. current <= sale / BUYBACK_RATIO. Otherwise "keep".
 */
export function evaluateBuyback(salePrice: number, currentPrice: number): "buy back" | "keep" {
  const sale = Math.abs(salePrice);
  const current = Math.abs(currentPrice);
  if (sale <= 0) return "keep";
  return current <= sale / BUYBACK_RATIO ? "buy back" : "keep";
}

/** Turn a raw position into an AnalyzedPosition, coverage not yet computed. */
export function analyze(pos: Position): AnalyzedPosition {
  const kind = classify(pos);
  const multiplier = contractMultiplier(pos);
  const action = EVALUATE_KINDS.has(kind) ? "to evaluate" : "ignore";
  // An unknown price counts as 0 for the rule only: sale 0 -> "keep".
  const decision = action === "to evaluate" ? evaluateBuyback(pos.avgPrice ?? 0, pos.marketPrice ?? 0) : null;
  return {
    description: describeContract(pos),
    kind,
    label: KIND_LABELS[kind],
    marketValue: pos.marketValue,
    quantity: pos.quantity,
    avgPrice: pos.avgPrice,
    lastPrice: pos.marketPrice,
    unrealizedPnl: pos.unrealizedPnl,
    action,
    decision,
    symbol: pos.symbol,
    secType: pos.secType,
    right: pos.right.toUpperCase().slice(0, 1),
    strike: pos.strike ?? 0,
    expiry: pos.expiry ?? "",
    multiplier,
    allocations: [],
    uncoveredQuantity: 0,
    usedQuantity: 0,
    requiredCash: 0,
    riskNotes: [],
  };
}
```

Ajouter `export * from "./classify.ts";` dans `index.ts`.

- [x] **Étape 5 : vérifier et committer**

Run: `pnpm --filter @ib/coverage test && pnpm --filter @ib/coverage typecheck`
Expected: PASS.

```bash
git add packages/coverage
git commit -m "feat(coverage): classification, description de contrat, rachat et analyze

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LJLvsD7TGEDB8mTSTxfmwy"
```

---

## Tâche 3 : moteur de couverture et rapport, tests de `test_coverage.py` portés

**Files:**
- Create: `packages/coverage/src/coverage.ts`, `packages/coverage/src/report.ts`
- Modify: `packages/coverage/src/index.ts`
- Test: `packages/coverage/src/coverage.test.ts`

**Interfaces:**
- Consumes: `analyze`, constantes, types, `fmtNum`, `fmtFixed2`, `fmtMoney`.
- Produces: `normalizeExpiry(expiry: string): string`, `fmtExpiry(expiry: string): string`, `computeCoverage(positions: AnalyzedPosition[]): Structure[]` (mute les positions) ; `buildRiskReport(positions: readonly Position[], cashAvailable: number | null): RiskReport` ; `structureMaxLoss`, `structureAssignmentCash`, `structureOk`, `structureDescription` `(s: Structure)` ; `putCashRequired`, `ironCondorCashRequired`, `cashRequired`, `cashOk` (`boolean | null`), `uncovered`, `shortStock`, `ironCondors`, `breaches`, `moderateShortCalls`, `issues`, `isOk` `(report: RiskReport)` ; `riskValue(p: AnalyzedPosition): number | null` ; `groupedPositions(positions): PositionGroup[]` avec `PositionGroup { id: DetailGroupId; title: string; positions: AnalyzedPosition[] }`.

- [x] **Étape 1 : tests (port de `test_coverage.py`, même ordre, mêmes noms)**

`packages/coverage/src/coverage.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { Position } from "@ib/ledger";
import { analyze } from "./classify.ts";
import {
  COVER_CASH,
  COVER_LEAPS,
  COVER_SPREAD,
  COVER_STOCK,
  MAX_STRUCTURE_LOSS,
  STRUCT_CALL_SPREAD,
  STRUCT_IRON_CONDOR,
  STRUCT_PUT_SPREAD,
} from "./constants.ts";
import { computeCoverage, normalizeExpiry } from "./coverage.ts";
import { option, stock } from "./fixtures.ts";
import {
  breaches,
  buildRiskReport,
  cashOk,
  cashRequired,
  ironCondors,
  isOk,
  issues,
  moderateShortCalls,
  structureMaxLoss,
  structureOk,
  uncovered,
} from "./report.ts";
import type { AnalyzedPosition, CoverSource, RiskReport, Structure } from "./types.ts";

// The whole point of the engine is to make an unbounded loss impossible to
// miss, so every scenario asserts either "covered and the account is OK" or
// "naked and the report screams". A long leg can only be used once: double
// counting would silently turn a naked short into a covered one.

function reportFor(positions: Position[], cash: number | null = 1_000_000): RiskReport {
  return buildRiskReport(positions, cash);
}

function find(positions: readonly AnalyzedPosition[], needle: string): AnalyzedPosition {
  const matches = positions.filter((p) => p.description.includes(needle));
  expect(matches, `${needle} matched ${matches.length} positions`).toHaveLength(1);
  return matches[0];
}

const sources = (pos: AnalyzedPosition): CoverSource[] => pos.allocations.map((a) => a.source);
const quantityFrom = (pos: AnalyzedPosition, source: CoverSource): number =>
  pos.allocations.filter((a) => a.source === source).reduce((sum, a) => sum + a.quantity, 0);

describe("normalizeExpiry", () => {
  it.each([
    ["2026-01-16", "20260116"],
    ["20260116", "20260116"],
    ["202601", "20260131"],
    ["", ""],
  ])("normalizes %j to %j", (raw, expected) => {
    expect(normalizeExpiry(raw)).toBe(expected);
  });

  it("orders expiries chronologically under plain string comparison, which the LEAPS rule relies on", () => {
    expect(normalizeExpiry("2026-01-16") < normalizeExpiry("2027-01-15")).toBe(true);
    expect(normalizeExpiry("202601") < normalizeExpiry("2026-03-01")).toBe(true);
  });
});

describe("short calls covered by stock", () => {
  it("fully covers a short call with 100 shares", () => {
    const report = reportFor([
      stock({ symbol: "AAPL", quantity: 100, avgPrice: 140 }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150 }),
    ]);
    const short = find(report.positions, "C 150");
    expect(sources(short)).toEqual([COVER_STOCK]);
    expect(short.uncoveredQuantity).toBe(0);
    expect(isOk(report)).toBe(true);
  });

  it("covers one contract per hundred shares: 300 shares back three contracts, not four", () => {
    const report = reportFor([
      stock({ symbol: "AAPL", quantity: 300, avgPrice: 140 }),
      option({ symbol: "AAPL", right: "C", quantity: -4, strike: 150 }),
    ]);
    const short = find(report.positions, "C 150");
    expect(quantityFrom(short, COVER_STOCK)).toBe(3);
    expect(short.uncoveredQuantity).toBe(1);
    expect(isOk(report)).toBe(false);
  });

  it("covers nothing with a partial lot: 99 shares, rounding up would hide a naked call", () => {
    const report = reportFor([
      stock({ symbol: "AAPL", quantity: 99, avgPrice: 140 }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150 }),
    ]);
    const short = find(report.positions, "C 150");
    expect(short.allocations).toEqual([]);
    expect(short.uncoveredQuantity).toBe(1);
    expect(isOk(report)).toBe(false);
  });

  it("does not share 100 shares between two short calls: the earliest expiry gets them", () => {
    const report = reportFor([
      stock({ symbol: "AAPL", quantity: 100, avgPrice: 140 }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150, expiry: "2026-01-16" }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150, expiry: "2026-02-20" }),
    ]);
    expect(sources(find(report.positions, "2026-01-16"))).toEqual([COVER_STOCK]);
    expect(find(report.positions, "2026-02-20").uncoveredQuantity).toBe(1);
    expect(isOk(report)).toBe(false);
  });

  it("does not cover with the stock of another symbol", () => {
    const report = reportFor([
      stock({ symbol: "MSFT", quantity: 500, avgPrice: 300 }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150 }),
    ]);
    expect(find(report.positions, "AAPL").uncoveredQuantity).toBe(1);
    expect(isOk(report)).toBe(false);
  });
});

describe("short calls covered by LEAPS", () => {
  it("covers a short call with a longer-dated long call", () => {
    const report = reportFor([
      option({ symbol: "AAPL", right: "C", quantity: 1, strike: 120, expiry: "2027-01-15" }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150, expiry: "2026-01-16" }),
    ]);
    expect(sources(find(report.positions, "2026-01-16"))).toEqual([COVER_LEAPS]);
    expect(find(report.positions, "2027-01-15").usedQuantity).toBe(1);
    expect(isOk(report)).toBe(true);
  });

  it("does not count a shorter-dated long call as a LEAPS cover", () => {
    const report = reportFor([
      option({ symbol: "AAPL", right: "C", quantity: 1, strike: 120, expiry: "2026-01-16" }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150, expiry: "2027-01-15" }),
    ]);
    expect(find(report.positions, "2027-01-15").uncoveredQuantity).toBe(1);
    expect(isOk(report)).toBe(false);
  });

  it("uses stock and LEAPS together: 3 sold, 100 shares held, 2 LEAPS owned", () => {
    const report = reportFor([
      stock({ symbol: "AAPL", quantity: 100, avgPrice: 140 }),
      option({ symbol: "AAPL", right: "C", quantity: 2, strike: 120, expiry: "2027-01-15" }),
      option({ symbol: "AAPL", right: "C", quantity: -3, strike: 150, expiry: "2026-01-16" }),
    ]);
    const short = find(report.positions, "2026-01-16");
    expect(sources(short)).toEqual([COVER_STOCK, COVER_LEAPS]);
    expect(quantityFrom(short, COVER_STOCK)).toBe(1);
    expect(quantityFrom(short, COVER_LEAPS)).toBe(2);
    expect(short.uncoveredQuantity).toBe(0);
    expect(isOk(report)).toBe(true);
  });

  it("consumes the LEAPS quantity across short calls: the second one stays naked", () => {
    const report = reportFor([
      option({ symbol: "AAPL", right: "C", quantity: 1, strike: 120, expiry: "2028-01-19" }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150, expiry: "2026-01-16" }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150, expiry: "2026-02-20" }),
    ]);
    expect(find(report.positions, "2026-01-16").uncoveredQuantity).toBe(0);
    expect(find(report.positions, "2026-02-20").uncoveredQuantity).toBe(1);
    expect(isOk(report)).toBe(false);
  });
});

describe("short puts secured by cash", () => {
  it("requires the full assignment cash", () => {
    const report = reportFor([option({ symbol: "AAPL", right: "P", quantity: -2, strike: 100 })], 50_000);
    const short = find(report.positions, "P 100");
    expect(sources(short)).toEqual([COVER_CASH]);
    expect(short.requiredCash).toBe(20_000);
    expect(cashRequired(report)).toBe(20_000);
    expect(cashOk(report)).toBe(true);
    expect(isOk(report)).toBe(true);
  });

  it("flags short puts exceeding the cash", () => {
    const report = reportFor([option({ symbol: "AAPL", right: "P", quantity: -3, strike: 100 })], 25_000);
    expect(cashRequired(report)).toBe(30_000);
    expect(cashOk(report)).toBe(false);
    expect(isOk(report)).toBe(false);
    expect(issues(report).some((issue) => issue.includes("only"))).toBe(true);
  });

  it("sums the cash requirement across symbols", () => {
    const report = reportFor(
      [
        option({ symbol: "AAPL", right: "P", quantity: -1, strike: 100 }),
        option({ symbol: "MSFT", right: "P", quantity: -2, strike: 300 }),
      ],
      100_000,
    );
    expect(cashRequired(report)).toBe(10_000 + 60_000);
  });

  it("locks no cash for a short put inside a spread: the long put caps the loss", () => {
    const report = reportFor(
      [
        option({ symbol: "AAPL", right: "P", quantity: 1, strike: 90, expiry: "2026-03-20" }),
        option({ symbol: "AAPL", right: "P", quantity: -1, strike: 95, expiry: "2026-03-20" }),
      ],
      0,
    );
    const short = find(report.positions, "P 95");
    expect(sources(short)).toEqual([COVER_SPREAD]);
    expect(short.requiredCash).toBe(0);
    expect(cashRequired(report)).toBe(0);
  });

  it("never reports a short put as uncovered: the danger is the cash bill, not the leg", () => {
    const report = reportFor([option({ symbol: "AAPL", right: "P", quantity: -1, strike: 100 })], 0);
    expect(uncovered(report)).toEqual([]);
    expect(isOk(report)).toBe(false);
  });
});

/** The four legs of an iron condor, premiums per unit. */
function ironCondor({
  symbol = "XYZ",
  expiry = "2026-03-20",
  longPut = 90,
  shortPut = 95,
  shortCall = 105,
  longCall = 110,
  qty = 1,
  shortPremium = 2,
  longPremium = 1,
} = {}): Position[] {
  return [
    option({ symbol, expiry, right: "P", strike: longPut, quantity: qty, avgPrice: longPremium }),
    option({ symbol, expiry, right: "P", strike: shortPut, quantity: -qty, avgPrice: shortPremium }),
    option({ symbol, expiry, right: "C", strike: shortCall, quantity: -qty, avgPrice: shortPremium }),
    option({ symbol, expiry, right: "C", strike: longCall, quantity: qty, avgPrice: longPremium }),
  ];
}

describe("defined-risk structures", () => {
  it("detects an iron condor", () => {
    const report = reportFor(ironCondor());
    expect(ironCondors(report)).toHaveLength(1);
    expect(ironCondors(report)[0].symbol).toBe("XYZ");
  });

  it("tags the condor's short legs as spread", () => {
    const report = reportFor(ironCondor());
    for (const needle of ["C 105", "P 95"]) expect(sources(find(report.positions, needle))).toEqual([COVER_SPREAD]);
  });

  it("caps the max loss at the wider side minus the credit: 5-wide wings, 1.00 net per side -> 500 - 200", () => {
    const report = reportFor(ironCondor());
    const structure = ironCondors(report)[0];
    expect(structure.callRisk).toBe(500);
    expect(structure.putRisk).toBe(500);
    expect(structure.credit).toBe(200);
    expect(structureMaxLoss(structure)).toBe(300);
    expect(structureOk(structure)).toBe(true);
    expect(isOk(report)).toBe(true);
  });

  it("takes the wider wing of an asymmetric condor", () => {
    const structure = ironCondors(reportFor(ironCondor({ longPut: 85 })))[0];
    expect(structure.putRisk).toBe(1000);
    expect(structureMaxLoss(structure)).toBe(1000 - 200);
  });

  it("flags a condor over the loss limit: a 20-wide wing loses far more than the budget", () => {
    const report = reportFor(ironCondor({ longPut: 75 }));
    const structure = ironCondors(report)[0];
    expect(structureMaxLoss(structure)).toBe(2000 - 200);
    expect(structureOk(structure)).toBe(false);
    expect(breaches(report)).toContain(structure);
    expect(isOk(report)).toBe(false);
    expect(issues(report).some((issue) => issue.includes("exceeds"))).toBe(true);
  });

  it("drives the loss limit by MAX_STRUCTURE_LOSS, not a hard-coded 1000", () => {
    const structure: Structure = {
      symbol: "X",
      expiry: "2026-03-20",
      kind: STRUCT_IRON_CONDOR,
      contracts: 2,
      callRisk: MAX_STRUCTURE_LOSS,
      putRisk: 0,
      credit: 0,
    };
    expect(structureOk(structure)).toBe(true);
    expect(structureOk({ ...structure, callRisk: MAX_STRUCTURE_LOSS + 0.01 })).toBe(false);
  });

  it("scales the risk with the number of condors", () => {
    const structure = ironCondors(reportFor(ironCondor({ qty: 3 })))[0];
    expect(structure.contracts).toBe(6);
    expect(structureMaxLoss(structure)).toBe(1500 - 600);
  });

  it("keeps condors on different expiries as separate structures", () => {
    const report = reportFor([...ironCondor({ expiry: "2026-03-20" }), ...ironCondor({ expiry: "2026-06-19" })]);
    expect(ironCondors(report)).toHaveLength(2);
  });

  it("calls a call side alone a call spread, not a condor", () => {
    const report = reportFor([
      option({ symbol: "XYZ", expiry: "2026-03-20", right: "C", strike: 105, quantity: -1, avgPrice: 2 }),
      option({ symbol: "XYZ", expiry: "2026-03-20", right: "C", strike: 110, quantity: 1, avgPrice: 1 }),
    ]);
    expect(ironCondors(report)).toEqual([]);
    expect(report.structures.map((s) => s.kind)).toEqual([STRUCT_CALL_SPREAD]);
    expect(structureMaxLoss(report.structures[0])).toBe(500 - 100);
    expect(isOk(report)).toBe(true);
  });

  it("calls a put side alone a put spread", () => {
    const report = reportFor(
      [
        option({ symbol: "XYZ", expiry: "2026-03-20", right: "P", strike: 95, quantity: -1, avgPrice: 2 }),
        option({ symbol: "XYZ", expiry: "2026-03-20", right: "P", strike: 90, quantity: 1, avgPrice: 1 }),
      ],
      0,
    );
    expect(report.structures.map((s) => s.kind)).toEqual([STRUCT_PUT_SPREAD]);
  });

  it("removes the risk when the long leg sits below the short strike: a debit spread", () => {
    const report = reportFor([
      option({ symbol: "XYZ", expiry: "2026-03-20", right: "C", strike: 150, quantity: -1, avgPrice: 2 }),
      option({ symbol: "XYZ", expiry: "2026-03-20", right: "C", strike: 100, quantity: 1, avgPrice: 1 }),
    ]);
    expect(report.structures[0].callRisk).toBe(0);
    expect(isOk(report)).toBe(true);
  });

  it("gives the tightest protection to the closest short strike: 105 pairs with 100, 205 with 200", () => {
    const report = reportFor([
      option({ symbol: "XYZ", expiry: "2026-03-20", right: "C", strike: 100, quantity: -1, avgPrice: 0 }),
      option({ symbol: "XYZ", expiry: "2026-03-20", right: "C", strike: 200, quantity: -1, avgPrice: 0 }),
      option({ symbol: "XYZ", expiry: "2026-03-20", right: "C", strike: 105, quantity: 1, avgPrice: 0 }),
      option({ symbol: "XYZ", expiry: "2026-03-20", right: "C", strike: 205, quantity: 1, avgPrice: 0 }),
    ]);
    expect(report.structures[0].callRisk).toBe(1000);
  });

  it("leaves the short leg of a partial condor uncovered", () => {
    const legs = ironCondor().filter((leg) => !(leg.right === "C" && leg.strike === 110));
    const report = reportFor(legs, 1_000_000);
    expect(find(report.positions, "C 105").uncoveredQuantity).toBe(1);
    expect(isOk(report)).toBe(false);
  });
});

describe("moderate-risk short calls", () => {
  it("notes a short call below the stock cost: assignment at 150 on shares bought at 165 locks in a loss", () => {
    const report = reportFor([
      stock({ symbol: "AAPL", quantity: 100, avgPrice: 165 }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150 }),
    ]);
    const moderate = moderateShortCalls(report);
    expect(moderate.map((p) => p.description)).toEqual(["AAPL 2026-01-16 C 150"]);
    expect(moderate[0].riskNotes[0]).toContain("stock cost");
    expect(isOk(report)).toBe(true);
  });

  it("does not note a short call above the stock cost", () => {
    const report = reportFor([
      stock({ symbol: "AAPL", quantity: 100, avgPrice: 140 }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150 }),
    ]);
    expect(moderateShortCalls(report)).toEqual([]);
  });

  it("notes a short call below the LEAPS strike", () => {
    const report = reportFor([
      option({ symbol: "AAPL", right: "C", quantity: 1, strike: 160, expiry: "2027-01-15" }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150, expiry: "2026-01-16" }),
    ]);
    const moderate = moderateShortCalls(report);
    expect(moderate).toHaveLength(1);
    expect(moderate[0].riskNotes[0]).toContain("LEAPS strike");
    expect(isOk(report)).toBe(true);
  });

  it("does not note a short call above the LEAPS strike", () => {
    const report = reportFor([
      option({ symbol: "AAPL", right: "C", quantity: 1, strike: 120, expiry: "2027-01-15" }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150, expiry: "2026-01-16" }),
    ]);
    expect(moderateShortCalls(report)).toEqual([]);
  });

  it("uses the weighted average stock cost: 100 @ 100 and 100 @ 200 -> 150, so a 140 strike is at risk", () => {
    const report = reportFor([
      stock({ symbol: "AAPL", quantity: 100, avgPrice: 100 }),
      stock({ symbol: "AAPL", quantity: 100, avgPrice: 200 }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 140 }),
    ]);
    expect(moderateShortCalls(report)).toHaveLength(1);
  });
});

describe("other dangerous positions and sanity", () => {
  it("flags short stock", () => {
    const report = reportFor([stock({ symbol: "AAPL", quantity: -100 })]);
    expect(isOk(report)).toBe(false);
    expect(issues(report).some((issue) => issue.includes("short stock"))).toBe(true);
  });

  it("is fine with an empty portfolio", () => {
    const report = buildRiskReport([], 0);
    expect(isOk(report)).toBe(true);
    expect(cashRequired(report)).toBe(0);
    expect(ironCondors(report)).toEqual([]);
  });

  it("is fine with a long-only portfolio", () => {
    const report = reportFor([
      stock({ symbol: "AAPL", quantity: 100 }),
      option({ symbol: "AAPL", right: "C", quantity: 2, strike: 150 }),
    ]);
    expect(isOk(report)).toBe(true);
  });

  it("computes coverage idempotently: running it twice does not double count", () => {
    const positions = [
      stock({ symbol: "AAPL", quantity: 100, avgPrice: 140 }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150 }),
    ].map(analyze);
    computeCoverage(positions);
    const first = positions.map((p) => [...p.allocations]);
    computeCoverage(positions);
    expect(positions.map((p) => [...p.allocations])).toEqual(first);
    expect(find(positions, "(STK)").usedQuantity).toBe(100);
  });
});

describe("strings the engine builds (compared to the oracle character for character)", () => {
  it("details a stock cover and a cash cover the way the Python did", () => {
    const report = reportFor(
      [
        stock({ symbol: "AAPL", quantity: 100, avgPrice: 165 }),
        option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150 }),
        option({ symbol: "XOM", right: "P", quantity: -2, strike: 55 }),
      ],
      1000,
    );
    expect(find(report.positions, "C 150").allocations[0].detail).toBe("100 shares @ 165.00");
    expect(find(report.positions, "C 150").riskNotes).toEqual(["strike 150 below stock cost 165.00"]);
    expect(find(report.positions, "P 55").allocations[0].detail).toBe("11,000.00 USD");
    expect(issues(report)).toEqual([
      "cash required (short puts + iron condors) needs 11,000.00 USD but only 1,000.00 USD is available",
    ]);
  });

  it("describes a breached structure and an uncovered leg the way the Python did", () => {
    const report = reportFor([
      ...ironCondor({ longPut: 75 }),
      stock({ symbol: "TSLA", quantity: -10 }),
      option({ symbol: "MSFT", right: "C", quantity: -2, strike: 400, expiry: "2026-03-20" }),
    ]);
    expect(issues(report)).toEqual([
      "MSFT 2026-03-20 C 400: 2 contract(s) not covered - unlimited loss risk",
      "TSLA (STK): short stock position - unlimited loss risk",
      "XYZ 2026-03-20 iron condor: max loss 1,800.00 USD exceeds the 1,000.00 USD limit",
    ]);
  });
});
```

Run: `pnpm --filter @ib/coverage test`
Expected: FAIL, `./coverage.ts` et `./report.ts` introuvables.

- [x] **Étape 2 : `coverage.ts`**

Port des trois passes. Les tris sont stables des deux côtés (`sorted` en Python, `Array.prototype.sort` depuis ES2019) ; `minBy` reproduit `min(key=...)` de Python, qui garde le premier des minimums.

```ts
import {
  COVER_CASH,
  COVER_LEAPS,
  COVER_SPREAD,
  COVER_STOCK,
  STRUCT_CALL_SPREAD,
  STRUCT_IRON_CONDOR,
  STRUCT_PUT_SPREAD,
  type StructureKind,
} from "./constants.ts";
import { fmtFixed2, fmtMoney, fmtNum } from "./format.ts";
import type { AnalyzedPosition, Structure } from "./types.ts";

// Every short option must be backed by something, otherwise the loss is
// unbounded. Three coverage families, allocated in this order, quantities
// consumed as they are used so a long leg never covers two short legs:
//   1. defined-risk structures (iron condors, vertical spreads): same
//      underlying AND same expiry, loss capped by the strike width;
//   2. short calls: long shares, then longer-dated long calls (LEAPS);
//   3. short puts: USD cash only, no leverage.

/** "2026-01-16" -> "20260116"; a bare month "202601" is the end of that month. */
export function normalizeExpiry(expiry: string): string {
  const raw = expiry.replaceAll("-", "").trim();
  return raw.length === 6 ? `${raw}31` : raw;
}

/** A normalized expiry back to YYYY-MM-DD; anything else passes through. */
export function fmtExpiry(expiry: string): string {
  const raw = normalizeExpiry(expiry);
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}` : raw;
}

/** A long position with the quantity still available as coverage. */
interface LongPool {
  pos: AnalyzedPosition;
  remaining: number;
}

/** Quantity of each short leg still waiting for coverage (Python used id(p)). */
type Remaining = Map<AnalyzedPosition, number>;

function resetCoverage(positions: AnalyzedPosition[]): void {
  for (const pos of positions) {
    pos.allocations = [];
    pos.uncoveredQuantity = 0;
    pos.usedQuantity = 0;
    pos.requiredCash = 0;
    pos.riskNotes = [];
  }
}

/** Python's min(items, key=...): the first item among the smallest keys. */
function minBy<T>(items: readonly T[], key: (item: T) => readonly [number, number]): T {
  let best = items[0];
  let bestKey = key(best);
  for (const item of items.slice(1)) {
    const k = key(item);
    if (k[0] < bestKey[0] || (k[0] === bestKey[0] && k[1] < bestKey[1])) {
      best = item;
      bestKey = k;
    }
  }
  return best;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Attribute coverage to every short option and return the structures found.
 * The positions are mutated in place: allocations, uncovered quantities,
 * required cash and risk notes are filled in. Idempotent.
 */
export function computeCoverage(positions: AnalyzedPosition[]): Structure[] {
  resetCoverage(positions);
  const bySymbol = new Map<string, AnalyzedPosition[]>();
  for (const pos of positions) {
    const group = bySymbol.get(pos.symbol);
    if (group) group.push(pos);
    else bySymbol.set(pos.symbol, [pos]);
  }
  const structures: Structure[] = [];
  for (const symbol of [...bySymbol.keys()].sort(compareStrings)) {
    structures.push(...coverSymbol(symbol, bySymbol.get(symbol) ?? []));
  }
  return structures;
}

function coverSymbol(symbol: string, group: AnalyzedPosition[]): Structure[] {
  const stockPool: LongPool[] = group
    .filter((p) => p.kind === "long_stock" && p.quantity > 0)
    .map((p) => ({ pos: p, remaining: p.quantity }));
  const longCalls: LongPool[] = group
    .filter((p) => p.kind === "long_call" && p.quantity > 0)
    .map((p) => ({ pos: p, remaining: Math.abs(p.quantity) }));
  const longPuts: LongPool[] = group
    .filter((p) => p.kind === "long_put" && p.quantity > 0)
    .map((p) => ({ pos: p, remaining: Math.abs(p.quantity) }));
  const shortCalls = group.filter((p) => p.kind === "short_call");
  const shortPuts = group.filter((p) => p.kind === "short_put");
  const remaining: Remaining = new Map([...shortCalls, ...shortPuts].map((p) => [p, Math.abs(p.quantity)]));

  const structures = buildStructures(symbol, shortCalls, shortPuts, longCalls, longPuts, remaining);
  coverShortCalls(shortCalls, stockPool, longCalls, remaining);
  secureShortPuts(shortPuts, remaining);
  return structures;
}

// --- Pass 1: same-expiry defined-risk structures ---------------------------

function buildStructures(
  symbol: string,
  shortCalls: AnalyzedPosition[],
  shortPuts: AnalyzedPosition[],
  longCalls: LongPool[],
  longPuts: LongPool[],
  remaining: Remaining,
): Structure[] {
  const structures: Structure[] = [];
  const expiries = [
    ...new Set([...shortCalls, ...shortPuts].filter((p) => p.expiry).map((p) => normalizeExpiry(p.expiry))),
  ].sort(compareStrings);

  for (const expiry of expiries) {
    const legsSc = shortCalls.filter((p) => normalizeExpiry(p.expiry) === expiry);
    const legsSp = shortPuts.filter((p) => normalizeExpiry(p.expiry) === expiry);
    const legsLc = longCalls.filter((l) => normalizeExpiry(l.pos.expiry) === expiry);
    const legsLp = longPuts.filter((l) => normalizeExpiry(l.pos.expiry) === expiry);

    const [callRisk, callCredit, callQty] = pairLegs(legsSc, legsLc, remaining, true);
    const [putRisk, putCredit, putQty] = pairLegs(legsSp, legsLp, remaining, false);

    if (callQty <= 0 && putQty <= 0) continue;

    let kind: StructureKind;
    if (callQty > 0 && putQty > 0) kind = STRUCT_IRON_CONDOR;
    else if (callQty > 0) kind = STRUCT_CALL_SPREAD;
    else kind = STRUCT_PUT_SPREAD;

    structures.push({
      symbol,
      expiry: fmtExpiry(expiry),
      kind,
      contracts: callQty + putQty,
      callRisk,
      putRisk,
      credit: callCredit + putCredit,
    });
  }
  return structures;
}

/**
 * Cover short legs with long legs of the same expiry. Returns [worst case in
 * USD, net credit in USD, contracts matched]. A long leg on the protective
 * side caps the loss at the strike width; a long leg beyond it removes the
 * risk entirely.
 */
function pairLegs(
  shorts: AnalyzedPosition[],
  longs: LongPool[],
  remaining: Remaining,
  isCall: boolean,
): [number, number, number] {
  // Walk the shorts from the strike closest to the money outwards, so the
  // riskiest leg gets the tightest protection available.
  const ordered = [...shorts].sort((a, b) => (isCall ? a.strike - b.strike : b.strike - a.strike));

  let totalRisk = 0;
  let totalCredit = 0;
  let matched = 0;

  for (const short of ordered) {
    let need = remaining.get(short) ?? 0;
    while (need > 0) {
      const candidates = longs.filter((l) => l.remaining > 0);
      if (candidates.length === 0) break;
      const best = minBy(candidates, (l) => pairCost(short, l.pos, isCall));
      const take = Math.min(need, best.remaining);
      const width = strikeWidth(short, best.pos, isCall);

      totalRisk += width * short.multiplier * take;
      totalCredit += (Math.abs(short.avgPrice ?? 0) - Math.abs(best.pos.avgPrice ?? 0)) * short.multiplier * take;
      short.allocations.push({ source: COVER_SPREAD, quantity: take, detail: best.pos.description });
      best.pos.usedQuantity += take;
      best.remaining -= take;
      need -= take;
      matched += take;
    }
    remaining.set(short, need);
  }
  return [totalRisk, totalCredit, matched];
}

/** Distance the underlying can travel against the short leg before the long leg takes over. */
function strikeWidth(short: AnalyzedPosition, long: AnalyzedPosition, isCall: boolean): number {
  return isCall ? Math.max(0, long.strike - short.strike) : Math.max(0, short.strike - long.strike);
}

/** Least resulting risk first; among equals, the leg closest to the short strike. */
function pairCost(short: AnalyzedPosition, long: AnalyzedPosition, isCall: boolean): [number, number] {
  return [strikeWidth(short, long, isCall), isCall ? -long.strike : long.strike];
}

// --- Pass 2: short calls covered by stock and LEAPS ------------------------

function coverShortCalls(
  shortCalls: AnalyzedPosition[],
  stockPool: LongPool[],
  longCalls: LongPool[],
  remaining: Remaining,
): void {
  const stockCost = weightedAvgCost(stockPool);
  const ordered = [...shortCalls].sort(
    (a, b) => compareStrings(normalizeExpiry(a.expiry), normalizeExpiry(b.expiry)) || a.strike - b.strike,
  );

  for (const short of ordered) {
    let need = remaining.get(short) ?? 0;
    if (need <= 0) {
      short.uncoveredQuantity = 0;
      continue;
    }

    // a) Long shares. One contract needs `multiplier` shares.
    const availableShares = stockPool.reduce((sum, l) => sum + l.remaining, 0);
    if (availableShares > 0 && short.multiplier > 0) {
      const coverable = Math.floor(availableShares / short.multiplier);
      const take = Math.min(need, coverable);
      if (take > 0) {
        const shares = take * short.multiplier;
        consumeShares(stockPool, shares);
        short.allocations.push({
          source: COVER_STOCK,
          quantity: take,
          detail: `${fmtNum(shares)} shares @ ${fmtFixed2(stockCost)}`,
        });
        if (short.strike < stockCost) {
          short.riskNotes.push(`strike ${fmtNum(short.strike)} below stock cost ${fmtFixed2(stockCost)}`);
        }
        need -= take;
      }
    }

    // b) Longer-dated long calls. Same expiry was already a spread in pass 1.
    while (need > 0) {
      const candidates = longCalls.filter(
        (l) => l.remaining > 0 && normalizeExpiry(l.pos.expiry) > normalizeExpiry(short.expiry),
      );
      if (candidates.length === 0) break;
      const best = minBy(candidates, (l) => pairCost(short, l.pos, true));
      const take = Math.min(need, best.remaining);
      short.allocations.push({ source: COVER_LEAPS, quantity: take, detail: best.pos.description });
      if (short.strike < best.pos.strike) {
        short.riskNotes.push(
          `strike ${fmtNum(short.strike)} below LEAPS strike ${fmtNum(best.pos.strike)} (${best.pos.description})`,
        );
      }
      best.pos.usedQuantity += take;
      best.remaining -= take;
      need -= take;
    }

    remaining.set(short, need);
    short.uncoveredQuantity = need;
  }
}

/** Average purchase price of the long shares of one underlying. */
function weightedAvgCost(stockPool: LongPool[]): number {
  const total = stockPool.reduce((sum, l) => sum + l.pos.quantity, 0);
  if (total <= 0) return 0;
  return stockPool.reduce((sum, l) => sum + (l.pos.avgPrice ?? 0) * l.pos.quantity, 0) / total;
}

/** Draw `shares` from the pool, first entry first. */
function consumeShares(stockPool: LongPool[], shares: number): void {
  let left = shares;
  for (const lot of stockPool) {
    if (left <= 0) break;
    const take = Math.min(left, lot.remaining);
    lot.remaining -= take;
    lot.pos.usedQuantity += take;
    left -= take;
  }
}

// --- Pass 3: short puts secured by cash ------------------------------------

/** strike x multiplier per contract, no leverage: the cash that has to sit in the account. */
function secureShortPuts(shortPuts: AnalyzedPosition[], remaining: Remaining): void {
  for (const short of shortPuts) {
    const need = remaining.get(short) ?? 0;
    if (need <= 0) continue;
    short.requiredCash = short.strike * short.multiplier * need;
    short.allocations.push({ source: COVER_CASH, quantity: need, detail: `${fmtMoney(short.requiredCash)} USD` });
    remaining.set(short, 0);
  }
}
```

- [x] **Étape 3 : `report.ts`**

```ts
import type { Position } from "@ib/ledger";
import { analyze } from "./classify.ts";
import { DETAIL_GROUPS, MAX_STRUCTURE_LOSS, STRUCT_IRON_CONDOR, type DetailGroupId } from "./constants.ts";
import { computeCoverage } from "./coverage.ts";
import { fmtMoney, fmtNum } from "./format.ts";
import type { AnalyzedPosition, RiskReport, Structure } from "./types.ts";

/** Run the coverage engine and wrap the result. The Python properties are the pure functions below. */
export function buildRiskReport(positions: readonly Position[], cashAvailable: number | null): RiskReport {
  const analyzed = positions.map(analyze);
  const structures = computeCoverage(analyzed);
  return { cashAvailable, positions: analyzed, structures };
}

// --- Structure --------------------------------------------------------------

/** Worst case minus credit. The two sides of a condor are not additive. */
export function structureMaxLoss(s: Structure): number {
  return Math.max(s.callRisk, s.putRisk) - s.credit;
}

/** Gross cash needed on the worst side. The credit is already in the account's cash: not netted. */
export function structureAssignmentCash(s: Structure): number {
  return Math.max(s.callRisk, s.putRisk);
}

export function structureOk(s: Structure): boolean {
  return structureMaxLoss(s) <= MAX_STRUCTURE_LOSS;
}

export function structureDescription(s: Structure): string {
  return `${s.symbol} ${s.expiry} ${s.kind}`;
}

// --- Position ---------------------------------------------------------------

/**
 * Capital genuinely at stake, in USD. Market value for everything the
 * account can only lose what it put in; the assignment amount for a short
 * put, i.e. the `requiredCash` the coverage engine computed (0 for a leg
 * of a spread, 0 before coverage ran). `null` when the market value is unknown.
 */
export function riskValue(p: AnalyzedPosition): number | null {
  if (p.kind === "short_put") return p.requiredCash;
  return p.marketValue === null ? null : Math.abs(p.marketValue);
}

// --- Report -----------------------------------------------------------------

export function putCashRequired(report: RiskReport): number {
  return report.positions.reduce((sum, p) => sum + p.requiredCash, 0);
}

export function ironCondors(report: RiskReport): Structure[] {
  return report.structures.filter((s) => s.kind === STRUCT_IRON_CONDOR);
}

/** Gross assignment cash of every condor, never max loss: the credit is already in cashAvailable. */
export function ironCondorCashRequired(report: RiskReport): number {
  return ironCondors(report).reduce((sum, s) => sum + structureAssignmentCash(s), 0);
}

/** Cash-secured puts plus condors: the broker holds the condor's worst case as margin. */
export function cashRequired(report: RiskReport): number {
  return putCashRequired(report) + ironCondorCashRequired(report);
}

/** `null` when the cash is unknown: no verdict, never a false one. */
export function cashOk(report: RiskReport): boolean | null {
  return report.cashAvailable === null ? null : cashRequired(report) <= report.cashAvailable;
}

/** Short options with nothing behind them: unbounded loss. */
export function uncovered(report: RiskReport): AnalyzedPosition[] {
  return report.positions.filter((p) => p.uncoveredQuantity > 0);
}

export function shortStock(report: RiskReport): AnalyzedPosition[] {
  return report.positions.filter((p) => p.kind === "short_stock");
}

export function breaches(report: RiskReport): Structure[] {
  return report.structures.filter((s) => !structureOk(s));
}

/** Covered short calls that would be assigned at a loss. */
export function moderateShortCalls(report: RiskReport): AnalyzedPosition[] {
  return report.positions.filter((p) => p.kind === "short_call" && p.riskNotes.length > 0);
}

/** Every blocking problem, in plain English, as the Python wrote them. */
export function issues(report: RiskReport): string[] {
  const problems: string[] = [];
  for (const pos of uncovered(report)) {
    problems.push(`${pos.description}: ${fmtNum(pos.uncoveredQuantity)} contract(s) not covered - unlimited loss risk`);
  }
  for (const pos of shortStock(report)) {
    problems.push(`${pos.description}: short stock position - unlimited loss risk`);
  }
  if (report.cashAvailable !== null && cashRequired(report) > report.cashAvailable) {
    problems.push(
      `cash required (short puts + iron condors) needs ${fmtMoney(cashRequired(report))} USD ` +
        `but only ${fmtMoney(report.cashAvailable)} USD is available`,
    );
  }
  for (const structure of breaches(report)) {
    problems.push(
      `${structureDescription(structure)}: max loss ${fmtMoney(structureMaxLoss(structure))} USD ` +
        `exceeds the ${fmtMoney(MAX_STRUCTURE_LOSS)} USD limit`,
    );
  }
  return problems;
}

export function isOk(report: RiskReport): boolean {
  return issues(report).length === 0;
}

// --- Grouping ---------------------------------------------------------------

export interface PositionGroup {
  id: DetailGroupId;
  title: string;
  positions: AnalyzedPosition[];
}

/** Split positions into DETAIL_GROUPS, each sorted by description (plain string order, like Python). */
export function groupedPositions(positions: readonly AnalyzedPosition[]): PositionGroup[] {
  const grouped = new Set(DETAIL_GROUPS.flatMap((g) => (g.kinds ? [...g.kinds] : [])));
  return DETAIL_GROUPS.map((group) => {
    const kinds = group.kinds;
    const matched = kinds ? positions.filter((p) => kinds.has(p.kind)) : positions.filter((p) => !grouped.has(p.kind));
    const sorted = [...matched].sort((a, b) => (a.description < b.description ? -1 : a.description > b.description ? 1 : 0));
    return { id: group.id, title: group.title, positions: sorted };
  });
}
```

Ajouter à `index.ts` : `export * from "./coverage.ts";` et `export * from "./report.ts";`.

- [x] **Étape 4 : vérifier et committer**

Run: `pnpm --filter @ib/coverage test && pnpm --filter @ib/coverage typecheck`
Expected: PASS, tous les tests de `coverage.test.ts` verts. Si une chaîne diffère (`detail`, `issues`), corriger le port, jamais le test.

```bash
git add packages/coverage
git commit -m "feat(coverage): moteur de couverture en trois passes et rapport de risque

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LJLvsD7TGEDB8mTSTxfmwy"
```

---

## Tâche 4 : `riskValue`, `groupedPositions` et les trois écarts explicites

**Files:**
- Test: `packages/coverage/src/report.test.ts`, `packages/coverage/src/deviations.test.ts`

**Interfaces:**
- Consumes: tout ce que produisent les tâches 2 et 3.

- [x] **Étape 1 : port du reste de `test_analysis.py`**

`packages/coverage/src/report.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { analyze } from "./classify.ts";
import { DETAIL_GROUPS, KIND_LABELS, POSITION_KINDS, type PositionKind } from "./constants.ts";
import { option, stock } from "./fixtures.ts";
import { buildRiskReport, groupedPositions, riskValue } from "./report.ts";
import type { AnalyzedPosition } from "./types.ts";

describe("riskValue", () => {
  it.each([
    ["long stock", stock({ symbol: "AAPL", marketValue: 15_000 })],
    ["short call", option({ symbol: "AAPL", right: "C", quantity: -1, marketValue: -250 })],
    ["long call", option({ symbol: "AAPL", right: "C", quantity: 1, marketValue: 250 })],
    ["long put", option({ symbol: "AAPL", right: "P", quantity: 1, marketValue: 250 })],
  ])("is the absolute market value for a %s", (_, pos) => {
    const analyzed = analyze(pos);
    expect(riskValue(analyzed)).toBe(Math.abs(analyzed.marketValue ?? Number.NaN));
  });

  it("is the assignment amount of a short put, not its premium", () => {
    const report = buildRiskReport(
      [option({ symbol: "XOM", right: "P", quantity: -1, strike: 100, marketValue: -200 })],
      1_000_000,
    );
    expect(riskValue(report.positions[0])).toBe(10_000);
  });

  it("reuses requiredCash for a short put: the very figure of the headroom card", () => {
    const report = buildRiskReport(
      [option({ symbol: "XOM", right: "P", quantity: -3, strike: 55, marketValue: -600 })],
      1_000_000,
    );
    expect(riskValue(report.positions[0])).toBe(report.positions[0].requiredCash);
    expect(riskValue(report.positions[0])).toBe(55 * 100 * 3);
  });

  it("is zero for a spread-protected short put: the risk shows up as the spread's max loss", () => {
    const report = buildRiskReport(
      [
        option({ symbol: "XYZ", right: "P", quantity: 1, strike: 90, expiry: "2026-03-20" }),
        option({ symbol: "XYZ", right: "P", quantity: -1, strike: 95, expiry: "2026-03-20" }),
      ],
      1_000_000,
    );
    const shortPut = report.positions.find((p) => p.kind === "short_put");
    expect(shortPut?.requiredCash).toBe(0);
    expect(riskValue(shortPut as AnalyzedPosition)).toBe(0);
  });

  it("is zero for a short put before coverage runs", () => {
    expect(riskValue(analyze(option({ symbol: "XOM", right: "P", quantity: -1, strike: 100 })))).toBe(0);
  });
});

function position(description: string, kind: PositionKind, overrides: Partial<AnalyzedPosition> = {}): AnalyzedPosition {
  return {
    description,
    kind,
    label: KIND_LABELS[kind],
    marketValue: -100,
    quantity: -1,
    avgPrice: 2,
    lastPrice: 0.8,
    unrealizedPnl: 120,
    action: "to evaluate",
    decision: "buy back",
    symbol: description.split(" ")[0],
    secType: "OPT",
    right: "C",
    strike: 150,
    expiry: "2026-01-16",
    multiplier: 100,
    allocations: [],
    uncoveredQuantity: 0,
    usedQuantity: 0,
    requiredCash: 0,
    riskNotes: [],
    ...overrides,
  };
}

describe("groupedPositions", () => {
  it("has a group for every kind, the catch-all included", () => {
    const grouped = new Set(DETAIL_GROUPS.flatMap((g) => (g.kinds ? [...g.kinds] : [])));
    expect(DETAIL_GROUPS.some((g) => g.kinds === null)).toBe(true);
    for (const kind of grouped) expect(POSITION_KINDS).toContain(kind);
  });

  it("returns the groups in declared order", () => {
    const groups = groupedPositions([
      position("ZZZZ (STK)", "long_stock"),
      position("AAAA 2026-01-16 C 150", "short_call"),
      position("MMMM 2026-01-16 P 100", "long_put"),
    ]);
    expect(groups.map((g) => g.id)).toEqual(DETAIL_GROUPS.map((g) => g.id));
    expect(groups.map((g) => g.title)).toEqual(DETAIL_GROUPS.map((g) => g.title));
  });

  it("sorts alphabetically within a group", () => {
    const groups = groupedPositions([
      position("ZZZZ 2026-01-16 C 150", "short_call"),
      position("AAAA 2026-01-16 C 150", "short_call"),
      position("MMMM 2026-01-16 P 100", "short_put"),
    ]);
    const sells = groups.find((g) => g.id === "optionSells")?.positions.map((p) => p.description);
    expect(sells).toEqual(["AAAA 2026-01-16 C 150", "MMMM 2026-01-16 P 100", "ZZZZ 2026-01-16 C 150"]);
  });

  it("does not mutate the input list", () => {
    const positions = [position("ZZZZ 2026-01-16 C 150", "short_call"), position("AAAA 2026-01-16 C 150", "short_call")];
    const original = [...positions];
    groupedPositions(positions);
    expect(positions).toEqual(original);
  });

  it("puts unknown kinds in the catch-all group", () => {
    const groups = groupedPositions([position("WEIRD (BOND)", "other"), position("SHRT (STK)", "short_stock")]);
    expect(groups.find((g) => g.id === "other")?.positions.map((p) => p.description)).toEqual(["SHRT (STK)", "WEIRD (BOND)"]);
  });

  it("keeps empty groups", () => {
    const groups = groupedPositions([]);
    expect(groups).toHaveLength(DETAIL_GROUPS.length);
    for (const group of groups) expect(group.positions).toEqual([]);
  });
});
```

- [x] **Étape 2 : les trois écarts (spec §3.3)**

`packages/coverage/src/deviations.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { analyze } from "./classify.ts";
import { option, stock } from "./fixtures.ts";
import { buildRiskReport, cashOk, isOk, issues, riskValue } from "./report.ts";

// Spec §3.3: the Python engine only ever saw numbers. Here an absent figure
// stays null on the way out, and counts as 0 only where the engine has to
// compute with it. Oracle fixtures never contain a null: these cases are
// covered here and nowhere else.
describe("null inputs (deviation 2)", () => {
  it("passes null display fields through analyze untouched", () => {
    const result = analyze(option({ marketValue: null, avgPrice: null, marketPrice: null, unrealizedPnl: null }));
    expect(result).toMatchObject({ marketValue: null, avgPrice: null, lastPrice: null, unrealizedPnl: null });
  });

  it("keeps a short option with no known sale price, rather than advising a trade", () => {
    expect(analyze(option({ avgPrice: null, marketPrice: 0 })).decision).toBe("keep");
    expect(analyze(option({ avgPrice: 2, marketPrice: null })).decision).toBe("buy back");
  });

  it("counts an unknown premium as 0 in a structure's credit", () => {
    const report = buildRiskReport(
      [
        option({ symbol: "XYZ", expiry: "2026-03-20", right: "C", strike: 105, quantity: -1, avgPrice: null }),
        option({ symbol: "XYZ", expiry: "2026-03-20", right: "C", strike: 110, quantity: 1, avgPrice: 1 }),
      ],
      0,
    );
    expect(report.structures[0].credit).toBe(-100);
  });

  it("counts an unknown stock cost as 0: the cover is detailed at 0.00 and no risk note is raised", () => {
    const report = buildRiskReport(
      [stock({ symbol: "AAPL", quantity: 100, avgPrice: null }), option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150 })],
      0,
    );
    const short = report.positions.find((p) => p.kind === "short_call");
    expect(short?.allocations[0].detail).toBe("100 shares @ 0.00");
    expect(short?.riskNotes).toEqual([]);
  });

  it("has no risk value for a long position without market value", () => {
    expect(riskValue(analyze(stock({ marketValue: null })))).toBeNull();
    expect(riskValue(analyze(option({ right: "P", quantity: -1, marketValue: null })))).toBe(0);
  });
});

describe("unknown cash (deviation 3)", () => {
  it("gives no cash verdict and no cash issue, whatever the short puts", () => {
    const report = buildRiskReport([option({ symbol: "AAPL", right: "P", quantity: -3, strike: 100 })], null);
    expect(report.cashAvailable).toBeNull();
    expect(cashOk(report)).toBeNull();
    expect(issues(report)).toEqual([]);
    expect(isOk(report)).toBe(true);
  });

  it("still reports the other problems", () => {
    const report = buildRiskReport([option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150 })], null);
    expect(issues(report)).toEqual(["AAPL 2026-01-16 C 150: 1 contract(s) not covered - unlimited loss risk"]);
  });
});
```

- [x] **Étape 3 : vérifier et committer**

Run: `pnpm --filter @ib/coverage test`
Expected: PASS. Compter les tests : `pnpm --filter @ib/coverage test 2>&1 | grep -E "Tests"` doit annoncer au moins 115 tests entre `classify`, `analyze`, `coverage`, `report` (les paramétrés comptent un par cas, comme en Python).

```bash
git add packages/coverage
git commit -m "test(coverage): risk value, groupes et les trois écarts explicites du port

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LJLvsD7TGEDB8mTSTxfmwy"
```

---

## Tâche 5 : `ib-parsers`, Open Positions et Cash Report

**Files:**
- Modify: `packages/ib-parsers/src/flex.ts`, `packages/ib-parsers/package.json` (rien à ajouter : `@ib/ledger` y est déjà)
- Test: `packages/ib-parsers/src/flex.test.ts`

**Interfaces:**
- Consumes: `Position` (`@ib/ledger`), `attr`, `parseNumber`, `flexDateToIsoDay`, `NormalizationError`, `warning`, `error`.
- Produces: `FlexSnapshot { asOf: string; positions: Position[]; cashAvailable: number | null }` ; `FlexParseResult` gagne `snapshot: FlexSnapshot | null`.

- [x] **Étape 1 : tests**

Dans `packages/ib-parsers/src/flex.test.ts`, ajouter après les constantes existantes :

```ts
const STOCK_POSITION =
  '<OpenPosition accountId="U0000001" currency="USD" fxRateToBase="1" assetCategory="STK" subCategory="COMMON" symbol="SYMA" description="SYMA HOLDINGS INC" conid="123" listingExchange="NASDAQ" underlyingSymbol="SYMA" multiplier="1" strike="" expiry="" putCall="" reportDate="20260902" position="200" markPrice="3.43" positionValue="686" openPrice="4.2" costBasisPrice="4.2" costBasisMoney="840" percentOfNAV="8.66" fifoPnlUnrealized="-154" side="Long" levelOfDetail="SUMMARY" />';
const OPTION_POSITION =
  '<OpenPosition accountId="U0000001" currency="USD" fxRateToBase="1" assetCategory="OPT" subCategory="C" symbol="SYMB  280121C00002500" description="SYMB 21JAN28 2.5 C" conid="456" listingExchange="CBOE" underlyingConid="789" underlyingSymbol="SYMB" multiplier="100" strike="2.5" expiry="20280121" putCall="C" reportDate="20260902" position="-2" markPrice="0.4982" positionValue="-99.64" openPrice="1.1" costBasisPrice="1.1" costBasisMoney="-220" percentOfNAV="-2.31" fifoPnlUnrealized="120.36" side="Short" levelOfDetail="SUMMARY" />';
const LOT_POSITION = STOCK_POSITION.replace('levelOfDetail="SUMMARY"', 'levelOfDetail="LOT"').replace('position="200"', 'position="50"');
const CASH_REPORT =
  '<CashReport><CashReportCurrency accountId="U0000001" currency="BASE_SUMMARY" levelOfDetail="BaseCurrency" fromDate="20250903" toDate="20260902" startingCash="1000" endingCash="9999.99" endingSettledCash="9999.99" /><CashReportCurrency accountId="U0000001" currency="USD" levelOfDetail="Currency" fromDate="20250903" toDate="20260902" startingCash="1000" endingCash="12345.67" endingSettledCash="12000" /></CashReport>';
const CASH_REPORT_EUR_ONLY = CASH_REPORT.replace('currency="USD"', 'currency="EUR"');
/** Every section the history and the positions need, with no row in the history ones. */
const COMPLETE = `<Trades/><CashTransactions/><OpenPositions>${STOCK_POSITION}${OPTION_POSITION}</OpenPositions>${CASH_REPORT}`;
```

Puis un nouveau bloc `describe` :

```ts
describe("parseFlexXml: open positions and cash report", () => {
  it("reads the open positions into a snapshot dated by reportDate", () => {
    const { snapshot, issues } = parseFlexXml(flex(COMPLETE), TARGET);
    expect(issues).toEqual([]);
    expect(snapshot?.asOf).toBe("2026-09-02");
    expect(snapshot?.positions[0]).toEqual({
      symbol: "SYMA",
      secType: "STK",
      right: "",
      strike: null,
      expiry: null,
      multiplier: 1,
      quantity: 200,
      avgPrice: 4.2,
      marketPrice: 3.43,
      marketValue: 686,
      unrealizedPnl: -154,
      currency: "USD",
      conid: "123",
      description: "SYMA HOLDINGS INC",
    });
  });

  it("keys an option on its underlying, with its contract and a per-unit cost basis", () => {
    const { snapshot } = parseFlexXml(flex(COMPLETE), TARGET);
    expect(snapshot?.positions[1]).toEqual({
      symbol: "SYMB",
      secType: "OPT",
      right: "C",
      strike: 2.5,
      expiry: "2028-01-21",
      multiplier: 100,
      quantity: -2,
      avgPrice: 1.1,
      marketPrice: 0.4982,
      marketValue: -99.64,
      unrealizedPnl: 120.36,
      currency: "USD",
      conid: "456",
      description: "SYMB 21JAN28 2.5 C",
    });
  });

  it("ignores LOT rows: a lot would double the summary's quantity", () => {
    const body = `<Trades/><CashTransactions/><OpenPositions>${STOCK_POSITION}${LOT_POSITION}</OpenPositions>${CASH_REPORT}`;
    const { snapshot } = parseFlexXml(flex(body), TARGET);
    expect(snapshot?.positions.map((p) => p.quantity)).toEqual([200]);
  });

  it("dates an empty Open Positions section by the statement's toDate", () => {
    const { snapshot } = parseFlexXml(flex(`<Trades/><CashTransactions/><OpenPositions/>${CASH_REPORT}`), TARGET);
    expect(snapshot).toEqual({ asOf: "2026-09-02", positions: [], cashAvailable: 12345.67 });
  });

  it("has no snapshot without an Open Positions section, and says so", () => {
    const result = parseFlexXml(flex(`<Trades/><CashTransactions/>${CASH_REPORT}`), TARGET);
    expect(result.snapshot).toBeNull();
    expect(result.issues).toEqual([{ severity: "warning", code: "section-missing", detail: "Open Positions" }]);
  });

  it("reads the USD ending cash of the Cash Report, never the base summary", () => {
    expect(parseFlexXml(flex(COMPLETE), TARGET).snapshot?.cashAvailable).toBe(12345.67);
  });

  it("leaves the cash unknown when the Cash Report has no USD line", () => {
    const body = `<Trades/><CashTransactions/><OpenPositions>${STOCK_POSITION}</OpenPositions>${CASH_REPORT_EUR_ONLY}`;
    const result = parseFlexXml(flex(body), TARGET);
    expect(result.snapshot?.cashAvailable).toBeNull();
    expect(result.issues).toEqual([{ severity: "warning", code: "currency-missing", detail: "Cash Report: USD" }]);
  });

  it("leaves the cash unknown when the Cash Report section is absent", () => {
    const body = `<Trades/><CashTransactions/><OpenPositions>${STOCK_POSITION}</OpenPositions>`;
    const result = parseFlexXml(flex(body), TARGET);
    expect(result.snapshot?.cashAvailable).toBeNull();
    expect(result.issues).toEqual([{ severity: "warning", code: "section-missing", detail: "Cash Report" }]);
  });

  it("reports an Open Positions column missing from the query definition", () => {
    const bare = STOCK_POSITION.replace(' markPrice="3.43"', "");
    const body = `<Trades/><CashTransactions/><OpenPositions>${bare}</OpenPositions>${CASH_REPORT}`;
    const result = parseFlexXml(flex(body), TARGET);
    expect(result.snapshot?.positions[0].marketPrice).toBeNull();
    expect(result.issues).toEqual([{ severity: "warning", code: "column-missing", detail: "Open Positions: markPrice" }]);
  });

  it("checks the option columns on option rows only", () => {
    const noStrike = OPTION_POSITION.replace(' strike="2.5"', "");
    const stockNoStrike = STOCK_POSITION.replace(' strike=""', "");
    const body = `<Trades/><CashTransactions/><OpenPositions>${stockNoStrike}${noStrike}</OpenPositions>${CASH_REPORT}`;
    expect(parseFlexXml(flex(body), TARGET).issues).toEqual([
      { severity: "warning", code: "column-missing", detail: "Open Positions: strike" },
    ]);
  });

  it("cancels everything on an open position without quantity", () => {
    const noQuantity = STOCK_POSITION.replace(' position="200"', "");
    const body = `<Trades/><CashTransactions/><OpenPositions>${noQuantity}</OpenPositions>${CASH_REPORT}`;
    const result = parseFlexXml(flex(body), TARGET);
    expect(result.snapshot).toBeNull();
    expect(result.transactions).toEqual([]);
    expect(result.issues[0]).toMatchObject({ severity: "error", code: "normalization" });
  });
});
```

Mettre à jour les tests existants que la section Cash Report rend bruyants :

- « reports missing sections as warnings » attend désormais trois avertissements : `Cash Transactions`, `Open Positions`, `Cash Report`.
- « reports a money column missing… », « does not flag option columns… », « flags option columns missing… », « warns that a Transfers section… » : ajouter `${CASH_REPORT}` après `<OpenPositions/>` dans le corps, pour que seule l'anomalie testée reste.

**Et, dans `apps/web/src/pages/SourcesPage.test.tsx`** (test « imports a Flex file and shows the
report… ») : la section `Cash Report` désormais vérifiée fait que l'**ancienne** fixture rapporte
deux sections absentes, et `getByText("Section absente")` lève sur plusieurs correspondances.
Remplacer ces deux lignes par :

```ts
    expect(within(report).getAllByText("Section absente")).toHaveLength(2);
    expect(within(report).getByText("Open Positions")).toBeInTheDocument();
    expect(within(report).getByText("Cash Report")).toBeInTheDocument();
```

La tâche 6 les remplacera par « aucune section absente » quand la fixture portera les deux
sections. Aucune tâche ne laisse la suite rouge.

Run: `pnpm --filter @ib/ib-parsers test`
Expected: FAIL sur `snapshot` inexistant.

- [x] **Étape 2 : implémentation dans `flex.ts`**

Types et imports :

```ts
import type { Position, Transaction, TransactionKind } from "@ib/ledger";

/** Open Positions and the USD cash of the same file, as of the close of `asOf`. */
export interface FlexSnapshot {
  /** YYYY-MM-DD: the reportDate of the rows, the statement's toDate when there is none. */
  asOf: string;
  positions: Position[];
  /** `endingCash` of the USD line of the Cash Report; `null` when absent. */
  cashAvailable: number | null;
}

export interface FlexParseResult extends ParseResult<FlexStatementInfo> {
  snapshot: FlexSnapshot | null;
}
```

Colonnes surveillées, à côté de `OPTION_TRADE_COLUMNS` :

```ts
const POSITION_COLUMNS = ["position", "markPrice", "positionValue", "costBasisPrice", "fifoPnlUnrealized", "multiplier"] as const;
const OPTION_POSITION_COLUMNS = ["strike", "expiry", "putCall", "underlyingSymbol"] as const;
```

Dans `parseFlexXml`, chaque `return` anticipé ajoute `snapshot: null`. Le bloc principal devient :

```ts
  try {
    const transactions = [
      ...parseTrades(statementEl, target, issues),
      ...parseCashTransactions(statementEl, target, issues),
      ...parseCorporateActions(statementEl, target),
    ];
    const snapshot = parseSnapshot(statementEl, statement, issues);
    checkSections(statementEl, issues);
    return { transactions, statement, snapshot, issues };
  } catch (e) {
    if (e instanceof NormalizationError) {
      return { transactions: [], statement, snapshot: null, issues: [...issues, error("normalization", e.message)] };
    }
    throw e;
  }
```

Nouvelles fonctions :

```ts
function parseSnapshot(statementEl: Element, statement: FlexStatementInfo, issues: ParseIssue[]): FlexSnapshot | null {
  const open = section(statementEl, "OpenPositions");
  if (!open) return null;
  // A LOT row repeats part of its SUMMARY row's quantity: read summaries only.
  const rows = children(open, "OpenPosition").filter((el) => (attr(el, "levelOfDetail") ?? "SUMMARY") === "SUMMARY");
  const positions = rows.map((el) => parseOpenPosition(el));
  reportMissingColumns("Open Positions", rows, POSITION_COLUMNS, issues);
  reportMissingColumns(
    "Open Positions",
    rows.filter((el) => isOptionCategory(attr(el, "assetCategory"))),
    OPTION_POSITION_COLUMNS,
    issues,
  );
  const asOf = rows.length > 0 ? flexDateToIsoDay(attr(rows[0], "reportDate")) : null;
  return { asOf: asOf ?? statement.toDate, positions, cashAvailable: parseCashReport(statementEl, issues) };
}

function isOptionCategory(category: string | null): boolean {
  return category === "OPT" || category === "FOP";
}

function parseOpenPosition(el: Element): Position {
  const category = attr(el, "assetCategory") ?? "";
  const symbol = attr(el, "symbol") ?? "";
  const what = `open position ${symbol}`;
  const quantity = parseNumber(attr(el, "position"), `${what} position`);
  if (quantity === null) throw new NormalizationError(`Open position without quantity (${symbol})`);
  const putCall = attr(el, "putCall");
  return {
    // Coverage groups by underlying: an option's own symbol is the packed OCC one.
    symbol: isOptionCategory(category) ? attr(el, "underlyingSymbol") || symbol : symbol,
    secType: category,
    right: putCall === "C" || putCall === "P" ? putCall : "",
    strike: parseNumber(attr(el, "strike"), `${what} strike`),
    expiry: flexDateToIsoDay(attr(el, "expiry")),
    multiplier: parseNumber(attr(el, "multiplier"), `${what} multiplier`),
    quantity,
    // costBasisPrice is already per unit (per share, per unit of underlying).
    avgPrice: parseNumber(attr(el, "costBasisPrice"), `${what} costBasisPrice`),
    marketPrice: parseNumber(attr(el, "markPrice"), `${what} markPrice`),
    marketValue: parseNumber(attr(el, "positionValue"), `${what} positionValue`),
    unrealizedPnl: parseNumber(attr(el, "fifoPnlUnrealized"), `${what} fifoPnlUnrealized`),
    currency: attr(el, "currency") ?? "",
    conid: attr(el, "conid") ?? "",
    description: attr(el, "description") ?? "",
  };
}

/** The USD line of the Cash Report: `endingCash` is TWS's TotalCashBalance at the close. */
function parseCashReport(statementEl: Element, issues: ParseIssue[]): number | null {
  const report = section(statementEl, "CashReport");
  if (!report) return null; // checkSections reports it
  const usd = children(report, "CashReportCurrency").find(
    (el) => attr(el, "currency") === "USD" && (attr(el, "levelOfDetail") ?? "Currency") === "Currency",
  );
  if (!usd) {
    issues.push(warning("currency-missing", "Cash Report: USD"));
    return null;
  }
  reportMissingColumns("Cash Report", [usd], ["endingCash"], issues);
  return parseNumber(attr(usd, "endingCash"), "cash report endingCash");
}
```

`checkSections` gagne `["CashReport", "Cash Report"]` dans `required`, après Open Positions.

- [x] **Étape 3 : vérifier et committer**

Run: `pnpm --filter @ib/ib-parsers test && pnpm --filter @ib/ib-parsers typecheck && pnpm --filter web test && pnpm --filter web typecheck`
Expected: PASS. Les tests d'`apps/web` sont bien lancés ici : c'est eux que la nouvelle section
`Cash Report` fait bouger.

```bash
git add packages/ib-parsers
git commit -m "feat(ib-parsers): Open Positions et Cash Report du Flex en snapshot

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LJLvsD7TGEDB8mTSTxfmwy"
```

---

## Tâche 6 : fixture Flex régénérée avec les deux nouvelles sections

**Files:**
- Modify: `packages/ib-parsers/scripts/anonymize-flex.mjs`, `packages/ib-parsers/tests/fixtures/flex_activity_sample.xml`, `packages/ib-parsers/src/flex.fixture.test.ts`, `apps/web/src/pages/SourcesPage.test.tsx`

- [x] **Étape 1 : Cash Report dans le script d'anonymisation**

Dans `anonymize-flex.mjs`, renommer la constante `MONEY` en `MONEY_COLUMNS`, puis insérer **avant l'étape 9** :

```js
// 8b. Cash Report. Every numeric attribute of a CashReportCurrency row is a money
// figure (starting/ending cash, deposits, commissions, dividends, interest…), except
// its two dates. Their names are collected from the file rather than listed here, so
// a column IB adds tomorrow is scrubbed too.
const cashReportMoney = new Set();
for (const [, attrs] of xml.matchAll(/<CashReportCurrency ([^>]*)\/>/g)) {
  for (const [, name] of attrs.matchAll(/ ?([A-Za-z]+)="-?\d[\d.]*"/g)) {
    if (name !== "fromDate" && name !== "toDate") cashReportMoney.add(name);
  }
}
const MONEY = [...MONEY_COLUMNS, ...cashReportMoney];
```

Vérifier que l'étape 9 lit bien `MONEY` (elle le fait déjà par ce nom).

- [x] **Étape 2 : régénérer la fixture**

```bash
node packages/ib-parsers/scripts/anonymize-flex.mjs private/flex_<compte>_<date>.xml > packages/ib-parsers/tests/fixtures/flex_activity_sample.xml
grep -c "<OpenPosition " packages/ib-parsers/tests/fixtures/flex_activity_sample.xml   # 30
grep -c "<CashReportCurrency " packages/ib-parsers/tests/fixtures/flex_activity_sample.xml   # 3
```

- [x] **Étape 3 : contrôle manuel de l'anonymisation (obligatoire avant commit)**

```bash
node -e '
const fs = require("fs");
const fixture = fs.readFileSync("packages/ib-parsers/tests/fixtures/flex_activity_sample.xml", "utf8");
const real = fs.readFileSync("private/flex_<compte>_<date>.xml", "utf8");
const values = new Set(
  [...fixture.matchAll(/ ([A-Za-z]+)="(-?\d+\.\d+|-?\d{4,})"/g)]
    .filter((m) => !/Date|conid|multiplier|expiry|fxRateToBase/.test(m[1]))
    .map((m) => m[2]),
);
const leaks = [...values].filter((v) => real.includes(`="${v}"`));
console.log(leaks.length ? `LEAKS: ${leaks.join(" ")}` : "no numeric value of the fixture appears in the real file");
'
grep -o 'accountId="[^"]*"' packages/ib-parsers/tests/fixtures/flex_activity_sample.xml | sort -u   # U0000001 seulement
grep -c 'isin="XX0000000000"\|isin=""' packages/ib-parsers/tests/fixtures/flex_activity_sample.xml
grep -o 'underlyingSymbol="[^"]*"' packages/ib-parsers/tests/fixtures/flex_activity_sample.xml | sort -u   # SYMn ou vide
```

Lire aussi à l'œil les trois lignes `CashReportCurrency` et deux lignes `OpenPosition` de la fixture : aucun nom de société réel dans `description` (les mots de quatre lettres et plus sont `ANON`), aucun `conid`, `isin`, `cusip`, `figi`. Si une fuite apparaît, corriger le script, régénérer, recontrôler. Ne pas committer avant.

- [x] **Étape 4 : tests sur la fixture**

Dans `packages/ib-parsers/src/flex.fixture.test.ts`, remplacer le test « reports the sections the real query does not export yet » par :

```ts
  it("reads every section the pages need: no section is missing any more", () => {
    expect(result.issues.filter((i) => i.code === "section-missing")).toEqual([]);
  });

  it("reads the open positions and the USD cash into a snapshot", () => {
    expect(result.snapshot?.asOf).toBe("2026-09-02");
    expect(result.snapshot?.positions).toHaveLength(30);
    expect(result.snapshot?.positions.filter((p) => p.secType === "OPT")).toHaveLength(24);
    expect(result.snapshot?.positions.filter((p) => p.secType === "STK")).toHaveLength(6);
    expect(result.snapshot?.cashAvailable).toBeGreaterThan(0);
  });

  it("keys every option position on a bare underlying with a full contract", () => {
    for (const p of result.snapshot?.positions.filter((p) => p.secType === "OPT") ?? []) {
      expect(p.symbol).toMatch(/^SYM\d+$/);
      expect(p.strike).not.toBeNull();
      expect(p.expiry).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.right === "C" || p.right === "P").toBe(true);
      expect(p.quantity).not.toBe(0);
    }
  });
```

Dans `apps/web/src/pages/SourcesPage.test.tsx`, test « imports a Flex file and shows the report… » : remplacer les deux lignes `Section absente` / `Open Positions` par
`expect(within(report).queryByText("Section absente")).not.toBeInTheDocument();`.

Run: `pnpm check`
Expected: PASS.

- [x] **Étape 5 : commit**

```bash
git add packages/ib-parsers apps/web/src/pages/SourcesPage.test.tsx
git commit -m "test(ib-parsers): fixture Flex régénérée avec Open Positions et Cash Report

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LJLvsD7TGEDB8mTSTxfmwy"
```

---

## Tâche 7 : oracle Python gelé, corpus synthétique, fixtures d'oracle

**Files:**
- Create: `tools/coverage-oracle/pyproject.toml`, `tools/coverage-oracle/.python-version`, `tools/coverage-oracle/README.md`, `tools/coverage-oracle/engine/ib_analysis/__init__.py`, `tools/coverage-oracle/engine/tests/{conftest.py,test_analysis.py,test_classification.py,test_coverage.py}`, `tools/coverage-oracle/generate.py`, `tools/coverage-oracle/corpus/*.json`, `packages/coverage/tests/oracle/*.json`
- Modify: `package.json` (script `oracle`)
- Test: `packages/coverage/src/oracle.test.ts`

**Interfaces:**
- Consumes: `buildRiskReport` ; le format `Position`.
- Produces: `tools/coverage-oracle/corpus/<nom>.json` = `{ positions: CorpusPosition[], cashAvailable: number }` où `CorpusPosition` est un `Position` dont `generate.py` complète les champs absents (`multiplier` 100 pour OPT/FOP et 1 sinon, `unrealizedPnl` 0, `currency` "USD", `conid` "", `description` "", `right` "", `strike` null, `expiry` null) ; `packages/coverage/tests/oracle/<nom>.json` = `{ input: { positions: Position[], cashAvailable }, expected: RiskReport }`.

- [x] **Étape 1 : copier le moteur et ses tests**

Reprendre `ib_analysis/__init__.py` et ses 115 tests de la première version dans
`tools/coverage-oracle/engine/`, puis :

```bash
echo "3.14" > tools/coverage-oracle/.python-version
```

`tools/coverage-oracle/pyproject.toml` :

```toml
[project]
name = "coverage-oracle"
version = "0.0.0"
description = "Frozen Python coverage engine of the first version, used only to generate the oracle fixtures of packages/coverage."
requires-python = ">=3.14"
dependencies = []

[dependency-groups]
dev = ["pytest>=8"]

[tool.uv]
package = false

[tool.pytest.ini_options]
testpaths = ["engine/tests"]
pythonpath = ["engine", "engine/tests"]
```

`tools/coverage-oracle/README.md` :

```markdown
# coverage-oracle

Copie **gelée** de `ib_analysis` (moteur de la première version) et de ses 115 tests. Ne suit
jamais une évolution du métier : le moteur vivant est `packages/coverage`, en TypeScript.

Sert uniquement à produire les fixtures d'oracle que `packages/coverage/src/oracle.test.ts`
compare à l'identique :

    pnpm oracle          # depuis la racine : extrait le corpus Flex, puis régénère tests/oracle/*.json
    uv run pytest -q     # ici : les 115 tests Python, pour prouver que la copie est intacte

Corpus : `corpus/*.json`, un portefeuille par famille de couverture, plus `flex-sample.json`
extrait de la fixture Flex anonymisée. `pnpm check` ne lance jamais de Python.
```

```bash
cd tools/coverage-oracle && uv sync && uv run pytest -q
```

Expected: `115 passed`. `uv.lock` est créé ; il est committé.

- [x] **Étape 2 : `generate.py`**

```python
#!/usr/bin/env python3
"""Turn every corpus/*.json into an oracle fixture for packages/coverage.

Reads positions in the TS `Position` shape, feeds them to the frozen Python
engine, and writes `{input, expected}` in the TS `RiskReport` shape: camelCase
keys, YYYY-MM-DD expiries. Every conversion lives here; the engine is untouched.
"""

from __future__ import annotations

import json
import math
import sys
from dataclasses import asdict
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "engine"))

import ib_analysis as an  # noqa: E402

CORPUS = HERE / "corpus"
OUT = HERE.parent.parent / "packages" / "coverage" / "tests" / "oracle"

DEFAULTS = {
    "right": "",
    "strike": None,
    "expiry": None,
    "unrealizedPnl": 0,
    "currency": "USD",
    "conid": "",
    "description": "",
}


def complete(p: dict) -> dict:
    """A corpus position with every `Position` field present."""
    full = {**DEFAULTS, **p}
    if "multiplier" not in full:
        full["multiplier"] = 100 if full["secType"] in ("OPT", "FOP") else 1
    return full


def average_cost_for(avg_price: float, multiplier: float) -> float:
    """The per-contract averageCost whose division by `multiplier` in analyze()
    gives back exactly `avg_price`: TS reads the per-unit price directly, so the
    round trip must not move a single bit."""
    candidate = avg_price * multiplier
    for _ in range(64):
        if candidate / multiplier == avg_price:
            return candidate
        direction = math.inf if candidate / multiplier < avg_price else -math.inf
        candidate = math.nextafter(candidate, direction)
    raise SystemExit(f"no averageCost reproduces avgPrice={avg_price!r} with multiplier={multiplier!r}")


def to_item(p: dict) -> SimpleNamespace:
    contract = SimpleNamespace(
        secType=p["secType"],
        symbol=p["symbol"],
        right=p["right"],
        strike=p["strike"],
        lastTradeDateOrContractMonth=(p["expiry"] or "").replace("-", ""),
        multiplier=p["multiplier"],
    )
    item = SimpleNamespace(
        contract=contract,
        position=p["quantity"],
        marketPrice=p["marketPrice"],
        marketValue=p["marketValue"],
        averageCost=p["avgPrice"],
        unrealizedPNL=p["unrealizedPnl"],
    )
    if contract.secType in ("OPT", "FOP"):
        item.averageCost = average_cost_for(p["avgPrice"], an.contract_multiplier(item))
    return item


def camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.capitalize() for part in rest)


def dashed(expiry: str) -> str:
    return f"{expiry[:4]}-{expiry[4:6]}-{expiry[6:]}" if len(expiry) == 8 and expiry.isdigit() else expiry


def position_out(pos: an.AnalyzedPosition) -> dict:
    data = {camel(k): v for k, v in asdict(pos).items()}
    data["expiry"] = dashed(pos.expiry)
    data["allocations"] = [asdict(a) for a in pos.allocations]
    return data


def structure_out(s: an.Structure) -> dict:
    data = {camel(k): v for k, v in asdict(s).items()}
    data["expiry"] = dashed(s.expiry)
    return data


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for path in sorted(CORPUS.glob("*.json")):
        corpus = json.loads(path.read_text())
        positions_in = [complete(p) for p in corpus["positions"]]
        analyzed = [an.analyze(to_item(p)) for p in positions_in]
        report = an.build_risk_report(analyzed, corpus["cashAvailable"])
        fixture = {
            "input": {"positions": positions_in, "cashAvailable": corpus["cashAvailable"]},
            "expected": {
                "cashAvailable": report.cash_available,
                "positions": [position_out(p) for p in report.positions],
                "structures": [structure_out(s) for s in report.structures],
            },
        }
        (OUT / path.name).write_text(json.dumps(fixture, indent=2, sort_keys=True, allow_nan=False) + "\n")
        print(f"{path.name}: {len(analyzed)} positions, {len(report.structures)} structures, ok={report.ok}")


if __name__ == "__main__":
    main()
```

- [x] **Étape 3 : corpus synthétique**

Chaque fichier dans `tools/coverage-oracle/corpus/`. Une position par ligne ; `avgPrice` par unité.

`empty.json` :
```json
{ "positions": [], "cashAvailable": 0 }
```

`stock-covered-calls.json` (300 actions, 4 calls : 3 couverts, 1 nu ; strike sous le coût) :
```json
{
  "positions": [
    { "symbol": "AAPL", "secType": "STK", "quantity": 300, "avgPrice": 165, "marketPrice": 150, "marketValue": 45000, "unrealizedPnl": -4500 },
    { "symbol": "AAPL", "secType": "OPT", "right": "C", "strike": 150, "expiry": "2026-01-16", "quantity": -4, "avgPrice": 2.5, "marketPrice": 1, "marketValue": -400 }
  ],
  "cashAvailable": 50000
}
```

`leaps-covered-calls.json` (un LEAPS consommé par le premier call, le second reste nu ; strike sous celui du LEAPS) :
```json
{
  "positions": [
    { "symbol": "AAPL", "secType": "OPT", "right": "C", "strike": 160, "expiry": "2028-01-19", "quantity": 1, "avgPrice": 35, "marketPrice": 40, "marketValue": 4000 },
    { "symbol": "AAPL", "secType": "OPT", "right": "C", "strike": 150, "expiry": "2026-01-16", "quantity": -1, "avgPrice": 2, "marketPrice": 0.8, "marketValue": -80 },
    { "symbol": "AAPL", "secType": "OPT", "right": "C", "strike": 155, "expiry": "2026-02-20", "quantity": -1, "avgPrice": 3, "marketPrice": 3.1, "marketValue": -310 }
  ],
  "cashAvailable": 10000
}
```

`stock-and-leaps.json` (3 vendus, 100 actions, 2 LEAPS : les deux sources servent) :
```json
{
  "positions": [
    { "symbol": "MSFT", "secType": "STK", "quantity": 100, "avgPrice": 300, "marketPrice": 420, "marketValue": 42000, "unrealizedPnl": 12000 },
    { "symbol": "MSFT", "secType": "OPT", "right": "C", "strike": 350, "expiry": "2027-01-15", "quantity": 2, "avgPrice": 90, "marketPrice": 95, "marketValue": 19000 },
    { "symbol": "MSFT", "secType": "OPT", "right": "C", "strike": 450, "expiry": "2026-03-20", "quantity": -3, "avgPrice": 6.1, "marketPrice": 6.2, "marketValue": -1860 }
  ],
  "cashAvailable": 10000
}
```

`cash-secured-puts-ok.json` :
```json
{
  "positions": [
    { "symbol": "AAPL", "secType": "OPT", "right": "P", "strike": 100, "expiry": "2026-03-20", "quantity": -2, "avgPrice": 4.2, "marketPrice": 1.75, "marketValue": -350 },
    { "symbol": "MSFT", "secType": "OPT", "right": "P", "strike": 300, "expiry": "2026-04-17", "quantity": -1, "avgPrice": 8, "marketPrice": 9, "marketValue": -900 }
  ],
  "cashAvailable": 100000
}
```

`cash-secured-puts-short.json` : mêmes positions, `"cashAvailable": 25000`.

`iron-condor-ok.json` :
```json
{
  "positions": [
    { "symbol": "XYZ", "secType": "OPT", "right": "P", "strike": 90, "expiry": "2026-03-20", "quantity": 1, "avgPrice": 1, "marketPrice": 0.5, "marketValue": 50 },
    { "symbol": "XYZ", "secType": "OPT", "right": "P", "strike": 95, "expiry": "2026-03-20", "quantity": -1, "avgPrice": 2, "marketPrice": 1, "marketValue": -100 },
    { "symbol": "XYZ", "secType": "OPT", "right": "C", "strike": 105, "expiry": "2026-03-20", "quantity": -1, "avgPrice": 2, "marketPrice": 1.5, "marketValue": -150 },
    { "symbol": "XYZ", "secType": "OPT", "right": "C", "strike": 110, "expiry": "2026-03-20", "quantity": 1, "avgPrice": 1, "marketPrice": 0.75, "marketValue": 75 }
  ],
  "cashAvailable": 10000
}
```

`iron-condor-breach.json` : même chose avec le put long à `"strike": 75` et `"quantity"` des quatre jambes à 2 / -2 / -2 / 2.

`vertical-spreads.json` (call spread sur XYZ, put spread sur ABC, spread débiteur protecteur sur DEF) :
```json
{
  "positions": [
    { "symbol": "XYZ", "secType": "OPT", "right": "C", "strike": 105, "expiry": "2026-03-20", "quantity": -1, "avgPrice": 2, "marketPrice": 1, "marketValue": -100 },
    { "symbol": "XYZ", "secType": "OPT", "right": "C", "strike": 110, "expiry": "2026-03-20", "quantity": 1, "avgPrice": 1, "marketPrice": 0.5, "marketValue": 50 },
    { "symbol": "ABC", "secType": "OPT", "right": "P", "strike": 95, "expiry": "2026-03-20", "quantity": -1, "avgPrice": 2, "marketPrice": 1, "marketValue": -100 },
    { "symbol": "ABC", "secType": "OPT", "right": "P", "strike": 90, "expiry": "2026-03-20", "quantity": 1, "avgPrice": 1, "marketPrice": 0.5, "marketValue": 50 },
    { "symbol": "DEF", "secType": "OPT", "right": "C", "strike": 150, "expiry": "2026-03-20", "quantity": -1, "avgPrice": 2, "marketPrice": 1, "marketValue": -100 },
    { "symbol": "DEF", "secType": "OPT", "right": "C", "strike": 100, "expiry": "2026-03-20", "quantity": 1, "avgPrice": 45, "marketPrice": 50, "marketValue": 5000 }
  ],
  "cashAvailable": 0
}
```

`partial-condor.json` : `iron-condor-ok.json` sans la jambe C 110.

`tightest-protection.json` :
```json
{
  "positions": [
    { "symbol": "XYZ", "secType": "OPT", "right": "C", "strike": 100, "expiry": "2026-03-20", "quantity": -1, "avgPrice": 0, "marketPrice": 0, "marketValue": 0 },
    { "symbol": "XYZ", "secType": "OPT", "right": "C", "strike": 200, "expiry": "2026-03-20", "quantity": -1, "avgPrice": 0, "marketPrice": 0, "marketValue": 0 },
    { "symbol": "XYZ", "secType": "OPT", "right": "C", "strike": 105, "expiry": "2026-03-20", "quantity": 1, "avgPrice": 0, "marketPrice": 0, "marketValue": 0 },
    { "symbol": "XYZ", "secType": "OPT", "right": "C", "strike": 205, "expiry": "2026-03-20", "quantity": 1, "avgPrice": 0, "marketPrice": 0, "marketValue": 0 }
  ],
  "cashAvailable": 0
}
```

`short-stock.json` :
```json
{
  "positions": [
    { "symbol": "TSLA", "secType": "STK", "quantity": -10, "avgPrice": 250, "marketPrice": 240, "marketValue": -2400, "unrealizedPnl": 100 },
    { "symbol": "WEIRD", "secType": "WAR", "quantity": 5, "avgPrice": 1, "marketPrice": 1, "marketValue": 5 }
  ],
  "cashAvailable": 1000
}
```

`mixed-portfolio.json` : la concaténation des positions de `stock-covered-calls`, `leaps-covered-calls` (symbole renommé `NVDA`), `cash-secured-puts-ok`, `iron-condor-ok` et `short-stock`, avec `"cashAvailable": 42000`. Douze fichiers en tout, `flex-sample.json` arrivant à la tâche 8.

- [x] **Étape 4 : générer et vérifier le contenu**

Ajouter à `package.json` racine : `"oracle": "uv run --project tools/coverage-oracle python tools/coverage-oracle/generate.py"`.

```bash
pnpm oracle
ls packages/coverage/tests/oracle/
grep -c '"UNCOVERED"' packages/coverage/tests/oracle/stock-covered-calls.json   # 0 : l'engin n'émet jamais cette source, elle est un affichage
```

Ouvrir `packages/coverage/tests/oracle/iron-condor-ok.json` et vérifier à l'œil : `structures[0]` = `{ callRisk: 500, putRisk: 500, credit: 200, contracts: 2, kind: "iron condor", expiry: "2026-03-20" }`, chaque jambe courte avec une allocation `spread`.

- [x] **Étape 5 : test d'oracle (échec attendu si le port dévie)**

`packages/coverage/src/oracle.test.ts` :

```ts
/// <reference types="node" />
// Runs under Node (vitest) although the package targets the browser, hence
// the explicit reference, as in ib-parsers' fixture test.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Position } from "@ib/ledger";
import { buildRiskReport } from "./report.ts";
import type { RiskReport } from "./types.ts";

interface OracleFixture {
  input: { positions: Position[]; cashAvailable: number };
  expected: RiskReport;
}

const ORACLE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../tests/oracle");
const fixtures = readdirSync(ORACLE_DIR).filter((name) => name.endsWith(".json")).sort();

// The frozen Python engine computed `expected`. Both engines do the same IEEE
// 754 operations in the same order, so equality is exact, floats included:
// any difference is a bug of the port, never of the oracle.
describe("oracle fixtures", () => {
  it("has the whole corpus", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(12);
  });

  it.each(fixtures)("reproduces %s exactly", (name) => {
    const { input, expected } = JSON.parse(readFileSync(path.join(ORACLE_DIR, name), "utf8")) as OracleFixture;
    expect(buildRiskReport(input.positions, input.cashAvailable)).toEqual(expected);
  });
});
```

Run: `pnpm --filter @ib/coverage test`
Expected: PASS. En cas d'écart, lire le diff Vitest : l'ordre des allocations, une chaîne, un flottant ; corriger `coverage.ts` ou `format.ts`, jamais la fixture.

- [x] **Étape 6 : commit**

```bash
git add tools/coverage-oracle packages/coverage package.json
git commit -m "test(coverage): oracle Python gelé, corpus synthétique et fixtures reproduites à l'identique

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LJLvsD7TGEDB8mTSTxfmwy"
```

---

## Tâche 8 : corpus réel anonymisé dérivé de la fixture Flex

> Cette tâche a été corrigée avant exécution : le Node de cette machine est **compilé sans
> support TypeScript** (`ERR_NO_TYPESCRIPT`, vérifié), et il n'existe ni `vite-node`, ni `tsx`,
> ni binaire `esbuild`. Un script `.mjs` important `../../ib-parsers/src/index.ts` ne peut donc
> pas s'exécuter. Le corpus est dérivé par un test Vitest, qui sert en même temps de garde
> anti-dérive entre la fixture et le corpus committé.

**Files:**
- Create: `packages/coverage/src/corpus.test.ts`, `tools/coverage-oracle/corpus/flex-sample.json`, `packages/coverage/tests/oracle/flex-sample.json`
- Modify: `packages/coverage/package.json` (devDependencies `@ib/ib-parsers`, `jsdom`), `package.json` (script `oracle`)

**Interfaces:**
- Consumes: `parseFlexXml` (`@ib/ib-parsers`), la fixture `packages/ib-parsers/tests/fixtures/flex_activity_sample.xml`, `generate.py` (tâche 7).
- Produces: `tools/coverage-oracle/corpus/flex-sample.json` = `{ positions: Position[], cashAvailable: number }`, puis `packages/coverage/tests/oracle/flex-sample.json` par `pnpm oracle`.

- [x] **Étape 1 : dépendances**

Ajouter aux `devDependencies` de `packages/coverage/package.json` :

```json
    "@ib/ib-parsers": "workspace:*",
    "jsdom": "^30.0.1",
```

`@ib/ib-parsers` est une dépendance **de développement** : le moteur ne lit jamais un fichier
IB, seul ce test le fait. Aucun cycle : `ib-parsers` ne dépend pas de `coverage`.

Puis `pnpm install`.

- [x] **Étape 2 : le test générateur et garde**

`packages/coverage/src/corpus.test.ts` :

```ts
// @vitest-environment jsdom
/// <reference types="node" />
// This package runs in the browser and its tsconfig opts out of ambient
// globals ("types": []); this file alone runs under Node, and needs jsdom's
// DOMParser because it drives the real Flex parser.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseFlexXml } from "@ib/ib-parsers";

// jsdom's global URL resolves against its fake document location, so the
// paths are built without the WHATWG URL API, as in ib-parsers' fixture test.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "../../ib-parsers/tests/fixtures/flex_activity_sample.xml");
const CORPUS = path.join(HERE, "../../../tools/coverage-oracle/corpus/flex-sample.json");

/** The anonymized real portfolio, in the shape the oracle corpus expects. */
function derive(): { positions: unknown[]; cashAvailable: number } {
  const result = parseFlexXml(readFileSync(FIXTURE, "utf8"), { accountId: "sample", ibAccountId: "U0000001" });
  if (!result.snapshot) throw new Error("the Flex fixture has no Open Positions section");
  return { positions: result.snapshot.positions, cashAvailable: result.snapshot.cashAvailable ?? 0 };
}

describe("oracle corpus derived from the Flex fixture", () => {
  // `pnpm oracle` sets UPDATE_CORPUS: the corpus is rewritten from the
  // fixture, then generate.py turns it into an oracle fixture. Without it
  // the test is a guard: the committed corpus must still be exactly what
  // the real parser reads, so the fixture and the oracle can never drift.
  it("matches the committed corpus", () => {
    const derived = derive();
    if (process.env.UPDATE_CORPUS) {
      mkdirSync(path.dirname(CORPUS), { recursive: true });
      writeFileSync(CORPUS, `${JSON.stringify(derived, null, 2)}\n`);
      console.log(`flex-sample.json: ${derived.positions.length} positions, cash ${derived.cashAvailable}`);
      return;
    }
    expect(JSON.parse(readFileSync(CORPUS, "utf8"))).toEqual(derived);
  });

  it("reads the whole portfolio of the fixture", () => {
    const derived = derive();
    expect(derived.positions).toHaveLength(30);
    expect(derived.cashAvailable).toBeGreaterThan(0);
  });
});
```

- [x] **Étape 3 : script racine**

Dans `package.json` racine, remplacer le script `oracle` de la tâche 7 par :

```json
    "oracle": "UPDATE_CORPUS=1 pnpm --filter @ib/coverage test corpus && uv run --project tools/coverage-oracle python tools/coverage-oracle/generate.py",
```

- [x] **Étape 4 : générer et vérifier**

```bash
pnpm oracle                      # flex-sample.json: 30 positions, cash <valeur synthétique>
pnpm --filter @ib/coverage test  # 13 fixtures d'oracle reproduites, garde du corpus verte
```

Si `generate.py` s'arrête sur `no averageCost reproduces avgPrice=…`, c'est un prix de la
fixture qui ne survit à aucun aller-retour par multiplicateur ; le signaler dans le message de
commit et exclure cette position dans `derive()` par un filtre sur `symbol`, jamais tricher sur
la valeur.

- [x] **Étape 5 : commit**

```bash
pnpm check
git add packages/coverage tools/coverage-oracle/corpus/flex-sample.json package.json pnpm-lock.yaml
git commit -m "test(coverage): portefeuille réel anonymisé dans le corpus de l'oracle

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LJLvsD7TGEDB8mTSTxfmwy"
```

---

## Tâche 9 : Dexie version 2, snapshot et secteurs, hooks de lecture

**Files:**
- Modify: `apps/web/src/db/schema.ts`, `apps/web/src/db/hooks.ts`, `apps/web/src/db/accounts.ts`, `apps/web/package.json` (dépendance `@ib/coverage`)
- Create: `apps/web/src/mocks/positions.ts`
- Test: `apps/web/src/db/hooks.test.tsx`, `apps/web/src/db/accounts.test.ts`

**Interfaces:**
- Consumes: `Position` (`@ib/ledger`), `buildRiskReport`, `RiskReport` (`@ib/coverage`).
- Produces: `SnapshotRecord { accountId; source: "flex"; asOf; importedAt; positions: Position[]; cashAvailable: number | null }`, `SectorRecord { ticker; name; category; score: number | null; status; importedAt }`, tables `db.snapshots` (clé `accountId`) et `db.sectors` (clé `ticker`) ; `ImportRecord.positions?: number | null`, `ImportRecord.cashAvailable?: number | null` ; `useSnapshot(accountId): SnapshotRecord | null | undefined`, `useSectors(): Map<string, SectorRecord> | undefined`, `useRiskReport(accountId): { snapshot; report: RiskReport | null | undefined; sectorOf(symbol): string | null }` ; `SAMPLE_POSITIONS`, `SAMPLE_SNAPSHOT`, `SAMPLE_SECTORS`.

- [x] **Étape 1 : dépendance et données de démonstration**

Ajouter `"@ib/coverage": "workspace:*"` aux `dependencies` de `apps/web/package.json`, puis `pnpm install`.

`apps/web/src/mocks/positions.ts` (un portefeuille qui exerce chaque famille de couverture : actions, LEAPS, cash, condor, une jambe nue) :

```ts
import type { Position } from "@ib/ledger";
import type { SectorRecord, SnapshotRecord } from "@/db/schema";

function position(overrides: Partial<Position>): Position {
  return {
    symbol: "AAPL",
    secType: "OPT",
    right: "C",
    strike: 150,
    expiry: "2026-01-16",
    multiplier: 100,
    quantity: -1,
    avgPrice: 2,
    marketPrice: 1,
    marketValue: -100,
    unrealizedPnl: 100,
    currency: "USD",
    conid: "",
    description: "",
    ...overrides,
  };
}

/**
 * alpha: 200 AAPL shares cover one call fully and one of two on the next
 * expiry (one contract UNCOVERED); an MSFT LEAPS covers a short call; two XOM
 * puts lock 20,000 of cash; an XYZ iron condor adds 500 of assignment cash.
 */
export const SAMPLE_POSITIONS: Position[] = [
  position({ symbol: "AAPL", secType: "STK", right: "", strike: null, expiry: null, multiplier: 1, quantity: 200, avgPrice: 140, marketPrice: 150, marketValue: 30000, unrealizedPnl: 2000, description: "APPLE INC" }),
  position({ symbol: "AAPL", right: "C", strike: 150, expiry: "2026-01-16", quantity: -1, avgPrice: 2, marketPrice: 0.8, marketValue: -80, unrealizedPnl: 120 }),
  position({ symbol: "AAPL", right: "C", strike: 155, expiry: "2026-02-20", quantity: -2, avgPrice: 3, marketPrice: 3.1, marketValue: -620, unrealizedPnl: -20 }),
  position({ symbol: "MSFT", right: "C", strike: 300, expiry: "2028-01-21", quantity: 1, avgPrice: 90, marketPrice: 95, marketValue: 9500, unrealizedPnl: 500 }),
  position({ symbol: "MSFT", right: "C", strike: 400, expiry: "2026-03-20", quantity: -1, avgPrice: 6.1, marketPrice: 6.2, marketValue: -620, unrealizedPnl: -10 }),
  position({ symbol: "XOM", right: "P", strike: 100, expiry: "2026-03-20", quantity: -2, avgPrice: 4.2, marketPrice: 1.75, marketValue: -350, unrealizedPnl: 490 }),
  position({ symbol: "XYZ", right: "P", strike: 90, expiry: "2026-03-20", quantity: 1, avgPrice: 1, marketPrice: 0.5, marketValue: 50, unrealizedPnl: -50 }),
  position({ symbol: "XYZ", right: "P", strike: 95, expiry: "2026-03-20", quantity: -1, avgPrice: 2, marketPrice: 1, marketValue: -100, unrealizedPnl: 100 }),
  position({ symbol: "XYZ", right: "C", strike: 105, expiry: "2026-03-20", quantity: -1, avgPrice: 2, marketPrice: 1.5, marketValue: -150, unrealizedPnl: 50 }),
  position({ symbol: "XYZ", right: "C", strike: 110, expiry: "2026-03-20", quantity: 1, avgPrice: 1, marketPrice: 0.75, marketValue: 75, unrealizedPnl: -25 }),
];

/** Cash required 20,500 against 42,000 available: covered. */
export const SAMPLE_SNAPSHOT: SnapshotRecord = {
  accountId: "alpha",
  source: "flex",
  asOf: "2026-09-02",
  importedAt: "2026-09-03T08:00:00.000Z",
  positions: SAMPLE_POSITIONS,
  cashAvailable: 42000,
};

export const SAMPLE_SECTORS: SectorRecord[] = [
  { ticker: "AAPL", name: "Apple Inc.", category: "Tech", score: 7.5, status: "on", importedAt: "2026-09-03T08:00:00.000Z" },
  { ticker: "MSFT", name: "Microsoft", category: "Tech", score: 8, status: "on", importedAt: "2026-09-03T08:00:00.000Z" },
  { ticker: "XOM", name: "Exxon Mobil", category: "Energy", score: null, status: "off", importedAt: "2026-09-03T08:00:00.000Z" },
];
```

- [x] **Étape 2 : tests des hooks et de la suppression de compte**

Ajouter à `apps/web/src/db/hooks.test.tsx` (le `beforeEach` vide aussi `db.snapshots` et `db.sectors`) :

```ts
import { useRiskReport, useSectors, useSnapshot } from "@/db/hooks";
import { SAMPLE_SECTORS, SAMPLE_SNAPSHOT } from "@/mocks/positions";

describe("useSnapshot", () => {
  it("resolves to null without a snapshot and to the account's own one otherwise", async () => {
    await db.snapshots.put({ ...SAMPLE_SNAPSHOT, accountId: "beta" });
    const none = renderHook(() => useSnapshot("alpha"));
    await waitFor(() => expect(none.result.current).toBeNull());
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    await waitFor(() => expect(none.result.current?.positions).toHaveLength(SAMPLE_SNAPSHOT.positions.length));
  });
});

describe("useSectors", () => {
  it("maps tickers to their record and follows writes", async () => {
    await db.sectors.bulkPut(SAMPLE_SECTORS);
    const { result } = renderHook(() => useSectors());
    await waitFor(() => expect(result.current?.get("AAPL")?.category).toBe("Tech"));
    await db.sectors.clear();
    await waitFor(() => expect(result.current?.size).toBe(0));
  });
});

describe("useRiskReport", () => {
  it("is undefined while loading, null without a snapshot, and a computed report with sectors otherwise", async () => {
    const { result } = renderHook(() => useRiskReport("alpha"));
    expect(result.current.report).toBeUndefined();
    await waitFor(() => expect(result.current.report).toBeNull());

    await db.snapshots.put(SAMPLE_SNAPSHOT);
    await db.sectors.bulkPut(SAMPLE_SECTORS);
    await waitFor(() => expect(result.current.report?.positions).toHaveLength(SAMPLE_SNAPSHOT.positions.length));
    expect(result.current.report?.cashAvailable).toBe(42000);
    expect(result.current.report?.structures.map((s) => s.kind)).toEqual(["iron condor"]);
    await waitFor(() => expect(result.current.sectorOf("AAPL")).toBe("Tech"));
    expect(result.current.sectorOf("XYZ")).toBeNull();
  });
});
```

Dans `apps/web/src/db/accounts.test.ts`, test « removes the account… » : ajouter avant `deleteAccount` un `await db.snapshots.put({ ...SAMPLE_SNAPSHOT, accountId: "a" }); await db.snapshots.put({ ...SAMPLE_SNAPSHOT, accountId: "b" });` et après : `expect((await db.snapshots.toArray()).map((s) => s.accountId)).toEqual(["b"]);`.

Run: `pnpm --filter web test -- hooks accounts`
Expected: FAIL, `db.snapshots` inexistant.

- [x] **Étape 3 : schéma**

`apps/web/src/db/schema.ts` :

```ts
import Dexie, { type EntityTable, type Table } from "dexie";
import type { DroppedCount, Position, Transaction, TransactionKind, TransactionSource } from "@ib/ledger";
import type { ParseIssue } from "@ib/ib-parsers";

// AccountRecord unchanged.

export interface ImportRecord {
  id?: number;
  accountId: string;
  source: TransactionSource;
  at: string;
  fileName: string;
  period: { start: string; end: string } | null;
  imported: number;
  skipped: number;
  dropped: DroppedCount[];
  issues: ParseIssue[];
  /** Positions written by this import; absent on records older than version 2. */
  positions?: number | null;
  cashAvailable?: number | null;
}

/** The current positions of one account: one document, replaced whole. */
export interface SnapshotRecord {
  accountId: string;
  /** "agent" joins in sub-project 4. */
  source: "flex";
  /** YYYY-MM-DD, the close the positions and cash are as of. */
  asOf: string;
  importedAt: string;
  positions: Position[];
  cashAvailable: number | null;
}

/** One row of the user's personal sector table. Shared by every account on purpose. */
export interface SectorRecord {
  ticker: string;
  name: string;
  category: string;
  score: number | null;
  status: string;
  importedAt: string;
}

export class AppDatabase extends Dexie {
  accounts!: EntityTable<AccountRecord, "id">;
  transactions!: Table<Transaction, [string, string]>;
  imports!: EntityTable<ImportRecord, "id">;
  snapshots!: EntityTable<SnapshotRecord, "accountId">;
  sectors!: EntityTable<SectorRecord, "ticker">;

  constructor(name = "ib-analyzer") {
    super(name);
    this.version(1).stores({
      accounts: "id",
      transactions: "[accountId+externalId], accountId, [accountId+when]",
      imports: "++id, accountId",
    });
    this.version(2).stores({
      snapshots: "accountId",
      sectors: "ticker",
    });
  }
}
```

- [x] **Étape 4 : hooks et suppression**

Ajouter à `apps/web/src/db/hooks.ts` :

```ts
import { useCallback, useMemo } from "react";
import { buildRiskReport, type RiskReport } from "@ib/coverage";
import { db, type AccountRecord, type ImportRecord, type SectorRecord, type SnapshotRecord } from "./schema";

/** `undefined` while loading, `null` when the account has no positions yet. */
export function useSnapshot(accountId: string): SnapshotRecord | null | undefined {
  return useLiveQuery(async () => (await db.snapshots.get(accountId)) ?? null, [accountId]);
}

/** The whole sector table keyed by ticker; `undefined` while loading. */
export function useSectors(): Map<string, SectorRecord> | undefined {
  const rows = useLiveQuery(() => db.sectors.toArray(), []);
  return useMemo(() => (rows ? new Map(rows.map((row) => [row.ticker, row])) : undefined), [rows]);
}

export interface RiskReportView {
  snapshot: SnapshotRecord | null | undefined;
  /** Same three states as `snapshot`. */
  report: RiskReport | null | undefined;
  /** Category of the ticker, `null` when the table does not know it. */
  sectorOf: (symbol: string) => string | null;
}

/** The risk report of one account, recomputed when its snapshot changes. */
export function useRiskReport(accountId: string): RiskReportView {
  const snapshot = useSnapshot(accountId);
  const sectors = useSectors();
  const report = useMemo(
    () => (snapshot ? buildRiskReport(snapshot.positions, snapshot.cashAvailable) : snapshot),
    [snapshot],
  );
  const sectorOf = useCallback((symbol: string) => sectors?.get(symbol)?.category || null, [sectors]);
  return { snapshot, report, sectorOf };
}
```

Dans `apps/web/src/db/accounts.ts`, `deleteAccount` ajoute `db.snapshots` à la transaction et `await db.snapshots.delete(id);`.

- [x] **Étape 5 : vérifier et committer**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: PASS.

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): tables snapshots et sectors, hooks useSnapshot, useSectors, useRiskReport

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LJLvsD7TGEDB8mTSTxfmwy"
```

---

## Tâche 10 : `importFile` écrit le snapshot dans la même transaction

**Files:**
- Modify: `apps/web/src/db/importFile.ts`
- Test: `apps/web/src/db/importFile.test.ts`

**Interfaces:**
- Consumes: `FlexParseResult.snapshot`, `db.snapshots`.
- Produces: `ImportReport` (statut `ok`) gagne `positions: number | null`, `cashAvailable: number | null`, `staleSnapshot: boolean` ; `ImportRecord.positions` et `.cashAvailable` écrits.

- [x] **Étape 1 : tests**

Ajouter à `apps/web/src/db/importFile.test.ts` :

```ts
describe("importFile: positions snapshot", () => {
  it("writes the Flex open positions and cash as the account's snapshot", async () => {
    const report = await importFile(db, account, file(flexXml, "flex.xml"));
    expect(report).toMatchObject({ status: "ok", positions: 30, staleSnapshot: false });
    expect(report.status === "ok" && report.cashAvailable).toBeGreaterThan(0);
    const snapshot = await db.snapshots.get("test");
    expect(snapshot).toMatchObject({ accountId: "test", source: "flex", asOf: "2026-09-02" });
    expect(snapshot?.positions).toHaveLength(30);
    const [record] = await db.imports.toArray();
    expect(record).toMatchObject({ positions: 30, cashAvailable: snapshot?.cashAvailable });
  });

  it("replaces the snapshot with a file of the same day, and keeps it against an older one", async () => {
    await importFile(db, account, file(flexXml, "flex.xml"));
    const first = await db.snapshots.get("test");

    const sameDay = await importFile(db, account, file(flexXml, "flex-again.xml"));
    expect(sameDay).toMatchObject({ status: "ok", positions: 30, staleSnapshot: false });
    expect((await db.snapshots.get("test"))?.importedAt).not.toBe(first?.importedAt);

    const older = flexXml.replaceAll('reportDate="20260902"', 'reportDate="20260101"');
    const report = await importFile(db, account, file(older, "old.xml"));
    expect(report).toMatchObject({ status: "ok", positions: null, staleSnapshot: true });
    expect((await db.snapshots.get("test"))?.asOf).toBe("2026-09-02");
    expect(await db.snapshots.count()).toBe(1);
  });

  it("leaves the snapshot alone on a statement import and on a Flex without Open Positions", async () => {
    await importFile(db, account, file(flexXml, "flex.xml"));
    await importFile(db, account, file(statementHtml, "2025.htm"));
    expect((await db.snapshots.get("test"))?.positions).toHaveLength(30);

    const noPositions = flexXml.replace(/<OpenPositions>[\s\S]*?<\/OpenPositions>/, "");
    const report = await importFile(db, account, file(noPositions, "bare.xml"));
    expect(report).toMatchObject({ status: "ok", positions: null, cashAvailable: null, staleSnapshot: false });
    expect((await db.snapshots.get("test"))?.positions).toHaveLength(30);
  });

  it("scopes the snapshot to the account", async () => {
    await importFile(db, account, file(flexXml, "flex.xml"));
    expect(await db.snapshots.get("other")).toBeUndefined();
  });
});
```

Le test « replaces … an older one » suppose que `reportDate="20260902"` n'apparaît que sur les lignes datées de ce jour ; si `flexXml` en porte ailleurs, le remplacement reste inoffensif pour ce test.

Run: `pnpm --filter web test -- importFile`
Expected: FAIL.

- [x] **Étape 2 : implémentation**

Dans `apps/web/src/db/importFile.ts` :

```ts
export type ImportReport =
  | { status: "error"; fileName: string; source: ImportFormat | null; issues: ParseIssue[] }
  | {
      status: "ok";
      fileName: string;
      source: ImportFormat;
      period: { start: string; end: string };
      imported: number;
      skipped: number;
      /** Only the kinds not yet reported on this account. */
      dropped: DroppedCount[];
      issues: ParseIssue[];
      /** Positions written as the account's snapshot; `null` when the file carried none or was older. */
      positions: number | null;
      cashAvailable: number | null;
      /** The file's positions were older than the cached ones and were ignored. */
      staleSnapshot: boolean;
    };
```

Après le calcul de `plan` et `at`, la transaction devient :

```ts
  const snapshot = "snapshot" in parsed ? parsed.snapshot : null;
  let positionsWritten: number | null = null;
  let staleSnapshot = false;

  await db.transaction("rw", db.transactions, db.imports, db.accounts, db.snapshots, async () => {
    await db.transactions.bulkDelete(plan.delete.map((externalId) => [account.id, externalId]));
    await db.transactions.bulkPut(plan.upsert);
    if (snapshot) {
      const current = await db.snapshots.get(account.id);
      if (!current || snapshot.asOf >= current.asOf) {
        await db.snapshots.put({
          accountId: account.id,
          source: "flex",
          asOf: snapshot.asOf,
          importedAt: at,
          positions: snapshot.positions,
          cashAvailable: snapshot.cashAvailable,
        });
        positionsWritten = snapshot.positions.length;
      } else {
        staleSnapshot = true;
      }
    }
    await db.imports.add({
      accountId: account.id,
      source,
      at,
      fileName: file.name,
      period,
      imported: plan.upsert.length,
      skipped: plan.skipped,
      dropped: plan.dropped,
      issues: parsed.issues,
      positions: positionsWritten,
      cashAvailable: snapshot?.cashAvailable ?? null,
    });
    // warnedDroppedKinds update unchanged.
  });

  return {
    status: "ok",
    fileName: file.name,
    source,
    period,
    imported: plan.upsert.length,
    skipped: plan.skipped,
    dropped: newlyDropped,
    issues: parsed.issues,
    positions: positionsWritten,
    cashAvailable: snapshot?.cashAvailable ?? null,
    staleSnapshot,
  };
```

- [x] **Étape 3 : vérifier et committer**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: PASS (les tests existants d'`importFile` et de `SourcesPage` restent verts : les nouveaux champs sont additifs).

```bash
git add apps/web/src/db
git commit -m "feat(web): un import Flex écrit le snapshot des positions dans la même transaction

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LJLvsD7TGEDB8mTSTxfmwy"
```

---

## Tâche 11 : import CSV de la table sectorielle

**Files:**
- Create: `apps/web/src/db/sectors.ts`
- Test: `apps/web/src/db/sectors.test.ts`

**Interfaces:**
- Consumes: `db.sectors`, `readFileText`.
- Produces: `parseSectorCsv(text: string, importedAt: string): SectorRecord[]` (lève `SectorCsvError`), `importSectorCsv(db, file): Promise<SectorImportReport>` avec `SectorImportReport = { status: "ok"; tickers: number } | { status: "error"; detail: string }`.

- [x] **Étape 1 : tests**

`apps/web/src/db/sectors.test.ts` :

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "@/db/schema";
import { importSectorCsv, parseSectorCsv, SectorCsvError } from "@/db/sectors";

const HEADER = "Ticker;Name;Category;Score;S-2;S-4;Last Date;Status";
const CSV = [
  HEADER,
  "ACQZ;EXAMPLE AVIATION Inc.;Aviation;6.5;6.0;;2026-08-18;on",
  "AEQZ;AEQZ Technologies Inc;Automotive;;6.5;6.0;2026-08-25;on",
  ";;;;;;;",
  "ZZZ;No Score Co;;;;;;off",
].join("\r\n");

let db: AppDatabase;
beforeEach(() => {
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
});

describe("parseSectorCsv", () => {
  it("reads the columns by name, ignores S-* and Last Date, skips rows without a ticker", () => {
    expect(parseSectorCsv(CSV, "2026-09-03T00:00:00.000Z")).toEqual([
      { ticker: "ACQZ", name: "EXAMPLE AVIATION Inc.", category: "Aviation", score: 6.5, status: "on", importedAt: "2026-09-03T00:00:00.000Z" },
      { ticker: "AEQZ", name: "AEQZ Technologies Inc", category: "Automotive", score: null, status: "on", importedAt: "2026-09-03T00:00:00.000Z" },
      { ticker: "ZZZ", name: "No Score Co", category: "", score: null, status: "off", importedAt: "2026-09-03T00:00:00.000Z" },
    ]);
  });

  it("finds the columns whatever their order, and copes with a BOM", () => {
    const shuffled = "﻿Category;Ticker;Status\nTech;AAPL;on";
    expect(parseSectorCsv(shuffled, "x")).toEqual([
      { ticker: "AAPL", name: "", category: "Tech", score: null, status: "on", importedAt: "x" },
    ]);
  });

  it("refuses a file without a Ticker column, and an unreadable score", () => {
    expect(() => parseSectorCsv("Name;Category\nApple;Tech", "x")).toThrow(SectorCsvError);
    expect(() => parseSectorCsv("Ticker;Score\nAAPL;high", "x")).toThrow(/Unreadable score "high" for AAPL/);
  });
});

describe("importSectorCsv", () => {
  const file = (content: string) => new File([content], "company.csv", { type: "text/csv" });

  it("replaces the whole table and reports the row count", async () => {
    await db.sectors.put({ ticker: "OLD", name: "", category: "Gone", score: null, status: "", importedAt: "" });
    const report = await importSectorCsv(db, file(CSV));
    expect(report).toEqual({ status: "ok", tickers: 3 });
    expect((await db.sectors.toArray()).map((r) => r.ticker).sort()).toEqual(["ACQZ", "AEQZ", "ZZZ"]);
  });

  it("writes nothing on an unreadable file", async () => {
    await db.sectors.put({ ticker: "OLD", name: "", category: "Kept", score: null, status: "", importedAt: "" });
    const report = await importSectorCsv(db, file("Name;Category\nApple;Tech"));
    expect(report).toEqual({ status: "error", detail: 'Column "Ticker" missing' });
    expect(await db.sectors.count()).toBe(1);
  });
});
```

Run: `pnpm --filter web test -- sectors`
Expected: FAIL, `@/db/sectors` introuvable.

- [x] **Étape 2 : implémentation**

`apps/web/src/db/sectors.ts` :

```ts
import { readFileText } from "./readFile";
import type { AppDatabase, SectorRecord } from "./schema";

export type SectorImportReport = { status: "ok"; tickers: number } | { status: "error"; detail: string };

export class SectorCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SectorCsvError";
  }
}

/**
 * The user's `company.csv`: `;`-separated, a header row, columns read by
 * name. `S-*` and `Last Date` are ignored. No quoting: the file never
 * carries a semicolon inside a cell.
 */
export function parseSectorCsv(text: string, importedAt: string): SectorRecord[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) throw new SectorCsvError("Empty file");
  const header = lines[0].split(";").map((cell) => cell.trim());
  const column = (name: string) => header.indexOf(name);
  if (column("Ticker") < 0) throw new SectorCsvError('Column "Ticker" missing');
  const cell = (cells: string[], name: string) => {
    const index = column(name);
    return index < 0 ? "" : (cells[index] ?? "").trim();
  };

  const records: SectorRecord[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(";");
    const ticker = cell(cells, "Ticker");
    if (!ticker) continue;
    const scoreText = cell(cells, "Score");
    const score = scoreText === "" ? null : Number(scoreText);
    if (score !== null && !Number.isFinite(score)) {
      throw new SectorCsvError(`Unreadable score "${scoreText}" for ${ticker}`);
    }
    records.push({
      ticker,
      name: cell(cells, "Name"),
      category: cell(cells, "Category"),
      score,
      status: cell(cells, "Status"),
      importedAt,
    });
  }
  return records;
}

/** The file is the whole table: cleared and rewritten in one transaction. */
export async function importSectorCsv(db: AppDatabase, file: File): Promise<SectorImportReport> {
  const text = await readFileText(file);
  let records: SectorRecord[];
  try {
    records = parseSectorCsv(text, new Date().toISOString());
  } catch (e) {
    if (e instanceof SectorCsvError) return { status: "error", detail: e.message };
    throw e;
  }
  await db.transaction("rw", db.sectors, async () => {
    await db.sectors.clear();
    await db.sectors.bulkPut(records);
  });
  return { status: "ok", tickers: records.length };
}
```

- [x] **Étape 3 : vérifier et committer**

Run: `pnpm --filter web test -- sectors && pnpm --filter web typecheck`
Expected: PASS.

```bash
git add apps/web/src/db/sectors.ts apps/web/src/db/sectors.test.ts
git commit -m "feat(web): import CSV de la table sectorielle, remplacement en une transaction

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LJLvsD7TGEDB8mTSTxfmwy"
```

---

## Tâche 12 : page Positions

**Files:**
- Create: `apps/web/src/lib/riskReport.ts`, `apps/web/src/pages/PositionsPage.tsx`, `apps/web/src/lib/businessConstants.test.ts`
- Modify: `apps/web/src/lib/format.ts`, `apps/web/src/i18n/en.json`, `apps/web/src/i18n/fr.json`, `apps/web/src/routes/router.tsx`
- Test: `apps/web/src/lib/riskReport.test.ts`, `apps/web/src/lib/format.test.ts`, `apps/web/src/pages/PositionsPage.test.tsx`

**Interfaces:**
- Consumes: `useRiskReport`, `groupedPositions`, `AnalyzedPosition`, `DetailGroupId` (`@ib/coverage`), `SAMPLE_SNAPSHOT`, `SAMPLE_SECTORS`.
- Produces: `decisionBadge(p)`, `coverageBadges(p)`, `groupTitleKey(id: DetailGroupId): string` ; `formatMoney(value: number | null)` et `formatPrice(value: number | null)` rendent `"—"` pour `null`.

- [x] **Étape 1 : i18n**

Dans `en.json`, remplacer le bloc `positions` par :

```json
"positions": {
  "filterPlaceholder": "Filter on the Position column…",
  "asOf": "Data as of {{date}}",
  "empty": "No positions yet — import a Flex query response with Open Positions.",
  "emptyLink": "Go to data sources",
  "noResults": "No positions match.",
  "groups": { "long": "Long positions", "optionBuys": "Option buys", "optionSells": "Option sells", "other": "Other positions" },
  "columns": { "position": "Position", "type": "Type", "sector": "Sector", "marketValue": "Market value", "quantity": "Quantity", "avgPrice": "Avg. init. price", "lastPrice": "Last price", "unrealizedPnl": "Unrealized P&L", "decision": "Decision", "coverage": "Coverage" }
}
```

et dans `fr.json` :

```json
"positions": {
  "filterPlaceholder": "Filtrer sur la colonne Position…",
  "asOf": "Données du {{date}}",
  "empty": "Aucune position — importez une réponse de Flex Query avec Open Positions.",
  "emptyLink": "Aller aux sources de données",
  "noResults": "Aucune position ne correspond.",
  "groups": { "long": "Positions longues", "optionBuys": "Achats d'options", "optionSells": "Ventes d'options", "other": "Autres positions" },
  "columns": { "position": "Position", "type": "Type", "sector": "Secteur", "marketValue": "Valeur de marché", "quantity": "Quantité", "avgPrice": "Prix initial moy.", "lastPrice": "Dernier prix", "unrealizedPnl": "P&L latent", "decision": "Décision", "coverage": "Couverture" }
}
```

(`refresh`, `stale` et `error` disparaissent : pas d'agent, pas de réseau.)

- [x] **Étape 2 : formatage de `null` et tests**

Dans `apps/web/src/lib/format.ts`, `formatMoney` et `formatPrice` acceptent `number | null` et rendent `"—"` pour `null`. Ajouter à `format.test.ts` :

```ts
it("formats an unknown money or price as a dash, never as zero", () => {
  expect(formatMoney(null)).toBe("—");
  expect(formatPrice(null)).toBe("—");
});
```

- [x] **Étape 3 : badges (port de l'ancien `lib/riskReport.ts`, camelCase) et tests**

`apps/web/src/lib/riskReport.ts` :

```ts
import type { AnalyzedPosition, DetailGroupId } from "@ib/coverage";

export function groupTitleKey(id: DetailGroupId): string {
  return `positions.groups.${id}`;
}

export interface DecisionBadge {
  variant: "success" | "destructive";
  label: "keep" | "buy back";
}

export function decisionBadge(position: AnalyzedPosition): DecisionBadge | null {
  if (position.decision === "keep") return { variant: "success", label: "keep" };
  if (position.decision === "buy back") return { variant: "destructive", label: "buy back" };
  return null;
}

export type CoverageBadgeVariant = "default" | "success" | "secondary" | "warning" | "destructive" | "outline";

export interface CoverageBadge {
  variant: CoverageBadgeVariant;
  label: string;
  tooltip: string | null;
}

const COVERAGE_SOURCE_VARIANT: Record<string, CoverageBadgeVariant> = {
  cash: "default",
  stock: "success",
  leaps: "secondary",
  spread: "warning",
};

/** One badge per allocation, then the uncovered remainder; "used x/y" or "unused" for a long cover. */
export function coverageBadges(position: AnalyzedPosition): CoverageBadge[] {
  if (position.kind === "short_call" || position.kind === "short_put") {
    const badges: CoverageBadge[] = position.allocations.map((allocation) => ({
      variant: COVERAGE_SOURCE_VARIANT[allocation.source] ?? "outline",
      label: `${allocation.source} ×${allocation.quantity}`,
      tooltip: allocation.detail || null,
    }));
    if (position.uncoveredQuantity > 0) {
      badges.push({ variant: "destructive", label: `UNCOVERED ×${position.uncoveredQuantity}`, tooltip: null });
    }
    if (badges.length === 0) badges.push({ variant: "destructive", label: "UNCOVERED", tooltip: null });
    return badges;
  }
  if (position.kind === "long_stock" || position.kind === "long_call" || position.kind === "long_put") {
    const total = Math.abs(position.quantity);
    if (position.usedQuantity > 0) {
      return [{ variant: "success", label: `used ${position.usedQuantity}/${total}`, tooltip: null }];
    }
    return [{ variant: "outline", label: "unused", tooltip: null }];
  }
  return [];
}
```

`apps/web/src/lib/riskReport.test.ts` : reprendre les blocs `decisionBadge` et `coverageBadges` de l'ancien `frontend/src/lib/riskReport.test.ts` avec une fabrique `position()` en camelCase (`marketValue`, `avgPrice`, `lastPrice`, `unrealizedPnl`, `secType`, `uncoveredQuantity`, `usedQuantity`, `requiredCash`, `riskNotes`, sans `sector`), plus :

```ts
it("maps a group id to its i18n key", () => {
  expect(groupTitleKey("optionSells")).toBe("positions.groups.optionSells");
});
```

- [x] **Étape 4 : garde-fou des constantes métier**

`apps/web/src/lib/businessConstants.test.ts` :

```ts
import { describe, expect, it } from "vitest";

// Every business constant of the coverage engine lives in @ib/coverage.
// A page that redefined one would silently drift from the engine.
const sources = import.meta.glob("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const FORBIDDEN = [
  /\b(BUYBACK_RATIO|MAX_STRUCTURE_LOSS|DEFAULT_MULTIPLIER)\s*=/,
  /["'](sell of (call|put)|buy of (call|put)|iron condor|call spread|put spread)["']/,
];

describe("business constants", () => {
  it("are never redefined in apps/web", () => {
    const offenders = Object.entries(sources)
      // Tests may name a kind to assert on it; production code may not.
      .filter(([path]) => !/\.test\.tsx?$/.test(path))
      .filter(([, text]) => FORBIDDEN.some((re) => re.test(text)))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
```

(Les fichiers de test sont exclus : ils peuvent nommer une sorte de structure pour l'affirmer.)

- [x] **Étape 5 : tests de la page**

`apps/web/src/pages/PositionsPage.test.tsx` :

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import i18n from "@/i18n";
import { db } from "@/db/schema";
import { PositionsPage } from "@/pages/PositionsPage";
import { SAMPLE_POSITIONS, SAMPLE_SECTORS, SAMPLE_SNAPSHOT } from "@/mocks/positions";

function renderPositions(accountId = "alpha") {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[`/accounts/${accountId}/positions`]}>
        <Routes>
          <Route path="/accounts/:accountId/positions" element={<PositionsPage />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(async () => {
  await Promise.all([db.snapshots.clear(), db.sectors.clear()]);
});

async function rowFor(description: string): Promise<HTMLTableRowElement> {
  return (await screen.findByText(description)).closest("tr") as HTMLTableRowElement;
}

// The shared i18n singleton defaults to French: page strings are asserted in
// French. Badge internals (keep, buy back, cash ×2) are not translated.
describe("PositionsPage", () => {
  it("renders the short put under Option sells with its decision and coverage badges", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    const row = await rowFor("XOM 2026-03-20 P 100");
    expect(screen.getByText("Ventes d'options")).toBeInTheDocument();
    expect(within(row).getByText("buy back")).toBeInTheDocument();
    expect(within(row).getByText("cash ×2")).toBeInTheDocument();
  });

  it("shows the uncovered contract, the stock cover and the LEAPS cover", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    expect(within(await rowFor("AAPL 2026-02-20 C 155")).getByText("UNCOVERED ×1")).toBeInTheDocument();
    expect(within(await rowFor("AAPL (STK)")).getByText("used 200/200")).toBeInTheDocument();
    expect(within(await rowFor("MSFT 2026-03-20 C 400")).getByText("leaps ×1")).toBeInTheDocument();
  });

  it("joins the sector table on the symbol and leaves unknown tickers blank", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    await db.sectors.bulkPut(SAMPLE_SECTORS);
    renderPositions();
    expect(within(await rowFor("XOM 2026-03-20 P 100")).getByText("Energy")).toBeInTheDocument();
    expect(within(await rowFor("XYZ 2026-03-20 C 105")).queryByText(/Tech|Energy/)).not.toBeInTheDocument();
  });

  it("dates the data by the snapshot's asOf", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    expect(await screen.findByText("Données du 2026-09-02")).toBeInTheDocument();
  });

  it("does not render a group with no positions in it", async () => {
    await db.snapshots.put({ ...SAMPLE_SNAPSHOT, positions: [SAMPLE_POSITIONS[5]] });
    renderPositions();
    await screen.findByText("XOM 2026-03-20 P 100");
    expect(screen.queryByText("Positions longues")).not.toBeInTheDocument();
    expect(screen.queryByText("Achats d'options")).not.toBeInTheDocument();
  });

  it("filters rows by the Position column as the user types, and says when nothing matches", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    await screen.findByText("XOM 2026-03-20 P 100");
    const user = userEvent.setup();
    const input = screen.getByPlaceholderText("Filtrer sur la colonne Position…");
    await user.type(input, "MSFT");
    expect(screen.queryByText("XOM 2026-03-20 P 100")).not.toBeInTheDocument();
    expect(screen.getByText("MSFT 2026-03-20 C 400")).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "nonexistent-ticker");
    expect(await screen.findByText("Aucune position ne correspond.")).toBeInTheDocument();
  });

  it("shows a dash, never a zero, for an unknown market value", async () => {
    await db.snapshots.put({ ...SAMPLE_SNAPSHOT, positions: [{ ...SAMPLE_POSITIONS[0], marketValue: null }] });
    renderPositions();
    const cells = within(await rowFor("AAPL (STK)")).getAllByRole("cell");
    expect(cells[3]).toHaveTextContent("—");
  });

  it("shows the empty state with a link to the data sources when the account has no snapshot", async () => {
    await db.snapshots.put({ ...SAMPLE_SNAPSHOT, accountId: "beta" });
    renderPositions("alpha");
    expect(await screen.findByText("Aucune position — importez une réponse de Flex Query avec Open Positions.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Aller aux sources de données" })).toHaveAttribute("href", "/accounts/alpha/sources");
    expect(screen.queryByText("XOM 2026-03-20 P 100")).not.toBeInTheDocument();
  });
});
```

Run: `pnpm --filter web test -- PositionsPage`
Expected: FAIL, `@/pages/PositionsPage` introuvable.

- [x] **Étape 6 : la page**

`apps/web/src/pages/PositionsPage.tsx` :

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { groupedPositions, type AnalyzedPosition } from "@ib/coverage";
import { Badge } from "@ib/ui/badge";
import { buttonVariants } from "@ib/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { Input } from "@ib/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ib/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ib/ui/tooltip";
import { useRiskReport } from "@/db/hooks";
import { formatMoney, formatPrice } from "@/lib/format";
import { coverageBadges, decisionBadge, groupTitleKey } from "@/lib/riskReport";
import { cn } from "@/lib/utils";

export function PositionsPage() {
  const { accountId = "" } = useParams<{ accountId: string }>();
  const { t } = useTranslation();
  const { snapshot, report, sectorOf } = useRiskReport(accountId);
  const [filter, setFilter] = useState("");

  if (report === undefined || snapshot === undefined) {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  if (report === null || snapshot === null) {
    return (
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <h1 className="font-heading text-lg font-semibold tracking-tight">{t("nav.positions")}</h1>
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("positions.empty")}</p>
            <Link to={`/accounts/${accountId}/sources`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("positions.emptyLink")}
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const filtered = report.positions.filter((position) =>
    position.description.toLowerCase().includes(filter.toLowerCase()),
  );
  const groups = groupedPositions(filtered).filter((group) => group.positions.length > 0);

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-lg font-semibold tracking-tight">{t("nav.positions")}</h1>
        {/* Flex positions are always as of the previous close: the date is always shown. */}
        <Badge variant="warning">{t("positions.asOf", { date: snapshot.asOf })}</Badge>
      </div>

      <Input
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder={t("positions.filterPlaceholder")}
        aria-label={t("positions.filterPlaceholder")}
      />

      {groups.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("positions.noResults")}</p>
          </CardContent>
        </Card>
      )}

      {groups.map((group) => (
        <Card key={group.id}>
          <CardHeader>
            <CardTitle>{t(groupTitleKey(group.id))}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("positions.columns.position")}</TableHead>
                  <TableHead>{t("positions.columns.type")}</TableHead>
                  <TableHead>{t("positions.columns.sector")}</TableHead>
                  <TableHead className="text-right">{t("positions.columns.marketValue")}</TableHead>
                  <TableHead className="text-right">{t("positions.columns.quantity")}</TableHead>
                  <TableHead className="text-right">{t("positions.columns.avgPrice")}</TableHead>
                  <TableHead className="text-right">{t("positions.columns.lastPrice")}</TableHead>
                  <TableHead className="text-right">{t("positions.columns.unrealizedPnl")}</TableHead>
                  <TableHead>{t("positions.columns.decision")}</TableHead>
                  <TableHead>{t("positions.columns.coverage")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.positions.map((position) => (
                  <PositionRow key={position.description} position={position} sector={sectorOf(position.symbol)} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function PositionRow({ position, sector }: { position: AnalyzedPosition; sector: string | null }) {
  const decision = decisionBadge(position);
  const pnl = position.unrealizedPnl;
  return (
    <TableRow>
      <TableCell className="font-medium">{position.description}</TableCell>
      <TableCell className="text-muted-foreground">{position.label}</TableCell>
      <TableCell>{sector && <Badge variant="outline">{sector}</Badge>}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">{formatMoney(position.marketValue)}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">{position.quantity}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">{formatPrice(position.avgPrice)}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">{formatPrice(position.lastPrice)}</TableCell>
      <TableCell
        className={cn(
          "text-right font-mono tabular-nums",
          pnl !== null && (pnl >= 0 ? "text-success" : "text-destructive"),
        )}
      >
        {formatMoney(pnl)}
      </TableCell>
      <TableCell>{decision && <Badge variant={decision.variant}>{decision.label}</Badge>}</TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {coverageBadges(position).map((badge, index) =>
            badge.tooltip ? (
              <Tooltip key={index}>
                <TooltipTrigger render={<Badge variant={badge.variant}>{badge.label}</Badge>} />
                <TooltipContent>{badge.tooltip}</TooltipContent>
              </Tooltip>
            ) : (
              <Badge key={index} variant={badge.variant}>
                {badge.label}
              </Badge>
            ),
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
```

Dans `router.tsx` : `{ path: "positions", element: <PositionsPage /> }` avec son import.

- [x] **Étape 7 : vérifier et committer**

Run: `pnpm --filter web test && pnpm --filter web typecheck && pnpm lint`
Expected: PASS ; le test `businessConstants` passe.

```bash
git add apps/web
git commit -m "feat(web): page Positions sur le snapshot IndexedDB, secteurs joints

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LJLvsD7TGEDB8mTSTxfmwy"
```

---

## Tâche 13 : page Dashboard

**Files:**
- Create: `apps/web/src/pages/DashboardPage.tsx`
- Modify: `apps/web/package.json` (`echarts`, `echarts-for-react`), `apps/web/src/i18n/en.json`, `apps/web/src/i18n/fr.json`, `apps/web/src/routes/router.tsx`
- Test: `apps/web/src/pages/DashboardPage.test.tsx`

**Interfaces:**
- Consumes: `useRiskReport`, `cashRequired`, `cashOk`, `uncovered` (`@ib/coverage`), `useTheme`, `formatMoney`, `formatPercent`.

- [x] **Étape 1 : dépendances et i18n**

```bash
pnpm --filter web add echarts@^6.1.0 echarts-for-react@^3.0.6
```

Ajouter `"unknown": "Cash unknown"` (en) et `"unknown": "Cash inconnu"` (fr) dans `dashboard.cashCard`.

- [x] **Étape 2 : tests**

`apps/web/src/pages/DashboardPage.test.tsx` :

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import i18n from "@/i18n";
import { db } from "@/db/schema";
import { DashboardPage } from "@/pages/DashboardPage";
import { SAMPLE_POSITIONS, SAMPLE_SNAPSHOT } from "@/mocks/positions";

function renderDashboard(accountId = "alpha") {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[`/accounts/${accountId}/dashboard`]}>
        <Routes>
          <Route path="/accounts/:accountId/dashboard" element={<DashboardPage />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(async () => {
  await Promise.all([db.snapshots.clear(), db.sectors.clear()]);
});

describe("DashboardPage", () => {
  it("shows the cash required (puts + condors) against the cash available, covered", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderDashboard();
    const card = await screen.findByLabelText("Marge de cash");
    expect(within(card).getByText("$20,500.00")).toBeInTheDocument();
    expect(within(card).getByText("$42,000.00")).toBeInTheDocument();
    expect(within(card).getByText("Couvert")).toBeInTheDocument();
    expect(within(card).getByTestId("cash-gauge")).toBeInTheDocument();
  });

  it("says when the cash is short", async () => {
    await db.snapshots.put({ ...SAMPLE_SNAPSHOT, cashAvailable: 1000 });
    renderDashboard();
    expect(await screen.findByText("Cash insuffisant")).toBeInTheDocument();
  });

  it("lists the uncovered positions with their uncovered quantity", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderDashboard();
    const card = await screen.findByLabelText("Positions non couvertes");
    expect(within(card).getByText("AAPL 2026-02-20 C 155")).toBeInTheDocument();
    // "1" twice: the card's count badge and the row's uncovered quantity.
    expect(within(card).getAllByText("1")).toHaveLength(2);
  });

  it("shows the empty state when nothing is uncovered", async () => {
    await db.snapshots.put({ ...SAMPLE_SNAPSHOT, positions: [SAMPLE_POSITIONS[5]] });
    renderDashboard();
    expect(await screen.findByText("Aucune position non couverte.")).toBeInTheDocument();
  });

  it("gives no verdict and no gauge when the cash is unknown", async () => {
    await db.snapshots.put({ ...SAMPLE_SNAPSHOT, cashAvailable: null });
    renderDashboard();
    const card = await screen.findByLabelText("Marge de cash");
    expect(within(card).getByText("Cash inconnu")).toBeInTheDocument();
    expect(within(card).getByText("—")).toBeInTheDocument();
    expect(within(card).getByText("$20,500.00")).toBeInTheDocument();
    expect(within(card).queryByTestId("cash-gauge")).not.toBeInTheDocument();
  });

  it("shows the empty state with a link to the data sources without a snapshot", async () => {
    renderDashboard();
    expect(await screen.findByText("Aucune position — importez une réponse de Flex Query avec Open Positions.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Aller aux sources de données" })).toHaveAttribute("href", "/accounts/alpha/sources");
  });
});
```

Run: `pnpm --filter web test -- DashboardPage`
Expected: FAIL.

- [x] **Étape 3 : la page**

`apps/web/src/pages/DashboardPage.tsx` :

```tsx
import ReactECharts from "echarts-for-react";
import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { cashOk, cashRequired, uncovered } from "@ib/coverage";
import { Badge } from "@ib/ui/badge";
import { buttonVariants } from "@ib/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { useRiskReport } from "@/db/hooks";
import { useTheme } from "@/hooks/useTheme";
import { formatMoney, formatPercent } from "@/lib/format";

// Must stay in sync with the success/destructive/border tokens in src/index.css —
// ECharts renders to SVG directly and can't read CSS custom properties itself.
const GAUGE_COLORS = {
  light: {
    success: "oklch(0.6 0.14 152)",
    destructive: "oklch(0.577 0.245 27.325)",
    track: "oklch(0.9 0.006 250)",
    foreground: "oklch(0.145 0.01 250)",
  },
  dark: {
    success: "oklch(0.72 0.16 152)",
    destructive: "oklch(0.704 0.191 22.216)",
    track: "oklch(1 0 0 / 12%)",
    foreground: "oklch(0.96 0.003 250)",
  },
};

const GAUGE_FONT = "'Geist Mono Variable', ui-monospace, SFMono-Regular, monospace";

export function DashboardPage() {
  const { accountId = "" } = useParams<{ accountId: string }>();
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { report } = useRiskReport(accountId);

  if (report === undefined) {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  if (report === null) {
    return (
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <h1 className="font-heading text-lg font-semibold tracking-tight">{t("nav.dashboard")}</h1>
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("positions.empty")}</p>
            <Link to={`/accounts/${accountId}/sources`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("positions.emptyLink")}
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const required = cashRequired(report);
  const ok = cashOk(report);
  const naked = uncovered(report);
  const available = report.cashAvailable;
  const ratio = available === null ? null : required > 0 ? Math.min(available / required, 1) : 1;
  const colors = GAUGE_COLORS[isDark ? "dark" : "light"];

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
          fontFamily: GAUGE_FONT,
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
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="font-heading text-lg font-semibold tracking-tight">{t("nav.dashboard")}</h1>
      <div className="grid gap-4 md:grid-cols-2">
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
            <div className="grid w-full grid-cols-2 gap-3">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">{t("dashboard.cashCard.required")}</p>
                <p className="font-mono text-base font-medium tabular-nums">{formatMoney(required)}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">{t("dashboard.cashCard.available")}</p>
                <p className="font-mono text-base font-medium tabular-nums">{formatMoney(available)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card aria-label={t("dashboard.uncoveredCard.title")}>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{t("dashboard.uncoveredCard.title")}</CardTitle>
            <CardAction>
              <Badge variant={naked.length > 0 ? "warning" : "outline"}>{naked.length}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            {naked.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <ShieldCheck className="size-8 text-success" />
                <p className="text-sm text-muted-foreground">{t("dashboard.uncoveredCard.empty")}</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {naked.map((position) => (
                  <div key={position.description} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="truncate text-sm">{position.description}</span>
                    <span className="shrink-0 font-mono text-sm font-medium text-destructive tabular-nums">
                      {position.uncoveredQuantity}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

Dans `router.tsx` : `{ path: "dashboard", element: <DashboardPage /> }` avec son import. Si `PlaceholderPage` n'a plus d'usage dans les routes de compte, le garder : `today`, les journaux et `settings` s'en servent encore.

- [x] **Étape 4 : vérifier et committer**

Run: `pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter web build`
Expected: PASS.

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): page Dashboard, jauge de cash et positions non couvertes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LJLvsD7TGEDB8mTSTxfmwy"
```

---

## Tâche 14 : Sources de données, table sectorielle et compte rendu enrichi

**Files:**
- Modify: `apps/web/src/pages/SourcesPage.tsx`, `apps/web/src/components/ImportReportCard.tsx`, `apps/web/src/i18n/en.json`, `apps/web/src/i18n/fr.json`
- Test: `apps/web/src/pages/SourcesPage.test.tsx`

**Interfaces:**
- Consumes: `importSectorCsv`, `SectorImportReport`, `useSectors`, `ImportReport.positions|cashAvailable|staleSnapshot`, `ImportRecord.positions`.

- [x] **Étape 1 : i18n**

Ajouter dans `sources` (en) :

```json
"report": { "...": "existing keys", "positions": "Positions", "cashAvailable": "Cash available", "staleSnapshot": "Positions ignored: the file is older than the cached positions." },
"history": { "...": "existing keys", "positions": "{{count}} positions" },
"sectors": {
  "title": "Sector table",
  "hint": "CSV separated by semicolons with the columns Ticker, Name, Category, Score and Status. The file replaces the whole table, shared by every account.",
  "button": "Import a CSV",
  "importing": "Importing…",
  "empty": "No sector table yet.",
  "summary": "{{count}} tickers, last import {{date}}",
  "ok": "Sector table replaced: {{count}} tickers.",
  "error": "Import cancelled: {{detail}}"
}
```

et (fr) :

```json
"report": { "positions": "Positions", "cashAvailable": "Cash disponible", "staleSnapshot": "Positions ignorées : le fichier est plus ancien que les positions en cache." },
"history": { "positions": "{{count}} positions" },
"sectors": {
  "title": "Table sectorielle",
  "hint": "CSV séparé par des points-virgules, colonnes Ticker, Name, Category, Score et Status. Le fichier remplace toute la table, commune à tous les comptes.",
  "button": "Importer un CSV",
  "importing": "Import en cours…",
  "empty": "Pas encore de table sectorielle.",
  "summary": "{{count}} tickers, dernier import {{date}}",
  "ok": "Table sectorielle remplacée : {{count}} tickers.",
  "error": "Import annulé : {{detail}}"
}
```

Mettre à jour `sources.import.hint` dans les deux langues pour citer les sections attendues : « … sections Trades, Cash Transactions, Corporate Actions, Open Positions et Cash Report … ».

- [x] **Étape 2 : tests**

Ajouter à `apps/web/src/pages/SourcesPage.test.tsx` (le `beforeEach` vide aussi `db.snapshots` et `db.sectors`) :

```ts
const SECTOR_CSV = "Ticker;Name;Category;Score;Status\nAAPL;Apple;Tech;7;on\nXOM;Exxon;Energy;;on";

async function pickSectorCsv(content: string) {
  const user = userEvent.setup();
  const input = screen.getByLabelText("Importer un CSV") as HTMLInputElement;
  await user.upload(input, new File([content], "company.csv", { type: "text/csv" }));
}

describe("SourcesPage: positions and sectors", () => {
  it("reports the positions and cash read from a Flex file, and counts them in the history", async () => {
    renderSources();
    await screen.findByText("U0000001");
    await pickFile(flexXml, "flex.xml");
    const report = await screen.findByTestId("import-report");
    expect(within(report).getByText("Positions")).toBeInTheDocument();
    expect(within(report).getByText("30")).toBeInTheDocument();
    expect(within(report).getByText("Cash disponible")).toBeInTheDocument();
    const history = await screen.findByTestId("import-history");
    expect(within(history).getByText(/30 positions/)).toBeInTheDocument();
    expect(await db.snapshots.get("test")).toBeDefined();
  });

  it("says when a file's positions were ignored as older than the cache", async () => {
    renderSources();
    await screen.findByText("U0000001");
    await pickFile(flexXml, "flex.xml");
    await screen.findByTestId("import-report");
    await pickFile(flexXml.replaceAll('reportDate="20260902"', 'reportDate="20260101"'), "old.xml");
    expect(await screen.findByText("Positions ignorées : le fichier est plus ancien que les positions en cache.")).toBeInTheDocument();
  });

  it("imports the sector table, shows its size and the last import date", async () => {
    renderSources();
    await screen.findByText("Pas encore de table sectorielle.");
    await pickSectorCsv(SECTOR_CSV);
    expect(await screen.findByText("Table sectorielle remplacée : 2 tickers.")).toBeInTheDocument();
    expect(await screen.findByText(/2 tickers, dernier import/)).toBeInTheDocument();
    expect(await db.sectors.count()).toBe(2);
  });

  it("shows the error of an unreadable sector file and keeps the table", async () => {
    await db.sectors.put({ ticker: "OLD", name: "", category: "Kept", score: null, status: "", importedAt: "2026-09-01T00:00:00.000Z" });
    renderSources();
    await screen.findByText(/1 tickers, dernier import/);
    await pickSectorCsv("Name;Category\nApple;Tech");
    expect(await screen.findByText('Import annulé : Column "Ticker" missing')).toBeInTheDocument();
    expect(await db.sectors.count()).toBe(1);
  });
});
```

Run: `pnpm --filter web test -- SourcesPage`
Expected: FAIL.

- [x] **Étape 3 : compte rendu d'import**

Dans `ImportReportCard.tsx`, à l'intérieur du fragment `report.status === "ok"`, après `skipped` :

```tsx
              {report.positions !== null && (
                <>
                  <dt className="text-muted-foreground">{t("sources.report.positions")}</dt>
                  <dd className="font-mono">{report.positions}</dd>
                </>
              )}
              {report.cashAvailable !== null && (
                <>
                  <dt className="text-muted-foreground">{t("sources.report.cashAvailable")}</dt>
                  <dd className="font-mono">{formatMoney(report.cashAvailable)}</dd>
                </>
              )}
```

et, après la `<dl>`, `{report.status === "ok" && report.staleSnapshot && <p className="text-sm text-warning-foreground">{t("sources.report.staleSnapshot")}</p>}`. Importer `formatMoney`.

- [x] **Étape 4 : page Sources**

Dans `SourcesPage.tsx` :

- Imports : `importSectorCsv, type SectorImportReport` depuis `@/db/sectors`, `useSectors` depuis `@/db/hooks`, `formatDateTime`.
- État : `const sectors = useSectors(); const [sectorReport, setSectorReport] = useState<SectorImportReport | null>(null); const [importingSectors, setImportingSectors] = useState(false); const sectorInput = useRef<HTMLInputElement>(null);`
- Handler, sur le modèle de `handleFile` :

```tsx
  async function handleSectorFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportingSectors(true);
    try {
      setSectorReport(await importSectorCsv(db, file));
    } catch (e) {
      setSectorReport({ status: "error", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setImportingSectors(false);
    }
  }
```

- Carte, entre le journal des imports et la suppression du compte :

```tsx
      <Card data-testid="sector-card">
        <CardHeader>
          <CardTitle>{t("sources.sectors.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t("sources.sectors.hint")}</p>
          <p className="text-sm">
            {sectors && sectors.size === 0 && t("sources.sectors.empty")}
            {sectors && sectors.size > 0 && (
              t("sources.sectors.summary", {
                count: sectors.size,
                date: formatDateTime([...sectors.values()][0].importedAt),
              })
            )}
          </p>
          <input
            ref={sectorInput}
            type="file"
            accept=".csv,text/csv"
            aria-label={t("sources.sectors.button")}
            className="sr-only"
            disabled={importingSectors}
            onChange={handleSectorFile}
          />
          <div>
            <Button variant="outline" onClick={() => sectorInput.current?.click()} disabled={importingSectors}>
              {t(importingSectors ? "sources.sectors.importing" : "sources.sectors.button")}
            </Button>
          </div>
          {sectorReport && (
            <p data-testid="sector-report" className={sectorReport.status === "error" ? "text-sm text-destructive" : "text-sm"}>
              {sectorReport.status === "ok"
                ? t("sources.sectors.ok", { count: sectorReport.tickers })
                : t("sources.sectors.error", { detail: sectorReport.detail })}
            </p>
          )}
        </CardContent>
      </Card>
```

- Colonne « Lignes » du journal : `{record.imported}{record.positions != null && ` + ${t("sources.history.positions", { count: record.positions })}`}`.

- [x] **Étape 5 : vérifier et committer**

Run: `pnpm --filter web test && pnpm --filter web typecheck && pnpm lint`
Expected: PASS.

```bash
git add apps/web
git commit -m "feat(web): table sectorielle sur Sources de données, positions et cash dans le compte rendu

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LJLvsD7TGEDB8mTSTxfmwy"
```

---

## Tâche 15 : graine de démonstration, options du driver, contrôle visuel

**Files:**
- Modify: `apps/web/src/mocks/seed.ts`, `.claude/skills/run-frontend/driver.mjs`, `.claude/skills/run-frontend/SKILL.md`

- [x] **Étape 1 : graine**

`apps/web/src/mocks/seed.ts` :

```ts
import { db } from "@/db/schema";
import { SAMPLE_TRANSACTIONS } from "@/mocks/ledger";
import { SAMPLE_SECTORS, SAMPLE_SNAPSHOT } from "@/mocks/positions";

/** Two accounts, a small ledger, a positions snapshot and a few sectors on `alpha`, for screenshots without any file. */
export async function seedDemo(): Promise<void> {
  await db.accounts.bulkPut([
    { id: "alpha", label: "alpha", ibAccountId: "U0000001", createdAt: new Date().toISOString(), warnedDroppedKinds: [] },
    { id: "beta", label: "beta", ibAccountId: "U0000002", createdAt: new Date().toISOString(), warnedDroppedKinds: [] },
  ]);
  await db.transactions.bulkPut(SAMPLE_TRANSACTIONS);
  await db.snapshots.put(SAMPLE_SNAPSHOT);
  await db.sectors.bulkPut(SAMPLE_SECTORS);
}
```

- [x] **Étape 2 : options du driver**

Dans l'en-tête de `driver.mjs`, documenter :

```
//   --ib-account=<id> after --seed, set the IB account id of the first route's account (to import a real file)
//   --import=<file>   upload a Flex XML or statement HTML on the Sources page of the first route's account
//   --sectors=<file>  upload a sector CSV the same way
```

Dans la boucle des routes, juste après le bloc `if (has("seed")) { … }` :

```js
    const account = routes[0].match(/^\/accounts\/([^/]+)/)?.[1] ?? "alpha";
    const ibAccount = flag("ib-account");
    if (ibAccount) {
      await page.goto(BASE, { waitUntil: "domcontentloaded" });
      await page.evaluate(
        ([id, ibAccountId]) => import("/src/db/schema.ts").then((m) => m.db.accounts.update(id, { ibAccountId })),
        [account, ibAccount],
      );
    }
    for (const [name, label, reportId] of [
      ["import", /importer un fichier|import a file/i, "import-report"],
      ["sectors", /importer un csv|import a csv/i, "sector-report"],
    ]) {
      const file = flag(name);
      if (!file) continue;
      await page.goto(`${BASE}/accounts/${account}/sources`, { waitUntil: "networkidle" });
      await page.getByLabel(label).setInputFiles(file);
      await page.getByTestId(reportId).waitFor();
    }
```

Chaque route ouvre un contexte neuf, donc la graine et les imports sont rejoués par route : c'est voulu, IndexedDB ne survit pas au contexte.

- [x] **Étape 3 : `SKILL.md`**

Ajouter les trois options au tableau, et un paragraphe « Positions et Dashboard » :

```markdown
| `--ib-account=<id>` | Après `--seed`, remplace l'identifiant IB du compte de la première route, pour importer un vrai fichier |
| `--import=<fichier>` | Importe un Flex XML ou un relevé HTML sur Sources de données avant la capture |
| `--sectors=<fichier>` | Importe un CSV sectoriel de la même façon |

Les pages Positions et Dashboard lisent le snapshot semé par `--seed` sur `alpha`
(`src/mocks/positions.ts`) : une jambe nue, un condor, des puts cash-secured. Pour les
voir sur des données réelles :

    node .claude/skills/run-frontend/driver.mjs /accounts/beta/positions /accounts/beta/dashboard \
      --seed --ib-account=U1234567 --import=private/flex_<compte>_<date>.xml \
      --sectors=private/company.csv
```

- [x] **Étape 4 : captures sur la graine**

```bash
node .claude/skills/run-frontend/driver.mjs /accounts/alpha/positions /accounts/alpha/dashboard /accounts/alpha/sources --seed
node .claude/skills/run-frontend/driver.mjs /accounts/alpha/dashboard --seed --dark
```

Ouvrir chaque PNG avec l'outil Read et vérifier : quatre groupes sur Positions avec les badges de couverture et la colonne Secteur remplie pour AAPL, MSFT, XOM ; sur le Dashboard, la jauge verte, « Cash requis $20,500.00 », « Cash disponible $42,000.00 », la carte des non couvertes avec `AAPL 2026-02-20 C 155 — 1` ; sur Sources, la carte Table sectorielle avec « 3 tickers ». Aucune erreur console.

- [x] **Étape 5 : commit**

```bash
git add apps/web/src/mocks/seed.ts .claude/skills/run-frontend
git commit -m "chore(web): graine avec snapshot et secteurs, driver avec import de fichiers

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LJLvsD7TGEDB8mTSTxfmwy"
```

---

## Tâche 16 : acceptation sur données réelles

Aucun fichier committé. Lire l'identifiant IB réel dans `private/flex_<compte>_<date>.xml` (`accountId` du `FlexStatement`) sans le recopier ailleurs.

- [x] **Étape 1 : captures sur le Flex réel**

```bash
node .claude/skills/run-frontend/driver.mjs /accounts/beta/positions /accounts/beta/dashboard /accounts/beta/sources \
  --seed --ib-account=<accountId réel> --import=private/flex_<compte>_<date>.xml \
  --sectors=private/company.csv --out=/tmp/ib-real-shots
```

Lire les PNG. Vérifier :

- Sources : compte rendu avec 30 positions, un cash disponible, aucune section absente ; table sectorielle importée.
- Positions : 30 lignes réparties dans les groupes, 12 positions courtes avec un badge de couverture chacune, secteurs remplis pour les tickers présents dans `company.csv`, badge « Données du 2026-09-02 ».
- Dashboard : cash requis, cash disponible, verdict, liste des non couvertes.

- [x] **Étape 2 : comparaison avec la première version**

Relever dans un message à Seb, sans identifiant de compte : le cash requis, le cash disponible, le verdict, la liste des positions non couvertes et les badges de couverture des 12 jambes courtes. Lui demander de lancer la première version sur son Mac (`./launch_ib_option_analyzer.sh`, TWS ouvert) le même jour et de comparer : mêmes positions, mêmes verdicts de couverture, même cash requis, mêmes non couvertes. Les prix et le P&L diffèrent (intraday contre clôture de la veille) ; le cash disponible diffère des mouvements du jour. Tout écart de couverture est un bug à traiter avant la fin de branche, avec `superpowers:systematic-debugging`.

---

## Tâche 17 : documentation et fin de branche

**Files:**
- Modify: `CLAUDE.md`, `docs/specs/2026-09-03-architecture-design.md`, `docs/points-reportes.md`, `README.md`

- [x] **Étape 1 : `CLAUDE.md`**

- Table des sous-projets : ligne 2 passe de `en cours, branche couverture-positions…` à
  `fait (2026-09-xx)` avec la date du merge.
- Tableau « Reste à copier » : supprimer les trois lignes du sous-projet 2
  (moteur Python, pages Positions et Dashboard, table sectorielle) ; seule reste la passerelle
  TWS du sous-projet 4. Le compte de tests (115) y est déjà correct.
- Section « Règles qui mordent » : ajouter « **`Position` vit dans `packages/ledger`**, `avgPrice` par unité, `expiry` en `YYYY-MM-DD`, `symbol` = sous-jacent pour une option » et « **Le snapshot de positions est un document par compte**, remplacé quand le `asOf` du fichier est supérieur ou égal ».
- Section « Outillage » : « `pnpm oracle` régénère les fixtures d'oracle (`tools/coverage-oracle`, premier projet uv du dépôt) ; `pnpm check` ne lance jamais de Python ». Ajouter `--import=`, `--sectors=`, `--ib-account=` du skill.
- Section « Tests » : « `coverage` : oracle strict + 115 tests portés ; un écart est un bug du port ».

- [x] **Étape 2 : spec fondateur et dette**

- `docs/specs/2026-09-03-architecture-design.md` : §6.4 « Les 197 tests Python portés » → « Les 115 tests Python portés » ; §14 « ses 197 tests » → « ses 115 tests ». Rien d'autre.
- `docs/points-reportes.md` : supprimer « Avant tout le reste : régénérer la fixture Flex » (fait). Déplacer les quatre points « Parseurs » et les deux points « Fixture anonymisée » vers « Sans échéance », en corrigeant : `column-missing` est câblé sur `Trades` et `Open Positions`, pas sur les sections de cash ; l'énumération des codes du spec §4.1 reste périmée. Ajouter sous « À traiter au sous-projet 4 » : « `SnapshotRecord.source` n'accepte que `flex` ; l'agent y ajoutera `agent` et le bouton Actualiser ». Ajouter sous « Sans échéance » : « Le corpus de l'oracle ne contient qu'un portefeuille réel (`beta`) ; en extraire un de `alpha` quand un Flex en existera » et « `label` des positions reste en anglais quelle que soit la langue, comme dans la première version ».

- [x] **Étape 3 : `README.md`**

Section « Utiliser sans serveur (palier 2) » : l'étape 2 cite les sections Flex attendues (`Trades`, `Cash Transactions`, `Corporate Actions`, `Open Positions`, `Cash Report`) et l'import CSV de la table sectorielle ; ajouter une étape « Positions et Dashboard : couverture de chaque option courte, cash requis contre disponible, positions non couvertes ». Section « Structure » : ajouter `packages/coverage` et `tools/coverage-oracle`.

- [x] **Étape 4 : vérification complète et commit**

```bash
pnpm check
(cd tools/coverage-oracle && uv run pytest -q)
git add CLAUDE.md README.md docs
git commit -m "docs: CLAUDE.md, README et dette à jour du sous-projet 2

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LJLvsD7TGEDB8mTSTxfmwy"
```

- [x] **Étape 5 : fin de branche**

Invoquer `superpowers:finishing-a-development-branch` : revue de la branche complète, `pnpm check` vert, merge sur `main`, suppression du worktree.

---

## Auto-revue du plan

- **Couverture du spec** : §2 `Position` → tâche 1 ; §3.1 forme du port et sortie → tâches 1 à 3 ; §3.2 modules → tâches 1 à 3 ; §3.3 écarts → tâches 2 (avgPrice) et 4 (null, cash inconnu) ; §3.4 vérification → tâches 4 (115 tests) et 7-8 (oracle) ; §4 oracle → tâches 7 et 8 ; §5.1 à §5.3 parseur → tâche 5 ; §5.4 fixture → tâche 6 ; §6.1 schéma → tâche 9 ; §6.2 importFile → tâche 10 ; §6.3 CSV → tâche 11 ; §6.4 hooks → tâche 9 ; §6.5 graine → tâche 15 ; §7.1 à §7.3 pages → tâches 12 et 13 ; §7.4 Sources → tâche 14 ; §7.5 docs → tâche 17 ; §8.1 tests → chaque tâche, garde-fou des constantes en tâche 12 ; §8.2 manuel → tâche 16.
- **Hors périmètre respecté** : pas de bouton Actualiser, pas d'agrégation par secteur, pas de positions dérivées du ledger, pas de traduction des libellés du moteur.
- **Cohérence des noms** : `Position`, `FlexSnapshot`, `SnapshotRecord`, `SectorRecord`, `buildRiskReport`, `computeCoverage`, `normalizeExpiry`, `fmtExpiry`, `fmtNum`, `fmtFixed2`, `fmtMoney`, `cashOk` (`boolean | null`), `uncovered`, `groupedPositions` (`{ id, title, positions }`), `groupTitleKey`, `useSnapshot`, `useSectors`, `useRiskReport` (`{ snapshot, report, sectorOf }`), `importSectorCsv`, `SectorImportReport`, `ImportReport.positions|cashAvailable|staleSnapshot`, `SAMPLE_POSITIONS|SAMPLE_SNAPSHOT|SAMPLE_SECTORS` sont définis avant d'être consommés et portent le même nom partout.
- **Ordre des tâches** : la fixture (6) précède l'extraction du corpus (8) ; le schéma (9) précède l'import (10) et les pages (12, 13) ; les pages précèdent la graine (15).
