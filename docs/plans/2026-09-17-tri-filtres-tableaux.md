# Sous-projet 20 — Tri et filtres de colonne des tableaux : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trier l'Historique et Positions par clic sur l'en-tête, les filtrer par colonne dans une petite grammaire (`>100`, `100..500`, `AAPL|MSFT`, `—`) ou par cases à cocher, avec une recherche par ticker commune à la page, l'état étant mémorisé dans `localStorage` par compte et par tableau.

**Architecture:** Tout vit dans `apps/web`. (1) *Moteur pur* : `lib/tableCriteria.ts` lit une saisie en prédicat ; `lib/tableView.ts` définit `ColumnSpec`, `TableView`, et `applyView`, `facetValues`, `nextSort`, `activeCriteria` ; `lib/tableViewStorage.ts` lit et écrit l'état sous `ib2:tableView:` et `ib2:pageSearch:`. (2) *Colonnes* : `historyColumnSpecs` et `positionColumnSpecs` à côté des colonnes existantes, `coverageValues` dans `lib/riskReport.ts`. (3) *Interface* : hooks `useTableView` et `usePageSearch`, composants `components/table/ColumnHeader.tsx` et `ActiveFilters.tsx` sur `popover` et `checkbox` de `packages/ui`, branchés dans `HistoryTable`/`HistoryPage` puis `PositionTable`/`PositionsPage`. (4) *Retraits* : filtres et raccourcis de l'Historique, `matchesFilter`/`filterTransactions` de `packages/ledger`.

**Tech Stack:** TypeScript 6, Vitest 4, React 19, react-router 8, Dexie 4 (`fake-indexeddb` en test), react-i18next, shadcn base-ui (`@base-ui/react` 1.7), lucide-react, `@tanstack/react-virtual`, Testing Library. Node 22, pnpm.

**Spec:** `docs/specs/2026-09-17-tri-filtres-tableaux-design.md` (lire aussi `CLAUDE.md`).

## Global Constraints

- **Rien dans `apps/api`, rien en IndexedDB** : l'état de tri et de filtres est une préférence d'affichage en `localStorage`, jamais une table Dexie, jamais envoyé au serveur.
- **Clés `localStorage`** exactement : `ib2:tableView:<accountId>:history`, `ib2:tableView:<accountId>:positions:<groupId>`, `ib2:pageSearch:<accountId>:history`, `ib2:pageSearch:<accountId>:positions`. Contenu `{ "v": 1, ... }`. Toute lecture et écriture sous `try/catch`.
- **Une valeur absente reste `null`**, s'affiche « — », **trie en dernier dans les deux sens**, et n'est retenue que par le terme `—`/`-` (ou exclue par `!—`).
- **Les enum stockent la valeur brute** (`trade`, `buy back`, `UNCOVERED`), jamais un libellé traduit.
- **Les soldes USD/EUR de l'Historique se calculent sur tout le ledger avant tout filtre ou tri** (`anchoredBalances` inchangé).
- **La barre temporelle n'est rendue que sans tri** (`view.sort` vide). `HISTORY_ROW_HEIGHT` et la hauteur constante des lignes ne changent pas.
- **`POSITION_COLUMNS` et `HISTORY_COLUMNS` gardent leur forme et leur ordre** : les specs s'y ajoutent, dans les mêmes fichiers, dans le même ordre.
- **Hors périmètre, ne pas toucher** : `StrategyPositionsPage`, `WHEEL_SHARE_COLUMNS`, `PositionSuggestionsCard`, `CashBalancesCard`, Journaux, Secteurs, Sources.
- **shadcn ici est base-ui** : `render={<X/>}`, jamais `asChild` ; `onValueChange`/`onCheckedChange` typés base-ui. Seuls nouveaux composants shadcn : `popover` et `checkbox`, imports `@/` réécrits en relatifs (`packages/ui/README.md`).
- **Aucune nouvelle dépendance npm** (les composants shadcn reposent sur `@base-ui/react` et `lucide-react`, déjà là).
- **Toute phrase visible vit dans `apps/web/src/i18n/{fr,en}.json`, mêmes clés dans les deux.**
- **Un test doit échouer si le comportement change.** `apps/web` teste sur `fake-indexeddb` avec une base semée, **jamais en moquant les hooks**. Chaque fichier de test qui touche `localStorage` le vide dans son `beforeEach`.
- Code et commentaires en anglais ; documentation, i18n et messages de commit en français.
- Chaque commit se termine par la ligne :
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```
- Le travail se fait dans un worktree `.claude/worktrees/tri-filtres` (skill `superpowers:using-git-worktrees`), branche `tri-filtres`, mergé sur `main` après revue. `pnpm install` dans le worktree avant la première tâche.
- **Les cases de ce plan se cochent dans le worktree au fur et à mesure, dans le même commit que la tâche.**
- Commandes lancées depuis la racine du worktree : un test ciblé par `pnpm --filter web test src/chemin/fichier.test.ts`, le typage par `pnpm --filter web typecheck`, tout par `pnpm check`.

### Écart assumé au spec

Le §5.4 du spec remonte le tableau de l'Historique en changeant sa `key` à chaque changement de vue. Or les popovers de filtre vivent dans l'en-tête du tableau : un remontage à chaque frappe fermerait le popover sous les doigts. **La `key` ne porte plus que le compte** ; un changement de recherche ou de vue remet `scrollTop` à 0 dans un `useLayoutEffect` de `HistoryTable` et émet un événement `scroll` synchrone pour que le virtualiseur suive avant la peinture. La tâche 7 corrige le §5.4 du spec et la règle « L'Historique ne pagine pas » de `CLAUDE.md` en conséquence.

---

## Structure des fichiers

```
packages/ui/src/components/ui/
  popover.tsx                  NOUVEAU (shadcn add, base-ui)
  checkbox.tsx                 NOUVEAU (shadcn add, base-ui)
packages/ledger/src/
  filter.ts                    ne garde que dayOf
  filter.test.ts               ne garde que les tests de dayOf
apps/web/src/
  lib/
    tableCriteria.ts (+ test)  NOUVEAU  parseCriterion, types de critère
    tableView.ts (+ test)      NOUVEAU  ColumnSpec, TableView, applyView, facetValues, nextSort, activeCriteria
    tableViewStorage.ts (+ t)  NOUVEAU  clés, lecture/écriture, clearTableViews
    historyColumns.ts (+ test) historyColumnSpecs, historyTicker
    positionColumns.ts (+ t)   positionColumnSpecs
    riskReport.ts (+ test)     coverageValues
    periodPresets.ts (+ test)  SUPPRIMÉS
  hooks/
    useTableView.ts (+ test)   NOUVEAU  useTableView, usePageSearch
  components/
    table/ColumnHeader.tsx     NOUVEAU  en-tête triable + popover de filtre
    table/ActiveFilters.tsx    NOUVEAU  pastilles et « Tout effacer »
    table/ColumnHeader.test.tsx, ActiveFilters.test.tsx
    history/HistoryTable.tsx   en-têtes interactifs, message vide, barre temporelle conditionnelle, retour en haut
    PositionTable.tsx          PositionTableHeader accepte des en-têtes interactifs
    PositionGroupCard.tsx      NOUVEAU  une carte de groupe avec son état
  pages/
    HistoryPage.tsx (+ test)   recherche de page, liste Type multiple, plus d'anciens filtres
    PositionsPage.tsx (+ test) recherche de page, cartes de groupe
  db/accounts.ts (+ test)      deleteAccount appelle clearTableViews
  i18n/fr.json, en.json        tableFilter.*, searchPlaceholder ; retraits
CLAUDE.md                      ligne 20, règle, retouche de la règle Historique
docs/specs/2026-09-17-tri-filtres-tableaux-design.md   §5.4 corrigé, statut
```

---

### Task 1: Grammaire des critères — `parseCriterion`

**Files:**
- Create: `apps/web/src/lib/tableCriteria.ts`
- Test: `apps/web/src/lib/tableCriteria.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces:
  ```ts
  export type ColumnType = "text" | "number" | "date" | "enum";
  export type CellValue = string | number | null;
  export type CriterionError = "number" | "date" | "textOperator" | "syntax";
  export type Predicate = (value: CellValue) => boolean;
  /** `test: null` means the input filters nothing (blank). */
  export type ParsedCriterion = { ok: true; test: Predicate | null } | { ok: false; error: CriterionError };
  export function parseCriterion(text: string, type: Exclude<ColumnType, "enum">): ParsedCriterion;
  ```
  Une colonne `date` est comparée sur la chaîne `YYYY-MM-DD HH:MM:SS` de `formatDateTime`.

- [x] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { parseCriterion, type CellValue } from "@/lib/tableCriteria";

/** The values among `values` that the criterion keeps; throws on a parse error. */
function keep(text: string, type: "text" | "number" | "date", values: CellValue[]): CellValue[] {
  const parsed = parseCriterion(text, type);
  if (!parsed.ok) throw new Error(`unexpected error ${parsed.error}`);
  return parsed.test ? values.filter(parsed.test) : values;
}

function errorOf(text: string, type: "text" | "number" | "date") {
  const parsed = parseCriterion(text, type);
  return parsed.ok ? null : parsed.error;
}

const NUMBERS: CellValue[] = [-2000, -1, 0, 1.5, 100, 250, 500, 1000, null];

describe("parseCriterion — structure", () => {
  it("filters nothing on a blank input", () => {
    expect(parseCriterion("   ", "number")).toEqual({ ok: true, test: null });
    expect(parseCriterion("", "text")).toEqual({ ok: true, test: null });
  });

  it("reads | as OR and spaces as AND, AND binding tighter", () => {
    expect(keep("<0|>500", "number", NUMBERS)).toEqual([-2000, -1, 1000]);
    expect(keep(">0 <500", "number", NUMBERS)).toEqual([1.5, 100, 250]);
    expect(keep(">0 <200|>=1000", "number", NUMBERS)).toEqual([1.5, 100, 1000]);
  });

  it("tolerates spaces between an operator and its value", () => {
    expect(keep("> 500", "number", NUMBERS)).toEqual([1000]);
  });

  it("negates a term with !", () => {
    expect(keep("!0..500", "number", NUMBERS)).toEqual([-2000, -1, 1000]);
  });

  it("matches null only with — or -, and every other term is false on null", () => {
    expect(keep("—", "number", NUMBERS)).toEqual([null]);
    expect(keep("-", "text", ["a", null])).toEqual([null]);
    expect(keep("!—", "number", [1, null])).toEqual([1]);
    expect(keep("!-", "text", ["a", null])).toEqual(["a"]);
    expect(keep("!=0", "number", [0, 1, null])).toEqual([1]);
    expect(keep("!SPY", "text", ["SPY", "QQQ", null])).toEqual(["QQQ"]);
    expect(keep("<0|—", "number", NUMBERS)).toEqual([-2000, -1, null]);
  });

  it("rejects an empty alternative or a dangling operator", () => {
    expect(errorOf("1|", "number")).toBe("syntax");
    expect(errorOf(">", "number")).toBe("syntax");
    expect(errorOf("!", "text")).toBe("syntax");
  });
});

describe("parseCriterion — number", () => {
  it("supports every comparison operator, a bare number meaning =", () => {
    expect(keep("=100", "number", NUMBERS)).toEqual([100]);
    expect(keep("100", "number", NUMBERS)).toEqual([100]);
    expect(keep("!=0", "number", [0, 1])).toEqual([1]);
    expect(keep("<1", "number", NUMBERS)).toEqual([-2000, -1, 0]);
    expect(keep("<=1.5", "number", NUMBERS)).toEqual([-2000, -1, 0, 1.5]);
    expect(keep(">500", "number", NUMBERS)).toEqual([1000]);
    expect(keep(">=500", "number", NUMBERS)).toEqual([500, 1000]);
  });

  it("reads inclusive ranges with optional bounds", () => {
    expect(keep("100..500", "number", NUMBERS)).toEqual([100, 250, 500]);
    expect(keep("..0", "number", NUMBERS)).toEqual([-2000, -1, 0]);
    expect(keep("500..", "number", NUMBERS)).toEqual([500, 1000]);
  });

  it("accepts a comma decimal, a minus sign and a dollar sign", () => {
    expect(keep("1,5", "number", NUMBERS)).toEqual([1.5]);
    expect(keep("<-1000", "number", NUMBERS)).toEqual([-2000]);
    expect(keep("$100", "number", NUMBERS)).toEqual([100]);
  });

  it("compares the raw value, never a rounding", () => {
    expect(keep("=1.2346", "number", [1.23456])).toEqual([]);
    expect(keep("1.2345..1.2346", "number", [1.23456])).toEqual([1.23456]);
  });

  it("rejects what is not a number", () => {
    expect(errorOf(">abc", "number")).toBe("number");
    expect(errorOf("1 000", "number")).toBe("number");
    expect(errorOf("..", "number")).toBe("number");
    expect(errorOf("<1..2", "number")).toBe("syntax");
  });
});

describe("parseCriterion — date", () => {
  const WHENS: CellValue[] = [
    "2024-12-31 23:59:59",
    "2025-01-01 00:00:00",
    "2025-02-28 10:00:00",
    "2025-03-01 00:00:00",
    "2025-03-31 23:59:59",
    "2025-04-01 00:00:00",
    "2025-06-30 16:20:00",
    "2025-07-01 09:30:00",
    "2026-01-02 09:30:00",
    null,
  ];

  it("reads a partial date as its whole period", () => {
    expect(keep("2025-03", "date", WHENS)).toEqual(["2025-03-01 00:00:00", "2025-03-31 23:59:59"]);
    expect(keep("2025-02-28", "date", WHENS)).toEqual(["2025-02-28 10:00:00"]);
    expect(keep("2026", "date", WHENS)).toEqual(["2026-01-02 09:30:00"]);
  });

  it("places each operator on the right bound of the period", () => {
    expect(keep(">=2025-03", "date", WHENS)).toEqual(WHENS.slice(3, 9));
    expect(keep(">2025-03", "date", WHENS)).toEqual(WHENS.slice(5, 9));
    expect(keep("<2025", "date", WHENS)).toEqual(["2024-12-31 23:59:59"]);
    expect(keep("<=2025", "date", WHENS)).toEqual(WHENS.slice(0, 8));
    expect(keep("!=2025", "date", WHENS)).toEqual(["2024-12-31 23:59:59", "2026-01-02 09:30:00"]);
    expect(keep("!2025", "date", WHENS)).toEqual(["2024-12-31 23:59:59", "2026-01-02 09:30:00"]);
  });

  it("reads a range from the start of its first bound to the end of its last", () => {
    expect(keep("2024..2025-06", "date", WHENS)).toEqual(WHENS.slice(0, 7));
    expect(keep("2025-07..", "date", WHENS)).toEqual(WHENS.slice(7, 9));
  });

  it("rejects a month or a day that does not exist", () => {
    expect(errorOf("2025-13", "date")).toBe("date");
    expect(errorOf("2025-02-30", "date")).toBe("date");
    expect(errorOf("2025-2", "date")).toBe("date");
    expect(errorOf("hier", "date")).toBe("date");
  });
});

