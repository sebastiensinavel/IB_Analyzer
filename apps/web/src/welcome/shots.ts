/**
 * The shots of /welcome (sub-project 41). Read by the page to show them and by
 * apps/web/scripts/screenshots.mjs to take them from the demo: one list, so a shot cannot be
 * shown without being taken.
 */
export type ShotId = "dashboard" | "positions" | "wheel" | "journal-wheel" | "condors" | "history";

export interface ShotSpec {
  id: ShotId;
  /** Route of the demo account. */
  route: string;
  /** CSS selector that must be visible before the capture. */
  waitFor: string;
  prepare?: "expand-first-condor" | "open-first-chart" | "collapse-sidebar";
  /**
   * CSS selector scrolled to the top of the viewport, after `prepare`, before the capture: the part
   * worth showing sits below the fold. The demo banner may scroll away with it.
   */
  scrollTo?: string;
}

export const SHOT_WIDTH = 1600;
export const SHOT_HEIGHT = 1000;
export const SHOT_THEMES = ["light", "dark"] as const;
export const SHOT_LANGUAGES = ["fr", "en"] as const;

// `main` is the SidebarInset element of AppLayout; every listed page renders an h1 or a <table>
// (the history table is a real <table>, virtualised).
export const SHOTS: readonly ShotSpec[] = [
  { id: "dashboard", route: "/accounts/demo/dashboard", waitFor: "main h1" },
  // The sold options carry the coverage and buy-back decision badges, the last two of the thirteen
  // columns: the sidebar folds so the whole table fits. FilteredTableBox labels its card by its
  // translated title, and the language is switched after the page loads: both titles.
  {
    id: "positions",
    route: "/accounts/demo/positions",
    waitFor: "main table",
    prepare: "collapse-sidebar",
    scrollTo: `main [aria-label="Ventes d'options"], main [aria-label="Option sells"]`,
  },
  // The table that holds the opened chart, from its column headers: the whole chart fits under them.
  {
    id: "wheel",
    route: "/accounts/demo/positions/wheel",
    waitFor: "main table",
    prepare: "open-first-chart",
    scrollTo: "main table:has([data-testid=position-chart-row]) thead",
  },
  { id: "journal-wheel", route: "/accounts/demo/journal/wheel", waitFor: "main table" },
  { id: "condors", route: "/accounts/demo/positions/condors", waitFor: "main table", prepare: "expand-first-condor" },
  { id: "history", route: "/accounts/demo/history", waitFor: "main table" },
];

// Under /shots/, never /welcome/: a real directory named like the SPA route makes nginx's
// `try_files $uri $uri/` answer /welcome with a 301 then a 403.
export function shotPath(id: ShotId, theme: (typeof SHOT_THEMES)[number], lang: (typeof SHOT_LANGUAGES)[number]): string {
  return `/shots/${id}.${theme}.${lang}.webp`;
}
