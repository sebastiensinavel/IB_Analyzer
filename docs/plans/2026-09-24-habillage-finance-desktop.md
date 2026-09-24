# Habillage « finance-desktop » — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** donner à l'application l'habillage des maquettes `dark-finance-desktop.html` et
`white-finance-desktop.html` (couleurs, polices, cartes, tableaux, sidebar, graphes, barres de
défilement) sans rien changer à la mise en page.

**Architecture :** les couleurs vivent dans les variables CSS de `apps/web/src/index.css`
(`:root` clair, `.dark` sombre), que les composants shadcn/base-ui de `packages/ui` lisent par
les classes Tailwind. Ce qui ne lit pas le CSS — ECharts, lightweight-charts, les étiquettes du
Journal — lit `apps/web/src/lib/chartColors.ts`, tenu en phase avec `index.css` par un test.

**Tech Stack :** Tailwind v4 (`@theme inline`), shadcn sur base-ui, `@fontsource-variable`,
ECharts, lightweight-charts, Vitest.

**Spec :** `docs/specs/2026-09-24-habillage-finance-desktop-design.md` — à lire en entier avant
toute tâche. Les maquettes sont dans `docs/style/` : `dark-finance-desktop.html`,
`white-finance-desktop.html`.

## Global Constraints

- **Aucune mise en page ne change** : ni largeur de colonne (`POSITION_COLUMNS`,
  `WHEEL_SHARE_COLUMNS`, `HISTORY_COLUMNS`), ni `HISTORY_ROW_HEIGHT`, ni marge de cellule, ni
  hauteur de ligne, ni structure de page. Pas de barre de titre, carte de compte, badge de
  ticker, sparkline.
- Pas de taille de base de texte à 13 px : les tailles Tailwind restent.
- Polices par `@fontsource-variable/inter` et `@fontsource-variable/jetbrains-mono`, jamais
  Google Fonts ni aucun tiers à l'exécution.
- Hexadécimal **en minuscules** dans le code (`chartColors.ts`, classes arbitraires) : le test
  de `journalTone` lit `dark:bg-\[(#[0-9a-f]{6})\]`.
- shadcn ici est **base-ui**, pas Radix. Dans `packages/ui`, imports relatifs, jamais `@/`.
- `pnpm --filter web test -- <motif>` ne filtre pas : filtrer par `npx vitest run <motif>`
  depuis `apps/web`.