describe("parseCriterion — text", () => {
  const LABELS: CellValue[] = ["AAPL Jan16'26 150 Call", "AAPL", "MSFT", "ZXAL.OLD", "a*b", null];

  it("finds a case-insensitive substring by default", () => {
    expect(keep("aap", "text", LABELS)).toEqual(["AAPL Jan16'26 150 Call", "AAPL"]);
  });

  it("reads = as exact equality and != as its opposite", () => {
    expect(keep("=aapl", "text", LABELS)).toEqual(["AAPL"]);
    expect(keep("!=AAPL", "text", LABELS)).toEqual(["AAPL Jan16'26 150 Call", "MSFT", "ZXAL.OLD", "a*b"]);
  });

  it("treats * as a wildcard only after = or !=", () => {
    expect(keep("=AA*", "text", LABELS)).toEqual(["AAPL Jan16'26 150 Call", "AAPL"]);
    expect(keep("=*Call", "text", LABELS)).toEqual(["AAPL Jan16'26 150 Call"]);
    expect(keep("a*b", "text", LABELS)).toEqual(["a*b"]);
  });

  it("keeps the OR of tickers", () => {
    expect(keep("=AAPL|=MSFT", "text", LABELS)).toEqual(["AAPL", "MSFT"]);
  });

  it("rejects comparison operators and ranges on text", () => {
    expect(errorOf("<AAPL", "text")).toBe("textOperator");
    expect(errorOf(">=B", "text")).toBe("textOperator");
    expect(errorOf("A..B", "text")).toBe("textOperator");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test src/lib/tableCriteria.test.ts`
Expected: FAIL, `Failed to resolve import "@/lib/tableCriteria"`.

- [x] **Step 3: Write the implementation**

```ts
/**
 * The criterion grammar of a column filter (spec of sub-project 20, §2): `|` separates
 * alternatives (OR), spaces separate terms (AND), `!` negates a term, `—` or `-` alone stands for
 * an absent value. Every term other than the absent one is false on `null`.
 */

export type ColumnType = "text" | "number" | "date" | "enum";
export type CellValue = string | number | null;
export type CriterionError = "number" | "date" | "textOperator" | "syntax";
export type Predicate = (value: CellValue) => boolean;
/** `test: null` means the input filters nothing (blank). */
export type ParsedCriterion = { ok: true; test: Predicate | null } | { ok: false; error: CriterionError };

type Operator = "" | "=" | "!=" | "<" | "<=" | ">" | ">=";

interface Term {
  negate: boolean;
  op: Operator;
  body: string;
}

class CriterionFailure extends Error {
  constructor(readonly code: CriterionError) {
    super(code);
  }
}

const OPERATORS: readonly Operator[] = ["!=", "<=", ">=", "=", "<", ">"];

function readTerms(alternative: string): Term[] {
  const terms: Term[] = [];
  let rest = alternative.trim();
  while (rest.length > 0) {
    let negate = false;
    if (rest.startsWith("!") && !rest.startsWith("!=")) {
      negate = true;
      rest = rest.slice(1).trimStart();
    }
    let op: Operator = "";
    for (const candidate of OPERATORS) {
      if (rest.startsWith(candidate)) {
        op = candidate;
        rest = rest.slice(candidate.length).trimStart();
        break;
      }
    }
    const match = /^\S+/.exec(rest);
    if (!match) throw new CriterionFailure("syntax");
    terms.push({ negate, op, body: match[0] });
    rest = rest.slice(match[0].length).trimStart();
  }
  return terms;
}

const isAbsentBody = (body: string) => body === "—" || body === "-";

function parseNumber(text: string): number {
  const cleaned = text.replace("$", "").replace(",", ".");
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(cleaned)) throw new CriterionFailure("number");
  return Number(cleaned);
}

interface Period {
  start: string;
  end: string;
}

function parsePeriod(text: string): Period {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(text);
  if (!match) throw new CriterionFailure("date");
  const [, year, month, day] = match;
  if (month === undefined) return { start: `${year}-01-01 00:00:00`, end: `${year}-12-31 23:59:59` };
  const monthIndex = Number(month);
  if (monthIndex < 1 || monthIndex > 12) throw new CriterionFailure("date");
  // Day 0 of the next month is the last day of this one.
  const lastDay = new Date(Date.UTC(Number(year), monthIndex, 0)).getUTCDate();
  if (day === undefined) {
    return { start: `${year}-${month}-01 00:00:00`, end: `${year}-${month}-${String(lastDay).padStart(2, "0")} 23:59:59` };
  }
  const dayIndex = Number(day);
  if (dayIndex < 1 || dayIndex > lastDay) throw new CriterionFailure("date");
  return { start: `${year}-${month}-${day} 00:00:00`, end: `${year}-${month}-${day} 23:59:59` };
}

/** Splits `a..b`; `null` when the body is not a range. Both bounds may not be empty. */
function splitRange(body: string): [string, string] | null {
  const index = body.indexOf("..");
  if (index < 0) return null;
  return [body.slice(0, index), body.slice(index + 2)];
}

function numberTerm(term: Term): (value: number) => boolean {
  const range = splitRange(term.body);
  if (range) {
    if (term.op !== "") throw new CriterionFailure("syntax");
    const [low, high] = range;
    if (low === "" && high === "") throw new CriterionFailure("number");
    const min = low === "" ? -Infinity : parseNumber(low);
    const max = high === "" ? Infinity : parseNumber(high);
    return (value) => value >= min && value <= max;
  }
  const target = parseNumber(term.body);
  switch (term.op) {
    case "":
    case "=":
      return (value) => value === target;
    case "!=":
      return (value) => value !== target;
    case "<":
      return (value) => value < target;
    case "<=":
      return (value) => value <= target;
    case ">":
      return (value) => value > target;
    case ">=":
      return (value) => value >= target;
  }
}

function dateTerm(term: Term): (value: string) => boolean {
  const range = splitRange(term.body);
  if (range) {
    if (term.op !== "") throw new CriterionFailure("syntax");
    const [low, high] = range;
    if (low === "" && high === "") throw new CriterionFailure("date");
    const start = low === "" ? "" : parsePeriod(low).start;
    const end = high === "" ? "￿" : parsePeriod(high).end;
    return (value) => value >= start && value <= end;
  }
  const period = parsePeriod(term.body);
  switch (term.op) {
    case "":
    case "=":
      return (value) => value >= period.start && value <= period.end;
    case "!=":
      return (value) => value < period.start || value > period.end;
    case "<":
      return (value) => value < period.start;
    case "<=":
      return (value) => value <= period.end;
    case ">":
      return (value) => value > period.end;
    case ">=":
      return (value) => value >= period.start;
  }
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function textTerm(term: Term): (value: string) => boolean {
  if (term.op === "<" || term.op === "<=" || term.op === ">" || term.op === ">=" || term.body.includes("..")) {
    throw new CriterionFailure("textOperator");
  }
  const needle = term.body.toLowerCase();
  if (term.op === "") return (value) => value.toLowerCase().includes(needle);
  const exact = term.body.includes("*") ? globToRegExp(term.body) : null;
  const equals = (value: string) => (exact ? exact.test(value) : value.toLowerCase() === needle);
  return term.op === "=" ? equals : (value) => !equals(value);
}

function termPredicate(term: Term, type: Exclude<ColumnType, "enum">): Predicate {
  if (isAbsentBody(term.body) && (term.op === "" || term.op === "=" || term.op === "!=")) {
    const wantsNull = (term.op !== "!=") !== term.negate;
    return (value) => (value === null) === wantsNull;
  }
  let base: (value: never) => boolean;
  if (type === "number") base = numberTerm(term) as (value: never) => boolean;
  else if (type === "date") base = dateTerm(term) as (value: never) => boolean;
  else base = textTerm(term) as (value: never) => boolean;
  return (value) => {
    if (value === null) return false;
    if (type === "number" ? typeof value !== "number" : typeof value !== "string") return false;
    const result = base(value as never);
    return term.negate ? !result : result;
  };
}

export function parseCriterion(text: string, type: Exclude<ColumnType, "enum">): ParsedCriterion {
  if (text.trim() === "") return { ok: true, test: null };
  try {
    const alternatives = text.split("|").map((alternative) => {
      if (alternative.trim() === "") throw new CriterionFailure("syntax");
      return readTerms(alternative).map((term) => termPredicate(term, type));
    });
    return {
      ok: true,
      test: (value) => alternatives.some((terms) => terms.every((predicate) => predicate(value))),
    };
  } catch (failure) {
    if (failure instanceof CriterionFailure) return { ok: false, error: failure.code };
    throw failure;
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test src/lib/tableCriteria.test.ts`
Expected: PASS. Si un cas échoue, corriger l'implémentation, jamais le test : les attentes recopient le §2 du spec.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/lib/tableCriteria.ts apps/web/src/lib/tableCriteria.test.ts docs/plans/2026-09-17-tri-filtres-tableaux.md
git commit -m "Grammaire des critères de filtre de colonne

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Vue d'un tableau — `applyView`, `facetValues`, `nextSort`, `activeCriteria`

**Files:**
- Create: `apps/web/src/lib/tableView.ts`
- Test: `apps/web/src/lib/tableView.test.ts`

**Interfaces:**
- Consumes (tâche 1) : `parseCriterion`, `ColumnType`, `CellValue`.
- Produces:
  ```ts
  export type SortDirection = "asc" | "desc";
  export interface SortKey { column: string; dir: SortDirection }
  /** Text typed for text/number/date columns, raw checked values for enum columns. */
  export type Criterion = string | readonly (string | null)[];
  export interface TableView { sort: readonly SortKey[]; criteria: Readonly<Record<string, Criterion>> }
  export const EMPTY_VIEW: TableView;
  export interface ColumnMeta { key: string; type: ColumnType; sortable: boolean }
  export interface ColumnSpec<Row> extends ColumnMeta {
    /** `null` for "—"; an array for a multi-valued enum column. */
    value: (row: Row) => CellValue | readonly string[];
    /** Display label of an enum value (translated by the caller). */
    label?: (value: string) => string;
  }
  export interface PageSearch<Row> { text: string; ticker: (row: Row) => string | null }
  export interface Facet { value: string | null; label: string | null; count: number }
  export function applyView<Row>(rows: readonly Row[], specs: readonly ColumnSpec<Row>[], view: TableView, search?: PageSearch<Row>): Row[];
  export function facetValues<Row>(rows: readonly Row[], spec: ColumnSpec<Row>, checked: readonly (string | null)[]): Facet[];
  export function nextSort(sort: readonly SortKey[], column: string, additive: boolean): SortKey[];
  /** Columns whose criterion actually filters (valid, non-empty), in spec order. */
  export function activeCriteria<Row>(specs: readonly ColumnSpec<Row>[], view: TableView): { spec: ColumnSpec<Row>; criterion: Criterion }[];
  /** Whether a criterion filters anything for this column: a non-empty checked list, or a valid non-blank text. */
  export function isActiveCriterion(meta: ColumnMeta, criterion: Criterion | undefined): boolean;
  ```

- [x] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { activeCriteria, applyView, EMPTY_VIEW, facetValues, isActiveCriterion, nextSort, type ColumnSpec, type TableView } from "@/lib/tableView";

interface Row {
  id: string;
  name: string;
  amount: number | null;
  kind: string | null;
  tags: string[];
  ticker: string | null;
}

const ROWS: Row[] = [
  { id: "a", name: "AAPL 2026-01-16 150 C", amount: 100, kind: "trade", tags: ["cash"], ticker: "AAPL" },
  { id: "b", name: "AAPL 2026-01-16 95 C", amount: null, kind: "dividend", tags: [], ticker: "AAPL" },
  { id: "c", name: "MSFT", amount: -50, kind: "trade", tags: ["stock", "UNCOVERED"], ticker: "MSFT" },
  { id: "d", name: "deposit", amount: 100, kind: null, tags: ["UNCOVERED"], ticker: null },
];

const SPECS: ColumnSpec<Row>[] = [
  { key: "name", type: "text", sortable: true, value: (row) => row.name },
  { key: "amount", type: "number", sortable: true, value: (row) => row.amount },
  { key: "kind", type: "enum", sortable: true, value: (row) => row.kind, label: (value) => ({ trade: "Zz trade", dividend: "Aa dividend" })[value] ?? value },
  { key: "tags", type: "enum", sortable: false, value: (row) => row.tags },
];

const ids = (rows: Row[]) => rows.map((row) => row.id);
const view = (partial: Partial<TableView>): TableView => ({ ...EMPTY_VIEW, ...partial });
const TICKER = { ticker: (row: Row) => row.ticker };

describe("applyView — filters", () => {
  it("keeps the input order without sort nor criteria", () => {
    expect(ids(applyView(ROWS, SPECS, EMPTY_VIEW))).toEqual(["a", "b", "c", "d"]);
  });

  it("ANDs the criteria of several columns", () => {
    expect(ids(applyView(ROWS, SPECS, view({ criteria: { amount: ">0", kind: ["trade"] } })))).toEqual(["a"]);
  });

  it("ignores an invalid criterion, an unknown column and a text criterion on an enum column", () => {
    expect(ids(applyView(ROWS, SPECS, view({ criteria: { amount: ">abc", ghost: "x", kind: "trade" } })))).toEqual(["a", "b", "c", "d"]);
  });

  it("filters an enum on the checked values, null standing for —", () => {
    expect(ids(applyView(ROWS, SPECS, view({ criteria: { kind: [null, "dividend"] } })))).toEqual(["b", "d"]);
    expect(ids(applyView(ROWS, SPECS, view({ criteria: { kind: [] } })))).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps a multi-valued row when at least one of its values is checked, an empty one only under —", () => {
    expect(ids(applyView(ROWS, SPECS, view({ criteria: { tags: ["UNCOVERED"] } })))).toEqual(["c", "d"]);
    expect(ids(applyView(ROWS, SPECS, view({ criteria: { tags: [null] } })))).toEqual(["b"]);
  });

  it("applies the page search on the ticker, with the text grammar", () => {
    expect(ids(applyView(ROWS, SPECS, EMPTY_VIEW, { text: "=AAPL|=MSFT", ...TICKER }))).toEqual(["a", "b", "c"]);
    expect(ids(applyView(ROWS, SPECS, EMPTY_VIEW, { text: "150", ...TICKER }))).toEqual([]);
    expect(ids(applyView(ROWS, SPECS, EMPTY_VIEW, { text: ">x", ...TICKER }))).toEqual(["a", "b", "c", "d"]);
  });
});

describe("applyView — sort", () => {
  it("sorts numbers with null last in both directions, stably", () => {
    expect(ids(applyView(ROWS, SPECS, view({ sort: [{ column: "amount", dir: "asc" }] })))).toEqual(["c", "a", "d", "b"]);
    expect(ids(applyView(ROWS, SPECS, view({ sort: [{ column: "amount", dir: "desc" }] })))).toEqual(["a", "d", "c", "b"]);
  });

  it("sorts text naturally: 95 before 150", () => {
    expect(ids(applyView(ROWS, SPECS, view({ sort: [{ column: "name", dir: "asc" }] })))).toEqual(["b", "a", "d", "c"]);
  });

  it("sorts an enum on its label, then on a secondary key", () => {
    expect(ids(applyView(ROWS, SPECS, view({ sort: [{ column: "kind", dir: "asc" }, { column: "amount", dir: "asc" }] })))).toEqual([
      "b", "c", "a", "d",
    ]);
  });

  it("ignores a non-sortable or unknown column", () => {
    expect(ids(applyView(ROWS, SPECS, view({ sort: [{ column: "tags", dir: "asc" }, { column: "ghost", dir: "desc" }] })))).toEqual([
      "a", "b", "c", "d",
    ]);
  });
});

describe("facetValues", () => {
  it("counts each value, sorted by label, null last", () => {
    expect(facetValues(ROWS, SPECS[2], [])).toEqual([
      { value: "dividend", label: "Aa dividend", count: 1 },
      { value: "trade", label: "Zz trade", count: 2 },
      { value: null, label: null, count: 1 },
    ]);
  });

  it("keeps a checked value that no row carries, at 0", () => {
    expect(facetValues(ROWS.slice(0, 1), SPECS[2], ["dividend"])).toEqual([
      { value: "dividend", label: "Aa dividend", count: 0 },
      { value: "trade", label: "Zz trade", count: 1 },
    ]);
  });

  it("counts every value of a multi-valued row once, and an empty row as —", () => {
    expect(facetValues(ROWS, SPECS[3], [])).toEqual([
      { value: "cash", label: "cash", count: 1 },
      { value: "stock", label: "stock", count: 1 },
      { value: "UNCOVERED", label: "UNCOVERED", count: 2 },
      { value: null, label: null, count: 1 },
    ]);
  });
});

describe("nextSort", () => {
  it("cycles a lone column asc → desc → none", () => {
    const asc = nextSort([], "amount", false);
    expect(asc).toEqual([{ column: "amount", dir: "asc" }]);
    const desc = nextSort(asc, "amount", false);
    expect(desc).toEqual([{ column: "amount", dir: "desc" }]);
    expect(nextSort(desc, "amount", false)).toEqual([]);
  });

  it("replaces the whole sort on a plain click on another column", () => {
    expect(nextSort([{ column: "amount", dir: "desc" }, { column: "name", dir: "asc" }], "name", false)).toEqual([{ column: "name", dir: "asc" }]);
  });

  it("adds, flips and removes one key with shift, leaving the others", () => {
    const two = nextSort([{ column: "amount", dir: "desc" }], "name", true);
    expect(two).toEqual([{ column: "amount", dir: "desc" }, { column: "name", dir: "asc" }]);
    const flipped = nextSort(two, "name", true);
    expect(flipped).toEqual([{ column: "amount", dir: "desc" }, { column: "name", dir: "desc" }]);
    expect(nextSort(flipped, "name", true)).toEqual([{ column: "amount", dir: "desc" }]);
  });
});

describe("activeCriteria", () => {
  it("lists only the criteria that filter, in spec order", () => {
    const active = activeCriteria(SPECS, view({ criteria: { kind: ["trade"], amount: ">0", name: "  ", tags: [], ghost: "x" } }));
    expect(active.map((entry) => entry.spec.key)).toEqual(["amount", "kind"]);
    expect(isActiveCriterion(SPECS[1], ">abc")).toBe(false);
    expect(isActiveCriterion(SPECS[1], undefined)).toBe(false);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test src/lib/tableView.test.ts`
Expected: FAIL, `Failed to resolve import "@/lib/tableView"`.

- [x] **Step 3: Write the implementation**

```ts
import { parseCriterion, type CellValue, type ColumnType, type Predicate } from "@/lib/tableCriteria";

export type SortDirection = "asc" | "desc";

export interface SortKey {
  column: string;
  dir: SortDirection;
}

/** Text typed for text/number/date columns, raw checked values for enum columns. */
export type Criterion = string | readonly (string | null)[];

/** What one table shows: its sort keys, first one first, and its column criteria. */
export interface TableView {
  sort: readonly SortKey[];
  criteria: Readonly<Record<string, Criterion>>;
}

export const EMPTY_VIEW: TableView = { sort: [], criteria: {} };

export interface ColumnMeta {
  key: string;
  type: ColumnType;
  sortable: boolean;
}

export interface ColumnSpec<Row> extends ColumnMeta {
  /** `null` for "—"; an array for a multi-valued enum column. */
  value: (row: Row) => CellValue | readonly string[];
  /** Display label of an enum value (translated by the caller). */
  label?: (value: string) => string;
}

export interface PageSearch<Row> {
  text: string;
  ticker: (row: Row) => string | null;
}

export interface Facet {
  value: string | null;
  /** `null` for the "—" entry: the component translates it. */
  label: string | null;
  count: number;
}

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** The predicate of a criterion over a row's value, or `null` when it filters nothing. */
function criterionTest(meta: ColumnMeta, criterion: Criterion | undefined): ((value: CellValue | readonly string[]) => boolean) | null {
  if (criterion === undefined) return null;
  if (meta.type === "enum") {
    if (typeof criterion === "string" || criterion.length === 0) return null;
    const checked = new Set(criterion);
    return (value) => (Array.isArray(value) ? (value.length === 0 ? checked.has(null) : value.some((item) => checked.has(item))) : checked.has(value as CellValue as string | null));
  }
  if (typeof criterion !== "string") return null;
  const parsed = parseCriterion(criterion, meta.type);
  if (!parsed.ok || parsed.test === null) return null;
  const test: Predicate = parsed.test;
  return (value) => !Array.isArray(value) && test(value as CellValue);
}

export function isActiveCriterion(meta: ColumnMeta, criterion: Criterion | undefined): boolean {
  return criterionTest(meta, criterion) !== null;
}

export function activeCriteria<Row>(specs: readonly ColumnSpec<Row>[], view: TableView): { spec: ColumnSpec<Row>; criterion: Criterion }[] {
  return specs.flatMap((spec) => {
    const criterion = view.criteria[spec.key];
    return criterion !== undefined && isActiveCriterion(spec, criterion) ? [{ spec, criterion }] : [];
  });
}

function sortableValue<Row>(spec: ColumnSpec<Row>, row: Row): string | number | null {
  const value = spec.value(row);
  if (Array.isArray(value) || value === null) return null;
  if (spec.type === "enum" && typeof value === "string") return spec.label?.(value) ?? value;
  return value as string | number;
}

function compareValues(a: string | number | null, b: string | number | null, dir: SortDirection): number {
  // Absent values sink to the bottom whatever the direction.
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  const order = typeof a === "number" && typeof b === "number" ? a - b : COLLATOR.compare(String(a), String(b));
  return dir === "asc" ? order : -order;
}

export function applyView<Row>(rows: readonly Row[], specs: readonly ColumnSpec<Row>[], view: TableView, search?: PageSearch<Row>): Row[] {
  const tests = specs.flatMap((spec) => {
    const test = criterionTest(spec, view.criteria[spec.key]);
    return test ? [(row: Row) => test(spec.value(row))] : [];
  });
  if (search) {
    const parsed = parseCriterion(search.text, "text");
    if (parsed.ok && parsed.test) {
      const test = parsed.test;
      tests.unshift((row) => test(search.ticker(row)));
    }
  }
  const filtered = tests.length === 0 ? [...rows] : rows.filter((row) => tests.every((test) => test(row)));
  const keys = view.sort.flatMap((key) => {
    const spec = specs.find((candidate) => candidate.key === key.column);
    return spec && spec.sortable ? [{ spec, dir: key.dir }] : [];
  });
  if (keys.length === 0) return filtered;
  // Array.prototype.sort is stable: rows equal on every key keep their input order.
  return filtered.sort((left, right) => {
    for (const { spec, dir } of keys) {
      const order = compareValues(sortableValue(spec, left), sortableValue(spec, right), dir);
      if (order !== 0) return order;
    }
    return 0;
  });
}

export function facetValues<Row>(rows: readonly Row[], spec: ColumnSpec<Row>, checked: readonly (string | null)[]): Facet[] {
  const counts = new Map<string | null, number>();
  const bump = (value: string | null) => counts.set(value, (counts.get(value) ?? 0) + 1);
  for (const row of rows) {
    const value = spec.value(row);
    if (Array.isArray(value)) {
      if (value.length === 0) bump(null);
      else new Set(value).forEach((item) => bump(item));
    } else {
      bump(value === null ? null : String(value));
    }
  }
  for (const value of checked) if (!counts.has(value)) counts.set(value, 0);
  const labelOf = (value: string) => spec.label?.(value) ?? value;
  const named = [...counts.entries()]
    .filter((entry): entry is [string, number] => entry[0] !== null)
    .map(([value, count]) => ({ value, label: labelOf(value), count }))
    .sort((a, b) => COLLATOR.compare(a.label, b.label));
  const empty = counts.get(null);
  return empty === undefined ? named : [...named, { value: null, label: null, count: empty }];
}

export function nextSort(sort: readonly SortKey[], column: string, additive: boolean): SortKey[] {
  const index = sort.findIndex((key) => key.column === column);
  if (!additive) {
    if (sort.length === 1 && index === 0) return sort[0].dir === "asc" ? [{ column, dir: "desc" }] : [];
    return [{ column, dir: "asc" }];
  }
  if (index < 0) return [...sort, { column, dir: "asc" }];
  if (sort[index].dir === "asc") return sort.map((key, i) => (i === index ? { column, dir: "desc" } : key));
  return sort.filter((_, i) => i !== index);
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test src/lib/tableView.test.ts && pnpm --filter web typecheck`
Expected: PASS, aucun erreur de typage.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/lib/tableView.ts apps/web/src/lib/tableView.test.ts docs/plans/2026-09-17-tri-filtres-tableaux.md
git commit -m "Filtrage, tri et valeurs présentes d'un tableau

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Mémorisation — `tableViewStorage` et suppression d'un compte

**Files:**
- Create: `apps/web/src/lib/tableViewStorage.ts`
- Test: `apps/web/src/lib/tableViewStorage.test.ts`
- Modify: `apps/web/src/db/accounts.ts` (`deleteAccount`, ligne ~113)
- Test: `apps/web/src/db/accounts.test.ts` (bloc `describe("deleteAccount")`)

**Interfaces:**
- Consumes (tâche 2) : `TableView`, `EMPTY_VIEW`, `ColumnMeta`, `isActiveCriterion`, `Criterion`, `SortKey`.
- Produces:
  ```ts
  export function tableViewKey(accountId: string, table: string): string;   // "ib2:tableView:<id>:<table>"
  export function pageSearchKey(accountId: string, page: string): string;   // "ib2:pageSearch:<id>:<page>"
  export function readTableView(key: string, columns: readonly ColumnMeta[]): TableView;
  export function writeTableView(key: string, view: TableView): void;
  export function readPageSearch(key: string): string;
  export function writePageSearch(key: string, text: string): void;
  export function clearTableViews(accountId: string): void;
  ```

- [x] **Step 1: Write the failing test**

`apps/web/src/lib/tableViewStorage.test.ts` :

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_VIEW, type ColumnMeta } from "@/lib/tableView";
import {
  clearTableViews,
  pageSearchKey,
  readPageSearch,
  readTableView,
  tableViewKey,
  writePageSearch,
  writeTableView,
} from "@/lib/tableViewStorage";

const COLUMNS: ColumnMeta[] = [
  { key: "amount", type: "number", sortable: true },
  { key: "kind", type: "enum", sortable: true },
  { key: "coverage", type: "enum", sortable: false },
];

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tableViewStorage", () => {
  it("builds the keys on the ib2: prefix, per account and table", () => {
    expect(tableViewKey("alpha", "positions:optionSells")).toBe("ib2:tableView:alpha:positions:optionSells");
    expect(pageSearchKey("beta", "history")).toBe("ib2:pageSearch:beta:history");
  });

  it("reads back what it wrote", () => {
    const view = { sort: [{ column: "amount", dir: "desc" as const }], criteria: { amount: ">0", kind: ["trade", null] } };
    writeTableView(tableViewKey("alpha", "history"), view);
    expect(JSON.parse(window.localStorage.getItem("ib2:tableView:alpha:history")!)).toEqual({ v: 1, ...view });
    expect(readTableView(tableViewKey("alpha", "history"), COLUMNS)).toEqual(view);
  });

  it("keeps alpha and beta apart", () => {
    writeTableView(tableViewKey("alpha", "history"), { sort: [], criteria: { amount: ">0" } });
    expect(readTableView(tableViewKey("beta", "history"), COLUMNS)).toEqual(EMPTY_VIEW);
  });

  it("removes the key when the view is empty", () => {
    const key = tableViewKey("alpha", "history");
    writeTableView(key, { sort: [], criteria: { amount: ">0" } });
    writeTableView(key, { sort: [], criteria: { amount: "", kind: [] } });
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("drops what it cannot understand and keeps the rest", () => {
    const key = tableViewKey("alpha", "history");
    window.localStorage.setItem(
      key,
      JSON.stringify({
        v: 1,
        sort: [{ column: "ghost", dir: "asc" }, { column: "coverage", dir: "asc" }, { column: "kind", dir: "sideways" }, { column: "amount", dir: "asc" }],
        criteria: { ghost: "x", amount: ">abc", kind: ["trade", 3], coverage: "UNCOVERED" },
      }),
    );
    expect(readTableView(key, COLUMNS)).toEqual({ sort: [{ column: "amount", dir: "asc" }], criteria: { kind: ["trade"] } });
  });

  it("falls back to an empty view on unreadable JSON or another version", () => {
    const key = tableViewKey("alpha", "history");
    window.localStorage.setItem(key, "{not json");
    expect(readTableView(key, COLUMNS)).toEqual(EMPTY_VIEW);
    window.localStorage.setItem(key, JSON.stringify({ v: 2, sort: [{ column: "amount", dir: "asc" }], criteria: {} }));
    expect(readTableView(key, COLUMNS)).toEqual(EMPTY_VIEW);
  });

  it("works without storage: a throwing localStorage gives an empty state and no error", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readTableView(tableViewKey("alpha", "history"), COLUMNS)).toEqual(EMPTY_VIEW);
    expect(() => writeTableView(tableViewKey("alpha", "history"), { sort: [], criteria: { amount: ">0" } })).not.toThrow();
    expect(readPageSearch(pageSearchKey("alpha", "history"))).toBe("");
    expect(() => writePageSearch(pageSearchKey("alpha", "history"), "AAPL")).not.toThrow();
  });

  it("stores the page search, and removes it when blank", () => {
    const key = pageSearchKey("alpha", "positions");
    writePageSearch(key, "AAPL|MSFT");
    expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual({ v: 1, text: "AAPL|MSFT" });
    expect(readPageSearch(key)).toBe("AAPL|MSFT");
    writePageSearch(key, "  ");
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("clears one account's keys, never those of an account whose id it prefixes", () => {
    writeTableView(tableViewKey("a", "history"), { sort: [], criteria: { amount: ">0" } });
    writePageSearch(pageSearchKey("a", "positions"), "AAPL");
    writeTableView(tableViewKey("ab", "history"), { sort: [], criteria: { amount: ">0" } });
    writePageSearch(pageSearchKey("ab", "positions"), "AAPL");
    window.localStorage.setItem("ib2:theme", "dark");
    clearTableViews("a");
    expect(Object.keys(window.localStorage).sort()).toEqual(["ib2:pageSearch:ab:positions", "ib2:tableView:ab:history", "ib2:theme"]);
  });
});
```

Dans `apps/web/src/db/accounts.test.ts`, ajouter dans `describe("deleteAccount")` :

```ts
  it("forgets the table views and page searches of the deleted account only", async () => {
    await createAccount(db, { label: "a", ibAccountId: "U1111111" });
    await createAccount(db, { label: "b", ibAccountId: "U2222222" });
    window.localStorage.setItem("ib2:tableView:a:history", JSON.stringify({ v: 1, sort: [], criteria: { amount: ">0" } }));
    window.localStorage.setItem("ib2:pageSearch:a:positions", JSON.stringify({ v: 1, text: "AAPL" }));
    window.localStorage.setItem("ib2:tableView:b:history", JSON.stringify({ v: 1, sort: [], criteria: { amount: ">0" } }));
    await deleteAccount(db, "a");
    expect(window.localStorage.getItem("ib2:tableView:a:history")).toBeNull();
    expect(window.localStorage.getItem("ib2:pageSearch:a:positions")).toBeNull();
    expect(window.localStorage.getItem("ib2:tableView:b:history")).not.toBeNull();
  });
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test src/lib/tableViewStorage.test.ts src/db/accounts.test.ts`
Expected: FAIL — import introuvable, puis la clé de `a` encore présente.

- [x] **Step 3: Write the implementation**

`apps/web/src/lib/tableViewStorage.ts` :

```ts
import { EMPTY_VIEW, isActiveCriterion, type ColumnMeta, type Criterion, type SortKey, type TableView } from "@/lib/tableView";

/**
 * Sort and filters of a table, remembered per browser in localStorage: a display preference, never
 * portfolio data, so never in IndexedDB nor on the server. One key per account and table, so two
 * accounts never share a filter. Every access is best-effort: storage can be missing or throw.
 */

const VIEW_PREFIX = "ib2:tableView:";
const SEARCH_PREFIX = "ib2:pageSearch:";
const VERSION = 1;

export function tableViewKey(accountId: string, table: string): string {
  return `${VIEW_PREFIX}${accountId}:${table}`;
}

export function pageSearchKey(accountId: string, page: string): string {
  return `${SEARCH_PREFIX}${accountId}:${page}`;
}

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeOrRemove(key: string, value: object | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify({ v: VERSION, ...value }));
  } catch {
    // Best-effort only (e.g. storage disabled in private browsing).
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readTableView(key: string, columns: readonly ColumnMeta[]): TableView {
  const stored = readJson(key);
  if (!isRecord(stored) || stored.v !== VERSION) return EMPTY_VIEW;
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const sort: SortKey[] = Array.isArray(stored.sort)
    ? stored.sort.flatMap((entry): SortKey[] => {
        if (!isRecord(entry) || typeof entry.column !== "string") return [];
        if (entry.dir !== "asc" && entry.dir !== "desc") return [];
        return byKey.get(entry.column)?.sortable ? [{ column: entry.column, dir: entry.dir }] : [];
      })
    : [];
  const criteria: Record<string, Criterion> = {};
  if (isRecord(stored.criteria)) {
    for (const [column, raw] of Object.entries(stored.criteria)) {
      const meta = byKey.get(column);
      if (!meta) continue;
      let criterion: Criterion | null = null;
      if (meta.type === "enum" && Array.isArray(raw)) {
        criterion = raw.filter((value): value is string | null => value === null || typeof value === "string");
      } else if (meta.type !== "enum" && typeof raw === "string") {
        criterion = raw;
      }
      if (criterion !== null && isActiveCriterion(meta, criterion)) criteria[column] = criterion;
    }
  }
  return sort.length === 0 && Object.keys(criteria).length === 0 ? EMPTY_VIEW : { sort, criteria };
}

export function writeTableView(key: string, view: TableView): void {
  const criteria = Object.fromEntries(
    Object.entries(view.criteria).filter(([, criterion]) => (typeof criterion === "string" ? criterion.trim() !== "" : criterion.length > 0)),
  );
  const empty = view.sort.length === 0 && Object.keys(criteria).length === 0;
  writeOrRemove(key, empty ? null : { sort: view.sort, criteria });
}

export function readPageSearch(key: string): string {
  const stored = readJson(key);
  return isRecord(stored) && stored.v === VERSION && typeof stored.text === "string" ? stored.text : "";
}

export function writePageSearch(key: string, text: string): void {
  writeOrRemove(key, text.trim() === "" ? null : { text });
}

/** Forgets every table view and page search of one account; the trailing ":" spares an id it prefixes. */
export function clearTableViews(accountId: string): void {
  try {
    const prefixes = [`${VIEW_PREFIX}${accountId}:`, `${SEARCH_PREFIX}${accountId}:`];
    const doomed: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key !== null && prefixes.some((prefix) => key.startsWith(prefix))) doomed.push(key);
    }
    doomed.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Same as above.
  }
}
```

Dans `apps/web/src/db/accounts.ts`, importer `clearTableViews` depuis `@/lib/tableViewStorage` et, juste après `if (getLastAccountId() === id) clearLastAccountId();`, ajouter :

```ts
  clearTableViews(id);
```

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test src/lib/tableViewStorage.test.ts src/db/accounts.test.ts && pnpm --filter web typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/lib/tableViewStorage.ts apps/web/src/lib/tableViewStorage.test.ts apps/web/src/db/accounts.ts apps/web/src/db/accounts.test.ts docs/plans/2026-09-17-tri-filtres-tableaux.md
git commit -m "Mémorisation du tri et des filtres par compte et par tableau

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Colonnes typées de l'Historique et de Positions, valeur de Couverture

**Files:**
- Modify: `apps/web/src/lib/historyColumns.ts`
- Create test: `apps/web/src/lib/historyColumns.test.ts`
- Modify: `apps/web/src/lib/positionColumns.ts`
- Create test: `apps/web/src/lib/positionColumns.test.ts`
- Modify: `apps/web/src/lib/riskReport.ts`
- Test: `apps/web/src/lib/riskReport.test.ts` (créer s'il n'existe pas)

**Interfaces:**
- Consumes (tâche 2) : `ColumnSpec`. `LedgerRow`, `tickerOf` de `@ib/ledger` ; `AnalyzedPosition`, `KIND_LABELS`, `PositionKind`, `COVER_NONE` de `@ib/coverage` ; `formatContract`, `formatDateTime` de `@/lib/format`.
- Produces:
  ```ts
  // historyColumns.ts
  export type Translate = (key: string) => string;
  export function historyColumnSpecs(t: Translate): ColumnSpec<LedgerRow>[];   // same keys and order as HISTORY_COLUMNS
  export function historyTicker(row: LedgerRow): string | null;
  // positionColumns.ts
  export function positionColumnSpecs(sectorOf: (symbol: string) => string | null): ColumnSpec<AnalyzedPosition>[];  // same keys and order as POSITION_COLUMNS
  // riskReport.ts
  export function coverageValues(position: AnalyzedPosition): string[];
  ```

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/historyColumns.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import type { LedgerRow } from "@ib/ledger";
import { HISTORY_COLUMNS, historyColumnSpecs, historyTicker } from "@/lib/historyColumns";
import { SAMPLE_DEPOSIT, SAMPLE_TRANSACTIONS } from "@/mocks/ledger";

const t = (key: string) => `t:${key}`;

function row(transaction = SAMPLE_TRANSACTIONS[0]): LedgerRow {
  return { transaction, cash: -18051.5, balances: { USD: -18543.15, EUR: 10000 } } as LedgerRow;
}

describe("historyColumnSpecs", () => {
  it("types every column of the table, in its order", () => {
    const specs = historyColumnSpecs(t);
    expect(specs.map((spec) => spec.key)).toEqual(HISTORY_COLUMNS.map((column) => column.key));
    expect(specs.map((spec) => spec.type)).toEqual(["date", "enum", "text", "number", "number", "number", "number", "number", "text", "number", "number"]);
    expect(specs.every((spec) => spec.sortable)).toBe(true);
  });

  it("compares what the cells show", () => {
    const specs = Object.fromEntries(historyColumnSpecs(t).map((spec) => [spec.key, spec]));
    expect(specs.dateTime.value(row())).toBe("2026-08-28 14:30:00");
    expect(specs.type.value(row())).toBe("trade");
    expect(specs.type.label?.("trade")).toBe("t:history.kinds.trade");
    expect(specs.symbol.value(row())).toBe("AAPL");
    expect(specs.symbol.value(row(SAMPLE_DEPOSIT))).toBe("ELECTRONIC FUND TRANSFER");
    expect(specs.totalPrice.value(row())).toBe(-18050);
    expect(specs.fee.value(row())).toBe(-1.5);
    expect(specs.price.value(row({ ...SAMPLE_TRANSACTIONS[0], price: null }))).toBeNull();
    expect(specs.cash.value(row())).toBe(-18051.5);
    expect(specs.currency.value(row())).toBe("USD");
    expect(specs.usdCash.value(row())).toBe(-18543.15);
    expect(specs.eurCash.value(row())).toBe(10000);
  });

  it("reads the ticker of a row, the underlying for a packed option, null without a symbol", () => {
    expect(historyTicker(row({ ...SAMPLE_TRANSACTIONS[0], symbol: "OQZA  261016C00012000", secType: "OPT" }))).toBe("OQZA");
    expect(historyTicker(row(SAMPLE_DEPOSIT))).toBeNull();
  });
});
```

`apps/web/src/lib/positionColumns.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { buildRiskReport } from "@ib/coverage";
import { POSITION_COLUMNS, positionColumnSpecs } from "@/lib/positionColumns";
import { SAMPLE_POSITIONS } from "@/mocks/positions";

describe("positionColumnSpecs", () => {
  it("types every shared column, in its order, coverage filterable but not sortable", () => {
    const specs = positionColumnSpecs(() => null);
    expect(specs.map((spec) => spec.key)).toEqual(POSITION_COLUMNS.map((column) => column.key));
    expect(specs.map((spec) => spec.type)).toEqual(["text", "enum", "enum", "number", "number", "number", "number", "number", "enum", "enum"]);
    expect(specs.filter((spec) => !spec.sortable).map((spec) => spec.key)).toEqual(["coverage"]);
  });

  it("compares what the row shows, the sector read through sectorOf", () => {
    const report = buildRiskReport(SAMPLE_POSITIONS, 42000);
    const put = report.positions.find((position) => position.symbol === "XOM")!;
    const specs = Object.fromEntries(positionColumnSpecs((symbol) => (symbol === "XOM" ? "Energy" : null)).map((spec) => [spec.key, spec]));
    expect(specs.position.value(put)).toBe("XOM Mar20'26 100 Put");
    expect(specs.type.value(put)).toBe("short_put");
    expect(specs.type.label?.("short_put")).toBe("sell of put");
    expect(specs.sector.value(put)).toBe("Energy");
    expect(specs.unrealizedPnl.value(put)).toBe(490);
    expect(specs.decision.value(put)).toBe(put.decision);
    expect(specs.coverage.value(put)).toEqual(["cash"]);
  });
});
```

`buildRiskReport(positions, cashAvailable)` est l'appel même de `useRiskReport` (`apps/web/src/db/hooks.ts`) sur `SAMPLE_SNAPSHOT`.

Dans `apps/web/src/lib/riskReport.test.ts`, étendre l'import de `@/lib/riskReport` avec `coverageValues`, importer `buildRiskReport` depuis `@ib/coverage`, `formatContract` depuis `@/lib/format` et `SAMPLE_POSITIONS` depuis `@/mocks/positions`, puis ajouter :

```ts
describe("coverageValues", () => {
  it("names the sources the badges show, UNCOVERED and used/unused included, never parsing a label", () => {
    const report = buildRiskReport(SAMPLE_POSITIONS, 42000);
    const bySpelling = new Map(report.positions.map((position) => [formatContract(position), position]));
    expect(coverageValues(bySpelling.get("XOM Mar20'26 100 Put")!)).toEqual(["cash"]);
    expect(coverageValues(bySpelling.get("AAPL Feb20'26 155 Call")!)).toEqual(["stock", "UNCOVERED"]);
    expect(coverageValues(bySpelling.get("MSFT Mar20'26 400 Call")!)).toEqual(["leaps"]);
    expect(coverageValues(bySpelling.get("AAPL")!)).toEqual(["used"]);
    for (const position of report.positions) {
      const badgeSources = coverageBadges(position).map((badge) => badge.label.split(" ")[0]);
      expect(coverageValues(position)).toEqual([...new Set(badgeSources)]);
    }
  });

  it("gives UNCOVERED to a sale without any allocation, unused to an idle long cover, nothing to other kinds", () => {
    const report = buildRiskReport(SAMPLE_POSITIONS, 42000);
    const sale = report.positions.find((position) => position.kind === "short_put")!;
    expect(coverageValues({ ...sale, allocations: [], uncoveredQuantity: 0 })).toEqual(["UNCOVERED"]);
    const long = report.positions.find((position) => position.kind === "long_stock")!;
    expect(coverageValues({ ...long, usedQuantity: 0 })).toEqual(["unused"]);
    expect(coverageValues({ ...long, kind: "other" })).toEqual([]);
  });
});
```

La boucle du premier test vérifie la cohérence avec `coverageBadges` : si l'ordre des badges diffère (allocations puis `UNCOVERED`), c'est `coverageValues` qui suit cet ordre.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test src/lib/historyColumns.test.ts src/lib/positionColumns.test.ts src/lib/riskReport.test.ts`
Expected: FAIL, `historyColumnSpecs`, `positionColumnSpecs` et `coverageValues` ne sont pas exportés.

- [ ] **Step 3: Write the implementation**

À la fin de `apps/web/src/lib/historyColumns.ts` :

```ts
import { tickerOf, type LedgerRow } from "@ib/ledger";
import { formatContract, formatDateTime } from "@/lib/format";
import type { ColumnSpec } from "@/lib/tableView";

export type Translate = (key: string) => string;

/**
 * What each column of the history compares, filters and sorts on: what its cell shows. Same keys and
 * order as HISTORY_COLUMNS. The balances are the anchored running balances, computed over the whole
 * ledger before any filter, so a row keeps its balance whatever the view.
 */
export function historyColumnSpecs(t: Translate): ColumnSpec<LedgerRow>[] {
  return [
    { key: "dateTime", type: "date", sortable: true, value: (row) => formatDateTime(row.transaction.when) },
    {
      key: "type",
      type: "enum",
      sortable: true,
      value: (row) => row.transaction.kind,
      label: (kind) => t(`history.kinds.${kind}`),
    },
    { key: "symbol", type: "text", sortable: true, value: (row) => formatContract(row.transaction) || row.transaction.description },
    { key: "quantity", type: "number", sortable: true, value: (row) => row.transaction.quantity },
    { key: "price", type: "number", sortable: true, value: (row) => row.transaction.price },
    { key: "totalPrice", type: "number", sortable: true, value: (row) => row.transaction.amount },
    { key: "fee", type: "number", sortable: true, value: (row) => row.transaction.commission },
    { key: "cash", type: "number", sortable: true, value: (row) => row.cash },
    { key: "currency", type: "text", sortable: true, value: (row) => row.transaction.currency },
    { key: "usdCash", type: "number", sortable: true, value: (row) => row.balances.USD },
    { key: "eurCash", type: "number", sortable: true, value: (row) => row.balances.EUR },
  ];
}

/** The ticker the page search reads: the underlying of an option, null for a cash movement. */
export function historyTicker(row: LedgerRow): string | null {
  return row.transaction.symbol ? tickerOf(row.transaction.symbol) : null;
}
```

(Les imports vont en tête du fichier. Si `row.balances` n'a pas exactement les clés `USD`/`EUR` typées, lire `BALANCE_CURRENCIES` dans `lib/currencies.ts` et adapter l'accès, sans changer la valeur.)

À la fin de `apps/web/src/lib/positionColumns.ts` :

```ts
import { KIND_LABELS, type AnalyzedPosition, type PositionKind } from "@ib/coverage";
import { formatContract } from "@/lib/format";
import { coverageValues } from "@/lib/riskReport";
import type { ColumnSpec } from "@/lib/tableView";

/**
 * What each shared column of the Positions page compares, filters and sorts on. Same keys and order
 * as POSITION_COLUMNS. The coverage is a set of sources, filterable but without a natural order.
 */
export function positionColumnSpecs(sectorOf: (symbol: string) => string | null): ColumnSpec<AnalyzedPosition>[] {
  return [
    { key: "position", type: "text", sortable: true, value: (position) => formatContract(position) },
    {
      key: "type",
      type: "enum",
      sortable: true,
      value: (position) => position.kind,
      label: (kind) => KIND_LABELS[kind as PositionKind] ?? kind,
    },
    { key: "sector", type: "enum", sortable: true, value: (position) => sectorOf(position.symbol) },
    { key: "marketValue", type: "number", sortable: true, value: (position) => position.marketValue },
    { key: "quantity", type: "number", sortable: true, value: (position) => position.quantity },
    { key: "avgPrice", type: "number", sortable: true, value: (position) => position.avgPrice },
    { key: "lastPrice", type: "number", sortable: true, value: (position) => position.lastPrice },
    { key: "unrealizedPnl", type: "number", sortable: true, value: (position) => position.unrealizedPnl },
    { key: "decision", type: "enum", sortable: true, value: (position) => position.decision },
    { key: "coverage", type: "enum", sortable: false, value: (position) => coverageValues(position) },
  ];
}
```

Dans `apps/web/src/lib/riskReport.ts`, à côté de `coverageBadges` :

```ts
/**
 * The coverage sources a Positions filter checks, from the position itself, never from badge text:
 * the same branches as coverageBadges, one value per distinct source.
 */
export function coverageValues(position: AnalyzedPosition): string[] {
  if (position.kind === "short_call" || position.kind === "short_put") {
    const sources = new Set<string>(position.allocations.map((allocation) => allocation.source));
    if (position.uncoveredQuantity > 0 || position.allocations.length === 0) sources.add(COVER_NONE);
    return [...sources];
  }
  if (position.kind === "long_stock" || position.kind === "long_call" || position.kind === "long_put") {
    return [position.usedQuantity > 0 ? "used" : "unused"];
  }
  return [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web test src/lib/historyColumns.test.ts src/lib/positionColumns.test.ts src/lib/riskReport.test.ts && pnpm --filter web typecheck`
Expected: PASS. Si `formatContract` d'une position ne rend pas `XOM Mar20'26 100 Put`, relire `PositionsPage.test.tsx` (qui affiche exactement ce libellé) plutôt que d'ajuster l'attente.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/historyColumns.ts apps/web/src/lib/historyColumns.test.ts apps/web/src/lib/positionColumns.ts apps/web/src/lib/positionColumns.test.ts apps/web/src/lib/riskReport.ts apps/web/src/lib/riskReport.test.ts docs/plans/2026-09-17-tri-filtres-tableaux.md
git commit -m "Colonnes typées de l'Historique et de Positions

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Hooks `useTableView` et `usePageSearch`

**Files:**
- Create: `apps/web/src/hooks/useTableView.ts`
- Test: `apps/web/src/hooks/useTableView.test.tsx`

**Interfaces:**
- Consumes (tâches 2, 3) : `TableView`, `Criterion`, `ColumnMeta`, `nextSort`, `readTableView`, `writeTableView`, `readPageSearch`, `writePageSearch`.
- Produces:
  ```ts
  export const PAGE_SEARCH_DEBOUNCE_MS = 300;
  export interface TableViewState {
    view: TableView;
    /** `null`, a blank text or an empty list removes the column's criterion. */
    setCriterion: (column: string, criterion: Criterion | null) => void;
    toggleSort: (column: string, additive: boolean) => void;
    clearColumn: (column: string) => void;
    /** Criteria and sort of this table; never the page search. */
    clearAll: () => void;
  }
  export function useTableView(storageKey: string, columns: readonly ColumnMeta[]): TableViewState;
  export interface PageSearchState { input: string; setInput: (text: string) => void; applied: string }
  export function usePageSearch(storageKey: string): PageSearchState;
  ```

- [ ] **Step 1: Write the failing test**

```tsx
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAGE_SEARCH_DEBOUNCE_MS, usePageSearch, useTableView } from "@/hooks/useTableView";
import type { ColumnMeta } from "@/lib/tableView";

const COLUMNS: ColumnMeta[] = [
  { key: "amount", type: "number", sortable: true },
  { key: "kind", type: "enum", sortable: true },
];

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useTableView", () => {
  it("starts from what storage holds and writes every change back", () => {
    window.localStorage.setItem("ib2:tableView:alpha:history", JSON.stringify({ v: 1, sort: [], criteria: { amount: ">0" } }));
    const { result } = renderHook(() => useTableView("ib2:tableView:alpha:history", COLUMNS));
    expect(result.current.view.criteria).toEqual({ amount: ">0" });
    act(() => result.current.setCriterion("kind", ["trade"]));
    act(() => result.current.toggleSort("amount", false));
    expect(result.current.view).toEqual({ sort: [{ column: "amount", dir: "asc" }], criteria: { amount: ">0", kind: ["trade"] } });
    expect(JSON.parse(window.localStorage.getItem("ib2:tableView:alpha:history")!)).toEqual({ v: 1, ...result.current.view });
  });

  it("removes a criterion set to null, blank or empty, and clears the whole table", () => {
    const { result } = renderHook(() => useTableView("ib2:tableView:alpha:history", COLUMNS));
    act(() => result.current.setCriterion("amount", ">0"));
    act(() => result.current.setCriterion("kind", ["trade"]));
    act(() => result.current.setCriterion("amount", "  "));
    act(() => result.current.clearColumn("kind"));
    expect(result.current.view.criteria).toEqual({});
    act(() => result.current.setCriterion("amount", ">0"));
    act(() => result.current.toggleSort("amount", true));
    act(() => result.current.clearAll());
    expect(result.current.view).toEqual({ sort: [], criteria: {} });
    expect(window.localStorage.getItem("ib2:tableView:alpha:history")).toBeNull();
  });

  it("reads the other account's view as soon as the key changes, never writing one into the other", () => {
    window.localStorage.setItem("ib2:tableView:beta:history", JSON.stringify({ v: 1, sort: [], criteria: { kind: ["dividend"] } }));
    const { result, rerender } = renderHook(({ key }) => useTableView(key, COLUMNS), { initialProps: { key: "ib2:tableView:alpha:history" } });
    act(() => result.current.setCriterion("amount", ">0"));
    rerender({ key: "ib2:tableView:beta:history" });
    expect(result.current.view.criteria).toEqual({ kind: ["dividend"] });
    expect(JSON.parse(window.localStorage.getItem("ib2:tableView:alpha:history")!).criteria).toEqual({ amount: ">0" });
  });
});

describe("usePageSearch", () => {
  it("applies and stores the input after the debounce, and reloads it per key", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ key }) => usePageSearch(key), { initialProps: { key: "ib2:pageSearch:alpha:positions" } });
    act(() => result.current.setInput("AAPL"));
    expect(result.current.input).toBe("AAPL");
    expect(result.current.applied).toBe("");
    act(() => vi.advanceTimersByTime(PAGE_SEARCH_DEBOUNCE_MS));
    expect(result.current.applied).toBe("AAPL");
    expect(JSON.parse(window.localStorage.getItem("ib2:pageSearch:alpha:positions")!)).toEqual({ v: 1, text: "AAPL" });
    rerender({ key: "ib2:pageSearch:beta:positions" });
    expect(result.current.input).toBe("");
    expect(result.current.applied).toBe("");
    act(() => vi.advanceTimersByTime(PAGE_SEARCH_DEBOUNCE_MS));
    expect(window.localStorage.getItem("ib2:pageSearch:beta:positions")).toBeNull();
    rerender({ key: "ib2:pageSearch:alpha:positions" });
    expect(result.current.applied).toBe("AAPL");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test src/hooks/useTableView.test.tsx`
Expected: FAIL, import introuvable.

- [ ] **Step 3: Write the implementation**

```ts
import { useCallback, useEffect, useState } from "react";
import { nextSort, type ColumnMeta, type Criterion, type TableView } from "@/lib/tableView";
import { readPageSearch, readTableView, writePageSearch, writeTableView } from "@/lib/tableViewStorage";

export const PAGE_SEARCH_DEBOUNCE_MS = 300;

export interface TableViewState {
  view: TableView;
  /** `null`, a blank text or an empty list removes the column's criterion. */
  setCriterion: (column: string, criterion: Criterion | null) => void;
  toggleSort: (column: string, additive: boolean) => void;
  clearColumn: (column: string) => void;
  /** Criteria and sort of this table; never the page search. */
  clearAll: () => void;
}

const isEmptyCriterion = (criterion: Criterion | null) =>
  criterion === null || (typeof criterion === "string" ? criterion.trim() === "" : criterion.length === 0);

/**
 * The sort and criteria of one table, remembered under `storageKey`. A new key (another account) is
 * read during the render that brings it, never after: an effect would first paint, and write, the
 * previous account's view under the new key.
 */
export function useTableView(storageKey: string, columns: readonly ColumnMeta[]): TableViewState {
  const [state, setState] = useState(() => ({ key: storageKey, view: readTableView(storageKey, columns) }));
  let current = state;
  if (state.key !== storageKey) {
    current = { key: storageKey, view: readTableView(storageKey, columns) };
    setState(current);
  }
  const { view } = current;

  const update = useCallback(
    (change: (view: TableView) => TableView) => {
      setState((previous) => {
        const base = previous.key === storageKey ? previous.view : readTableView(storageKey, columns);
        const next = change(base);
        writeTableView(storageKey, next);
        return { key: storageKey, view: next };
      });
    },
    // `columns` is read only to sanitize a stored view; its identity may change every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storageKey],
  );

  const setCriterion = useCallback(
    (column: string, criterion: Criterion | null) =>
      update((previous) => {
        const criteria = { ...previous.criteria };
        if (isEmptyCriterion(criterion)) delete criteria[column];
        else criteria[column] = criterion as Criterion;
        return { ...previous, criteria };
      }),
    [update],
  );
  const toggleSort = useCallback(
    (column: string, additive: boolean) => update((previous) => ({ ...previous, sort: nextSort(previous.sort, column, additive) })),
    [update],
  );
  const clearColumn = useCallback((column: string) => setCriterion(column, null), [setCriterion]);
  const clearAll = useCallback(() => update(() => ({ sort: [], criteria: {} })), [update]);

  return { view, setCriterion, toggleSort, clearColumn, clearAll };
}

export interface PageSearchState {
  input: string;
  setInput: (text: string) => void;
  /** The debounced text, the one that filters and is stored. */
  applied: string;
}

export function usePageSearch(storageKey: string): PageSearchState {
  const [state, setState] = useState(() => {
    const text = readPageSearch(storageKey);
    return { key: storageKey, input: text, applied: text };
  });
  let current = state;
  if (state.key !== storageKey) {
    const text = readPageSearch(storageKey);
    current = { key: storageKey, input: text, applied: text };
    setState(current);
  }

  useEffect(() => {
    if (current.input === current.applied) return;
    const id = setTimeout(() => {
      writePageSearch(storageKey, current.input);
      setState((previous) => (previous.key === storageKey ? { ...previous, applied: previous.input } : previous));
    }, PAGE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [storageKey, current.input, current.applied]);

  const setInput = useCallback(
    (text: string) => setState((previous) => (previous.key === storageKey ? { ...previous, input: text } : previous)),
    [storageKey],
  );

  return { input: current.input, setInput, applied: current.applied };
}
```

Si le dépôt n'a pas de règle eslint `react-hooks`, retirer la ligne `eslint-disable-next-line` (vérifier par `grep -rn "react-hooks" apps/web/eslint.config.* package.json` ; `pnpm check` échoue sur une directive inutile si `reportUnusedDisableDirectives` est actif).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test src/hooks/useTableView.test.tsx && pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/useTableView.ts apps/web/src/hooks/useTableView.test.tsx docs/plans/2026-09-17-tri-filtres-tableaux.md
git commit -m "Hooks de vue de tableau et de recherche de page

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Composants `ColumnHeader` et `ActiveFilters`, popover et checkbox, traductions

**Files:**
- Create: `packages/ui/src/components/ui/popover.tsx`, `packages/ui/src/components/ui/checkbox.tsx` (shadcn)
- Create: `apps/web/src/components/table/ColumnHeader.tsx`, `apps/web/src/components/table/ActiveFilters.tsx`
- Test: `apps/web/src/components/table/ColumnHeader.test.tsx`, `apps/web/src/components/table/ActiveFilters.test.tsx`
- Modify: `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`

**Interfaces:**
- Consumes (tâches 1, 2) : `parseCriterion`, `ColumnMeta`, `Criterion`, `Facet`, `TableView`, `ColumnSpec`, `activeCriteria`.
- Produces:
  ```tsx
  export interface ColumnHeaderProps {
    meta: ColumnMeta;
    label: string;
    view: TableView;
    /** Values offered by an enum column's filter. */
    facets?: readonly Facet[];
    numeric?: boolean;
    className?: string;
    title?: string;
    onSort: (additive: boolean) => void;
    onCriterion: (criterion: Criterion | null) => void;
  }
  export function ColumnHeader(props: ColumnHeaderProps): JSX.Element;   // renders its own <TableHead>

  export interface ActiveFiltersProps<Row> {
    specs: readonly ColumnSpec<Row>[];
    view: TableView;
    columnLabel: (key: string) => string;
    onClearColumn: (key: string) => void;
    onClearAll: () => void;
  }
  export function ActiveFilters<Row>(props: ActiveFiltersProps<Row>): JSX.Element | null;
  export function criterionSummary<Row>(spec: ColumnSpec<Row>, criterion: Criterion, emptyLabel: string): string;
  ```

- [ ] **Step 1: Add the shadcn components**

```bash
cd packages/ui
pnpm dlx shadcn@latest add popover checkbox
sed -i 's#from "@/lib/utils"#from "../../lib/utils"#; s#from "@/hooks/use-mobile"#from "../../hooks/use-mobile"#; s#from "@/components/ui/\([a-z-]*\)"#from "./\1"#' src/components/ui/popover.tsx src/components/ui/checkbox.tsx
cd ../..
git status --short packages/ui
```

Expected : seuls `popover.tsx` et `checkbox.tsx` sont nouveaux, ils importent `@base-ui/react/popover` et `@base-ui/react/checkbox` (pas `@radix-ui`), et `packages/ui/package.json` n'a gagné aucune dépendance. Si `shadcn add` a modifié un autre fichier (`components.json`, un composant existant, `package.json`), annuler cette modification par `git checkout -- <fichier>`. Lire les deux fichiers générés pour connaître les noms exportés (`Popover`, `PopoverTrigger`, `PopoverContent` ; `Checkbox`) et adapter les imports ci-dessous s'ils diffèrent.

- [ ] **Step 2: Add the translations**

Dans `apps/web/src/i18n/fr.json`, ajouter une section de premier niveau :

```json
  "tableFilter": {
    "open": "Filtrer {{column}}",
    "input": "Critère pour {{column}}",
    "clear": "Effacer",
    "clearAll": "Tout effacer",
    "clearColumn": "Retirer le filtre {{column}}",
    "empty": "— (vide)",
    "sortOrder": "Tri n°{{order}}",
    "help": {
      "text": "aap · =AAPL · =AA* · A|B · —",
      "number": ">100 · 10..20 · <0|>1000 · —",
      "date": "2025 · >=2025-03 · 2024..2025-06 · —"
    },
    "errors": {
      "number": "Nombre illisible",
      "date": "Date illisible : AAAA, AAAA-MM ou AAAA-MM-JJ",
      "textOperator": "Pas de comparaison ni de plage sur du texte",
      "syntax": "Critère incomplet"
    }
  },
```

Dans `apps/web/src/i18n/en.json`, la même section :

```json
  "tableFilter": {
    "open": "Filter {{column}}",
    "input": "Criterion for {{column}}",
    "clear": "Clear",
    "clearAll": "Clear all",
    "clearColumn": "Remove the {{column}} filter",
    "empty": "— (empty)",
    "sortOrder": "Sort #{{order}}",
    "help": {
      "text": "aap · =AAPL · =AA* · A|B · —",
      "number": ">100 · 10..20 · <0|>1000 · —",
      "date": "2025 · >=2025-03 · 2024..2025-06 · —"
    },
    "errors": {
      "number": "Unreadable number",
      "date": "Unreadable date: YYYY, YYYY-MM or YYYY-MM-DD",
      "textOperator": "No comparison nor range on text",
      "syntax": "Incomplete criterion"
    }
  },
```

- [ ] **Step 3: Write the failing tests**

`apps/web/src/components/table/ColumnHeader.test.tsx` :

```tsx
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Table, TableHeader, TableRow } from "@ib/ui/table";
import { ColumnHeader, type ColumnHeaderProps } from "@/components/table/ColumnHeader";
import { EMPTY_VIEW, type Criterion, type TableView } from "@/lib/tableView";

function renderHeader(props: Partial<ColumnHeaderProps> = {}) {
  const onSort = vi.fn();
  const onCriterion = vi.fn();
  render(
    <Table>
      <TableHeader>
        <TableRow>
          <ColumnHeader meta={{ key: "amount", type: "number", sortable: true }} label="Montant" view={EMPTY_VIEW} onSort={onSort} onCriterion={onCriterion} {...props} />
        </TableRow>
      </TableHeader>
    </Table>,
  );
  return { onSort, onCriterion };
}

/** A header wired to real state, as a page would. */
function Stateful({ initial }: { initial: TableView }) {
  const [view, setView] = useState(initial);
  const onCriterion = (criterion: Criterion | null) =>
    setView((previous) => ({ ...previous, criteria: criterion === null ? {} : { amount: criterion } }));
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <ColumnHeader meta={{ key: "amount", type: "number", sortable: true }} label="Montant" view={view} onSort={() => {}} onCriterion={onCriterion} />
        </TableRow>
      </TableHeader>
    </Table>
  );
}

describe("ColumnHeader", () => {
  it("sorts on a click, additively with shift, and says the direction", async () => {
    const { onSort } = renderHeader({ view: { sort: [{ column: "amount", dir: "desc" }], criteria: {} } });
    const header = screen.getByRole("columnheader");
    expect(header).toHaveAttribute("aria-sort", "descending");
    const user = userEvent.setup();
    await user.click(within(header).getByRole("button", { name: "Montant" }));
    expect(onSort).toHaveBeenLastCalledWith(false);
    await user.keyboard("{Shift>}");
    await user.click(within(header).getByRole("button", { name: "Montant" }));
    await user.keyboard("{/Shift}");
    expect(onSort).toHaveBeenLastCalledWith(true);
  });

  it("numbers the keys of a multiple sort, aria-sort staying on the first key's header", () => {
    renderHeader({ view: { sort: [{ column: "name", dir: "asc" }, { column: "amount", dir: "asc" }], criteria: {} } });
    expect(screen.getByRole("columnheader")).not.toHaveAttribute("aria-sort");
    expect(screen.getByLabelText("Tri n°2")).toHaveTextContent("2");
  });

  it("has no sort button on a non-sortable column, only its filter", () => {
    renderHeader({ meta: { key: "coverage", type: "enum", sortable: false }, label: "Couverture" });
    expect(screen.queryByRole("button", { name: "Couverture" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filtrer Couverture" })).toBeInTheDocument();
  });

  it("passes a valid criterion on, shows an invalid one in red without passing it, and clears", async () => {
    render(<Stateful initial={EMPTY_VIEW} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Filtrer Montant" }));
    const input = await screen.findByRole("textbox", { name: "Critère pour Montant" });
    await user.type(input, ">abc");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Nombre illisible");
    expect(screen.getByRole("button", { name: "Filtrer Montant" })).toHaveAttribute("data-active", "false");
    await user.clear(input);
    await user.type(input, ">100");
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(screen.getByRole("button", { name: "Filtrer Montant" })).toHaveAttribute("data-active", "true");
    await user.click(screen.getByRole("button", { name: "Effacer" }));
    expect(screen.getByRole("button", { name: "Filtrer Montant" })).toHaveAttribute("data-active", "false");
  });

  it("offers the present values of an enum column as checkboxes with their counts", async () => {
    const { onCriterion } = renderHeader({
      meta: { key: "kind", type: "enum", sortable: true },
      label: "Type",
      view: { sort: [], criteria: { kind: ["trade"] } },
      facets: [
        { value: "trade", label: "Trade", count: 3 },
        { value: "dividend", label: "Dividende", count: 0 },
        { value: null, label: null, count: 1 },
      ],
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Filtrer Type" }));
    const trade = await screen.findByRole("checkbox", { name: /Trade/ });
    expect(trade).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /— \(vide\)/ })).not.toBeChecked();
    expect(screen.getByText("3")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /Dividende/ }));
    expect(onCriterion).toHaveBeenLastCalledWith(["trade", "dividend"]);
    await user.click(trade);
    expect(onCriterion).toHaveBeenLastCalledWith(null);
  });
});
```

`apps/web/src/components/table/ActiveFilters.test.tsx` :

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActiveFilters } from "@/components/table/ActiveFilters";
import { EMPTY_VIEW, type ColumnSpec } from "@/lib/tableView";

interface Row {
  amount: number | null;
  kind: string | null;
}

const SPECS: ColumnSpec<Row>[] = [
  { key: "amount", type: "number", sortable: true, value: (row) => row.amount },
  { key: "kind", type: "enum", sortable: true, value: (row) => row.kind, label: (value) => (value === "trade" ? "Trade" : "Dividende") },
];
const LABELS: Record<string, string> = { amount: "P/L latent", kind: "Type" };

describe("ActiveFilters", () => {
  it("renders nothing without an active criterion", () => {
    const { container } = render(
      <ActiveFilters specs={SPECS} view={{ sort: [{ column: "amount", dir: "asc" }], criteria: { amount: ">abc" } }} columnLabel={(key) => LABELS[key]} onClearColumn={() => {}} onClearAll={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("summarizes each active column, clears one, and clears all", async () => {
    const onClearColumn = vi.fn();
    const onClearAll = vi.fn();
    render(
      <ActiveFilters
        specs={SPECS}
        view={{ ...EMPTY_VIEW, criteria: { amount: "<0", kind: ["trade", null] } }}
        columnLabel={(key) => LABELS[key]}
        onClearColumn={onClearColumn}
        onClearAll={onClearAll}
      />,
    );
    expect(screen.getByText("P/L latent : <0")).toBeInTheDocument();
    expect(screen.getByText("Type : Trade, —")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Retirer le filtre Type" }));
    expect(onClearColumn).toHaveBeenCalledWith("kind");
    await user.click(screen.getByRole("button", { name: "Tout effacer" }));
    expect(onClearAll).toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm --filter web test src/components/table/`
Expected: FAIL, imports introuvables.

- [ ] **Step 5: Write the implementation**

`apps/web/src/components/table/ColumnHeader.tsx` :

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownIcon, ArrowUpIcon, FunnelIcon } from "lucide-react";
import { Button } from "@ib/ui/button";
import { Checkbox } from "@ib/ui/checkbox";
import { Input } from "@ib/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@ib/ui/popover";
import { TableHead } from "@ib/ui/table";
import { parseCriterion } from "@/lib/tableCriteria";
import { isActiveCriterion, type ColumnMeta, type Criterion, type Facet, type TableView } from "@/lib/tableView";
import { cn } from "@/lib/utils";

export interface ColumnHeaderProps {
  meta: ColumnMeta;
  label: string;
  view: TableView;
  /** Values offered by an enum column's filter. */
  facets?: readonly Facet[];
  numeric?: boolean;
  className?: string;
  title?: string;
  onSort: (additive: boolean) => void;
  onCriterion: (criterion: Criterion | null) => void;
}

/**
 * A sortable, filterable column header: the label sorts (shift adds a key), the funnel opens the
 * column's filter. Renders its own TableHead so aria-sort sits on the header cell.
 */
export function ColumnHeader({ meta, label, view, facets = [], numeric = false, className, title, onSort, onCriterion }: ColumnHeaderProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const sortIndex = view.sort.findIndex((key) => key.column === meta.key);
  const sortKey = sortIndex >= 0 ? view.sort[sortIndex] : null;
  const criterion = view.criteria[meta.key];
  const active = isActiveCriterion(meta, criterion);
  const ariaSort = sortIndex === 0 && sortKey ? (sortKey.dir === "asc" ? "ascending" : "descending") : undefined;
  const Arrow = sortKey?.dir === "desc" ? ArrowDownIcon : ArrowUpIcon;

  return (
    <TableHead className={className} title={title} aria-sort={ariaSort}>
      <div className={cn("flex min-w-0 items-center gap-1", numeric && "justify-end")}>
        {meta.sortable ? (
          <button type="button" className="inline-flex min-w-0 items-center gap-0.5 hover:text-foreground" onClick={(event) => onSort(event.shiftKey)}>
            <span className="truncate">{label}</span>
            {sortKey && <Arrow aria-hidden="true" className="size-3.5 shrink-0" />}
            {sortKey && view.sort.length > 1 && (
              <span aria-label={t("tableFilter.sortOrder", { order: sortIndex + 1 })} className="text-[0.65rem] tabular-nums">
                {sortIndex + 1}
              </span>
            )}
          </button>
        ) : (
          <span className="truncate">{label}</span>
        )}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-label={t("tableFilter.open", { column: label })}
                data-active={active}
                className={cn("shrink-0 rounded p-0.5 hover:bg-muted", active ? "text-primary" : "text-muted-foreground/60")}
              />
            }
          >
            <FunnelIcon aria-hidden="true" className={cn("size-3.5", active && "fill-current")} />
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" align={numeric ? "end" : "start"}>
            {meta.type === "enum" ? (
              <EnumFilter facets={facets} checked={Array.isArray(criterion) ? criterion : []} onCriterion={onCriterion} />
            ) : (
              <TextFilter
                type={meta.type}
                label={label}
                initial={typeof criterion === "string" ? criterion : ""}
                onCriterion={onCriterion}
                onDone={() => setOpen(false)}
              />
            )}
          </PopoverContent>
        </Popover>
      </div>
    </TableHead>
  );
}

function TextFilter({
  type,
  label,
  initial,
  onCriterion,
  onDone,
}: {
  type: "text" | "number" | "date";
  label: string;
  initial: string;
  onCriterion: (criterion: Criterion | null) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  // The draft may be invalid: it stays here, and only a valid criterion reaches the table.
  const [draft, setDraft] = useState(initial);
  const parsed = parseCriterion(draft, type);
  const change = (text: string) => {
    setDraft(text);
    const next = parseCriterion(text, type);
    if (next.ok) onCriterion(next.test === null ? null : text);
  };
  return (
    <div className="flex flex-col gap-2">
      <Input
        autoFocus
        value={draft}
        onChange={(event) => change(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onDone();
        }}
        aria-label={t("tableFilter.input", { column: label })}
        aria-invalid={!parsed.ok}
        className="font-mono"
      />
      {parsed.ok ? (
        <p className="font-mono text-xs text-muted-foreground">{t(`tableFilter.help.${type}`)}</p>
      ) : (
        <p role="alert" className="text-xs text-destructive">
          {t(`tableFilter.errors.${parsed.error}`)}
        </p>
      )}
      <Button size="xs" variant="outline" className="self-end" onClick={() => change("")}>
        {t("tableFilter.clear")}
      </Button>
    </div>
  );
}

function EnumFilter({
  facets,
  checked,
  onCriterion,
}: {
  facets: readonly Facet[];
  checked: readonly (string | null)[];
  onCriterion: (criterion: Criterion | null) => void;
}) {
  const { t } = useTranslation();
  const toggle = (value: string | null, on: boolean) => {
    const next = on ? [...checked, value] : checked.filter((item) => item !== value);
    onCriterion(next.length === 0 ? null : next);
  };
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {facets.map((facet) => {
          const text = facet.label ?? t("tableFilter.empty");
          return (
            <li key={facet.value ?? " null"}>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox checked={checked.includes(facet.value)} onCheckedChange={(on) => toggle(facet.value, on === true)} aria-label={text} />
                <span className="truncate">{text}</span>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">{facet.count}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <Button size="xs" variant="outline" className="self-end" onClick={() => onCriterion(null)}>
        {t("tableFilter.clear")}
      </Button>
    </div>
  );
}
```

`apps/web/src/components/table/ActiveFilters.tsx` :

```tsx
import { useTranslation } from "react-i18next";
import { XIcon } from "lucide-react";
import { Badge } from "@ib/ui/badge";
import { Button } from "@ib/ui/button";
import { activeCriteria, type ColumnSpec, type Criterion, type TableView } from "@/lib/tableView";

export interface ActiveFiltersProps<Row> {
  specs: readonly ColumnSpec<Row>[];
  view: TableView;
  columnLabel: (key: string) => string;
  onClearColumn: (key: string) => void;
  onClearAll: () => void;
}

/** The criterion as a pill reads it: the typed text, or the checked labels. */
export function criterionSummary<Row>(spec: ColumnSpec<Row>, criterion: Criterion, emptyLabel: string): string {
  if (typeof criterion === "string") return criterion.trim();
  return criterion.map((value) => (value === null ? emptyLabel : (spec.label?.(value) ?? value))).join(", ");
}

/** One pill per filtered column above a table, and a way to clear them all. Nothing when unfiltered. */
export function ActiveFilters<Row>({ specs, view, columnLabel, onClearColumn, onClearAll }: ActiveFiltersProps<Row>) {
  const { t } = useTranslation();
  const active = activeCriteria(specs, view);
  if (active.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {active.map(({ spec, criterion }) => {
        const column = columnLabel(spec.key);
        return (
          <Badge key={spec.key} variant="secondary" className="gap-1 pr-0.5">
            <span>{`${column} : ${criterionSummary(spec, criterion, "—")}`}</span>
            <button
              type="button"
              aria-label={t("tableFilter.clearColumn", { column })}
              className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
              onClick={() => onClearColumn(spec.key)}
            >
              <XIcon aria-hidden="true" className="size-3" />
            </button>
          </Badge>
        );
      })}
      <Button size="xs" variant="ghost" onClick={onClearAll}>
        {t("tableFilter.clearAll")}
      </Button>
    </div>
  );
}
```

Le séparateur ` : ` suit la typographie française ; en anglais la pastille garde la même forme (pas de clé i18n pour un signe de ponctuation).

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter web test src/components/table/ && pnpm --filter web typecheck && pnpm --filter @ib/ui typecheck`
Expected: PASS. Si le nom accessible d'une case à cocher base-ui ne se résout pas (`findByRole("checkbox", { name: /Trade/ })` introuvable), vérifier que `aria-label` est bien transmis à l'élément `role="checkbox"` par le composant généré ; ne pas remplacer la requête par un sélecteur CSS. Si `userEvent` ne transmet pas `shiftKey` au clic, remplacer les deux lignes `keyboard` par `fireEvent.click(bouton, { shiftKey: true })`.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/ui/popover.tsx packages/ui/src/components/ui/checkbox.tsx apps/web/src/components/table apps/web/src/i18n/fr.json apps/web/src/i18n/en.json docs/plans/2026-09-17-tri-filtres-tableaux.md
git commit -m "En-têtes triables et filtrables, pastilles de filtres actifs

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Historique — tri, filtres de colonne, recherche, liste Type ; retrait des anciens filtres

**Files:**
- Modify: `apps/web/src/components/history/HistoryTable.tsx`
- Modify: `apps/web/src/pages/HistoryPage.tsx`
- Test: `apps/web/src/pages/HistoryPage.test.tsx`
- Delete: `apps/web/src/lib/periodPresets.ts`, `apps/web/src/lib/periodPresets.test.ts`
- Modify: `packages/ledger/src/filter.ts`, `packages/ledger/src/filter.test.ts`
- Modify: `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`
- Modify: `docs/specs/2026-09-17-tri-filtres-tableaux-design.md` (§5.4, « Remontage »)

**Interfaces:**
- Consumes : `historyColumnSpecs`, `historyTicker`, `HISTORY_COLUMNS` (tâche 4) ; `useTableView`, `usePageSearch` (tâche 5) ; `ColumnHeader`, `ActiveFilters` (tâche 6) ; `applyView`, `facetValues` (tâche 2) ; `tableViewKey`, `pageSearchKey` (tâche 3).
- Produces : nouvelles props de `HistoryTable` :
  ```ts
  export interface HistoryTableProps {
    rows: readonly LedgerRow[];            // filtered and sorted
    labelledBy: string;
    specs: readonly ColumnSpec<LedgerRow>[];
    view: TableView;
    facets: Readonly<Record<string, readonly Facet[]>>;
    /** Any change scrolls back to the top; a live row does not change it. */
    resetKey: string;
    onSort: (column: string, additive: boolean) => void;
    onCriterion: (column: string, criterion: Criterion | null) => void;
  }
  ```

- [ ] **Step 1: Rewrite the page tests**

Dans `apps/web/src/pages/HistoryPage.test.tsx` :

1. Dans le `beforeEach`, ajouter `window.localStorage.clear();`.
2. **Supprimer** les tests `"filters by kind and drops the filter again on All types"`, `"filters by date range, inclusive"` et `"fills both dates from a year preset, keeps that year's rows, and lets All drop them"`.
3. Remplacer, dans `"keeps the balances of the whole ledger when a filter hides earlier rows"` et `"brings the table back to its top when a filter changes"`, `screen.getByPlaceholderText("Filtrer par symbole…")` par `screen.getByRole("textbox", { name: "Rechercher un ticker" })` ; la recherche porte sur le ticker, les attentes (`AAPL` ; `SYM1` et ses 111 lignes) restent vraies.
4. Dans `"says on the balance headers what the balances are anchored on"`, les en-têtes ont désormais un bouton de filtre dans leur nom accessible : remplacer `{ name: "Cash USD" }` par `{ name: /^Cash USD/ }` et `{ name: "Cash EUR" }` par `{ name: /^Cash EUR/ }`.
5. Dans `"keeps its columns on fixed widths…"`, garder l'attente sur `textContent` (icônes sans texte, aucun numéro de tri sans tri).
6. Ajouter, avec des helpers en tête de fichier :

```tsx
async function openFilter(user: ReturnType<typeof userEvent.setup>, column: string) {
  await user.click(screen.getByRole("button", { name: `Filtrer ${column}` }));
}

function sortButton(column: string) {
  return within(screen.getByRole("columnheader", { name: new RegExp(`^${column}`) })).getByRole("button", { name: column });
}
```

et les tests :

```tsx
  it("sorts on a header click, then back to the default order on the third", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    const user = userEvent.setup();
    await user.click(sortButton("Prix total"));
    // Amounts: AAPL -18050, TSLA -1100, MSFT 610, deposit 10000.
    await waitFor(() => expect(rowSymbols()).toEqual(["AAPL", "TSLA", "MSFT", "ELECTRONIC FUND TRANSFER"]));
    expect(screen.getByRole("columnheader", { name: /^Prix total/ })).toHaveAttribute("aria-sort", "ascending");
    await user.click(sortButton("Prix total"));
    await waitFor(() => expect(rowSymbols()).toEqual(["ELECTRONIC FUND TRANSFER", "MSFT", "TSLA", "AAPL"]));
    await user.click(sortButton("Prix total"));
    await waitFor(() => expect(rowSymbols()).toEqual(["AAPL", "MSFT", "TSLA", "ELECTRONIC FUND TRANSFER"]));
  });

  it("puts the rows without a value last, whatever the direction", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    const user = userEvent.setup();
    await user.click(sortButton("Frais"));
    await user.click(sortButton("Frais"));
    await waitFor(() => expect(rowSymbols().at(-1)).toBe("ELECTRONIC FUND TRANSFER"));
    await user.click(sortButton("Frais"));
    await user.click(sortButton("Frais"));
    await waitFor(() => expect(rowSymbols().at(-1)).toBe("ELECTRONIC FUND TRANSFER"));
  });

  it("filters a column with a criterion and keeps each row's whole-ledger balance", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    const user = userEvent.setup();
    await openFilter(user, "Prix total");
    await user.type(await screen.findByRole("textbox", { name: "Critère pour Prix total" }), ">0");
    await waitFor(() => expect(rowSymbols()).toEqual(["MSFT", "ELECTRONIC FUND TRANSFER"]));
    expect(within(await rowFor("MSFT")).getAllByRole("cell")[USD_CASH_CELL]).toHaveTextContent("-491.65");
    expect(screen.getByText("Prix total : >0")).toBeInTheDocument();
  });

  it("shows an invalid criterion in red and does not filter on it", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    const user = userEvent.setup();
    await openFilter(user, "Date/Heure");
    const input = await screen.findByRole("textbox", { name: "Critère pour Date/Heure" });
    await user.type(input, "2025-13");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(rowSymbols()).toHaveLength(4);
    await user.clear(input);
    await user.type(input, "2026-08-2");
    expect(input).toHaveAttribute("aria-invalid", "true");
    await user.type(input, "7");
    await waitFor(() => expect(rowSymbols()).toEqual(["MSFT"]));
  });

  it("keeps the Type list above the table and the Type column filter on one state", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(await screen.findByRole("option", { name: /Dépôt\/Retrait/ }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(rowSymbols()).toEqual(["ELECTRONIC FUND TRANSFER"]));
    await openFilter(user, "Type");
    expect(await screen.findByRole("checkbox", { name: /Dépôt\/Retrait/ })).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: /Trade/ }));
    await waitFor(() => expect(rowSymbols()).toHaveLength(4));
  });

  it("counts the Type values over the whole ledger, not over the filtered rows", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Rechercher un ticker" }), "=MSFT");
    await waitFor(() => expect(rowSymbols()).toEqual(["MSFT"]));
    await openFilter(user, "Type");
    const trade = (await screen.findByRole("checkbox", { name: /Trade/ })).closest("label")!;
    expect(trade).toHaveTextContent("3");
  });

  it("searches the ticker with OR, an option by its underlying", async () => {
    await seed([
      ...SAMPLE_TRANSACTIONS,
      { ...SAMPLE_TRANSACTIONS[0], externalId: "flex:trade:9", symbol: "MSFT  261016C00400000", secType: "OPT", right: "C", strike: 400, expiry: "2026-10-16" },
    ]);
    renderHistory();
    await screen.findByText("AAPL");
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Rechercher un ticker" }), "=MSFT|=TSLA");
    await waitFor(() => expect(rowSymbols()).toEqual(["MSFT Oct16'26 400 Call", "MSFT", "TSLA"]));
  });

  it("hides the timeline under a sort and brings it back on the default order", async () => {
    await seed(manyRows(50));
    renderHistory();
    await screen.findByText("SYM49");
    expect(screen.getByRole("slider", { name: "Frise chronologique" })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(sortButton("Date/Heure"));
    await waitFor(() => expect(screen.queryByRole("slider", { name: "Frise chronologique" })).not.toBeInTheDocument());
    await user.click(sortButton("Date/Heure"));
    await user.click(sortButton("Date/Heure"));
    expect(await screen.findByRole("slider", { name: "Frise chronologique" })).toBeInTheDocument();
  });

  it("keeps headers, pills and Clear all when a filter empties the table", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    const user = userEvent.setup();
    await openFilter(user, "Quantité");
    await user.type(await screen.findByRole("textbox", { name: "Critère pour Quantité" }), ">1000000");
    expect(await screen.findByText("Aucune transaction ne correspond.")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /^Quantité/ })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Tout effacer" }));
    await waitFor(() => expect(rowSymbols()).toHaveLength(4));
  });

  it("remembers the view per account, across a remount", async () => {
    await seed();
    await seed([{ ...SAMPLE_TRANSACTIONS[0], accountId: "beta", externalId: "flex:trade:b1", symbol: "BETA" }]);
    const first = renderHistory("alpha");
    await screen.findByText("AAPL");
    const user = userEvent.setup();
    await user.click(sortButton("Prix total"));
    await waitFor(() => expect(rowSymbols()[0]).toBe("AAPL"));
    first.unmount();
    renderHistory("beta");
    await screen.findByText("BETA");
    expect(screen.getByRole("columnheader", { name: /^Prix total/ })).not.toHaveAttribute("aria-sort");
    cleanup();
    renderHistory("alpha");
    await screen.findByText("AAPL");
    expect(screen.getByRole("columnheader", { name: /^Prix total/ })).toHaveAttribute("aria-sort", "ascending");
    expect(rowSymbols()).toEqual(["AAPL", "TSLA", "MSFT", "ELECTRONIC FUND TRANSFER"]);
  });

  it("no longer offers the date fields nor the period presets", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    expect(screen.queryByLabelText("Date de début")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Période" })).not.toBeInTheDocument();
  });
```

Ajouter `cleanup` à l'import de `@testing-library/react`. Le solde USD de MSFT (`-491.65`) se vérifie à la main sur `SAMPLE_TRANSACTIONS` : dépôt EUR (USD 0), TSLA `-1101` → `-1101`, MSFT `+609.35` → `-491.65`. Si le calcul réel diffère, lire la valeur dans le test existant `"computes the running balances…"` et la cellule avant filtre, jamais ajuster pour faire passer.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test src/pages/HistoryPage.test.tsx`
Expected: FAIL sur les nouveaux tests (pas de bouton de tri, pas de champ « Rechercher un ticker »).

- [ ] **Step 3: Rewrite `HistoryTable`**

Dans `apps/web/src/components/history/HistoryTable.tsx` :

- Remplacer l'interface de props par celle de la section **Interfaces** ci-dessus, et importer `useLayoutEffect`, `ColumnHeader`, `ColumnSpec`, `Criterion`, `Facet`, `TableView`.
- Mettre à jour le commentaire de la fonction : le tableau n'est plus remonté par la page à chaque filtre ; `resetKey` le ramène en haut.
- Après la création du virtualiseur, ajouter :

```tsx
  // Back to the top on a new search, criterion or sort. Not a remount: the filter popovers live in
  // this header and would close under the reader's fingers. The synchronous scroll event lets the
  // virtualizer read the new offset before paint; a row arriving live leaves resetKey unchanged.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || element.scrollTop === 0) return;
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  }, [resetKey]);
```

- Remplacer le rendu des `TableHead` de l'en-tête par :

```tsx
              {HISTORY_COLUMNS.map((column, index) => (
                <ColumnHeader
                  key={column.key}
                  meta={specs[index]}
                  label={t(`history.columns.${column.key}`)}
                  view={view}
                  facets={facets[column.key]}
                  numeric={column.numeric}
                  className={`sticky top-0 z-10 border-b bg-card ${column.numeric ? "text-right" : ""}`}
                  // Anchored on the cash points when a file carries a Cash Report; the Consistency
                  // page checks it, the title says so on the column itself.
                  title={column.balance ? t("history.columns.balanceHint") : undefined}
                  onSort={(additive) => onSort(column.key, additive)}
                  onCriterion={(criterion) => onCriterion(column.key, criterion)}
                />
              ))}
```

- Dans `TableBody`, avant le premier `SpacerRow`, ajouter la ligne vide :

```tsx
            {rows.length === 0 && (
              <tr>
                <td colSpan={HISTORY_COLUMNS.length} className="py-12 text-center text-sm text-muted-foreground">
                  {t("history.noResults")}
                </td>
              </tr>
            )}
```

- Rendre la barre temporelle seulement sans tri :

```tsx
      {view.sort.length === 0 && (
        <TimelineScrubber ... />   // mêmes props qu'aujourd'hui
      )}
```

- `getItemKey` doit supporter zéro ligne (le virtualiseur ne l'appelle pas avec `count: 0`, rien à changer).

- [ ] **Step 4: Rewrite `HistoryPage`**

Remplacer le contenu de `apps/web/src/pages/HistoryPage.tsx` par :

```tsx
import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { anchoredBalances } from "@ib/ledger";
import { Card, CardContent } from "@ib/ui/card";
import { Input } from "@ib/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ib/ui/select";
import { HistoryTable } from "@/components/history/HistoryTable";
import { ActiveFilters } from "@/components/table/ActiveFilters";
import { useCashPoints, useLedger } from "@/db/hooks";
import { usePageSearch, useTableView } from "@/hooks/useTableView";
import { BALANCE_CURRENCIES } from "@/lib/currencies";
import { historyColumnSpecs, historyTicker } from "@/lib/historyColumns";
import { applyView, facetValues } from "@/lib/tableView";
import { pageSearchKey, tableViewKey } from "@/lib/tableViewStorage";

export function HistoryPage() {
  const { accountId = "" } = useParams<{ accountId: string }>();
  const { t } = useTranslation();
  const titleId = useId();
  const ledger = useLedger(accountId);
  const points = useCashPoints(accountId);
  const specs = useMemo(() => historyColumnSpecs((key) => t(key)), [t]);
  const table = useTableView(tableViewKey(accountId, "history"), specs);
  const search = usePageSearch(pageSearchKey(accountId, "history"));

  // Balances run over the whole ledger, oldest first, anchored on the cash points, before any
  // filter or sort: a row keeps its balance whatever the view. The default order is newest first.
  const anchored = useMemo(
    () => (ledger && points ? anchoredBalances(ledger, BALANCE_CURRENCIES, points) : undefined),
    [ledger, points],
  );
  const rows = useMemo(() => (anchored ? [...anchored.rows].reverse() : undefined), [anchored]);
  const visible = useMemo(
    () => (rows ? applyView(rows, specs, table.view, { text: search.applied, ticker: historyTicker }) : undefined),
    [rows, specs, table.view, search.applied],
  );

  const typeSpec = specs.find((spec) => spec.key === "type")!;
  const typeCriterion = table.view.criteria.type;
  const checkedTypes = Array.isArray(typeCriterion) ? typeCriterion : [];
  // Counted over the whole ledger: a type does not vanish because another filter emptied its rows.
  const facets = useMemo(
    () => ({ type: rows ? facetValues(rows, typeSpec, checkedTypes) : [] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, typeSpec, JSON.stringify(checkedTypes)],
  );

  if (!visible) {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  const resetKey = JSON.stringify([search.applied, table.view]);

  return (
    // 3rem is AppLayout's title bar (h-12): changing one means changing the other, there is no
    // shared variable between them.
    <div className="flex h-[calc(100svh-3rem)] flex-col gap-4 p-4 md:p-6">
      <h1 id={titleId} className="font-heading text-lg font-semibold tracking-tight">
        {t("nav.history")}
      </h1>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search.input}
          onChange={(event) => search.setInput(event.target.value)}
          placeholder={t("history.searchPlaceholder")}
          aria-label={t("history.searchLabel")}
          className="max-w-xs font-mono"
        />
        <Select
          multiple
          value={checkedTypes.filter((value): value is string => value !== null)}
          onValueChange={(next: string[] | null) => table.setCriterion("type", next ?? [])}
        >
          <SelectTrigger className="w-56" aria-label={t("history.kindFilter")}>
            <SelectValue>
              {(value: string[]) =>
                value.length === 0 ? t("history.allKinds") : value.map((kind) => t(`history.kinds.${kind}`)).join(", ")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {facets.type
              .filter((facet): facet is typeof facet & { value: string } => facet.value !== null)
              .map((facet) => (
                <SelectItem key={facet.value} value={facet.value}>
                  {`${facet.label} (${facet.count})`}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      <ActiveFilters
        specs={specs}
        view={table.view}
        columnLabel={(key) => t(`history.columns.${key}`)}
        onClearColumn={table.clearColumn}
        onClearAll={table.clearAll}
      />

      <Card className="min-h-0 flex-1 py-0">
        <CardContent className="flex min-h-0 flex-1 px-0">
          {/* Keyed on the account only: a new account starts at the top in a fresh container. */}
          <HistoryTable
            key={accountId}
            rows={visible}
            labelledBy={titleId}
            specs={specs}
            view={table.view}
            facets={facets}
            resetKey={resetKey}
            onSort={table.toggleSort}
            onCriterion={table.setCriterion}
          />
        </CardContent>
      </Card>
    </div>
  );
}
```

Points à vérifier en écrivant :
- le typage exact de `Select` base-ui en mode `multiple` (`onValueChange` peut recevoir `string[]`) : lire `apps/web/node_modules/@base-ui/react/select/root/SelectRoot.d.ts` et ajuster la signature du rappel, pas le comportement ;
- dans le test `"keeps the Type list…"`, l'option du `Select` porte le nombre (`Dépôt/Retrait (1)`), d'où la regex ;
- si la règle `react-hooks/exhaustive-deps` n'existe pas dans le dépôt, retirer la directive `eslint-disable-next-line` et garder la dépendance `JSON.stringify(checkedTypes)` calculée dans une variable avant le `useMemo`.

- [ ] **Step 5: Translations and removals**

Dans `fr.json`, section `history` : supprimer `filterPlaceholder`, `startDate`, `endDate`, `presets` ; ajouter :

```json
    "searchLabel": "Rechercher un ticker",
    "searchPlaceholder": "Rechercher un ticker : AAPL, AAPL|MSFT…",
```

Dans `en.json`, section `history`, mêmes retraits, et :

```json
    "searchLabel": "Search a ticker",
    "searchPlaceholder": "Search a ticker: AAPL, AAPL|MSFT…",
```

Garder `kindFilter`, `allKinds`, `kinds`, `noResults`, `timeline`, `columns`.

Retraits de code :

```bash
git rm apps/web/src/lib/periodPresets.ts apps/web/src/lib/periodPresets.test.ts
grep -rn "periodPresets\|matchesFilter\|filterTransactions\|TransactionFilter" apps packages --include=*.ts --include=*.tsx | grep -v node_modules
```

Expected : seules restent les occurrences de `packages/ledger/src/filter.ts` et `filter.test.ts`. Réduire `filter.ts` à :

```ts
/** IB day (New York) of a `when` stamped UTC (see ib-parsers' common.ts). */
export function dayOf(when: string): string {
  return when.slice(0, 10);
}
```

et `filter.test.ts` à son seul bloc `describe("dayOf")`, import `import { dayOf } from "./filter.ts";`. Relancer le `grep` : aucune occurrence.

- [ ] **Step 6: Correct the spec**

Dans `docs/specs/2026-09-17-tri-filtres-tableaux-design.md` §5.4, remplacer le point **Remontage** par :

```markdown
- **Retour en haut** : la clé de `HistoryTable` ne porte plus que le compte. Un changement de
  recherche, de critère ou de tri remet `scrollTop` à 0 dans un `useLayoutEffect` sur une
  `resetKey` (`JSON.stringify([search, view])`) et émet un événement `scroll` synchrone pour que
  le virtualiseur suive avant la peinture. Remonter le tableau à chaque frappe fermerait le
  popover de filtre, qui vit dans son en-tête. Une ligne arrivée en direct ne change pas la
  `resetKey`.
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter web test src/pages/HistoryPage.test.tsx src/components/history && pnpm --filter @ib/ledger test && pnpm --filter web typecheck`
Expected: PASS, y compris les tests existants de défilement (`"brings the table back to its top when a filter changes"`, `"…when the account changes"`, `"keeps the reader's scroll position when a row arrives live"`, `"jumps from the timeline…"`). Le nom du paquet ledger est à lire dans `packages/ledger/package.json` si `@ib/ledger` ne répond pas.

- [ ] **Step 8: Commit**

```bash
git add -A apps/web/src/components/history apps/web/src/pages/HistoryPage.tsx apps/web/src/pages/HistoryPage.test.tsx apps/web/src/lib/periodPresets.ts apps/web/src/lib/periodPresets.test.ts packages/ledger/src/filter.ts packages/ledger/src/filter.test.ts apps/web/src/i18n/fr.json apps/web/src/i18n/en.json docs/specs/2026-09-17-tri-filtres-tableaux-design.md docs/plans/2026-09-17-tri-filtres-tableaux.md
git commit -m "Historique : tri et filtres de colonne, recherche par ticker

Les champs symbole et date, le type unique et les raccourcis de période
disparaissent, avec matchesFilter et filterTransactions de ledger.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Positions — recherche de page et une vue par carte de groupe

**Files:**
- Modify: `apps/web/src/components/PositionTable.tsx`
- Create: `apps/web/src/components/PositionGroupCard.tsx`
- Modify: `apps/web/src/pages/PositionsPage.tsx`
- Test: `apps/web/src/pages/PositionsPage.test.tsx`
- Modify: `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`

**Interfaces:**
- Consumes : `positionColumnSpecs` (tâche 4) ; `useTableView`, `usePageSearch` (tâche 5) ; `ColumnHeader`, `ActiveFilters` (tâche 6) ; `applyView`, `facetValues`, `EMPTY_VIEW` (tâche 2) ; `tableViewKey`, `pageSearchKey` (tâche 3) ; `groupedPositions`, `PositionGroup`, `AnalyzedPosition` de `@ib/coverage` ; `PositionRow`, `coverageBadges`, `groupTitleKey`.
- Produces :
  ```tsx
  // PositionTable.tsx
  export interface InteractiveHeader {
    specs: readonly ColumnSpec<AnalyzedPosition>[];
    view: TableView;
    facets: Readonly<Record<string, readonly Facet[]>>;
    onSort: (column: string, additive: boolean) => void;
    onCriterion: (column: string, criterion: Criterion | null) => void;
  }
  export function PositionTableHeader(props: { interactive?: InteractiveHeader }): JSX.Element;
  // PositionGroupCard.tsx
  export function PositionGroupCard(props: {
    accountId: string;
    groupId: string;
    title: string;
    /** The group's positions in the snapshot, before search and filters: what the facets count. */
    positions: readonly AnalyzedPosition[];
    /** The same after the page search. */
    searched: readonly AnalyzedPosition[];
    specs: readonly ColumnSpec<AnalyzedPosition>[];
    sectorOf: (symbol: string) => string | null;
  }): JSX.Element;
  ```

- [ ] **Step 1: Rewrite the page tests**

Dans `apps/web/src/pages/PositionsPage.test.tsx` :

1. `beforeEach` : ajouter `window.localStorage.clear();`.
2. Remplacer `"filters rows by the Position column as the user types, and says when nothing matches"` et `"spells a contract like the journals do, and filters on that spelling"` par :

```tsx
  it("searches every card on the ticker, with OR, and says when nothing matches", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    await screen.findByText("XOM Mar20'26 100 Put");
    const user = userEvent.setup();
    const input = screen.getByRole("textbox", { name: "Rechercher un ticker" });
    await user.type(input, "=MSFT|=XOM");
    await waitFor(() => expect(screen.queryByText("AAPL Jan16'26 150 Call")).not.toBeInTheDocument());
    expect(screen.getByText("MSFT Mar20'26 400 Call")).toBeInTheDocument();
    expect(screen.getByText("XOM Mar20'26 100 Put")).toBeInTheDocument();
    // AAPL shares were the only long position: the card goes with them.
    expect(screen.queryByText("Positions longues")).not.toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "=NOPE");
    expect(await screen.findByText("Aucune position ne correspond.")).toBeInTheDocument();
  });

  it("spells a contract like the journals do", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    expect(await screen.findByText("AAPL Jan16'26 150 Call")).toBeInTheDocument();
  });

  it("filters one card on its own column, leaving the other cards alone", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    const sells = (await screen.findByText("Ventes d'options")).closest("[data-slot=card]") as HTMLElement;
    const user = userEvent.setup();
    await user.click(within(sells).getByRole("button", { name: "Filtrer P/L latent" }));
    await user.type(await screen.findByRole("textbox", { name: "Critère pour P/L latent" }), "<0");
    await waitFor(() => expect(within(sells).queryByText("XOM Mar20'26 100 Put")).not.toBeInTheDocument());
    expect(within(sells).getByText("AAPL Feb20'26 155 Call")).toBeInTheDocument();
    expect(screen.getByText("MSFT Jan21'28 300 Call")).toBeInTheDocument();
    expect(within(sells).getByText("P/L latent : <0")).toBeInTheDocument();
  });

  it("keeps a card emptied by its own filter, with its headers and a way back", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    const longs = (await screen.findByText("Positions longues")).closest("[data-slot=card]") as HTMLElement;
    const user = userEvent.setup();
    await user.click(within(longs).getByRole("button", { name: "Filtrer Quantité" }));
    await user.type(await screen.findByRole("textbox", { name: "Critère pour Quantité" }), ">1000");
    expect(await within(longs).findByText("Aucune position ne correspond.")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(within(longs).getByRole("button", { name: "Tout effacer" }));
    expect(await within(longs).findByText("AAPL")).toBeInTheDocument();
  });

  it("sorts a card on unrealized P/L, unknown values last", async () => {
    await db.snapshots.put({ ...SAMPLE_SNAPSHOT, positions: [...SAMPLE_POSITIONS.slice(0, 5), { ...SAMPLE_POSITIONS[5], unrealizedPnl: null }] });
    renderPositions();
    const sells = (await screen.findByText("Ventes d'options")).closest("[data-slot=card]") as HTMLElement;
    const user = userEvent.setup();
    const header = within(sells).getByRole("columnheader", { name: /^P\/L latent/ });
    await user.click(within(header).getByRole("button", { name: "P/L latent" }));
    const order = () => within(sells).getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0].textContent);
    await waitFor(() => expect(order()[0]).toBe("AAPL Feb20'26 155 Call"));
    expect(order().at(-1)).toBe("XOM Mar20'26 100 Put");
    await user.click(within(header).getByRole("button", { name: "P/L latent" }));
    await waitFor(() => expect(order()[0]).toBe("AAPL Jan16'26 150 Call"));
    expect(order().at(-1)).toBe("XOM Mar20'26 100 Put");
  });

  it("filters the coverage on UNCOVERED", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    const sells = (await screen.findByText("Ventes d'options")).closest("[data-slot=card]") as HTMLElement;
    const user = userEvent.setup();
    await user.click(within(sells).getByRole("button", { name: "Filtrer Couverture" }));
    await user.click(await screen.findByRole("checkbox", { name: /UNCOVERED/ }));
    await waitFor(() => expect(within(sells).getAllByRole("row")).toHaveLength(2));
    expect(within(sells).getByText("AAPL Feb20'26 155 Call")).toBeInTheDocument();
  });

  it("gives the cash card no interactive header", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    await seedCash();
    renderPositions();
    const cash = (await screen.findByText("Cash", { selector: "[data-slot=card-title]" })).closest("[data-slot=card]") as HTMLElement;
    expect(within(cash).queryByRole("button", { name: /^Filtrer/ })).not.toBeInTheDocument();
  });
