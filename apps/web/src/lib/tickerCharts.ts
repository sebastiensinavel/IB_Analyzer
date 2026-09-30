import { format, type EChartsOption } from "echarts";
import type { Exposure, TickerPnl } from "@ib/ledger";
import { MONTH_GRID, seriesColor } from "@/lib/capitalCharts";
import { CHART_FONT, type ChartColors } from "@/lib/chartColors";
import { formatAmount } from "@/lib/format";

export interface AllocationBar {
  ticker: string;
  assigned: number;
  putCash: number;
  /** assigned + putCash: the bar's whole length. */
  allocated: number;
}

/** The height one ticker takes, bar and gap: a chart is as tall as its tickers, never scrolled. */
export const TICKER_ROW_HEIGHT = 28;
const BAR_WIDTH = 14;
/**
 * The frame of a ticker chart: the left of the month charts, which fits the longest ticker as it
 * fits their widest amount, and room on the right for half of the last amount on the X axis.
 */
const TICKER_GRID = { left: MONTH_GRID.left, right: 40, bottom: 32 } as const;
/** Above the plot: a margin, or the legend's row. */
const PLAIN_TOP = 16;
const LEGEND_TOP = 40;
/** What the frame of each chart takes of its height, beside its rows. */
export const ALLOCATION_FRAME = LEGEND_TOP + TICKER_GRID.bottom;
export const TICKER_PNL_FRAME = PLAIN_TOP + TICKER_GRID.bottom;

export function tickerChartHeight(count: number, frame: number): number {
  return frame + count * TICKER_ROW_HEIGHT;
}

/** What the Wheel ties up now on each ticker, the most allocated first, equal amounts by name. */
export function allocationBars(exposure: readonly Exposure[]): AllocationBar[] {
  return exposure
    .map(({ ticker, assigned, putCash }) => ({ ticker, assigned, putCash, allocated: assigned + putCash }))
    .sort((a, b) => b.allocated - a.allocated || (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0));
}

function amount(value: number, currency: string): string {
  return `${formatAmount(value)} ${currency}`;
}

/** The first ticker at the top, its name in the axis, no tick beside it. */
function tickerAxis(tickers: readonly string[], colors: ChartColors) {
  return { type: "category" as const, inverse: true, data: [...tickers], axisTick: { show: false }, axisLine: { lineStyle: { color: colors.track } } };
}

function amountAxis(colors: ChartColors) {
  return { type: "value" as const, splitLine: { lineStyle: { color: colors.track } } };
}

export function allocationOption(
  bars: readonly AllocationBar[],
  names: { assigned: string; putCash: string; allocated: string },
  colors: ChartColors,
  currency: string,
): EChartsOption {
  // `assigned` keeps the hue of its line on the capital chart; the puts' cash takes the puts sold's.
  const parts = [
    { key: "assigned" as const, color: seriesColor("assigned", colors) },
    { key: "putCash" as const, color: colors.series[2] },
  ];
  return {
    textStyle: { fontFamily: CHART_FONT, color: colors.foreground },
    grid: { ...TICKER_GRID, top: LEGEND_TOP },
    legend: { type: "scroll", top: 0, textStyle: { color: colors.foreground } },
    tooltip: {
      trigger: "axis",
      confine: true,
      axisPointer: { type: "shadow" },
      formatter: (params: unknown) => {
        const points = params as { name: string; marker: string; seriesName: string; value: number }[];
        const total = points.reduce((n, point) => n + point.value, 0);
        // The ticker comes from a file: escaped. The bar's length is said first, then its parts.
        return [
          `<b>${format.encodeHTML(points[0].name)}</b>`,
          `${names.allocated} : <b>${amount(total, currency)}</b>`,
          ...points.map((point) => `${point.marker} ${point.seriesName} : <b>${amount(point.value, currency)}</b>`),
        ].join("<br/>");
      },
    },
    xAxis: amountAxis(colors),
    yAxis: tickerAxis(bars.map((bar) => bar.ticker), colors),
    series: parts.map(({ key, color }) => ({
      id: key,
      type: "bar" as const,
      name: names[key],
      stack: "allocated",
      barWidth: BAR_WIDTH,
      color,
      data: bars.map((bar) => bar[key]),
    })),
  };
}

/** `tickers` in the order of `StrategyStats.tickers`: the largest gain at the top. */
export function tickerPnlOption(tickers: readonly TickerPnl[], colors: ChartColors, currency: string): EChartsOption {
  return {
    textStyle: { fontFamily: CHART_FONT, color: colors.foreground },
    grid: { ...TICKER_GRID, top: PLAIN_TOP },
    tooltip: {
      trigger: "axis",
      confine: true,
      axisPointer: { type: "shadow" },
      valueFormatter: (value: unknown) => (typeof value === "number" ? amount(value, currency) : "—"),
    },
    xAxis: amountAxis(colors),
    yAxis: tickerAxis(tickers.map((t) => t.ticker), colors),
    series: [
      {
        type: "bar",
        barWidth: BAR_WIDTH,
        data: tickers.map((t) => ({ value: t.pnl, itemStyle: { color: t.pnl >= 0 ? colors.success : colors.destructive } })),
      },
    ],
  };
}