- `pnpm check` **une seule fois**, à la fin (tâche 4). Pendant les tâches : tests ciblés.
- Un réglage visuel ne s'itère pas sur des captures : les valeurs viennent de la spec.
- Cocher les cases du plan dans le même commit que la tâche.
- Pied de commit : `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Barres de défilement de l'Historique restées natives** : un `scrollbar-width` résiduel
   (classe `[scrollbar-width:thin]` ou règle globale hors `@supports`) désactive
   `::-webkit-scrollbar` dans Chrome ≥ 121. Tâche 1, étape de grep.
2. **Étiquettes du Journal confondues** : `primary` et `success` sont tous deux teal ; une
   étiquette restée sur `bg-primary` ou `bg-success` ferait se confondre actions et puts
   ouverts. Tâche 3, test sur les trois teintes distinctes.
3. **`CHART_COLORS` décalé d'`index.css`** : ECharts dessine en SVG et ne lit pas les
   variables. Tâche 1, test de synchronisation.
4. **Rôle d'une série déplacé** : réordonner `series` changerait la couleur des niveaux du
   graphe de cours et des courbes de capital. Tâche 1, l'ordre bleu/or/teal/violet/corail est
   imposé ; `chartLevels.test.ts` et `journalTone.test.ts` le fixent déjà par index.
5. **En-têtes de tableau tronqués** : l'en-tête passe en majuscules espacées ; s'il ne tient
   plus dans sa colonne, c'est une régression de mise en page. Tâche 4, contrôle sur les
   captures de Positions et de l'Historique — en cas de troncature, s'arrêter et le signaler,
   ne rien élargir.

## Structure des fichiers

| Fichier | Tâche | Rôle |
|---|---|---|
| `apps/web/package.json` | 1 | polices Inter et JetBrains Mono au lieu de Geist |
| `apps/web/src/index.css` | 1 | tokens, polices, chiffres tabulaires, ombres, barres de défilement |
| `apps/web/src/lib/chartColors.ts` | 1, 3 | palette des graphes ; champs du graphe de cours (tâche 3) |
| `apps/web/src/lib/chartColors.test.ts` | 1 | *nouveau* : synchronisation avec `index.css` |
| `apps/web/src/components/history/HistoryTable.tsx` | 1 | retrait de `[scrollbar-width:thin]` |
| `packages/ui/src/components/ui/card.tsx` | 2 | bordure `border`, ombre `shadow-card` |
| `packages/ui/src/components/ui/button.tsx` | 2 | primaire teal, graisse 600, `shadow-primary` |
| `packages/ui/src/components/ui/badge.tsx` | 2 | `secondary`/`outline` au style `.env` |
| `packages/ui/src/components/ui/table.tsx` | 2 | en-têtes en petites capitales, survol avec liseré |
| `packages/ui/src/components/ui/sidebar.tsx` | 2 | libellés de section, élément actif avec liseré |
| `apps/web/src/components/app-sidebar.tsx` | 2 | logo en dégradé |
| `apps/web/src/components/PriceChart.tsx` | 3 | couleurs lues dans `chartColors.ts` |
| `apps/web/src/lib/journalTone.ts` (+ test) | 3 | teintes explicites bleu / or / teal |
| `CLAUDE.md` | 4 | règle des couleurs, « En cours » teal, registre ligne 31 |

---

### Task 1 : Tokens, polices, palette des graphes, barres de défilement

**Files:**
- Modify: `apps/web/package.json`, `apps/web/src/index.css`, `apps/web/src/lib/chartColors.ts`,
  `apps/web/src/components/history/HistoryTable.tsx:95`
- Create: `apps/web/src/lib/chartColors.test.ts`

**Interfaces:**
- Produces : classes Tailwind `text-subtle-foreground`, `border-line-2`, `border-sep`,
  `bg-sep`, `shadow-card`, `shadow-primary` (et variantes) ; variables CSS `--subtle-foreground`,
  `--line-2`, `--sep`, `--card-shadow`, `--primary-shadow`, `--logo-from`, `--logo-to`,
  `--logo-foreground`, `--logo-shadow` ; `CHART_COLORS.{light,dark}.series` dans l'ordre
  bleu, or, teal, violet, corail ; `CHART_FONT` en JetBrains Mono.

- [x] **Step 1 : Écrire le test de synchronisation (échoue)**

`apps/web/src/lib/chartColors.test.ts` :

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHART_COLORS, CHART_FONT } from "./chartColors";

const css = readFileSync(fileURLToPath(new URL("../index.css", import.meta.url)), "utf8");

/** Les déclarations `--x: valeur;` du premier bloc `selector { … }`, valeurs en minuscules. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`bloc ${selector} introuvable`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim().toLowerCase()]),
  );
}

describe.each([
  ["light", ":root"],
  ["dark", ".dark"],
] as const)("CHART_COLORS.%s follows index.css %s", (theme, selector) => {
  const t = tokens(selector);
  const c = CHART_COLORS[theme];

  it("uses the theme tokens ECharts cannot read", () => {
    expect(c.success).toBe(t.success);
    expect(c.destructive).toBe(t.destructive);
    expect(c.foreground).toBe(t.foreground);
    expect(c.surface).toBe(t.card);
  });

  it("gives chart-1…5 the series, in order", () => {
    expect(c.series).toEqual([1, 2, 3, 4, 5].map((i) => t[`chart-${i}`]));
  });
});

describe("CHART_COLORS", () => {
  it("keeps each series role on the mockup hue closest to its former one", () => {
    // 0 actions (bleu), 1 calls vendus (or), 2 puts vendus / ouvert (teal), 3 LEAPS (violet), 4 corail.
    expect(CHART_COLORS.light.series).toEqual(["#3b78e7", "#d08a10", "#0e9f90", "#7b5ce5", "#e0473f"]);
    expect(CHART_COLORS.dark.series).toEqual(["#6c9ef8", "#e6b04a", "#2bc4b4", "#a28bf5", "#f0716a"]);
  });

  it("draws its figures in the app's mono font", () => {
    expect(CHART_FONT).toContain("JetBrains Mono Variable");
  });
});
```

- [x] **Step 2 : Le lancer, vérifier qu'il échoue**

Run : `cd apps/web && npx vitest run src/lib/chartColors.test.ts`
Attendu : FAIL (valeurs oklch actuelles ≠ hex, série et police anciennes).

- [x] **Step 3 : Polices**

