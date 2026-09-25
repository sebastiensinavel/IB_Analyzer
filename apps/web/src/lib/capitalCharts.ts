import type { EChartsOption } from "echarts";
import type { CapitalScope, Exposure, StrategyCapital } from "@ib/ledger";
import { CHART_FONT, type ChartColors } from "@/lib/chartColors";
import { formatAmount, formatRate } from "@/lib/format";

/** A pie reads at a glance up to six slices: five named, the rest folded into Other. */
export const MAX_NAMED_SLICES = 5;

export interface SectorSlice {
  sector: string;
  /** The Wheel's split, shown in its own legend table. */
  assigned: number;
  putCash: number;
  /** Everything the sector ties up, whichever strategy ties it up. */
  total: number;
  /** total / the whole exposure */
  share: number;
  /** Past the fifth: drawn inside Other, still listed on its own in the legend table. */
  folded: boolean;
}

export type CapitalSeriesKey = "cumulativePnl" | "assigned" | "allocated" | "invested";

export interface CapitalSeries {
  key: CapitalSeriesKey;
  /** Translated by the page (`useCapitalSeries`). */
  name: string;
}

/** Every line a capital chart can draw. A line's rank here is its hue, on every page. */
const SERIES_HUES = ["cumulativePnl", "assigned", "allocated", "invested"] as const satisfies readonly CapitalSeriesKey[];

/** The lines each scope draws, in order: nothing is assigned outside the Wheel. */
export const SCOPE_SERIES: Record<CapitalScope, readonly CapitalSeriesKey[]> = {
  wheel: ["cumulativePnl", "assigned", "allocated", "invested"],
  leaps: ["cumulativePnl", "allocated", "invested"],
  condors: ["cumulativePnl", "allocated", "invested"],
  portfolio: ["cumulativePnl", "allocated", "invested"],
};

/** Room for the widest amount on a month chart's Y axis, "140,000" and its gap. */
const MONTH_GRID_LEFT = 64;
/** One character of CHART_FONT at ECharts' 12 px: a monospace advance of 0.6 em, rounded up. */
const CHAR_WIDTH = 7.5;
/** An end label wraps past this many characters: "Cumul des profits/pertes" takes two lines, not 180 px of a phone's plot. */
const END_LABEL_MAX_CHARS = 14;
/** ECharts' own default, written out because the margin counts it. */
const END_LABEL_DISTANCE = 8;
/** Left and right, around the text on its card-colored background. */
const END_LABEL_PADDING = 2;
/** A point with no neighbour draws no segment: this symbol is all that shows it. */
const ISOLATED_SYMBOL_SIZE = 6;

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function exposureTotal(e: Exposure): number {
  return e.assigned + e.putCash + e.leaps + e.condors;
}

export function sectorSlices(exposure: readonly Exposure[], sectorOf: (ticker: string) => string | null, unclassified: string): SectorSlice[] {
  const groups = new Map<string, { assigned: number; putCash: number; total: number }>();
  for (const e of exposure) {
    const sector = sectorOf(e.ticker) ?? unclassified;
    const group = groups.get(sector) ?? { assigned: 0, putCash: 0, total: 0 };
    group.assigned += e.assigned;
    group.putCash += e.putCash;
    group.total += exposureTotal(e);
    groups.set(sector, group);
  }
  const whole = exposure.reduce((n, e) => n + exposureTotal(e), 0);
  const sorted = [...groups.entries()]
    .map(([sector, group]) => ({ sector, ...group }))
    .sort((a, b) => b.total - a.total || compareNames(a.sector, b.sector));
  const folds = sorted.length > MAX_NAMED_SLICES;
  return sorted.map((slice, index) => ({ ...slice, share: whole === 0 ? 0 : slice.total / whole, folded: folds && index >= MAX_NAMED_SLICES }));
}

/** `index` is the slice's rank in `sectorSlices`; the named slices come first, so rank is hue. */
export function swatchColor(slice: SectorSlice, index: number, colors: ChartColors): string {
  return slice.folded ? colors.other : colors.series[index];
}

/** A capital line's hue: its key's rank among every line, so "Allocated" is the same color on every page. */
export function seriesColor(key: CapitalSeriesKey, colors: ChartColors): string {
  return colors.series[SERIES_HUES.indexOf(key)];
}

function endLabelWidth(series: readonly CapitalSeries[]): number {
  const longest = Math.max(...series.map((s) => s.name.length));
  return Math.ceil(Math.min(longest, END_LABEL_MAX_CHARS) * CHAR_WIDTH);
}

/**
 * The horizontal frame of a month chart: the capital chart's, whose right margin holds the end
 * labels of `series`. Every month chart of a page takes the same `series`, so a month sits at the
 * same x on each card.
 */
export function monthGrid(series: readonly CapitalSeries[]): { left: number; right: number } {
  return { left: MONTH_GRID_LEFT, right: endLabelWidth(series) + END_LABEL_DISTANCE + 2 * END_LABEL_PADDING };
}

/** A month's value, with a visible symbol only where no neighbour draws a segment to it. */
function linePoints(values: readonly (number | null)[]) {
  const isolated = (index: number) => (values[index - 1] ?? null) === null && (values[index + 1] ?? null) === null;
  return values.map((value, index) => (value === null ? null : { value, symbolSize: isolated(index) ? ISOLATED_SYMBOL_SIZE : 0 }));
}

/** Symbols on, sized per point by `linePoints`, and never sampled away on a long axis. */
const LINE_SYMBOLS = { showSymbol: true, showAllSymbol: true, symbol: "circle" } as const;

