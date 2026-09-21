/**
 * One candlestick chart (Lightweight Charts v5), the levels of a strategy painted on top of it:
 * horizontal lines, verticals on their dates, and the rectangles of a condor. All of that is
 * `LevelsPrimitive` (`lib/levelsPrimitive.ts`); this file only assembles a `DrawnLevel` per
 * level (`drawnLevels`) and wires the primitive into the chart's lifecycle.
 */
import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { useTranslation } from "react-i18next";
import type { ChartLevel, ChartLevelKind } from "@ib/ledger";
import type { PriceBar } from "@/agent/client";
import { levelColor, levelLabel, levelPrice } from "@/lib/chartLevels";
import { LevelsPrimitive, timeExtent, type DrawnLevel } from "@/lib/levelsPrimitive";

export interface PriceChartProps {
  bars: readonly PriceBar[];
  levels: readonly ChartLevel[];
  isDark: boolean;
  height?: number;
}

/** Several table rows tall: the chart is what the injected row is for. */
export const CHART_HEIGHT = 650;
const UP = "#26a69a";
const DOWN = "#ef5350";

/** Assemble couleur, prix et étiquette de chaque niveau : la couture testable de ce fichier. */
export function drawnLevels(
  levels: readonly ChartLevel[],
  bars: readonly PriceBar[],
  isDark: boolean,
  word: (kind: ChartLevelKind) => string,
  locale: string,
): DrawnLevel[] {
  return levels.map((level) => {
    const price = levelPrice(level, bars);
    return {
      level,
      color: levelColor(level.kind, isDark),
      price,
      label: price === null || level.kind === "condor" ? null : levelLabel(level, price, word(level.kind), locale),
    };
  });
}

export function PriceChart({ bars, levels, isDark, height = CHART_HEIGHT }: PriceChartProps) {
  const { t, i18n } = useTranslation();
  const holder = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  // One chart for the life of the row; its data and annotations are set in the effect below.
  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    const chart = createChart(element, {
      height,
      layout: {
        background: { color: "transparent" },
        textColor: isDark ? "#a1a1aa" : "#52525b",
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: isDark ? "#27272a" : "#f1f5f9" },
        horzLines: { color: isDark ? "#27272a" : "#f1f5f9" },
      },
      rightPriceScale: { borderColor: isDark ? "#3f3f46" : "#e4e4e7" },
      timeScale: { borderColor: isDark ? "#3f3f46" : "#e4e4e7" },
      crosshair: { mode: 0 },
      autoSize: true,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderVisible: false,
      wickUpColor: UP,
      wickDownColor: DOWN,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height, isDark]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    const candles = bars.map((bar) => ({
      time: bar.date as Time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    }));
    // Les jours vides prolongent l'échelle du temps jusqu'à l'échéance la plus lointaine :
    // sans eux, une date future n'a pas de coordonnée et sa verticale n'est pas tracée.
    const empty = timeExtent(bars, levels).map((day) => ({ time: day as Time }));
    series.setData([...candles, ...empty]);
    const primitive = new LevelsPrimitive(
      drawnLevels(levels, bars, isDark, (kind) => t(`charts.levels.${kind}`), i18n.language),
    );
    series.attachPrimitive(primitive as never);
    chart.timeScale().fitContent();
    return () => {
      series.detachPrimitive(primitive as never);
    };
  }, [bars, levels, isDark, t, i18n.language]);

  return <div ref={holder} className="w-full" style={{ height }} data-testid="price-chart" />;
}