```bash
cd apps/web && pnpm remove @fontsource-variable/geist @fontsource-variable/geist-mono \
  && pnpm add @fontsource-variable/inter @fontsource-variable/jetbrains-mono
```

- [x] **Step 4 : Réécrire `apps/web/src/index.css`**

Remplacer le fichier entier par (les `@import` Tailwind/shadcn et `@source` sont conservés) :

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@source "../../../packages/ui/src";
@import "@fontsource-variable/inter";
@import "@fontsource-variable/jetbrains-mono";

@custom-variant dark (&:is(.dark *));

/*
 * Habillage « finance-desktop » (sous-projet 31) : valeurs reprises des maquettes
 * dark-finance-desktop.html et white-finance-desktop.html. Ce qui ne lit pas le CSS (ECharts,
 * lightweight-charts) reprend ces valeurs dans src/lib/chartColors.ts, tenu en phase par
 * chartColors.test.ts.
 */
@theme inline {
    --font-heading: var(--font-sans);
    --font-sans: 'Inter Variable', system-ui, sans-serif;
    --font-mono: 'JetBrains Mono Variable', ui-monospace, SFMono-Regular, monospace;
    --color-sidebar-ring: var(--sidebar-ring);
    --color-sidebar-border: var(--sidebar-border);
    --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
    --color-sidebar-accent: var(--sidebar-accent);
    --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
    --color-sidebar-primary: var(--sidebar-primary);
    --color-sidebar-foreground: var(--sidebar-foreground);
    --color-sidebar: var(--sidebar);
    --color-chart-5: var(--chart-5);
    --color-chart-4: var(--chart-4);
    --color-chart-3: var(--chart-3);
    --color-chart-2: var(--chart-2);
    --color-chart-1: var(--chart-1);
    --color-ring: var(--ring);
    --color-input: var(--input);
    --color-border: var(--border);
    --color-line-2: var(--line-2);
    --color-sep: var(--sep);
    --color-warning-foreground: var(--warning-foreground);
    --color-warning: var(--warning);
    --color-success-foreground: var(--success-foreground);
    --color-success: var(--success);
    --color-destructive: var(--destructive);
    --color-accent-foreground: var(--accent-foreground);
    --color-accent: var(--accent);
    --color-subtle-foreground: var(--subtle-foreground);
    --color-muted-foreground: var(--muted-foreground);
    --color-muted: var(--muted);
    --color-secondary-foreground: var(--secondary-foreground);
    --color-secondary: var(--secondary);
    --color-primary-foreground: var(--primary-foreground);
    --color-primary: var(--primary);
    --color-popover-foreground: var(--popover-foreground);
    --color-popover: var(--popover);
    --color-card-foreground: var(--card-foreground);
    --color-card: var(--card);
    --color-foreground: var(--foreground);
    --color-background: var(--background);
    --shadow-card: var(--card-shadow);
    --shadow-primary: var(--primary-shadow);
    --radius-sm: calc(var(--radius) * 0.6);
    --radius-md: calc(var(--radius) * 0.8);
    --radius-lg: var(--radius);
    --radius-xl: calc(var(--radius) * 1.4);
    --radius-2xl: calc(var(--radius) * 1.8);
    --radius-3xl: calc(var(--radius) * 2.2);
    --radius-4xl: calc(var(--radius) * 2.6);
}

:root {
    color-scheme: light;
    --background: #f3f5f8;
    --foreground: #0d1a22;
    --card: #ffffff;
    --card-foreground: #0d1a22;
    --popover: #ffffff;
    --popover-foreground: #0d1a22;
    --primary: #0e9f90;
    --primary-foreground: #ffffff;
    --secondary: #f8fafb;
    --secondary-foreground: #0d1a22;
    --muted: #f8fafb;
    --muted-foreground: #52616b;
    --subtle-foreground: #8795a0;
    --accent: #edf6f5;
    --accent-foreground: #0d1a22;
    --destructive: #e0473f;
    --success: #0e9f90;
    --success-foreground: #ffffff;
    --warning: #d08a10;
    --warning-foreground: #ffffff;
    --border: #e3e8ec;
    --input: #e3e8ec;
    --line-2: #d5dde3;
    --sep: #e7ecf0;
    --ring: #0e9f90;
    --chart-1: #3b78e7;
    --chart-2: #d08a10;
    --chart-3: #0e9f90;
    --chart-4: #7b5ce5;
    --chart-5: #e0473f;
    --radius: 0.625rem;
    --card-shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 4px 16px -8px rgba(16, 24, 40, 0.06);
    --primary-shadow: 0 1px 2px rgba(11, 124, 113, 0.25), 0 4px 12px -4px rgba(14, 159, 144, 0.5);
    --logo-from: #4cc6bc;
    --logo-to: #0b7c71;
    --logo-foreground: #ffffff;
    --logo-shadow: 0 4px 10px -3px rgba(14, 159, 144, 0.45);
    --scrollbar-thumb: rgba(82, 97, 107, 0.26);
    --scrollbar-thumb-hover: rgba(82, 97, 107, 0.42);
    --scrollbar-grab-from: #4cc6bc;
    --sidebar: #fbfcfd;
    --sidebar-foreground: #52616b;
    --sidebar-primary: #0e9f90;
    --sidebar-primary-foreground: #ffffff;
    --sidebar-accent: #e9f6f4;
    --sidebar-accent-foreground: #0d1a22;
    --sidebar-border: #e3e8ec;
    --sidebar-ring: #0e9f90;
}