/** The donut's ring, as the mockup draws it: a 16 px stroke on a 138 px circle, some 68 % to 91 % of its radius. */
export const DONUT_RADIUS = ["66%", "88%"] as const;
/** Degrees of empty track between two slices: the mockup's 3 px gap. */
const DONUT_PAD_ANGLE = 2;

export function exposureOption(slices: readonly SectorSlice[], other: string, colors: ChartColors, currency: string): EChartsOption {
  const data = slices
    .filter((slice) => !slice.folded)
    .map((slice, index) => ({ name: slice.sector, value: slice.total, itemStyle: { color: swatchColor(slice, index, colors) } }));
  const folded = slices.filter((slice) => slice.folded);
  if (folded.length > 0) data.push({ name: other, value: folded.reduce((n, slice) => n + slice.total, 0), itemStyle: { color: colors.other } });
  return {
    textStyle: { fontFamily: CHART_FONT, color: colors.foreground },
    tooltip: {
      trigger: "item",
      backgroundColor: colors.surface,
      borderColor: colors.axisBorder,
      textStyle: { color: colors.foreground, fontFamily: CHART_FONT, fontSize: 12 },
      extraCssText: "box-shadow:none;border-radius:8px;",
      formatter: (params: unknown) => {
        const { name, value, percent } = params as { name: string; value: number; percent: number };
        return `${name}: ${formatAmount(value)} ${currency} (${formatRate(percent / 100)})`;
      },
    },
    series: [
      // The track under the ring: the gaps between slices show it, as in the mockup.
      {
        id: "track",
        type: "pie",
        radius: [...DONUT_RADIUS],
        silent: true,
        label: { show: false },
        emphasis: { disabled: true },
        tooltip: { show: false },
        itemStyle: { color: colors.track },
        data: [{ name: "", value: 1 }],
        animation: false,
      },
      {
        id: "sectors",
        type: "pie",
        radius: [...DONUT_RADIUS],
        padAngle: data.length > 1 ? DONUT_PAD_ANGLE : 0,
        label: { show: false },
        itemStyle: { borderRadius: 3 },
        emphasis: { scale: true, scaleSize: 4 },
        data,
      },
    ],
  };
}

export function capitalOption(capital: StrategyCapital, series: readonly CapitalSeries[], colors: ChartColors): EChartsOption {
  const labelWidth = endLabelWidth(series);
  return {
    textStyle: { fontFamily: CHART_FONT, color: colors.foreground },
    grid: { ...monthGrid(series), top: 40, bottom: 40 },
    // One row, paged past its width: a wrapped legend would run into the top of the plot.
    legend: { type: "scroll", top: 0, textStyle: { color: colors.foreground } },
    tooltip: {
      trigger: "axis",
      valueFormatter: (value: unknown) => `${typeof value === "number" ? formatAmount(value) : "—"} ${capital.currency}`,
    },
    // The cumulative P/L usually ends near 0, and its wrapped end label reaches half its height
    // below the line: the months sit lower than ECharts' 8 px so the two never touch.
    xAxis: {
      type: "category",
      boundaryGap: true,
      data: capital.months.map((m) => m.month),
      axisLabel: { margin: 14 },
      axisLine: { lineStyle: { color: colors.track } },
    },
    yAxis: { type: "value", splitLine: { lineStyle: { color: colors.track } } },
    // The key is the line's id: `CapitalCard` replaces the series by id, so a line the next scope
    // does not draw — the Wheel's "Assigned" once the page shows the condors — leaves the chart.
    series: series.map(({ key, name }) => ({
      id: key,
      type: "line" as const,
      name,
      smooth: false,
      ...LINE_SYMBOLS,
      color: seriesColor(key, colors),
      lineStyle: { width: 2 },
      // Allocated and cash invested part by the cumulative P/L alone, assigned meets allocated
      // whenever no put is open: their end labels would pile up without the shift. The shift is
      // bounded by the chart, not the plot, so a pile at 0 can still reach the months: the card's
      // own background lets a label cover a month label there rather than mix letters with it.
      endLabel: {
        show: true,
        formatter: "{a}",
        color: colors.foreground,
        width: labelWidth,
        overflow: "break" as const,
        distance: END_LABEL_DISTANCE,
        backgroundColor: colors.surface,
        padding: [0, END_LABEL_PADDING],
      },
      labelLayout: { moveOverlap: "shiftY" as const },
      data: linePoints(capital.months.map((m) => m[key])),
    })),
  };
}

export function returnOption(capital: StrategyCapital, series: readonly CapitalSeries[], colors: ChartColors): EChartsOption {
  return {
    textStyle: { fontFamily: CHART_FONT, color: colors.foreground },
    grid: { ...monthGrid(series), top: 16, bottom: 32 },
    tooltip: {
      trigger: "axis",
      valueFormatter: (value: unknown) => (typeof value === "number" ? formatRate(value) : "—"),
    },
    xAxis: { type: "category", boundaryGap: true, data: capital.months.map((m) => m.month), axisLine: { lineStyle: { color: colors.track } } },
    // The labels print one decimal: a finer step would print "0.1%" twice.
    yAxis: { type: "value", minInterval: 0.001, axisLabel: { formatter: (value: number) => formatRate(value) }, splitLine: { lineStyle: { color: colors.track } } },
    series: [
      {
        type: "line",
        smooth: false,
        connectNulls: false,
        ...LINE_SYMBOLS,
        color: colors.series[0],
        lineStyle: { width: 2 },
        data: linePoints(capital.months.map((m) => m.returnRate)),
        markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: colors.track, width: 1, type: "solid" }, data: [{ yAxis: 0 }] },
      },
    ],
  };
}
