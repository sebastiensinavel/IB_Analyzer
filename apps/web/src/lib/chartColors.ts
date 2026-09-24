// Reprend les tokens de src/index.css (sous-projet 31, maquettes finance-desktop) : ECharts et
// lightweight-charts dessinent eux-mêmes et ne lisent pas les variables CSS.
// chartColors.test.ts échoue si l'un des deux fichiers change seul.
export interface ChartColors {
  success: string;
  destructive: string;
  track: string;
  foreground: string;
  /** The card behind the chart (`--card`): the gap between two pie slices. */
  surface: string;
  /**
   * Categorical hues in fixed order, never cycled; each index carries a role (0 shares,
   * 1 short calls, 2 short puts / open, 3 LEAPS, 4 fifth pie slice) — spec of sub-project 31,
   * §5.1.
   */
  series: readonly string[];
  /** A slice that folds several sectors together. */
  other: string;
}

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
    series: ["#5c8de6", "#b98508", "#00a798", "#927be3", "#df625c"],
    other: "#7a8c93",
  },
};

export const CHART_FONT = "'JetBrains Mono Variable', ui-monospace, SFMono-Regular, monospace";

export function chartColors(isDark: boolean): ChartColors {
  return isDark ? CHART_COLORS.dark : CHART_COLORS.light;
}