.dark {
    color-scheme: dark;
    --background: #080d12;
    --foreground: #e7eef2;
    --card: #0e151c;
    --card-foreground: #e7eef2;
    --popover: #0e151c;
    --popover-foreground: #e7eef2;
    --primary: #2bc4b4;
    --primary-foreground: #04201d;
    --secondary: #121b23;
    --secondary-foreground: #e7eef2;
    --muted: #121b23;
    --muted-foreground: #9aa9b3;
    --subtle-foreground: #63727d;
    --accent: #182731;
    --accent-foreground: #e7eef2;
    --destructive: #f0716a;
    --success: #2bc4b4;
    --success-foreground: #04201d;
    --warning: #e6b04a;
    --warning-foreground: #1b1204;
    --border: #1c2731;
    --input: #1c2731;
    --line-2: #24313c;
    --sep: #1d2934;
    --ring: #2bc4b4;
    --chart-1: #6c9ef8;
    --chart-2: #e6b04a;
    --chart-3: #2bc4b4;
    --chart-4: #a28bf5;
    --chart-5: #f0716a;
    --card-shadow: none;
    --primary-shadow: none;
    --logo-from: #2bc4b4;
    --logo-to: #136e6a;
    --logo-foreground: #04201d;
    --logo-shadow: none;
    --scrollbar-thumb: rgba(154, 169, 179, 0.34);
    --scrollbar-thumb-hover: rgba(154, 169, 179, 0.5);
    --scrollbar-grab-from: #7fd3cf;
    --sidebar: #0a1016;
    --sidebar-foreground: #9aa9b3;
    --sidebar-primary: #2bc4b4;
    --sidebar-primary-foreground: #04201d;
    --sidebar-accent: #13212a;
    --sidebar-accent-foreground: #e7eef2;
    --sidebar-border: #1c2731;
    --sidebar-ring: #2bc4b4;
}

@layer base {
  * {
    @apply border-border outline-ring/50;
    }
  body {
    @apply bg-background text-foreground;
    font-feature-settings: "tnum" 1, "cv11" 1;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    }
  html {
    @apply font-sans;
    }

  /*
   * Barres de défilement de la maquette, en CSS seul (spec §6). Elles n'apparaissent que là où
   * le contenu déborde (overflow-auto partout). Aucun `scrollbar-width` hors du @supports :
   * depuis Chrome 121 il désactive les pseudo-éléments ci-dessous.
   */
  ::-webkit-scrollbar {
    width: 10px;
    height: 10px;
    }
  ::-webkit-scrollbar-track,
  ::-webkit-scrollbar-corner {
    background: transparent;
    }
  ::-webkit-scrollbar-thumb {
    background-color: var(--scrollbar-thumb);
    background-clip: padding-box;
    border: 2px solid transparent;
    border-radius: 99px;
    }
  ::-webkit-scrollbar-thumb:hover {
    background-color: var(--scrollbar-thumb-hover);
    }
  ::-webkit-scrollbar-thumb:vertical:active {
    background-image: linear-gradient(180deg, var(--scrollbar-grab-from), var(--primary));
    }
  ::-webkit-scrollbar-thumb:horizontal:active {
    background-image: linear-gradient(90deg, var(--scrollbar-grab-from), var(--primary));
    }
  @supports not selector(::-webkit-scrollbar) {
    * {
      scrollbar-width: thin;
      scrollbar-color: var(--scrollbar-thumb) transparent;
      }
    }
}
```

- [x] **Step 5 : Réécrire `apps/web/src/lib/chartColors.ts`**

Garder l'interface et `chartColors()` ; remplacer le commentaire d'en-tête, `CHART_COLORS` et
`CHART_FONT` :

```ts
// Reprend les tokens de src/index.css (sous-projet 31, maquettes finance-desktop) : ECharts et
// lightweight-charts dessinent eux-mêmes et ne lisent pas les variables CSS.
// chartColors.test.ts échoue si l'un des deux fichiers change seul.
```

```ts
export const CHART_COLORS: { light: ChartColors; dark: ChartColors } = {
  light: {
    success: "#0e9f90",
    destructive: "#e0473f",
    track: "#e9eef1",
    foreground: "#0d1a22",
    surface: "#ffffff",
    series: ["#3b78e7", "#d08a10", "#0e9f90", "#7b5ce5", "#e0473f"],
    other: "#7a8c93",
  },
  dark: {
    success: "#2bc4b4",
    destructive: "#f0716a",
    track: "#16212a",
    foreground: "#e7eef2",
    surface: "#0e151c",
    series: ["#6c9ef8", "#e6b04a", "#2bc4b4", "#a28bf5", "#f0716a"],
    other: "#7a8c93",
  },
};