```

Avant d'écrire ces tests, vérifier sur `SAMPLE_SNAPSHOT` rendu (test existant `"renders the short put…"`) :
- le groupe de chaque position : ventes d'options = AAPL 150 C, AAPL 155 C, MSFT 400 C, XOM 100 P et les deux jambes vendues de XYZ ; achats = MSFT 300 C (LEAPS) et les deux jambes achetées de XYZ ; longues = AAPL ;
- les libellés d'en-tête réels (`positions.columns.*` de `fr.json`) : « P/L latent », « Quantité », « Couverture » ; si l'un diffère, utiliser le libellé réel ;
- le titre de la carte Cash et l'attribut `data-slot` des cartes (`packages/ui/src/components/ui/card.tsx`) ;
- dans `"sorts a card…"`, les P/L des ventes : AAPL 155 C `-20`, MSFT 400 C `-10`, XYZ 105 C `50`, XYZ 95 P `100`, AAPL 150 C `120`, XOM `null`. Si le moteur réorganise les lignes (quantités agrégées, jambes XYZ regroupées ailleurs), lire l'ordre réel des lignes du groupe avant tri et recalculer les attentes à la main à partir de ces valeurs, jamais depuis la sortie du code testé ;
- dans `"filters the coverage…"`, la seule vente `UNCOVERED` est AAPL 155 C (`UNCOVERED ×1`, test existant) : une ligne d'en-tête plus une ligne.

3. `"lines up the columns of every table on the page, the cash included"` : si l'attente porte sur le nom ou le texte des en-têtes, garder `textContent` ; un nom accessible passe en regex `^…`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test src/pages/PositionsPage.test.tsx`
Expected: FAIL sur les nouveaux tests.

