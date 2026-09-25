import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CHART_COLORS, CHART_FONT } from "./chartColors";

// `new URL("../index.css", import.meta.url)` is Vite's own "asset URL" idiom (spec §6), but the
// literal two-argument form is statically rewritten by vite:asset-import-meta-url for the
// browser consumer, which this jsdom test environment also uses: it resolves against jsdom's
// default `http://localhost:3000/` origin instead of the real file path. Reading `import.meta.url`
// on its own dodges that rewrite (the plugin only matches the two-argument call).
const here = fileURLToPath(import.meta.url);
const css = readFileSync(path.join(path.dirname(here), "../index.css"), "utf8");

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

  it("draws the price chart's axes in the subtle text and border tokens", () => {
    expect(c.axisText).toBe(t["subtle-foreground"]);
    expect(c.axisBorder).toBe(t.border);
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

  it("dots the price chart grid a step above the axis border, in both themes", () => {
    expect(CHART_COLORS.light.grid).toBe("#c8d2d9");
    expect(CHART_COLORS.dark.grid).toBe("#2b3a46");
  });
});
