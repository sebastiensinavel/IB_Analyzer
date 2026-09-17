# Sous-projet 12 — L'Historique en défilement continu : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la pagination de la page Historique par un tableau virtualisé qui défile, bordé d'une barre temporelle (années, mois) pilotable au pointeur et au clavier, et ajouter des puces de période à côté des champs de date.

**Architecture:** Trois couches. (1) *Fonctions pures* : `lib/historyTimeline.ts` découpe les lignes affichées en mois et calcule tous les sauts de la barre (clavier, pointeur, libellés d'année) en index de ligne ; `lib/periodPresets.ts` rend les puces et reconnaît la puce active. (2) *Composants* : `TimelineScrubber` affiche la barre et traduit clavier et pointeur en `onSeek(rowIndex)` ; `HistoryTable` pose un `<table>` à colonnes fixes dans un conteneur qui défile, virtualisé par `@tanstack/react-virtual` à hauteur de ligne constante, et écrit `scrollTop = index × HISTORY_ROW_HEIGHT` quand la barre le demande. (3) *Page* : `HistoryPage` garde filtres et soldes, perd la pagination, remonte `HistoryTable` à chaque changement de filtre (`key`) et ajoute la rangée de puces.

**Tech Stack:** TypeScript 6, Vitest 4, React 19, react-router 8, Dexie 4 (`fake-indexeddb` en test), react-i18next, shadcn base-ui, Tailwind 4, `@tanstack/react-virtual` 3.14. Node 22, pnpm.

**Spec:** `docs/specs/2026-09-11-historique-defilement-design.md` (lire aussi `CLAUDE.md`).

## Global Constraints

- **Aucun changement dans `packages/`** (ni `ledger`, ni `coverage`, ni `ib-parsers`, ni `ui`) ni dans `apps/api`. `anchoredBalances`, `matchesFilter` et l'ordre des lignes ne changent pas.
- **Le serveur ne voit jamais** transactions, positions ni cash ; rien ne quitte le navigateur. Une tâche qui semble réclamer un endpoint, un modèle ou une table est un signal d'arrêt.
- **Les soldes cumulés restent calculés sur tout le ledger**, jamais sur les lignes filtrées.
- **`HISTORY_ROW_HEIGHT = 36`, une seule définition** (`apps/web/src/lib/historyColumns.ts`), égale au `h-9` de chaque cellule du corps, sans padding vertical ; **aucune cellule ne passe à la ligne**. Le virtualiseur ne mesure jamais une ligne.
- **Mois et jours coupés en UTC par `when.slice`**, comme `dayOf` : `when.slice(0, 7)` pour un mois. Aucune conversion de fuseau.
- **Les années des puces viennent du ledger entier du compte**, jamais des lignes filtrées ni d'une liste codée en dur ; `today` est calculé par la page, jamais par `periodPresets.ts`.
- **Jamais `virtualizer.scrollToOffset` ni `scrollToIndex`** : ils appellent `Element.scrollTo`, que jsdom n'a pas (appel silencieusement ignoré). La position s'écrit dans `scrollTop`.
- **`@tanstack/react-virtual` `^3.14.11`**, dépendance de production d'`apps/web`.
- **Une valeur absente reste `null`**, jamais `0`, et s'affiche « — ».
- **Toute phrase vit dans `apps/web/src/i18n/{fr,en}.json`, mêmes clés dans les deux.**
- **shadcn ici est base-ui** : `render={<X/>}`, jamais `asChild`.
- **Un test doit échouer si le comportement change.** `apps/web` teste sur `fake-indexeddb` avec une base semée, **jamais en moquant les hooks**. Seule la mise en page, que jsdom ne calcule pas, est simulée (`offsetHeight`, `getBoundingClientRect`).
- Code et commentaires en anglais ; documentation, i18n et messages de commit en français.
- Chaque commit se termine par les deux lignes :
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SLgmog35qujRS8DL5w79CN
  ```
- Le travail se fait dans un worktree `.claude/worktrees/historique-defilement` (skill `superpowers:using-git-worktrees`), branche `historique-defilement`, mergé sur `main` après revue.
- **Les cases de ce plan se cochent dans le worktree au fur et à mesure, dans le même commit que la tâche.**

---

## Structure des fichiers

```
apps/web/src/
  lib/historyTimeline.ts (+ test)            NOUVEAU  TimelineMonth, buildTimeline, monthIndexAt,
                                                      shiftMonth, stepTarget, rowAtFraction, yearMarks
  lib/periodPresets.ts (+ test)              NOUVEAU  PeriodPreset, yearsOf, periodPresets, activePreset
  lib/historyColumns.ts                      NOUVEAU  HISTORY_COLUMNS, HISTORY_ROW_HEIGHT,
                                                      HISTORY_HEADER_HEIGHT, SCRUB_LABEL_LINGER_MS
  lib/format.ts (+ test)                              formatMonth
  components/history/TimelineScrubber.tsx (+ test)  NOUVEAU  la barre temporelle
  components/history/HistoryTable.tsx        NOUVEAU  tableau virtualisé, TransactionRow (quitte la page)
  pages/HistoryPage.tsx (+ test)                      sans pagination, HistoryTable, puces de période
  i18n/fr.json, i18n/en.json                          history.timeline, history.presets.*,
                                                      history.pagination.* supprimé
apps/web/package.json, pnpm-lock.yaml                 @tanstack/react-virtual

CLAUDE.md, docs/specs/2026-09-11-historique-defilement-design.md, docs/points-reportes.md
```

## Commandes

Depuis la racine du worktree.

```bash
pnpm install                                                   # une fois, à la création du worktree
pnpm --filter web test src/lib/historyTimeline.test.ts         # un fichier de l'app (garde TZ=Asia/Kolkata)
pnpm --filter web test                                         # toute l'app
pnpm --filter web typecheck                                    # tsc -b, silencieux si OK
pnpm lint                                                      # oxlint
pnpm check                                                     # lint + typecheck + build + tous les Vitest
```

Toujours passer par le script `test` de `web` (jamais `exec vitest`) : il fixe `TZ=Asia/Kolkata`. `pnpm check` ne lance ni Python, ni Django, ni Playwright.

---

## Tâche 1 : la frise, fonctions pures

**Files:**
- Create: `apps/web/src/lib/historyTimeline.ts`, `apps/web/src/lib/historyTimeline.test.ts`

**Interfaces:**
- Consomme : rien.
- Produit :
  - `interface TimelineMonth { month: string; start: number; count: number }`
  - `type TimelineStep = "nextMonth" | "previousMonth" | "nextYear" | "previousYear" | "first" | "last"`
  - `interface YearMark { year: string; start: number }`
  - `buildTimeline(whens: readonly string[]): TimelineMonth[]`
  - `monthIndexAt(timeline: readonly TimelineMonth[], rowIndex: number): number` — `-1` sur une frise vide
  - `shiftMonth(month: string, delta: number): string`
  - `stepTarget(timeline: readonly TimelineMonth[], total: number, firstVisible: number, step: TimelineStep): number`
  - `rowAtFraction(total: number, fraction: number): number`
  - `yearMarks(timeline: readonly TimelineMonth[], total: number, height: number, minGap: number): YearMark[]`

- [x] **Step 1 : créer le worktree**

Invoquer la skill `superpowers:using-git-worktrees` pour créer `.claude/worktrees/historique-defilement` sur une branche `historique-defilement` partant de `main`, puis :

```bash
cd .claude/worktrees/historique-defilement
pnpm install
pnpm --filter web test
```

Attendu : tout vert. C'est la ligne de base ; toutes les commandes suivantes partent de ce répertoire. Si un test échoue **déjà** ici, s'arrêter et le signaler avec sa sortie, sans rien « corriger » en passant.

- [x] **Step 2 : écrire les tests**

Créer `apps/web/src/lib/historyTimeline.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { buildTimeline, monthIndexAt, rowAtFraction, shiftMonth, stepTarget, yearMarks } from "@/lib/historyTimeline";

// Newest first, as the history table shows its rows.
const WHENS = [
  "2026-03-31T23:30:00.000Z", // 0 — late on the 31st in UTC: still March, as dayOf cuts it
  "2026-03-02T10:00:00.000Z", // 1
  "2026-02-15T10:00:00.000Z", // 2
  "2025-11-20T10:00:00.000Z", // 3
  "2025-11-03T10:00:00.000Z", // 4
  "2025-02-10T10:00:00.000Z", // 5
  "2024-12-01T10:00:00.000Z", // 6
];
const TIMELINE = buildTimeline(WHENS);
const TOTAL = WHENS.length;

describe("buildTimeline", () => {
  it("cuts the rows into months, newest first, with each month's first row and size", () => {
    expect(TIMELINE).toEqual([
      { month: "2026-03", start: 0, count: 2 },
      { month: "2026-02", start: 2, count: 1 },
      { month: "2025-11", start: 3, count: 2 },
      { month: "2025-02", start: 5, count: 1 },
      { month: "2024-12", start: 6, count: 1 },
    ]);
  });

  it("counts every row exactly once", () => {
    expect(TIMELINE.reduce((sum, month) => sum + month.count, 0)).toBe(TOTAL);
  });

  it("describes the rows as they come, without sorting them", () => {
    expect(buildTimeline(["2026-03-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z", "2026-03-05T00:00:00.000Z"])).toEqual([
      { month: "2026-03", start: 0, count: 1 },
      { month: "2026-02", start: 1, count: 1 },
      { month: "2026-03", start: 2, count: 1 },
    ]);
  });

  it("has no month without rows", () => {
    expect(buildTimeline([])).toEqual([]);
  });
});

describe("monthIndexAt", () => {
  it("finds the month holding a row, at both ends of a month", () => {
    expect(monthIndexAt(TIMELINE, 0)).toBe(0);
    expect(monthIndexAt(TIMELINE, 1)).toBe(0);
    expect(monthIndexAt(TIMELINE, 2)).toBe(1);
    expect(monthIndexAt(TIMELINE, 3)).toBe(2);
    expect(monthIndexAt(TIMELINE, 4)).toBe(2);
    expect(monthIndexAt(TIMELINE, 6)).toBe(4);
  });

  it("answers -1 on an empty timeline", () => {
    expect(monthIndexAt([], 0)).toBe(-1);
  });
});

describe("shiftMonth", () => {
  it("moves a month key across years, both ways", () => {
    expect(shiftMonth("2026-03", -12)).toBe("2025-03");
    expect(shiftMonth("2025-11", 12)).toBe("2026-11");
    expect(shiftMonth("2025-01", -1)).toBe("2024-12");
    expect(shiftMonth("2024-12", 1)).toBe("2025-01");
  });
});

describe("stepTarget", () => {
  it("goes down one month to the start of the next, older month", () => {
    expect(stepTarget(TIMELINE, TOTAL, 1, "nextMonth")).toBe(2);
    expect(stepTarget(TIMELINE, TOTAL, 3, "nextMonth")).toBe(5);
  });

  it("stays put going down from the oldest month", () => {
    expect(stepTarget(TIMELINE, TOTAL, 6, "nextMonth")).toBe(6);
  });

  it("goes up to the start of the current month first, then to the month before", () => {
    expect(stepTarget(TIMELINE, TOTAL, 4, "previousMonth")).toBe(3);
    expect(stepTarget(TIMELINE, TOTAL, 3, "previousMonth")).toBe(2);
    expect(stepTarget(TIMELINE, TOTAL, 0, "previousMonth")).toBe(0);
  });

  it("goes down a year to the most recent month at least twelve months older", () => {
    // From 2026-03: 2025-11 is only four months older; 2025-02 is the first at or before 2025-03.
    expect(stepTarget(TIMELINE, TOTAL, 0, "nextYear")).toBe(5);
  });

  it("goes down a year to the oldest month when none is twelve months older", () => {
    // From 2025-11: neither 2025-02 nor 2024-12 is at or before 2024-11.
    expect(stepTarget(TIMELINE, TOTAL, 3, "nextYear")).toBe(6);
  });

  it("goes up a year to the oldest month at least twelve months more recent", () => {
    // From 2025-02: 2025-11 is too close; 2026-02 is the first at or after 2026-02.
    expect(stepTarget(TIMELINE, TOTAL, 5, "previousYear")).toBe(2);
  });

  it("goes up a year to the first row when no month is twelve months more recent", () => {
    expect(stepTarget(TIMELINE, TOTAL, 3, "previousYear")).toBe(0);
  });

  it("jumps to the first and the last row", () => {
    expect(stepTarget(TIMELINE, TOTAL, 3, "first")).toBe(0);
    expect(stepTarget(TIMELINE, TOTAL, 3, "last")).toBe(6);
  });
});

describe("rowAtFraction", () => {
  it("maps a height on the track to the row at that share of the table", () => {
    expect(rowAtFraction(7, 0)).toBe(0);
    expect(rowAtFraction(7, 0.75)).toBe(5);
  });

  it("stays within the rows", () => {
    expect(rowAtFraction(7, 1)).toBe(6);
    expect(rowAtFraction(7, 1.4)).toBe(6);
    expect(rowAtFraction(7, -0.2)).toBe(0);
  });
});

describe("yearMarks", () => {
  it("writes each year at its first month", () => {
    expect(yearMarks(TIMELINE, TOTAL, 700, 16)).toEqual([
      { year: "2026", start: 0 },
      { year: "2025", start: 3 },
      { year: "2024", start: 6 },
    ]);
  });

  it("leaves out a year that would overlap the label above it", () => {
    // On a 35 px track, 2025 lands 15 px under 2026, 2024 lands 30 px under it.
    expect(yearMarks(TIMELINE, TOTAL, 35, 16)).toEqual([
      { year: "2026", start: 0 },
      { year: "2024", start: 6 },
    ]);
  });
});
```

- [x] **Step 3 : vérifier l'échec**

Run: `pnpm --filter web test src/lib/historyTimeline.test.ts`
Expected: FAIL, le module `@/lib/historyTimeline` est introuvable.

- [x] **Step 4 : écrire le module**

Créer `apps/web/src/lib/historyTimeline.ts` :

```ts
/**
 * The history table's timeline: the months its rows fall in, where each starts, and every jump
 * the timeline bar makes through them. Pure: row indexes in, row indexes out. The bar and the
 * table share a single coordinate, a row index over the row count.
 */

export interface TimelineMonth {
  /** "YYYY-MM", cut from the instant as `dayOf` cuts a day: UTC, no conversion. */
  month: string;
  /** Index, among the rows on screen, of the month's first row. */
  start: number;
  count: number;
}

export type TimelineStep = "nextMonth" | "previousMonth" | "nextYear" | "previousYear" | "first" | "last";

export interface YearMark {
  year: string;
  start: number;
}

/**
 * The months of the rows, in the table's own order (newest first). A month is a run of adjacent
 * rows sharing a key: the timeline describes what the table shows, without assuming a sort.
 */
export function buildTimeline(whens: readonly string[]): TimelineMonth[] {
  const months: TimelineMonth[] = [];
  whens.forEach((when, index) => {
    const month = when.slice(0, 7);
    const last = months.at(-1);
    if (last?.month === month) last.count += 1;
    else months.push({ month, start: index, count: 1 });
  });
  return months;
}

/** Index in `timeline` of the month holding row `rowIndex`; -1 when there is no month at all. */
export function monthIndexAt(timeline: readonly TimelineMonth[], rowIndex: number): number {
  let low = 0;
  let high = timeline.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (timeline[middle].start <= rowIndex) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/** "2025-01" moved by -1 is "2024-12". */
export function shiftMonth(month: string, delta: number): string {
  const [year, index] = month.split("-").map(Number);
  const serial = year * 12 + (index - 1) + delta;
  return `${Math.floor(serial / 12)}-${String((serial % 12) + 1).padStart(2, "0")}`;
}

/**
 * The row a keyboard step lands on, from the first row in view. "next" goes down the table,
 * towards older rows. Keys compare as strings: "YYYY-MM" sorts as it reads.
 */
export function stepTarget(
  timeline: readonly TimelineMonth[],
  total: number,
  firstVisible: number,
  step: TimelineStep,
): number {
  const current = monthIndexAt(timeline, firstVisible);
  if (current < 0) return 0;
  const month = timeline[current];
  switch (step) {
    case "first":
      return 0;
    case "last":
      return Math.max(0, total - 1);
    case "nextMonth":
      return current + 1 < timeline.length ? timeline[current + 1].start : firstVisible;
    case "previousMonth":
      if (firstVisible > month.start) return month.start;
      return current > 0 ? timeline[current - 1].start : 0;
    case "nextYear": {
      const target = shiftMonth(month.month, -12);
      const older = timeline.slice(current + 1).find((candidate) => candidate.month <= target);
      return (older ?? timeline[timeline.length - 1]).start;
    }
    case "previousYear": {
      const target = shiftMonth(month.month, 12);
      const newer = timeline.slice(0, current).findLast((candidate) => candidate.month >= target);
      return newer?.start ?? 0;
    }
  }
}

/** The row at `fraction` of the table's height, kept within the rows. */
export function rowAtFraction(total: number, fraction: number): number {
  return Math.max(0, Math.min(total - 1, Math.floor(fraction * total)));
}

/**
 * The year labels of a `height` px track: each year at its first month, left out when it would
 * sit less than `minGap` px under the label above it.
 */
export function yearMarks(timeline: readonly TimelineMonth[], total: number, height: number, minGap: number): YearMark[] {
  const marks: YearMark[] = [];
  let previousYear: string | null = null;
  let lastTop = Number.NEGATIVE_INFINITY;
  for (const month of timeline) {
    const year = month.month.slice(0, 4);
    if (year === previousYear) continue;
    previousYear = year;
    const top = (month.start / Math.max(1, total)) * height;
    if (top - lastTop < minGap) continue;
    marks.push({ year, start: month.start });
    lastTop = top;
  }
  return marks;
}
```

- [x] **Step 5 : vérifier le succès**

Run: `pnpm --filter web test src/lib/historyTimeline.test.ts && pnpm --filter web typecheck`
Expected: PASS, 19 tests ; typecheck silencieux.

- [x] **Step 6 : commit**

Cocher les cases de la tâche 1 dans ce plan, puis :

```bash
git add apps/web/src/lib/historyTimeline.ts apps/web/src/lib/historyTimeline.test.ts docs/plans/2026-09-11-historique-defilement.md
git commit -F - <<'EOF'
feat(web): frise de l'historique, mois et sauts en index de ligne

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SLgmog35qujRS8DL5w79CN
EOF
```

---

## Tâche 2 : les puces de période, fonctions pures

**Files:**
- Create: `apps/web/src/lib/periodPresets.ts`, `apps/web/src/lib/periodPresets.test.ts`

**Interfaces:**
- Consomme : rien.
- Produit :
  - `type PeriodPresetId = "all" | "last30Days" | "last12Months" | \`year:${number}\``
  - `interface PeriodPreset { id: PeriodPresetId; from: string; to: string }` — `""` pour « Tout »
  - `yearsOf(whens: readonly string[]): number[]` — décroissant, sans doublon
  - `periodPresets(years: readonly number[], today: string): PeriodPreset[]` — ordre : Tout, 30 jours, 12 mois, années
  - `activePreset(presets: readonly PeriodPreset[], from: string, to: string): PeriodPresetId | null`

- [x] **Step 1 : écrire les tests**

Créer `apps/web/src/lib/periodPresets.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { activePreset, periodPresets, yearsOf } from "@/lib/periodPresets";

describe("yearsOf", () => {
  it("lists the years of the instants, newest first, once each", () => {
    expect(yearsOf(["2025-06-02T10:00:00.000Z", "2026-08-28T14:30:00.000Z", "2025-01-02T00:00:00.000Z", "2023-12-31T23:59:59.000Z"])).toEqual([2026, 2025, 2023]);
  });

  it("has no year without instants", () => {
    expect(yearsOf([])).toEqual([]);
  });
});

describe("periodPresets", () => {
  it("offers All, the last 30 days, the last 12 months, then each year, newest first", () => {
    expect(periodPresets([2026, 2025], "2026-09-11")).toEqual([
      { id: "all", from: "", to: "" },
      { id: "last30Days", from: "2026-08-12", to: "2026-09-11" },
      { id: "last12Months", from: "2025-09-11", to: "2026-09-11" },
      { id: "year:2026", from: "2026-01-01", to: "2026-12-31" },
      { id: "year:2025", from: "2025-01-01", to: "2025-12-31" },
    ]);
  });

  it("goes back a year from a February 29 to February 28", () => {
    expect(periodPresets([], "2024-02-29").find((preset) => preset.id === "last12Months")).toEqual({
      id: "last12Months",
      from: "2023-02-28",
      to: "2024-02-29",
    });
  });

  it("counts 30 days back across a month and across a year", () => {
    expect(periodPresets([], "2026-03-10").find((preset) => preset.id === "last30Days")?.from).toBe("2026-02-08");
    expect(periodPresets([], "2026-01-15").find((preset) => preset.id === "last30Days")?.from).toBe("2025-12-16");
  });
});

describe("activePreset", () => {
  const presets = periodPresets([2026, 2025], "2026-09-11");

  it("names the preset whose two dates are exactly in the fields", () => {
    expect(activePreset(presets, "2025-01-01", "2025-12-31")).toBe("year:2025");
    expect(activePreset(presets, "2025-09-11", "2026-09-11")).toBe("last12Months");
  });

  it("names none once a date is edited by hand", () => {
    expect(activePreset(presets, "2025-01-02", "2025-12-31")).toBeNull();
    expect(activePreset(presets, "2025-01-01", "")).toBeNull();
  });

  it("names All when both fields are empty", () => {
    expect(activePreset(presets, "", "")).toBe("all");
  });
});
```

- [x] **Step 2 : vérifier l'échec**

Run: `pnpm --filter web test src/lib/periodPresets.test.ts`
Expected: FAIL, le module `@/lib/periodPresets` est introuvable.

- [x] **Step 3 : écrire le module**

Créer `apps/web/src/lib/periodPresets.ts` :

```ts
/**
 * The period presets of the history page: a click fills both date fields. Days are UTC days,
 * like `dayOf`; `today` comes from the caller, so the module never reads the clock.
 */

export type PeriodPresetId = "all" | "last30Days" | "last12Months" | `year:${number}`;

export interface PeriodPreset {
  id: PeriodPresetId;
  /** "YYYY-MM-DD", or "" for no bound. */
  from: string;
  to: string;
}

/** The years of these instants, newest first. */
export function yearsOf(whens: readonly string[]): number[] {
  return [...new Set(whens.map((when) => Number(when.slice(0, 4))))].sort((a, b) => b - a);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** All, the last 30 days, the last 12 months, then one preset per year. */
export function periodPresets(years: readonly number[], today: string): PeriodPreset[] {
  const [year, month, day] = today.split("-").map(Number);
  // Day 0 of the next month is the last day of this one: a year back from February 29 is the 28th.
  const lastDayAYearBack = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
  const aYearBack = isoDay(new Date(Date.UTC(year - 1, month - 1, Math.min(day, lastDayAYearBack))));
  const thirtyDaysBack = isoDay(new Date(Date.UTC(year, month - 1, day - 30)));
  return [
    { id: "all", from: "", to: "" },
    { id: "last30Days", from: thirtyDaysBack, to: today },
    { id: "last12Months", from: aYearBack, to: today },
    ...years.map((y): PeriodPreset => ({ id: `year:${y}`, from: `${y}-01-01`, to: `${y}-12-31` })),
  ];
}

/** The preset whose two dates are exactly those of the fields, if any. */
export function activePreset(presets: readonly PeriodPreset[], from: string, to: string): PeriodPresetId | null {
  return presets.find((preset) => preset.from === from && preset.to === to)?.id ?? null;
}
```

- [x] **Step 4 : vérifier le succès**

Run: `pnpm --filter web test src/lib/periodPresets.test.ts && pnpm --filter web typecheck`
Expected: PASS, 8 tests ; typecheck silencieux.

- [x] **Step 5 : commit**

Cocher les cases de la tâche 2 dans ce plan, puis :

```bash
git add apps/web/src/lib/periodPresets.ts apps/web/src/lib/periodPresets.test.ts docs/plans/2026-09-11-historique-defilement.md
git commit -F - <<'EOF'
feat(web): puces de période de l'historique, années du ledger, 30 jours, 12 mois

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SLgmog35qujRS8DL5w79CN
EOF
```

---

## Tâche 3 : la barre temporelle

**Files:**
- Create: `apps/web/src/components/history/TimelineScrubber.tsx`, `apps/web/src/components/history/TimelineScrubber.test.tsx`
- Modify: `apps/web/src/lib/format.ts`, `apps/web/src/lib/format.test.ts`, `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`

**Interfaces:**
- Consomme (tâche 1) : `TimelineMonth`, `TimelineStep`, `monthIndexAt`, `stepTarget`, `rowAtFraction`, `yearMarks` de `@/lib/historyTimeline`.
- Produit :
  - `formatMonth(month: string, locale: string): string` dans `@/lib/format`
  - `interface TimelineScrubberProps { timeline: readonly TimelineMonth[]; total: number; firstVisible: number; visibleCount: number; height: number; scrolling: boolean; onSeek(rowIndex: number): void }`
  - `TimelineScrubber(props: TimelineScrubberProps)` — `role="slider"`, nom accessible `t("history.timeline")`
  - clé i18n `history.timeline`

- [x] **Step 1 : écrire les tests**

Dans `apps/web/src/lib/format.test.ts`, remplacer la ligne d'import :

```ts
import { byteLength, formatAmount, formatBytes, formatClockTime, formatDateTime, formatMoney, formatPercent, formatPrice, formatSnapshotDate } from "@/lib/format";
```

par :

```ts
import { byteLength, formatAmount, formatBytes, formatClockTime, formatDateTime, formatMoney, formatMonth, formatPercent, formatPrice, formatSnapshotDate } from "@/lib/format";
```

et ajouter à la fin du fichier :

```ts
describe("formatMonth", () => {
  it("spells a month key in the reader's language", () => {
    expect(formatMonth("2024-03", "fr")).toBe("mars 2024");
    expect(formatMonth("2024-03", "en")).toBe("March 2024");
  });
});
```

Créer `apps/web/src/components/history/TimelineScrubber.test.tsx` :

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TimelineScrubber, type TimelineScrubberProps } from "@/components/history/TimelineScrubber";
import { buildTimeline } from "@/lib/historyTimeline";

// Newest first, as the history table shows its rows. Months: 2026-03 (rows 0-1), 2026-02 (2),
// 2025-11 (3-4), 2025-02 (5), 2024-12 (6).
const WHENS = [
  "2026-03-31T23:30:00.000Z",
  "2026-03-02T10:00:00.000Z",
  "2026-02-15T10:00:00.000Z",
  "2025-11-20T10:00:00.000Z",
  "2025-11-03T10:00:00.000Z",
  "2025-02-10T10:00:00.000Z",
  "2024-12-01T10:00:00.000Z",
];

function renderScrubber(overrides: Partial<TimelineScrubberProps> = {}) {
  const props: TimelineScrubberProps = {
    timeline: buildTimeline(WHENS),
    total: WHENS.length,
    firstVisible: 0,
    visibleCount: 2,
    height: 700,
    scrolling: false,
    onSeek: vi.fn(),
    ...overrides,
  };
  const view = render(<TimelineScrubber {...props} />);
  return { props, view, slider: screen.getByRole("slider", { name: "Frise chronologique" }) };
}

// jsdom lays nothing out: the track is given a 700 px box starting 100 px down the page.
function layTrack(slider: HTMLElement) {
  vi.spyOn(slider, "getBoundingClientRect").mockReturnValue({
    top: 100, bottom: 800, height: 700, left: 0, right: 48, width: 48, x: 0, y: 100, toJSON: () => ({}),
  } as DOMRect);
}

// The shared `@/i18n` singleton defaults to French.
describe("TimelineScrubber", () => {
  it("says which month is at the top of the table", () => {
    const { props, view, slider } = renderScrubber({ firstVisible: 1 });
    expect(slider).toHaveAttribute("aria-valuetext", "mars 2026");
    expect(slider).toHaveAttribute("aria-valuenow", "1");
    expect(slider).toHaveAttribute("aria-valuemin", "0");
    expect(slider).toHaveAttribute("aria-valuemax", "6");
    view.rerender(<TimelineScrubber {...props} firstVisible={5} />);
    expect(slider).toHaveAttribute("aria-valuetext", "février 2025");
  });

  it("writes the years along the track", () => {
    renderScrubber();
    expect(screen.getByText("2026")).toBeInTheDocument();
    expect(screen.getByText("2025")).toBeInTheDocument();
    expect(screen.getByText("2024")).toBeInTheDocument();
  });

  it("steps through months and years from the keyboard", () => {
    const onSeek = vi.fn();
    const { slider } = renderScrubber({ firstVisible: 1, onSeek });
    fireEvent.keyDown(slider, { key: "ArrowDown" });
    expect(onSeek).toHaveBeenLastCalledWith(2);
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(onSeek).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(slider, { key: "PageDown" });
    expect(onSeek).toHaveBeenLastCalledWith(5);
    fireEvent.keyDown(slider, { key: "End" });
    expect(onSeek).toHaveBeenLastCalledWith(6);
    fireEvent.keyDown(slider, { key: "Home" });
    expect(onSeek).toHaveBeenLastCalledWith(0);
    onSeek.mockClear();
    fireEvent.keyDown(slider, { key: "a" });
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("seeks the row under the pointer, and follows it while dragging only", () => {
    const onSeek = vi.fn();
    const { slider } = renderScrubber({ onSeek });
    layTrack(slider);
    // 625 px is 75 % down a track from 100 to 800: row ⌊0.75 × 7⌋ = 5, in February 2025.
    fireEvent.pointerDown(slider, { clientY: 625, pointerId: 1 });
    expect(onSeek).toHaveBeenLastCalledWith(5);
    expect(screen.getByText("février 2025")).toBeInTheDocument();
    fireEvent.pointerMove(slider, { clientY: 100, pointerId: 1 });
    expect(onSeek).toHaveBeenLastCalledWith(0);
    fireEvent.pointerUp(slider, { pointerId: 1 });
    onSeek.mockClear();
    fireEvent.pointerMove(slider, { clientY: 625, pointerId: 1 });
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("shows the floating month while the table scrolls, and hides it at rest", () => {
    const { props, view } = renderScrubber({ firstVisible: 3 });
    expect(screen.queryByText("novembre 2025")).not.toBeInTheDocument();
    view.rerender(<TimelineScrubber {...props} scrolling />);
    expect(screen.getByText("novembre 2025")).toBeInTheDocument();
  });
});
```

- [x] **Step 2 : vérifier l'échec**

Run: `pnpm --filter web test src/lib/format.test.ts src/components/history/TimelineScrubber.test.tsx`
Expected: FAIL — `formatMonth is not a function`, et le module `@/components/history/TimelineScrubber` est introuvable.

- [x] **Step 3 : `formatMonth`**

Dans `apps/web/src/lib/format.ts`, juste après la fonction `formatSnapshotDate`, ajouter :

```ts
/** A timeline month key, "2024-03", in the reader's language: "mars 2024", "March 2024". UTC, like the key. */
export function formatMonth(month: string, locale: string): string {
  const [year, index] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, index - 1, 1)),
  );
}
```

- [x] **Step 4 : la clé i18n**

Dans `apps/web/src/i18n/fr.json`, section `history`, remplacer :

```json
    "kindFilter": "Type",
```

par :

```json
    "timeline": "Frise chronologique",
    "kindFilter": "Type",
```

Dans `apps/web/src/i18n/en.json`, section `history`, remplacer :

```json
    "kindFilter": "Type",
```

par :

```json
    "timeline": "Timeline",
    "kindFilter": "Type",
```

- [x] **Step 5 : le composant**

Créer `apps/web/src/components/history/TimelineScrubber.tsx` :

```tsx
import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { formatMonth } from "@/lib/format";
import {
  monthIndexAt,
  rowAtFraction,
  stepTarget,
  yearMarks,
  type TimelineMonth,
  type TimelineStep,
} from "@/lib/historyTimeline";

/** A year label closer than this to the one above it is left out rather than overlapped. */
const YEAR_LABEL_MIN_GAP_PX = 16;

const KEY_STEPS: Partial<Record<string, TimelineStep>> = {
  ArrowDown: "nextMonth",
  ArrowUp: "previousMonth",
  PageDown: "nextYear",
  PageUp: "previousYear",
  Home: "first",
  End: "last",
};

export interface TimelineScrubberProps {
  timeline: readonly TimelineMonth[];
  /** Number of rows in the table. */
  total: number;
  /** Index of the first row in view. */
  firstVisible: number;
  visibleCount: number;
  /** Height of the track in px: the scroll container's own. */
  height: number;
  /** The table is scrolling, or stopped less than SCRUB_LABEL_LINGER_MS ago. */
  scrolling: boolean;
  /** Brings this row to the top of the table. */
  onSeek(rowIndex: number): void;
}

/** A row index as a CSS share of the track: the bar's single coordinate. */
function share(rowIndex: number, total: number): string {
  return `${(rowIndex / Math.max(1, total)) * 100}%`;
}

/**
 * The timeline along the history table: years written at their first month, a tick per month,
 * the rows in view as a block. Pointer and keyboard both end in `onSeek`; the table scrolls and
 * hands the new first row back through `firstVisible`.
 */
export function TimelineScrubber({ timeline, total, firstVisible, visibleCount, height, scrolling, onSeek }: TimelineScrubberProps) {
  const { t, i18n } = useTranslation();
  const [pointerRow, setPointerRow] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const monthOf = (rowIndex: number) => {
    const month = timeline[monthIndexAt(timeline, rowIndex)];
    return month ? formatMonth(month.month, i18n.language) : "";
  };

  const rowAt = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return rowAtFraction(total, rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = KEY_STEPS[event.key];
    if (!step) return;
    event.preventDefault();
    onSeek(stepTarget(timeline, total, firstVisible, step));
  };

  const labelRow = pointerRow ?? firstVisible;
  const showLabel = dragging || pointerRow !== null || scrolling;

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={t("history.timeline")}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, total - 1)}
      aria-valuenow={firstVisible}
      aria-valuetext={monthOf(firstVisible)}
      className="relative w-12 shrink-0 cursor-ns-resize touch-none rounded-md outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50"
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        // jsdom has no pointer capture; a browser keeps sending moves here once the pointer leaves.
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setDragging(true);
        const row = rowAt(event);
        setPointerRow(row);
        onSeek(row);
      }}
      onPointerMove={(event) => {
        const row = rowAt(event);
        setPointerRow(row);
        if (dragging) onSeek(row);
      }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onPointerLeave={() => {
        if (!dragging) setPointerRow(null);
      }}
    >
      {timeline.map((month) => (
        <span
          key={`${month.month}-${month.start}`}
          aria-hidden="true"
          className="absolute right-1 h-px w-1.5 bg-border"
          style={{ top: share(month.start, total) }}
        />
      ))}
      {yearMarks(timeline, total, height, YEAR_LABEL_MIN_GAP_PX).map((mark) => (
        <span
          key={`${mark.year}-${mark.start}`}
          aria-hidden="true"
          className="absolute left-0.5 font-mono text-[0.65rem] leading-none text-muted-foreground"
          style={{ top: share(mark.start, total) }}
        >
          {mark.year}
        </span>
      ))}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 min-h-1 rounded-sm bg-primary/15 ring-1 ring-primary/40"
        style={{ top: share(firstVisible, total), height: share(Math.min(visibleCount, total - firstVisible), total) }}
      />
      {showLabel && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-full z-20 mr-2 rounded-md bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md ring-1 ring-foreground/10"
          style={{ top: `min(${share(labelRow, total)}, calc(100% - 1.75rem))` }}
        >
          {monthOf(labelRow)}
        </span>
      )}
    </div>
  );
}
```

- [x] **Step 6 : vérifier le succès**

Run: `pnpm --filter web test src/lib/format.test.ts src/components/history/TimelineScrubber.test.tsx src/i18n && pnpm --filter web typecheck && pnpm lint`
Expected: PASS ; typecheck silencieux ; `pnpm lint` sort en 0, sans nouvel avertissement sur ces fichiers.

- [x] **Step 7 : commit**

Cocher les cases de la tâche 3 dans ce plan, puis :

```bash
git add apps/web/src/components/history apps/web/src/lib/format.ts apps/web/src/lib/format.test.ts apps/web/src/i18n docs/plans/2026-09-11-historique-defilement.md
git commit -F - <<'EOF'
feat(web): barre temporelle de l'historique, pointeur et clavier

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SLgmog35qujRS8DL5w79CN
EOF
```

---

## Tâche 4 : le tableau virtualisé remplace la pagination

**Files:**
- Create: `apps/web/src/lib/historyColumns.ts`, `apps/web/src/components/history/HistoryTable.tsx`
- Modify: `apps/web/src/pages/HistoryPage.tsx`, `apps/web/src/pages/HistoryPage.test.tsx`, `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`, `apps/web/package.json`, `pnpm-lock.yaml`

**Interfaces:**
- Consomme : `buildTimeline` (tâche 1) ; `TimelineScrubber` et ses props (tâche 3) ; `LedgerRow` de `@ib/ledger` (inchangé).
- Produit :
  - `HISTORY_COLUMNS` : `readonly { key: string; width: string; numeric: boolean; balance: boolean }[]`, onze colonnes, clés = clés i18n de `history.columns`
  - `HISTORY_ROW_HEIGHT = 36`, `HISTORY_HEADER_HEIGHT = 40`, `SCRUB_LABEL_LINGER_MS = 1000` dans `@/lib/historyColumns`
  - `HistoryTable({ rows: readonly LedgerRow[]; labelledBy: string })` — région défilante `role="region"` nommée par `labelledBy`
  - `HistoryPage` : `<h1 id>` (via `useId`) qui nomme la région ; `HistoryTable` monté avec `key` = les filtres

- [x] **Step 1 : la dépendance**

```bash
pnpm --filter web add @tanstack/react-virtual@^3.14.11
grep -n "@tanstack/react-virtual" apps/web/package.json pnpm-lock.yaml | head -5
```

Expected: `apps/web/package.json` porte `"@tanstack/react-virtual": "^3.14.11"` dans `dependencies`, et l'importeur `apps/web` de `pnpm-lock.yaml` porte le spécificateur `^3.14.11` — **avec** le `^` (un verrou qui aurait figé `3.14.11` nu est à régénérer : voir la dette « Outillage » de `docs/points-reportes.md`).

- [x] **Step 2 : réécrire les tests de la page**

Remplacer tout le contenu de `apps/web/src/pages/HistoryPage.test.tsx` par :

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import type { Transaction } from "@ib/ledger";
import i18n from "@/i18n";
import { db } from "@/db/schema";
import { HISTORY_COLUMNS, HISTORY_ROW_HEIGHT } from "@/lib/historyColumns";
import { HistoryPage } from "@/pages/HistoryPage";
import { SAMPLE_DEPOSIT, SAMPLE_TRANSACTIONS } from "@/mocks/ledger";

function renderHistory(accountId = "alpha") {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[`/accounts/${accountId}/history`]}>
        <Routes>
          <Route path="/accounts/:accountId/history" element={<HistoryPage />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

// Column order: date, type, symbol, quantity, price, total price, fee, cash,
// currency, USD cash, EUR cash.
const CASH_CELL = 7;
const CURRENCY_CELL = 8;
const USD_CASH_CELL = 9;
const EUR_CASH_CELL = 10;

async function rowFor(text: string | RegExp): Promise<HTMLTableRowElement> {
  const cell = await screen.findByText(text);
  return cell.closest("tr") as HTMLTableRowElement;
}

// Spacer rows are aria-hidden, so getAllByRole leaves them out: header row, then data rows.
function rowSymbols(): string[] {
  return screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[2].textContent ?? "");
}

function scroller(): HTMLElement {
  return screen.getByRole("region", { name: "Historique" });
}

/** SYM0 is the oldest row, SYM{count-1} the newest: one a day from 2024-01-01. */
function manyRows(count: number): Transaction[] {
  return Array.from({ length: count }, (_, i) => ({
    ...SAMPLE_TRANSACTIONS[0],
    externalId: `flex:trade:${1000 + i}`,
    symbol: `SYM${i}`,
    when: new Date(Date.UTC(2024, 0, 1 + i, 12)).toISOString(),
  }));
}

beforeEach(async () => {
  await Promise.all([db.transactions.clear(), db.accounts.clear(), db.cashPoints.clear()]);
  // jsdom lays nothing out: every element measures 0, and a virtualizer over a 0 px viewport
  // renders no row. @tanstack/virtual-core reads offsetWidth/offsetHeight (its getRect) and does
  // without ResizeObserver, which jsdom lacks: an 800 px viewport is all it needs.
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1280);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function seed(rows: Transaction[] = SAMPLE_TRANSACTIONS) {
  await db.transactions.bulkAdd(rows);
}

// The shared `@/i18n` singleton defaults to French: page strings are asserted in French.
describe("HistoryPage", () => {
  it("renders every transaction of the account as a row, newest first", async () => {
    await seed();
    renderHistory();
    expect(await screen.findByText("AAPL")).toBeInTheDocument();
    expect(rowSymbols()).toEqual(["AAPL", "MSFT", "TSLA", "ELECTRONIC FUND TRANSFER"]);
  });

  it("spells an option like the journals do, out of Flex's packed OCC symbol", async () => {
    await seed([
      { ...SAMPLE_TRANSACTIONS[0], symbol: "OQZA  261016C00012000", secType: "OPT", right: "C", strike: 12, expiry: "2026-10-16" },
    ]);
    renderHistory();
    expect(await screen.findByText("OQZA Oct16'26 12 Call")).toBeInTheDocument();
  });

  it("never shows another account's rows", async () => {
    await seed([{ ...SAMPLE_TRANSACTIONS[0], accountId: "beta" }]);
    renderHistory("alpha");
    expect(await screen.findByText("Aucune transaction ne correspond.")).toBeInTheDocument();
  });

  it("shows the cash impact and its currency, without a hardcoded dollar sign", async () => {
    await seed();
    renderHistory();
    const cells = within(await rowFor("AAPL")).getAllByRole("cell");
    expect(cells[CASH_CELL]).toHaveTextContent("-18,051.50");
    expect(cells[CASH_CELL]).not.toHaveTextContent("$");
    expect(cells[CURRENCY_CELL]).toHaveTextContent("USD");
  });

  it("computes the running balances over the whole ledger and carries both currencies on every row", async () => {
    await seed();
    renderHistory();
    const deposit = within(await rowFor("ELECTRONIC FUND TRANSFER")).getAllByRole("cell");
    expect(deposit[USD_CASH_CELL]).toHaveTextContent("0.00");
    expect(deposit[EUR_CASH_CELL]).toHaveTextContent("10,000.00");
    const aapl = within(await rowFor("AAPL")).getAllByRole("cell");
    expect(aapl[USD_CASH_CELL]).toHaveTextContent("-18,543.15");
    expect(aapl[EUR_CASH_CELL]).toHaveTextContent("10,000.00");
  });

  it("keeps the balances of the whole ledger when a filter hides earlier rows", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Filtrer par symbole…"), "AAPL");
    await waitFor(() => expect(rowSymbols()).toEqual(["AAPL"]));
    const aapl = within(await rowFor("AAPL")).getAllByRole("cell");
    expect(aapl[USD_CASH_CELL]).toHaveTextContent("-18,543.15");
  });

  it("says on the balance headers what the balances are anchored on", async () => {
    await seed();
    renderHistory();
    const usdHeader = await screen.findByRole("columnheader", { name: "Cash USD" });
    expect(usdHeader).toHaveAttribute("title", expect.stringContaining("calé sur le cash de fin"));
    expect(screen.getByRole("columnheader", { name: "Cash EUR" })).toHaveAttribute("title", expect.stringContaining("calé sur le cash de fin"));
    expect(usdHeader).toHaveAttribute("title", expect.stringContaining("la page Consistance dit s'il retombe sur le cash de début"));
  });

  it("anchors the balances on the end point of the Cash Report", async () => {
    await seed();
    await db.cashPoints.put({ accountId: "alpha", currency: "USD", kind: "end", asOf: "2026-12-31", amount: 1456.85, source: "flex", importedAt: "" });
    renderHistory();
    // Raw USD ends on -18,543.15: the whole column moves by 20,000.
    expect(within(await rowFor("AAPL")).getAllByRole("cell")[USD_CASH_CELL]).toHaveTextContent("1,456.85");
    expect(within(await rowFor("ELECTRONIC FUND TRANSFER")).getAllByRole("cell")[USD_CASH_CELL]).toHaveTextContent("20,000.00");
    expect(within(await rowFor("AAPL")).getAllByRole("cell")[EUR_CASH_CELL]).toHaveTextContent("10,000.00");
  });

  it("leaves the cash check to the Consistency page", async () => {
    await seed();
    await db.cashPoints.put({ accountId: "alpha", currency: "USD", kind: "end", asOf: "2026-12-31", amount: 1456.85, source: "flex", importedAt: "" });
    renderHistory();
    // Still anchored: only the card moved.
    expect(within(await rowFor("AAPL")).getAllByRole("cell")[USD_CASH_CELL]).toHaveTextContent("1,456.85");
    expect(screen.queryByLabelText("Cohérence du cash")).not.toBeInTheDocument();
    expect(screen.queryByText(/solde calé sur le cash de fin/)).not.toBeInTheDocument();
    expect(screen.queryByText(/aucun Cash Report/)).not.toBeInTheDocument();
  });

  it("labels each transaction with its translated kind and falls back to the description without a symbol", async () => {
    await seed();
    renderHistory();
    const cells = within(await rowFor("ELECTRONIC FUND TRANSFER")).getAllByRole("cell");
    expect(cells[1]).toHaveTextContent("Dépôt/Retrait");
    expect(cells[CASH_CELL]).toHaveTextContent("10,000.00");
  });

  it("filters by kind and drops the filter again on All types", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(await screen.findByRole("option", { name: "Dépôt/Retrait" }));
    await waitFor(() => expect(rowSymbols()).toEqual(["ELECTRONIC FUND TRANSFER"]));
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(await screen.findByRole("option", { name: "Tous les types" }));
    await waitFor(() => expect(rowSymbols()).toHaveLength(4));
  });

  it("filters by date range, inclusive", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    fireEvent.change(screen.getByLabelText("Date de début"), { target: { value: "2026-08-20" } });
    fireEvent.change(screen.getByLabelText("Date de fin"), { target: { value: "2026-08-27" } });
    await waitFor(() => expect(rowSymbols()).toEqual(["MSFT", "TSLA"]));
  });

  it("keeps its columns on fixed widths, so scrolling never resizes them", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    const table = screen.getByRole("table");
    expect([...table.querySelectorAll("col")].map((col) => col.style.width)).toEqual(HISTORY_COLUMNS.map((column) => column.width));
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Date/Heure", "Type", "Symbole", "Quantité", "Prix", "Prix total", "Frais", "Cash", "Devise", "Cash USD", "Cash EUR",
    ]);
  });

  it("renders only the rows in view out of a long history, with no pagination", async () => {
    await seed(manyRows(200));
    renderHistory();
    expect(await screen.findByText("SYM199")).toBeInTheDocument();
    expect(rowSymbols().length).toBeGreaterThan(0);
    expect(rowSymbols().length).toBeLessThan(60);
    expect(screen.queryByText("SYM0")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suivant" })).not.toBeInTheDocument();
  });

  it("renders the oldest row once the table is scrolled to its bottom", async () => {
    await seed(manyRows(200));
    renderHistory();
    await screen.findByText("SYM199");
    scroller().scrollTop = 200 * HISTORY_ROW_HEIGHT;
    fireEvent.scroll(scroller());
    expect(await screen.findByText("SYM0")).toBeInTheDocument();
    expect(screen.queryByText("SYM199")).not.toBeInTheDocument();
  });

  it("brings the table back to its top when a filter changes", async () => {
    await seed(manyRows(200));
    renderHistory();
    await screen.findByText("SYM199");
    scroller().scrollTop = 150 * HISTORY_ROW_HEIGHT;
    fireEvent.scroll(scroller());
    await screen.findByText("SYM49");
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Filtrer par symbole…"), "SYM1");
    // SYM1, SYM10-19 and SYM100-199 match: the newest of them, SYM199, is back on top.
    await waitFor(() => expect(scroller().scrollTop).toBe(0));
    expect(await screen.findByText("SYM199")).toBeInTheDocument();
  });

  it("jumps from the timeline to the row it names", async () => {
    await seed(manyRows(200));
    renderHistory();
    await screen.findByText("SYM199");
    const slider = screen.getByRole("slider", { name: "Frise chronologique" });
    // The newest row is the 200th day of 2024: July 18.
    expect(slider).toHaveAttribute("aria-valuetext", "juillet 2024");
    fireEvent.keyDown(slider, { key: "End" });
    expect(scroller().scrollTop).toBe(199 * HISTORY_ROW_HEIGHT);
  });

  it("renders a dash for an unknown amount instead of 0.00", async () => {
    await seed([{ ...SAMPLE_DEPOSIT, amount: 10000 }, { ...SAMPLE_TRANSACTIONS[0], symbol: "SNZA", price: null, amount: null, commission: null }]);
    renderHistory();
    const row = await rowFor("SNZA");
    const cells = within(row).getAllByRole("cell");
    expect(cells[4]).toHaveTextContent("—");
    expect(cells[5]).toHaveTextContent("—");
    expect(cells[CASH_CELL]).toHaveTextContent("—");
    expect(cells[EUR_CASH_CELL]).toHaveTextContent("10,000.00");
  });

  it("shows a no-results message on an empty ledger", async () => {
    renderHistory();
    expect(await screen.findByText("Aucune transaction ne correspond.")).toBeInTheDocument();
  });

  it("follows the ledger: a row written later appears without reloading", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    await db.transactions.add({ ...SAMPLE_TRANSACTIONS[0], externalId: "flex:trade:new", symbol: "NEW", when: "2026-09-01T00:00:00.000Z" });
    expect(await screen.findByText("NEW")).toBeInTheDocument();
  });
});
```