- [ ] **Step 3: `PositionTableHeader` accepts interactive headers**

Remplacer `PositionTableHeader` dans `apps/web/src/components/PositionTable.tsx` :

```tsx
export interface InteractiveHeader {
  specs: readonly ColumnSpec<AnalyzedPosition>[];
  view: TableView;
  facets: Readonly<Record<string, readonly Facet[]>>;
  onSort: (column: string, additive: boolean) => void;
  onCriterion: (column: string, criterion: Criterion | null) => void;
}

/**
 * The header row of the ten shared columns. Sortable and filterable when `interactive` is given;
 * plain otherwise, as on the strategy pages, which are out of this feature's scope.
 */
export function PositionTableHeader({ interactive }: { interactive?: InteractiveHeader }) {
  const { t } = useTranslation();
  return (
    <TableHeader>
      <TableRow>
        {POSITION_COLUMNS.map((column, index) =>
          interactive ? (
            <ColumnHeader
              key={column.key}
              meta={interactive.specs[index]}
              label={t(`positions.columns.${column.key}`)}
              view={interactive.view}
              facets={interactive.facets[column.key]}
              numeric={column.numeric}
              className={cn(column.numeric && "text-right")}
              onSort={(additive) => interactive.onSort(column.key, additive)}
              onCriterion={(criterion) => interactive.onCriterion(column.key, criterion)}
            />
          ) : (
            <TableHead key={column.key} className={cn(column.numeric && "text-right")}>
              {t(`positions.columns.${column.key}`)}
            </TableHead>
          ),
        )}
      </TableRow>
    </TableHeader>
  );
}
```