export const CHART_FONT = "'JetBrains Mono Variable', ui-monospace, SFMono-Regular, monospace";
```

Mettre à jour le commentaire de `series` dans l'interface : « Categorical hues in fixed order,
never cycled; each index carries a role (0 shares, 1 short calls, 2 short puts / open,
3 LEAPS, 4 fifth pie slice) — spec of sub-project 31, §5.1. »

- [x] **Step 6 : Valider la palette (skill `dataviz`)**

Charger le skill `dataviz` et passer son validateur sur `series` contre `surface`, dans chaque
thème. Si une teinte échoue, l'ajuster **en luminance seulement** dans les deux fichiers
(`chartColors.ts` et `chart-N` d'`index.css`) et dans l'attente du test du Step 1, puis noter
l'écart dans le message de commit. Ne jamais changer de famille de teinte ni d'ordre.

- [x] **Step 7 : Retirer le `scrollbar-width` de l'Historique**

`apps/web/src/components/history/HistoryTable.tsx:95` : la classe devient
`"min-w-0 flex-1 overflow-auto"`. Puis vérifier qu'aucun autre ne reste :

Run : `grep -rn "scrollbar-width\|scrollbar-color" apps/web/src packages/ui/src`
Attendu : seules les deux lignes du `@supports` d'`index.css`.

- [x] **Step 8 : Tests**

Run : `cd apps/web && npx vitest run src/lib/chartColors.test.ts src/lib/chartLevels.test.ts src/lib/capitalCharts.test.ts src/components/PriceChart.test.tsx`
Attendu : PASS. `journalTone.test.ts` peut échouer sur ses teintes sombres : c'est la tâche 3,
le noter sans le corriger ici.

- [x] **Step 9 : Commit** (cases cochées dans ce plan)

```bash
git add -A apps/web docs/plans/2026-09-24-habillage-finance-desktop.md pnpm-lock.yaml
git commit -m "Habillage finance-desktop : tokens, Inter et JetBrains Mono, palette des graphes, barres de défilement"
```

---

### Task 2 : Composants partagés — carte, bouton, badge, tableau, sidebar, logo

**Files:**
- Modify: `packages/ui/src/components/ui/{card,button,badge,table,sidebar}.tsx`,
  `apps/web/src/components/app-sidebar.tsx:53`

**Interfaces:**
- Consumes (tâche 1) : `shadow-card`, `shadow-primary`, `text-subtle-foreground`, `border-sep`,
  `--line-2`, `--logo-from`, `--logo-to`, `--logo-foreground`, `--logo-shadow`, `--primary`,
  `--sidebar-primary`.
- Produces : rien de nouveau ; les classes des composants changent.

Aucun test unitaire ne fixe des classes de style (un tel test casserait à chaque retouche sans
rien protéger) ; le filet est la suite existante — elle ne doit pas bouger — plus les captures
de la tâche 4. **Ne changer aucune classe de taille, marge, hauteur ou largeur.**

- [x] **Step 1 : Carte** — `card.tsx`, dans la classe de `Card`, remplacer
  `ring-1 ring-foreground/10` par `ring-1 ring-border shadow-card`. (`ring` et non `border` :
  il ne prend pas de place, la mise en page ne bouge pas d'un pixel.) `rounded-xl` reste : il
  vaut 14 px avec `--radius: 0.625rem`.

- [x] **Step 2 : Bouton** — `button.tsx`, variante `default` :

```ts
default: "bg-primary font-semibold text-primary-foreground shadow-primary hover:bg-primary/85",
```

- [x] **Step 3 : Badge** — `badge.tsx`, variantes `secondary` et `outline` (le style `.env`) :

```ts
secondary:
  "rounded-md bg-muted text-[10.5px] font-semibold tracking-[.04em] text-muted-foreground shadow-[inset_0_0_0_1px_var(--line-2)] [a]:hover:bg-accent",