Ce qui a changé par rapport à l'ancien fichier : la simulation de taille dans `beforeEach`/`afterEach`, les aides `scroller` et `manyRows`, et les cinq tests « fixed widths », « only the rows in view », « oldest row », « back to its top », « jumps from the timeline », à la place de l'ancien test de pagination. Tous les autres tests sont repris mot pour mot.

- [x] **Step 3 : vérifier l'échec**

Run: `pnpm --filter web test src/pages/HistoryPage.test.tsx`
Expected: FAIL — le module `@/lib/historyColumns` est introuvable (tout le fichier échoue à l'import).

- [x] **Step 4 : les colonnes et les constantes**

Créer `apps/web/src/lib/historyColumns.ts` :

```ts
/**
 * The eleven columns of the history table, in order, with their widths as a share of the table.
 * The widths are fixed because the table is virtualized: under an automatic layout, each scroll
 * renders other rows and the columns would resize under the reader. Keys are the i18n keys of
 * `history.columns`.
 */
export const HISTORY_COLUMNS = [
  { key: "dateTime", width: "14%", numeric: false, balance: false },
  { key: "type", width: "9%", numeric: false, balance: false },
  { key: "symbol", width: "17%", numeric: false, balance: false },
  { key: "quantity", width: "6%", numeric: true, balance: false },
  { key: "price", width: "7%", numeric: true, balance: false },
  { key: "totalPrice", width: "8%", numeric: true, balance: false },
  { key: "fee", width: "6%", numeric: true, balance: false },
  { key: "cash", width: "8%", numeric: true, balance: false },
  { key: "currency", width: "5%", numeric: false, balance: false },
  { key: "usdCash", width: "10%", numeric: true, balance: true },
  { key: "eurCash", width: "10%", numeric: true, balance: true },
] as const satisfies readonly { key: string; width: string; numeric: boolean; balance: boolean }[];

/**
 * Every body row is exactly this tall: Tailwind's `h-9` on each cell, no vertical padding, never
 * wrapped. The virtualizer never measures: row i starts at i × HISTORY_ROW_HEIGHT, which is what
 * lets the timeline bar place a month exactly. A taller row would put it off.
 */
export const HISTORY_ROW_HEIGHT = 36;

/** The sticky header row: `TableHead`'s own `h-10`. */
export const HISTORY_HEADER_HEIGHT = 40;

/** How long the timeline's floating month lingers once a scroll stops. */
export const SCRUB_LABEL_LINGER_MS = 1000;
```

- [x] **Step 5 : le tableau**

Créer `apps/web/src/components/history/HistoryTable.tsx` :

```tsx
import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { LedgerRow } from "@ib/ledger";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ib/ui/table";
import { TimelineScrubber } from "@/components/history/TimelineScrubber";
import { formatAmount, formatContract, formatDateTime, formatPrice } from "@/lib/format";
import { HISTORY_COLUMNS, HISTORY_HEADER_HEIGHT, HISTORY_ROW_HEIGHT, SCRUB_LABEL_LINGER_MS } from "@/lib/historyColumns";
import { buildTimeline } from "@/lib/historyTimeline";

const OVERSCAN = 10;
// One height for every body cell (HISTORY_ROW_HEIGHT): h-9, no vertical padding, clipped rather
// than wrapped. The border sits on the cell, inside that height, since the table's borders are
// separate.
const CELL = "h-9 truncate border-b py-0";
const NUMERIC_CELL = `${CELL} text-right font-mono tabular-nums`;

export interface HistoryTableProps {
  /** The filtered rows, newest first. */
  rows: readonly LedgerRow[];
  /** Id of the page heading that names the scrolling region. */
  labelledBy: string;
}

/**
 * The history as one scrolling table: sticky header, only the rows in view rendered, and the
 * timeline bar along its right edge. The page remounts it (`key`) when a filter changes: a fresh
 * scroll container starts at its top before anything is painted, while a row arriving live
 * leaves the reader where they are.
 *
 * Not `Table` from @ib/ui: its `overflow-x-auto` wrapper would become the header's scrolling
 * ancestor, and the header would stick to it rather than to the container that scrolls.
 */
export function HistoryTable({ rows, labelledBy }: HistoryTableProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => HISTORY_ROW_HEIGHT,
    getItemKey: (index) => rows[index].transaction.externalId,
    overscan: OVERSCAN,
    // React 19 warns on flushSync from a lifecycle; an ordinary re-render is enough here.
    useFlushSync: false,
    // isScrolling is what shows the timeline's floating month during an ordinary scroll.
    isScrollingResetDelay: SCRUB_LABEL_LINGER_MS,
  });
  const timeline = useMemo(() => buildTimeline(rows.map((row) => row.transaction.when)), [rows]);

  const items = virtualizer.getVirtualItems();
  const paddingTop = items[0]?.start ?? 0;
  const paddingBottom = virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0);
  const viewport = virtualizer.scrollRect?.height ?? 0;
  const firstVisible = Math.max(0, Math.min(rows.length - 1, Math.floor((virtualizer.scrollOffset ?? 0) / HISTORY_ROW_HEIGHT)));
  const visibleCount = Math.max(1, Math.floor((viewport - HISTORY_HEADER_HEIGHT) / HISTORY_ROW_HEIGHT));

  // Written straight into scrollTop, not through virtualizer.scrollToOffset: that one calls
  // Element.scrollTo, which jsdom lacks. The browser fires a scroll event and the virtualizer follows.
  const seek = (rowIndex: number) => {
    if (scrollRef.current) scrollRef.current.scrollTop = rowIndex * HISTORY_ROW_HEIGHT;
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 gap-1">
      <div
        ref={scrollRef}
        role="region"
        aria-labelledby={labelledBy}
        tabIndex={0}
        className="min-w-0 flex-1 overflow-auto [scrollbar-width:thin]"
      >
        <table className="w-full min-w-[64rem] table-fixed caption-bottom border-separate border-spacing-0 text-sm">
          <colgroup>
            {HISTORY_COLUMNS.map((column) => (
              <col key={column.key} style={{ width: column.width }} />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow className="border-b-0 hover:bg-transparent">
              {HISTORY_COLUMNS.map((column) => (
                <TableHead
                  key={column.key}
                  className={`sticky top-0 z-10 truncate border-b bg-card ${column.numeric ? "text-right" : ""}`}
                  // Anchored on the cash points when a file carries a Cash Report; the Consistency
                  // page checks it, the title says so on the column itself.
                  title={column.balance ? t("history.columns.balanceHint") : undefined}
                >
                  {t(`history.columns.${column.key}`)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paddingTop > 0 && <SpacerRow height={paddingTop} />}
            {items.map((item) => (
              <TransactionRow key={item.key} row={rows[item.index]} />
            ))}
            {paddingBottom > 0 && <SpacerRow height={paddingBottom} />}
          </TableBody>
        </table>
      </div>
      <TimelineScrubber
        timeline={timeline}
        total={rows.length}
        firstVisible={firstVisible}
        visibleCount={visibleCount}
        height={viewport}
        scrolling={virtualizer.isScrolling}
        onSeek={seek}
      />
    </div>
  );
}

/** Stands for the rows out of view. Hidden from assistive tech: it is not a row of the history. */
function SpacerRow({ height }: { height: number }) {
  return (
    <tr aria-hidden="true" style={{ height }}>
      <td colSpan={HISTORY_COLUMNS.length} className="p-0" />
    </tr>
  );
}

function TransactionRow({ row }: { row: LedgerRow }) {
  const { t } = useTranslation();
  const { transaction, cash, balances } = row;
  // Cash movements (deposits, dividends, fees) carry no symbol; IB's own
  // description is the only thing that tells two of them apart.
  const label = formatContract(transaction) || transaction.description;
  return (
    <TableRow className="border-b-0">
      <TableCell className={CELL}>{formatDateTime(transaction.when)}</TableCell>
      <TableCell className={`${CELL} text-muted-foreground`}>
        {t(`history.kinds.${transaction.kind}`, { defaultValue: transaction.kind })}
      </TableCell>
      {/* IB descriptions run up to 512 chars: the fixed column clips them, the title keeps them. */}
      <TableCell className={`${CELL} font-medium`} title={label}>
        {label}
      </TableCell>
      <TableCell className={NUMERIC_CELL}>{transaction.quantity ?? "—"}</TableCell>
      <TableCell className={NUMERIC_CELL}>{transaction.price === null ? "—" : formatPrice(transaction.price)}</TableCell>
      <TableCell className={NUMERIC_CELL}>{transaction.amount === null ? "—" : formatAmount(transaction.amount)}</TableCell>
      <TableCell className={NUMERIC_CELL}>
        {transaction.commission === null ? "—" : formatAmount(transaction.commission)}
      </TableCell>
      <TableCell className={NUMERIC_CELL}>{cash === null ? "—" : formatAmount(cash)}</TableCell>
      <TableCell className={`${CELL} text-muted-foreground`}>{transaction.currency}</TableCell>
      {/* Running balances, not this row's impact: they are shown on every
          row, including one that moves the other currency. */}
      <TableCell className={NUMERIC_CELL}>{formatAmount(balances.USD)}</TableCell>
      <TableCell className={NUMERIC_CELL}>{formatAmount(balances.EUR)}</TableCell>
    </TableRow>
  );
}
```

- [x] **Step 6 : la page**

Remplacer tout le contenu de `apps/web/src/pages/HistoryPage.tsx` par :

```tsx
import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { TRANSACTION_KINDS, anchoredBalances, matchesFilter, type TransactionKind } from "@ib/ledger";
import { Card, CardContent } from "@ib/ui/card";
import { Input } from "@ib/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ib/ui/select";
import { HistoryTable } from "@/components/history/HistoryTable";
import { SnapshotStatus } from "@/components/SnapshotStatus";
import { useCashPoints, useLedger } from "@/db/hooks";
import { BALANCE_CURRENCIES } from "@/lib/currencies";

const SEARCH_DEBOUNCE_MS = 300;

export function HistoryPage() {
  const { accountId = "" } = useParams<{ accountId: string }>();
  const { t } = useTranslation();
  const titleId = useId();
  const ledger = useLedger(accountId);
  const points = useCashPoints(accountId);
  const [searchInput, setSearchInput] = useState("");
  const [symbol, setSymbol] = useState("");
  // null means "every kind" — the history is a cash-flow view by default.
  const [kind, setKind] = useState<TransactionKind | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setSymbol(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Balances run over the whole ledger, oldest first, anchored on the cash points; the table
  // shows newest first.
  const anchored = useMemo(
    () => (ledger && points ? anchoredBalances(ledger, BALANCE_CURRENCIES, points) : undefined),
    [ledger, points],
  );
  const rows = useMemo(() => (anchored ? [...anchored.rows].reverse() : undefined), [anchored]);
  const filtered = useMemo(
    () =>
      rows?.filter((row) =>
        matchesFilter(row.transaction, {
          symbol: symbol || undefined,
          kind,
          from: startDate || undefined,
          to: endDate || undefined,
        }),
      ),
    [rows, symbol, kind, startDate, endDate],
  );

  if (!filtered) {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  // A new filter remounts the table, whose fresh scroll container starts at its top; a row
  // arriving live keeps the same key and leaves the reader where they are.
  const filterKey = JSON.stringify([symbol, kind, startDate, endDate]);

  return (
    <div className="flex h-[calc(100svh-3rem)] flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id={titleId} className="font-heading text-lg font-semibold tracking-tight">
          {t("nav.history")}
        </h1>
        <SnapshotStatus accountId={accountId} showAsOf={false} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder={t("history.filterPlaceholder")}
          aria-label={t("history.filterPlaceholder")}
          className="max-w-xs"
        />
        <Select value={kind} onValueChange={(next: TransactionKind | null) => setKind(next)}>
          <SelectTrigger className="w-52" aria-label={t("history.kindFilter")}>
            <SelectValue>
              {(value: TransactionKind | null) => (value ? t(`history.kinds.${value}`) : t("history.allKinds"))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={null}>{t("history.allKinds")}</SelectItem>
            {TRANSACTION_KINDS.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`history.kinds.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
          aria-label={t("history.startDate")}
          className="w-auto"
        />
        <Input
          type="date"
          value={endDate}
          onChange={(event) => setEndDate(event.target.value)}
          aria-label={t("history.endDate")}
          className="w-auto"
        />
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("history.noResults")}</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="min-h-0 flex-1 py-0">
          <CardContent className="flex min-h-0 flex-1 px-0">
            <HistoryTable key={filterKey} rows={filtered} labelledBy={titleId} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [x] **Step 7 : supprimer les clés de pagination**