avec les imports `AnalyzedPosition` (`@ib/coverage`), `ColumnHeader`, `ColumnSpec`, `Criterion`, `Facet`, `TableView`.

- [ ] **Step 4: `PositionGroupCard`**

`apps/web/src/components/PositionGroupCard.tsx` :

```tsx
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AnalyzedPosition } from "@ib/coverage";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { TableBody, TableCell, TableRow } from "@ib/ui/table";
import { PositionRow } from "@/components/PositionRow";
import { PositionTable, PositionTableHeader } from "@/components/PositionTable";
import { ActiveFilters } from "@/components/table/ActiveFilters";
import { useTableView } from "@/hooks/useTableView";
import { formatContract } from "@/lib/format";
import { POSITION_COLUMNS } from "@/lib/positionColumns";
import { coverageBadges } from "@/lib/riskReport";
import { applyView, facetValues, type ColumnSpec } from "@/lib/tableView";
import { tableViewKey } from "@/lib/tableViewStorage";

export interface PositionGroupCardProps {
  accountId: string;
  groupId: string;
  title: string;
  /** The group's positions in the snapshot, before search and filters: what the facets count. */
  positions: readonly AnalyzedPosition[];
  /** The same after the page search. */
  searched: readonly AnalyzedPosition[];
  specs: readonly ColumnSpec<AnalyzedPosition>[];
  sectorOf: (symbol: string) => string | null;
}

/**
 * One group of the Positions page with its own sort and filters: a column means something else in
 * another group (a Type, a Decision, a Coverage), so each card remembers its view apart.
 */
export function PositionGroupCard({ accountId, groupId, title, positions, searched, specs, sectorOf }: PositionGroupCardProps) {
  const { t } = useTranslation();
  const table = useTableView(tableViewKey(accountId, `positions:${groupId}`), specs);
  const rows = useMemo(() => applyView(searched, specs, table.view), [searched, specs, table.view]);
  const facets = useMemo(
    () =>
      Object.fromEntries(
        specs
          .filter((spec) => spec.type === "enum")
          .map((spec) => {
            const criterion = table.view.criteria[spec.key];
            return [spec.key, facetValues(positions, spec, Array.isArray(criterion) ? criterion : [])];
          }),
      ),
    [positions, specs, table.view],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 overflow-x-auto">
        <ActiveFilters
          specs={specs}
          view={table.view}
          columnLabel={(key) => t(`positions.columns.${key}`)}
          onClearColumn={table.clearColumn}
          onClearAll={table.clearAll}
        />
        <PositionTable>
          <PositionTableHeader interactive={{ specs, view: table.view, facets, onSort: table.toggleSort, onCriterion: table.setCriterion }} />
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={POSITION_COLUMNS.length} className="py-8 text-center text-sm text-muted-foreground">
                  {t("positions.noResults")}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((position) => (
                <PositionRow
                  key={position.description}
                  values={{
                    contract: formatContract(position),
                    label: position.label,
                    sector: sectorOf(position.symbol),
                    marketValue: position.marketValue,
                    quantity: position.quantity,
                    avgPrice: position.avgPrice,
                    lastPrice: position.lastPrice,
                    unrealizedPnl: position.unrealizedPnl,
                    decision: position.decision,
                    coverage: coverageBadges(position),
                  }}
                />
              ))
            )}
          </TableBody>
        </PositionTable>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Rewrite the Positions list in `PositionsPage`**

Dans `apps/web/src/pages/PositionsPage.tsx` :
- supprimer `useState`, `filter`, `setFilter`, les imports désormais inutiles (`TableBody`, `PositionRow`, `PositionTable`, `PositionTableHeader`, `CardHeader`, `CardTitle`, `coverageBadges`, `formatContract` s'ils ne servent plus) ;
- ajouter, avant les `return` anticipés (règle des hooks) :

```tsx
  const specs = useMemo(() => positionColumnSpecs(sectorOf), [sectorOf]);
  const search = usePageSearch(pageSearchKey(accountId, "positions"));