outline:
  "rounded-md border-transparent text-[10.5px] font-semibold tracking-[.04em] text-muted-foreground shadow-[inset_0_0_0_1px_var(--line-2)] [a]:hover:bg-muted [a]:hover:text-foreground",
```

`Badge` passe par `cn()` (twMerge) : `rounded-md` et `text-[10.5px]` l'emportent sur
`rounded-4xl` et `text-xs` de la base. Les autres variantes ne changent pas.

- [x] **Step 4 : Tableau** — `table.tsx` :

`TableRow` :
```ts
"border-b border-sep transition-colors hover:bg-accent has-aria-expanded:bg-accent data-[state=selected]:bg-muted [&:hover>td:first-child]:shadow-[inset_2px_0_0_var(--primary)]",
```

`TableHead` : remplacer `font-medium ... text-foreground` par la typographie d'en-tête, sans
toucher `h-10 px-2` :
```ts
"h-10 px-2 text-left align-middle text-[10.5px] font-medium tracking-[.08em] whitespace-nowrap text-subtle-foreground uppercase [&:has([role=checkbox])]:pr-0",
```

`TableHeader` : `"[&_tr]:border-b [&_tr]:border-border [&_tr]:hover:bg-transparent"` (un
en-tête ne s'allume pas au survol, et ne prend pas le liseré).

Ensuite, chercher les en-têtes qui imposent leur propre couleur ou taille et annuleraient le
style : `grep -rn "TableHead\b" apps/web/src --include=*.tsx | grep -v test` puis, dans ces
fichiers et dans `components/table/ColumnHeader.tsx`, retirer seulement un `text-foreground`,
`text-sm` ou `normal-case` posé sur un en-tête (pas une largeur, pas une marge). Ne rien
retirer d'autre ; si un en-tête a une raison écrite de garder sa casse, la laisser et le noter
dans le rapport.

- [x] **Step 5 : Sidebar** — `sidebar.tsx` :

`SidebarGroupLabel` : dans sa classe, remplacer `text-xs font-medium text-sidebar-foreground/70`
par `text-[10px] font-medium tracking-[.14em] text-subtle-foreground uppercase`.

`sidebarMenuButtonVariants` (base) : remplacer `data-active:font-medium` par
`font-medium data-active:shadow-[inset_2px_0_0_var(--sidebar-primary)]` ; `rounded-md` reste
(8 px). Rien d'autre.

- [x] **Step 6 : Logo** — `app-sidebar.tsx:53`, la classe du carré « IB » :

```tsx
<div className="flex size-7 items-center justify-center rounded-md bg-linear-135 from-(--logo-from) to-(--logo-to) font-heading text-sm font-bold text-(--logo-foreground) shadow-(--logo-shadow)">
```

- [x] **Step 7 : Suite de tests de `apps/web` et `packages/ui`**

Run : `cd apps/web && npx vitest run` puis `pnpm --filter @ib/ui test` s'il existe (sinon
l'ignorer : `ls packages/ui/package.json` et lire ses scripts).
Attendu : tout PASS, sauf éventuellement `journalTone.test.ts` (tâche 3). Un test qui cherchait
une classe retirée (`text-foreground` d'un en-tête…) : adapter l'attente à la nouvelle classe,
jamais supprimer l'assertion.

- [x] **Step 8 : Commit** (cases cochées)

```bash
git add -A packages/ui apps/web docs/plans/2026-09-24-habillage-finance-desktop.md
git commit -m "Habillage finance-desktop : cartes, boutons, badges, tableaux et sidebar"
```

---

### Task 3 : Graphe de cours et étiquettes du Journal

**Files:**
- Modify: `apps/web/src/lib/chartColors.ts`, `apps/web/src/components/PriceChart.tsx:31-32,76-95`,
  `apps/web/src/lib/journalTone.ts:19-25`, `apps/web/src/lib/journalTone.test.ts:47-62`,
  `apps/web/src/lib/chartColors.test.ts`

**Interfaces:**
- Consumes : `CHART_COLORS` de la tâche 1.
- Produces : `ChartColors` gagne `grid: string`, `axisText: string`, `axisBorder: string`.

- [x] **Step 1 : Tests (échouent)**

Dans `chartColors.test.ts`, dans le `describe.each`, ajouter :

```ts
  it("draws the price chart's axes in the subtle text and border tokens", () => {
    expect(c.axisText).toBe(t["subtle-foreground"]);
    expect(c.axisBorder).toBe(t.border);
  });
