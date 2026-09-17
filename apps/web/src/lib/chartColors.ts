// Must stay in sync with the success/destructive/border/card tokens in src/index.css —
// ECharts renders to SVG directly and can't read CSS custom properties itself.
export interface ChartColors {
  success: string;
  destructive: string;
  track: string;
  foreground: string;
  /** The card behind the chart (`--card`): the gap between two pie slices. */
  surface: string;
  /**
   * Categorical hues in fixed order, never cycled: the dataviz reference palette, validated
   * against the card surface of each theme (spec of sub-project 13, §4.5).
   */
  series: readonly string[];
  /** A slice that folds several sectors together. */
  other: string;
}

export const CHART_COLORS: { light: ChartColors; dark: ChartColors } = {
  light: {
    success: "oklch(0.6 0.14 152)",
    destructive: "oklch(0.577 0.245 27.325)",
    track: "oklch(0.9 0.006 250)",
    foreground: "oklch(0.145 0.01 250)",
    surface: "oklch(1 0 0)",
    series: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"],
    other: "#898781",
  },
  dark: {
    success: "oklch(0.72 0.16 152)",
    destructive: "oklch(0.704 0.191 22.216)",
    track: "oklch(1 0 0 / 12%)",
    foreground: "oklch(0.96 0.003 250)",
    surface: "oklch(0.16 0.008 250)",
    series: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"],
    other: "#898781",
  },
};

export const CHART_FONT = "'Geist Mono Variable', ui-monospace, SFMono-Regular, monospace";

export function chartColors(isDark: boolean): ChartColors {
  return isDark ? CHART_COLORS.dark : CHART_COLORS.light;
}