```

- remplacer le calcul `filtered`/`groups` et le rendu des groupes par :

```tsx
  // Groups empty in the snapshot never show. The page search runs on the ticker, which means the
  // same thing in every group; a group it empties goes away. A group emptied by its own column
  // filters stays, so its filters can be cleared.
  const groups = groupedPositions(report.positions)
    .filter((group) => group.positions.length > 0)
    .map((group) => ({ group, searched: applyView(group.positions, specs, EMPTY_VIEW, { text: search.applied, ticker: (position) => position.symbol }) }))
    .filter(({ searched }) => searched.length > 0);
```

```tsx
      <Input
        value={search.input}
        onChange={(event) => search.setInput(event.target.value)}
        placeholder={t("positions.searchPlaceholder")}
        aria-label={t("positions.searchLabel")}
        className="font-mono"
      />

      {groups.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("positions.noResults")}</p>
          </CardContent>
        </Card>
      )}

      {groups.map(({ group, searched }) => (
        <PositionGroupCard
          key={group.id}
          accountId={accountId}
          groupId={group.id}
          title={t(groupTitleKey(group.id))}
          positions={group.positions}
          searched={searched}
          specs={specs}
          sectorOf={sectorOf}
        />
      ))}
```

Les `useMemo`/`usePageSearch` doivent être appelés à chaque rendu, avant `if (report === undefined …)` : les déplacer en tête du composant. `sectorOf` est défini même en chargement (`useAccountRiskReport`).

- [ ] **Step 6: Translations**

`fr.json`, section `positions` : supprimer `filterPlaceholder`, ajouter :

```json
    "searchLabel": "Rechercher un ticker",
    "searchPlaceholder": "Rechercher un ticker : AAPL, AAPL|MSFT…",
