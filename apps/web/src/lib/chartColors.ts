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
  /**
   * Grille en pointillé serré du graphe de cours. Plus marquée que `.dashed` de la maquette
   * (1,18:1 contre la carte, moins que la bordure des axes) : ~1,55:1 dans les deux thèmes,
   * pour qu'un pointillé, qui n'allume qu'un pixel sur deux, reste lisible.
   */
  grid: string;
  /** Texte des axes du graphe de cours : `--subtle-foreground`. */
  axisText: string;
  /** Bordure des échelles du graphe de cours : `--border`. */
  axisBorder: string;
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
    grid: "#c8d2d9",
    axisText: "#8795a0",
    axisBorder: "#e3e8ec",
  },
  dark: {
    success: "#2bc4b4",
    destructive: "#f0716a",
    track: "#16212a",
    foreground: "#e7eef2",
    surface: "#0e151c",
    series: ["#6c9ef8", "#e6b04a", "#2bc4b4", "#a28bf5", "#f0716a"],
    other: "#7a8c93",
    grid: "#2b3a46",
    axisText: "#63727d",
    axisBorder: "#1c2731",
  },
};

export const CHART_FONT = "'JetBrains Mono Variable', ui-monospace, SFMono-Regular, monospace";

export function chartColors(isDark: boolean): ChartColors {
  return isDark ? CHART_COLORS.dark : CHART_COLORS.light;
}