```

et dans le `describe("CHART_COLORS")` :

```ts
  it("dots the price chart grid like the mockup", () => {
    expect(CHART_COLORS.light.grid).toBe("#e7ecf0");
    expect(CHART_COLORS.dark.grid).toBe("#1a252e");
  });
```

Dans `journalTone.test.ts`, remplacer le bloc `describe("LABEL_TONE_CLASS", …)` par :

```ts
describe("LABEL_TONE_CLASS", () => {
  // primary et success sont tous deux teal (sous-projet 31) : une étiquette ne peut plus
  // s'appuyer sur eux, elle prend la teinte de la série de son rôle, dans les deux thèmes.
  const hue = (className: string, dark: boolean) =>
    className.match(dark ? /dark:bg-\[(#[0-9a-f]{6})\]/ : /(?:^|\s)bg-\[(#[0-9a-f]{6})\]/)?.[1];

  it.each([
    [false, CHART_COLORS.light],
    [true, CHART_COLORS.dark],
  ] as const)("takes the hue of its capital line (dark: %s)", (dark, colors) => {
    expect(hue(LABEL_TONE_CLASS.shortCall, dark)).toBe(seriesColor("assigned", colors));
    expect(hue(LABEL_TONE_CLASS.shares, dark)).toBe(seriesColor("cumulativePnl", colors));
    expect(hue(LABEL_TONE_CLASS.open, dark)).toBe(seriesColor("allocated", colors));
  });

  it("keeps the three tones apart", () => {
    for (const dark of [false, true]) {
      const hues = Object.values(LABEL_TONE_CLASS).map((c) => hue(c, dark));
      expect(new Set(hues).size).toBe(3);
    }
  });

  it("never leans on the primary or success tokens, both teal now", () => {
    for (const c of Object.values(LABEL_TONE_CLASS)) expect(c).not.toMatch(/bg-(primary|success)/);
  });

  it("stays light enough under the dark theme's text: /45, not /70", () => {
    for (const c of Object.values(LABEL_TONE_CLASS)) expect(c).toMatch(/dark:bg-\[#[0-9a-f]{6}\]\/45/);
  });
});
```

Run : `cd apps/web && npx vitest run src/lib/chartColors.test.ts src/lib/journalTone.test.ts`
Attendu : FAIL.

- [x] **Step 2 : `chartColors.ts`** — ajouter à `ChartColors` :

```ts
  /** Grille en pointillés du graphe de cours (`.dashed` de la maquette). */
  grid: string;
  /** Texte des axes du graphe de cours : `--subtle-foreground`. */
  axisText: string;
  /** Bordure des échelles du graphe de cours : `--border`. */
  axisBorder: string;
```

et aux valeurs : clair `grid: "#e7ecf0", axisText: "#8795a0", axisBorder: "#e3e8ec"` ;
sombre `grid: "#1a252e", axisText: "#63727d", axisBorder: "#1c2731"`.

- [x] **Step 3 : `PriceChart.tsx`** — supprimer les constantes `UP` et `DOWN` ; dans l'effet,
`const colors = chartColors(isDark);` (import depuis `@/lib/chartColors`), puis :

```ts
      layout: { background: { color: "transparent" }, textColor: colors.axisText, fontFamily: CHART_FONT, attributionLogo: true },
      grid: {
        vertLines: { color: colors.grid, style: LineStyle.SparseDotted },
        horzLines: { color: colors.grid, style: LineStyle.SparseDotted },
      },
      rightPriceScale: { borderColor: colors.axisBorder },
      timeScale: { borderColor: colors.axisBorder },
```

et la série : `upColor: colors.success, downColor: colors.destructive, wickUpColor:
colors.success, wickDownColor: colors.destructive`. `LineStyle` s'importe de
`lightweight-charts`. Vérifier qu'aucun littéral de couleur ne reste :
`grep -n "#[0-9a-fA-F]\{6\}" apps/web/src/components/PriceChart.tsx` → rien.

- [x] **Step 4 : `journalTone.ts`** — remplacer le commentaire et `LABEL_TONE_CLASS` :

```ts
// primary et success sont tous deux teal (sous-projet 31) : chaque ton prend la teinte de la
// courbe de capital de son rôle (CHART_COLORS.*.series) — actions bleu « P/L cumulé », call
// vendu or « Assigné », ouvert teal « Alloué ». En sombre à /45 : à /70 le texte clair n'y
// garde qu'un contraste de 3,3.
export const LABEL_TONE_CLASS: Record<LabelTone, string> = {
  shares: "bg-[#3b78e7]/15 dark:bg-[#6c9ef8]/45",
  shortCall: "bg-[#d08a10]/25 dark:bg-[#e6b04a]/45",
  open: "bg-[#0e9f90]/15 dark:bg-[#2bc4b4]/45",
};
```

- [x] **Step 5 : Tests**

Run : `cd apps/web && npx vitest run src/lib src/components/PriceChart.test.tsx src/pages`
Attendu : PASS (la page Secteur et Score lit `LABEL_TONE_CLASS.open`, elle suit).

- [x] **Step 6 : Commit** (cases cochées)

```bash
git add -A apps/web docs/plans/2026-09-24-habillage-finance-desktop.md
git commit -m "Habillage finance-desktop : graphe de cours et étiquettes du Journal aux teintes des maquettes"
```

---

### Task 4 : Documentation, vérification, instance de relecture

**Files:**
- Modify: `CLAUDE.md`, `docs/specs/2026-09-24-habillage-finance-desktop-design.md` (statut)

- [x] **Step 1 : `CLAUDE.md`**

1. Dans la règle de la table sectorielle, « sur le vert des puts en cours du journal Wheel »
   devient « sur le teal des puts en cours du journal Wheel ».
2. Ajouter, avant la puce « Il n'y a pas de page Aujourd'hui », la règle :

```markdown
- **Les couleurs vivent dans les tokens de `apps/web/src/index.css`**, reprises des maquettes
  finance-desktop (sous-projet 31) : `primary` et `success` sont tous deux teal, si bien
  qu'aucune étiquette ne s'appuie sur leur différence (`journalTone.ts` prend les teintes des
  séries). Ce qui ne lit pas le CSS — ECharts, lightweight-charts — lit `lib/chartColors.ts`
  seul, que `chartColors.test.ts` tient en phase avec `index.css`. L'index d'une série porte
  un rôle (0 actions, 1 calls vendus, 2 puts vendus et ouvert, 3 LEAPS) : ne jamais le
  réordonner. Les barres de défilement sont dessinées en CSS seul ; aucun `scrollbar-width`
  hors du `@supports` d'`index.css`, qui désactiverait leur style dans Chrome.
```

3. Registre : ajouter la ligne
   `| 31 | Habillage « finance-desktop » : tokens, polices, tableaux, graphes, barres de défilement | fait (2026-09-24) |`.
4. Spec : `Statut : conçu (2026-09-24).` → `Statut : livré (2026-09-24).`

- [x] **Step 2 : `pnpm check`** (une seule fois)

Run : `pnpm check` depuis la racine du worktree. Attendu : lint, typage, build, tests PASS.
Corriger ce qui échoue, relancer seulement les tests ciblés, puis `pnpm check` une dernière fois.

- [x] **Step 3 : Captures, une passe**

Avec le skill `run-frontend` (depuis la racine du worktree, graine `--seed`), capturer en
thème clair puis sombre : tableau de bord, Positions, Historique, Journal Wheel, Paramètres
(10 captures). Vérifier, sans itérer :
- couleurs, polices, cartes, sidebar (liseré teal de l'élément actif) conformes à la spec ;
- **aucun en-tête de tableau tronqué** sur Positions et l'Historique (Review Focus 5) ; s'il y
  en a, ne rien élargir : le noter dans le rapport avec la capture ;
- les trois étiquettes du Journal Wheel distinctes.

- [x] **Step 4 : Commit** (cases cochées)

```bash
git add -A CLAUDE.md docs
git commit -m "Documente le sous-projet 31"
```

- [x] **Step 5 : Instance de relecture**

`pnpm dev:start` dans le worktree ; donner à Seb les deux URL (`pnpm dev:status`). La laisser
tourner jusqu'à sa décision de merge.