```bash
grep -rn "history.pagination" apps/web/src
```

Expected: aucune ligne (seule l'ancienne page les lisait).

Dans `apps/web/src/i18n/fr.json`, supprimer :

```json
    "pagination": {
      "previous": "Précédent",
      "next": "Suivant",
      "pageOf": "Page {{page}} / {{total}}"
    },
```

Dans `apps/web/src/i18n/en.json`, supprimer :

```json
    "pagination": {
      "previous": "Previous",
      "next": "Next",
      "pageOf": "Page {{page}} / {{total}}"
    },
```

- [x] **Step 8 : vérifier le succès**

Run: `pnpm --filter web test && pnpm --filter web typecheck && pnpm lint`
Expected: toute l'app verte, dont les 20 tests de `HistoryPage.test.tsx` ; typecheck silencieux ; `pnpm lint` sort en 0. Un avertissement React « flushSync was called from inside a lifecycle method » dans la sortie signale que `useFlushSync: false` a sauté : le rétablir.

- [x] **Step 9 : commit**

Cocher les cases de la tâche 4 dans ce plan, puis :

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/lib/historyColumns.ts apps/web/src/components/history/HistoryTable.tsx apps/web/src/pages/HistoryPage.tsx apps/web/src/pages/HistoryPage.test.tsx apps/web/src/i18n docs/plans/2026-09-11-historique-defilement.md
git commit -F - <<'EOF'
feat(web): l'historique défile dans un tableau virtualisé, sans pagination

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SLgmog35qujRS8DL5w79CN
EOF
```

---

## Tâche 5 : les puces de période dans la page

**Files:**
- Modify: `apps/web/src/pages/HistoryPage.tsx`, `apps/web/src/pages/HistoryPage.test.tsx`, `apps/web/src/i18n/fr.json`, `apps/web/src/i18n/en.json`

**Interfaces:**
- Consomme (tâche 2) : `yearsOf`, `periodPresets`, `activePreset`, `PeriodPreset` de `@/lib/periodPresets`.
- Produit : un `role="group"` nommé `t("history.presets.label")`, un bouton par puce avec `aria-pressed` ; clés i18n `history.presets.{label,all,last30Days,last12Months}`.

- [x] **Step 1 : écrire le test**

Dans `apps/web/src/pages/HistoryPage.test.tsx`, ajouter juste après le test « filters by date range, inclusive » :

```tsx
  it("fills both dates from a year preset, keeps that year's rows, and lets All drop them", async () => {
    await seed([...SAMPLE_TRANSACTIONS, { ...SAMPLE_TRANSACTIONS[0], externalId: "flex:trade:2025", symbol: "OLD", when: "2025-06-02T10:00:00.000Z" }]);
    renderHistory();
    await screen.findByText("AAPL");
    const presets = screen.getByRole("group", { name: "Période" });
    // Years come from the ledger, newest first.
    expect(within(presets).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Tout", "30 derniers jours", "12 derniers mois", "2026", "2025",
    ]);
    expect(within(presets).getByRole("button", { name: "Tout" })).toHaveAttribute("aria-pressed", "true");
    const user = userEvent.setup();
    await user.click(within(presets).getByRole("button", { name: "2025" }));
    expect(screen.getByLabelText("Date de début")).toHaveValue("2025-01-01");
    expect(screen.getByLabelText("Date de fin")).toHaveValue("2025-12-31");
    await waitFor(() => expect(rowSymbols()).toEqual(["OLD"]));
    expect(within(presets).getByRole("button", { name: "2025" })).toHaveAttribute("aria-pressed", "true");
    expect(within(presets).getByRole("button", { name: "Tout" })).toHaveAttribute("aria-pressed", "false");
    // The 2026 preset stays offered although the filter emptied its year.
    expect(within(presets).getByRole("button", { name: "2026" })).toBeInTheDocument();
    await user.click(within(presets).getByRole("button", { name: "Tout" }));
    expect(screen.getByLabelText("Date de début")).toHaveValue("");
    await waitFor(() => expect(rowSymbols()).toHaveLength(5));
  });