```

`en.json`, section `positions` : supprimer `filterPlaceholder`, ajouter :

```json
    "searchLabel": "Search a ticker",
    "searchPlaceholder": "Search a ticker: AAPL, AAPL|MSFT…",
```

Vérifier par `grep -rn "positions.filterPlaceholder" apps/web/src` qu'aucun autre code ne s'en sert (`StrategyPositionsPage` compris) ; s'il sert encore, garder la clé.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter web test src/pages/PositionsPage.test.tsx src/pages/StrategyPositionsPage.test.tsx src/components/CashBalancesCard.test.tsx && pnpm --filter web typecheck`
Expected: PASS ; `StrategyPositionsPage` et la carte Cash inchangés.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/PositionTable.tsx apps/web/src/components/PositionGroupCard.tsx apps/web/src/pages/PositionsPage.tsx apps/web/src/pages/PositionsPage.test.tsx apps/web/src/i18n/fr.json apps/web/src/i18n/en.json docs/plans/2026-09-17-tri-filtres-tableaux.md
git commit -m "Positions : recherche par ticker et tri et filtres par carte

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Documentation, vérification complète et relecture visuelle

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/specs/2026-09-17-tri-filtres-tableaux-design.md` (statut)

- [ ] **Step 1: Update `CLAUDE.md`**

1. Tableau des sous-projets, ajouter la ligne :
   ```markdown
   | 20 | Tri et filtres de colonne de l'Historique et de Positions | fait (AAAA-MM-JJ) |
   ```
   avec la date du jour de fin.
2. Dans la règle **« L'Historique ne pagine pas »**, remplacer « Un changement de filtre ou de compte remonte le tableau (`key`), une ligne arrivée en direct ne le fait pas. » par :
   « Un changement de compte remonte le tableau (`key`) ; un changement de recherche, de critère ou de tri le ramène en haut par `resetKey` sans le remonter, pour ne pas fermer le popover de filtre de l'en-tête ; une ligne arrivée en direct ne fait ni l'un ni l'autre. La barre temporelle n'est rendue que sans tri. »
3. Ajouter une règle, après celle de l'Historique :
   ```markdown
   - **Tri et filtres des tableaux sont un état d'affichage en `localStorage`, jamais en IndexedDB ni
     sur le serveur** : une clé par compte et par tableau (`ib2:tableView:<compte>:history`,
     `…:positions:<groupe>`) et par page pour la recherche par ticker (`ib2:pageSearch:`), effacées
     par `deleteAccount`. Le moteur est pur (`lib/tableCriteria.ts`, `lib/tableView.ts`) ; chaque
     colonne déclare son type et sa valeur à côté de ses largeurs (`historyColumnSpecs`,
     `positionColumnSpecs`). Un `null` trie en dernier dans les deux sens et n'est retenu que par
     `—`. Les soldes de l'Historique se calculent sur tout le ledger avant tout filtre ou tri. Une
     carte de Positions a sa propre vue : Type, Décision et Couverture n'y ont pas le même sens
     d'un groupe à l'autre ; seule la recherche par ticker est commune. La Couverture se filtre sur
     `coverageValues`, jamais sur le texte des badges. Hors Historique et Positions, aucun tableau
     n'est triable.
   ```

- [ ] **Step 2: Spec status**

Dans le spec, remplacer `Statut : conçu (2026-09-17).` par `Statut : implémenté (AAAA-MM-JJ).`, date du jour.

- [ ] **Step 3: Full check**

Run: `pnpm check`
Expected: PASS (lint, typage, tests de tous les paquets, fraîcheur du schéma API). Corriger toute erreur en revenant à la tâche fautive, jamais en désactivant une règle.

- [ ] **Step 4: Visual check**

Avec le skill `run-frontend` (depuis la racine du worktree), graine `--seed`, en français :
- l'Historique au repos ; puis trié par Prix total, avec un filtre `>0` sur Prix total et la liste Type à deux valeurs : pastilles visibles, barre temporelle absente ; puis le popover de filtre ouvert sur Date/Heure avec une saisie invalide (`2025-13`) ;
- Positions avec la recherche `AAPL|MSFT`, puis une carte filtrée sur Couverture (popover ouvert) ;
- les mêmes vues en thème sombre.

Regarder chaque capture : en-têtes lisibles sans chevauchement de l'icône et du libellé, popover non coupé, pastilles alignées, colonnes de Positions toujours alignées entre les cartes. Corriger et recapturer au besoin.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/specs/2026-09-17-tri-filtres-tableaux-design.md docs/plans/2026-09-17-tri-filtres-tableaux.md
git commit -m "Sous-projet 20 : documentation

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Dev instance for review**

`pnpm dev:start` dans le worktree, donner les deux URL (Vite et Django) à Seb pour relecture de la branche. `pnpm dev:stop` avant tout merge.