```

- [x] **Step 2 : vérifier l'échec**

Run: `pnpm --filter web test src/pages/HistoryPage.test.tsx`
Expected: FAIL sur ce seul test — `Unable to find role="group"` nommé « Période ».

- [x] **Step 3 : les clés i18n**

Dans `apps/web/src/i18n/fr.json`, section `history`, remplacer :

```json
    "timeline": "Frise chronologique",
```

par :

```json
    "presets": {
      "label": "Période",
      "all": "Tout",
      "last30Days": "30 derniers jours",
      "last12Months": "12 derniers mois"
    },
    "timeline": "Frise chronologique",
```

Dans `apps/web/src/i18n/en.json`, section `history`, remplacer :

```json
    "timeline": "Timeline",
```

par :

```json
    "presets": {
      "label": "Period",
      "all": "All",
      "last30Days": "Last 30 days",
      "last12Months": "Last 12 months"
    },
    "timeline": "Timeline",
```

- [x] **Step 4 : la page**

Dans `apps/web/src/pages/HistoryPage.tsx` :

1. Remplacer :

```tsx
import { Card, CardContent } from "@ib/ui/card";
```

par :

```tsx
import { Button } from "@ib/ui/button";
import { Card, CardContent } from "@ib/ui/card";
```

et remplacer :

```tsx
import { BALANCE_CURRENCIES } from "@/lib/currencies";
```

par :

```tsx
import { BALANCE_CURRENCIES } from "@/lib/currencies";
import { activePreset, periodPresets, yearsOf, type PeriodPreset } from "@/lib/periodPresets";
```

2. Remplacer :

```tsx
  if (!filtered) {
```

par :

```tsx
  // Years come from the whole ledger, never from the filtered rows: a preset does not vanish
  // because a filter emptied its year.
  const presets = useMemo(
    () => periodPresets(yearsOf(ledger?.map((transaction) => transaction.when) ?? []), new Date().toISOString().slice(0, 10)),
    [ledger],
  );

  if (!filtered) {
```

3. Remplacer :

```tsx
  const filterKey = JSON.stringify([symbol, kind, startDate, endDate]);
```

par :

```tsx
  const filterKey = JSON.stringify([symbol, kind, startDate, endDate]);
  const activeId = activePreset(presets, startDate, endDate);
  const presetLabel = (preset: PeriodPreset) =>
    preset.id === "all" || preset.id === "last30Days" || preset.id === "last12Months"
      ? t(`history.presets.${preset.id}`)
      : preset.id.slice("year:".length);
```

4. Juste avant la ligne `{filtered.length === 0 ? (`, insérer :

```tsx
      <div role="group" aria-label={t("history.presets.label")} className="flex flex-wrap items-center gap-1.5">
        {presets.map((preset) => (
          <Button
            key={preset.id}
            size="xs"
            variant={preset.id === activeId ? "default" : "outline"}
            aria-pressed={preset.id === activeId}
            onClick={() => {
              setStartDate(preset.from);
              setEndDate(preset.to);
            }}
          >
            {presetLabel(preset)}
          </Button>
        ))}
      </div>

```

- [x] **Step 5 : vérifier le succès**

Run: `pnpm --filter web test && pnpm --filter web typecheck && pnpm lint`
Expected: toute l'app verte, dont les 21 tests de `HistoryPage.test.tsx` ; typecheck silencieux ; `pnpm lint` sort en 0.

- [x] **Step 6 : commit**

Cocher les cases de la tâche 5 dans ce plan, puis :

```bash
git add apps/web/src/pages/HistoryPage.tsx apps/web/src/pages/HistoryPage.test.tsx apps/web/src/i18n docs/plans/2026-09-11-historique-defilement.md
git commit -F - <<'EOF'
feat(web): puces de période dans l'historique

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SLgmog35qujRS8DL5w79CN
EOF
```

---

## Tâche 6 : vérification dans la vraie application, documentation, revue, merge

**Files:**
- Modify: `CLAUDE.md`, `docs/specs/2026-09-11-historique-defilement-design.md:3`, `docs/points-reportes.md` (si la revue reporte quelque chose)
- Create (hors dépôt, jamais committé) : `/tmp/ib-frontend-shots/historique-defilement/check.mjs`

- [x] **Step 1 : `pnpm check`**

Run: `pnpm check`
Expected: lint, typecheck, `check:api-types`, build et tous les Vitest verts. Un échec s'examine avec `superpowers:systematic-debugging`, jamais par un contournement.

- [x] **Step 2 : captures de démonstration**

Le worktree a son propre port Vite (`tools/dev-env/ports.mjs`) : lire la ligne `dev-env: worktree historique-defilement → web :…` du driver. `--keep` laisse le serveur tourner pour l'étape suivante.

```bash
SHOTS=/tmp/ib-frontend-shots/historique-defilement
node .claude/skills/run-frontend/driver.mjs /accounts/alpha/history --seed --out=$SHOTS/seed
node .claude/skills/run-frontend/driver.mjs /accounts/alpha/history --seed --dark --out=$SHOTS/dark
node .claude/skills/run-frontend/driver.mjs /accounts/alpha/history --seed --width=400 --keep --out=$SHOTS/narrow
```

Lire chaque PNG avec l'outil Read et vérifier :
- `seed/…` : titre, filtres, puces « Tout » (pleine), « 30 derniers jours », « 12 derniers mois », « 2026 » ; le tableau dans sa carte jusqu'en bas de l'écran, plus de boutons Précédent/Suivant ; la barre temporelle à droite avec « 2026 » et la fenêtre visible ;
- `dark/…` : barre, puces et en-tête lisibles en thème sombre, l'en-tête a un fond opaque ;
- `narrow/…` : à 400 px, les filtres passent à la ligne, rien ne déborde de la page ; le tableau défile horizontalement dans sa carte.

Si le driver échoue (délai `networkidle`, Chromium manquant), s'arrêter et le signaler avec sa sortie ; ne pas modifier le driver.

- [x] **Step 3 : défilement et barre sur les données réelles de alpha**

Le driver ne capture qu'une page à son arrivée : il ne sait ni défiler ni glisser. Écrire ce script jetable, **hors du dépôt**, dans `/tmp/ib-frontend-shots/historique-defilement/check.mjs` :

```js
// Throwaway check for sub-project 12: imports alpha's real files into a fresh browser, then
// scrolls and drags the history table. Never committed.
import { pathToFileURL } from "node:url";

const REPO = process.env.REPO;
const OUT = process.env.OUT;
const { devPorts } = await import(pathToFileURL(`${REPO}/tools/dev-env/ports.mjs`));
const { chromium } = await import(pathToFileURL(`${REPO}/apps/web/node_modules/playwright/index.mjs`));
const BASE = `http://127.0.0.1:${devPorts(`${REPO}/`).web}`;
const [ibAccount, ...files] = process.argv.slice(2);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.evaluate(() => import("/src/mocks/seed.ts").then((m) => m.seedAccounts()));
await page.evaluate(([ib]) => import("/src/db/schema.ts").then((m) => m.db.accounts.update("alpha", { ibAccountId: ib })), [ibAccount]);
for (const file of files) {
  await page.goto(`${BASE}/accounts/alpha/sources`, { waitUntil: "networkidle" });
  await page.getByLabel(/importer un fichier|import a file/i).setInputFiles(file);
  await page.getByTestId("import-report").waitFor();
}

await page.goto(`${BASE}/accounts/alpha/history`, { waitUntil: "networkidle" });
const region = page.getByRole("region", { name: "Historique" });
const slider = page.getByRole("slider", { name: "Frise chronologique" });
await region.locator("tbody tr:not([aria-hidden])").first().waitFor();

const state = () =>
  region.evaluate((el) => {
    const header = el.querySelector("th").getBoundingClientRect();
    const rows = [...el.querySelectorAll("tbody tr:not([aria-hidden])")];
    const firstVisible = rows.find((row) => row.getBoundingClientRect().bottom > header.bottom + 1);
    return {
      rowHeights: [...new Set(rows.map((row) => row.getBoundingClientRect().height))],
      headerStuck: Math.abs(header.top - el.getBoundingClientRect().top) < 1,
      pageScrolls: document.scrollingElement.scrollHeight > window.innerHeight,
      firstVisibleDate: firstVisible?.querySelector("td")?.textContent,
      rendered: rows.length,
    };
  });
const report = async (name) => {
  await page.waitForTimeout(300);
  console.log(name, JSON.stringify({ ...(await state()), timeline: await slider.getAttribute("aria-valuetext") }));
  await page.screenshot({ path: `${OUT}/${name}.png` });
};

await report("1-top");

const box = await slider.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.75);
await page.mouse.down();
await report("2-drag-75");
await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.4, { steps: 10 });
await report("3-drag-40");
await page.mouse.up();

await slider.focus();
await page.keyboard.press("End");
await report("4-end");
await page.keyboard.press("PageUp");
await report("5-page-up");
await page.keyboard.press("Home");
await report("6-home");

await page.getByRole("group", { name: "Période" }).getByRole("button", { name: "2023" }).click();
await report("7-preset-2023");

console.log(errors.length ? `ERRORS: ${errors.join(" | ")}` : "no page error");
await browser.close();
process.exit(errors.length ? 1 : 0);
```

Puis, depuis la racine du worktree, le serveur de l'étape 2 tournant encore (`--keep`). `private/` est ignoré par git, donc absent du worktree : on lit celui du checkout principal, trois niveaux plus haut (`.claude/worktrees/historique-defilement`).

```bash
PRIVATE=$(realpath ../../../private)
ALPHA=$(grep -o 'accountId="[^"]*"' "$PRIVATE/flex_<compte>_<date>.xml" | head -1 | cut -d'"' -f2)
STATEMENTS=$(ls "$PRIVATE"/U*.htm | grep "$ALPHA" | sort)
REPO=$PWD OUT=/tmp/ib-frontend-shots/historique-defilement node /tmp/ib-frontend-shots/historique-defilement/check.mjs "$ALPHA" $STATEMENTS "$PRIVATE/flex_<compte>_<date>.xml"
```

Les relevés s'importent du plus ancien au plus récent (`sort`), puis le Flex. Ni l'identifiant de compte ni un nom de fichier réel ne s'écrit dans un fichier versionné.

Vérifier dans la sortie et sur chaque PNG (outil Read) :
- `rowHeights` vaut `[36]` à chaque étape : sinon la barre est fausse, et c'est un bug de la tâche 4 ;
- `pageScrolls` vaut `false` : seule la carte défile ;
- `headerStuck` vaut `true` à chaque étape ;
- `timeline` (le mois annoncé par la barre) est le mois de `firstVisibleDate` à chaque étape ;
- `rendered` reste de l'ordre de quelques dizaines ;
- `2-drag-75` montre l'étiquette flottante du mois, `4-end` les plus anciennes lignes de alpha (2022), `6-home` les plus récentes ;
- `7-preset-2023` : les deux dates du 2023-01-01 au 2023-12-31, la puce « 2023 » pleine, le tableau revenu en haut sur la ligne la plus récente de 2023 ;
- les colonnes ne changent pas de largeur d'une capture à l'autre, et aucune date n'est tronquée ;
- `no page error`.

Arrêter ensuite le serveur laissé par `--keep` (le driver a affiché son pid).

- [x] **Step 4 : `CLAUDE.md` et le spec**

1. Tableau des sous-projets, ajouter après la ligne du 11 :

```markdown
| 12 | Historique en défilement continu | livré (2026-09-11), en attente de merge |
```

2. Après la règle « **Les tableaux de la page Positions partagent leurs colonnes** … », ajouter :

```markdown
- **L'Historique ne pagine pas** : un seul tableau virtualisé (`components/history/HistoryTable.tsx`)
  défile dans sa carte, en-tête figé, bordé d'une barre temporelle (`TimelineScrubber`). Ses lignes
  ont une hauteur constante, `HISTORY_ROW_HEIGHT` (`lib/historyColumns.ts`), et aucune cellule ne
  passe à la ligne : la barre place un mois à `index × hauteur` sans rien mesurer, une ligne plus
  haute la fausserait. La barre suit les lignes filtrées, les puces d'année le ledger entier. Un
  changement de filtre remonte le tableau (`key`), une ligne arrivée en direct ne le fait pas. La
  position s'écrit dans `scrollTop`, jamais par `scrollToOffset` (jsdom n'a pas `scrollTo`).
```

3. Dans `docs/specs/2026-09-11-historique-defilement-design.md`, remplacer `Statut : conçu (2026-09-11).` par `Statut : implémenté (2026-09-11).`

Commit :

```bash
git add CLAUDE.md docs
git commit -F - <<'EOF'
docs: sous-projet 12 livré, règle de l'Historique en défilement continu

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SLgmog35qujRS8DL5w79CN
EOF
```

- [x] **Step 5 : revue de branche**

Invoquer `superpowers:requesting-code-review` sur la branche `historique-defilement` contre `main`, avec ce plan et le spec. Corriger chaque constat retenu (TDD, un commit par correction). Un constat jugé non bloquant et reporté délibérément s'écrit dans `docs/points-reportes.md`, sous un titre `## Reporté par le sous-projet 12 (Historique en défilement continu)` inséré avant `## Sans échéance`, avec la raison du report. Relancer `pnpm check` après les corrections.

- [x] **Step 6 : merge**

Cocher les cases de la tâche 6 dans le dernier commit de la branche, puis invoquer `superpowers:finishing-a-development-branch`. Après le merge sur `main`, dans `CLAUDE.md`, la ligne du 12 devient `| 12 | Historique en défilement continu | fait (2026-09-11) |`, puis :

```bash
git add CLAUDE.md
git commit -F - <<'EOF'
docs: sous-projet 12 mergé sur main

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SLgmog35qujRS8DL5w79CN
EOF
```
