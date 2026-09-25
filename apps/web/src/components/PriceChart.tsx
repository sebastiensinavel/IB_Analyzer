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
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type ISeriesPrimitive,
  type Time,
} from "lightweight-charts";
import { useTranslation } from "react-i18next";
import type { ChartLevel, ChartLevelKind } from "@ib/ledger";
import type { PriceBar } from "@/agent/client";
import { chartColors, CHART_FONT } from "@/lib/chartColors";
import { levelColor, levelFill, levelLabel, levelPrice } from "@/lib/chartLevels";
import { CHART_MARGIN_DAYS, LevelsPrimitive, timeExtent, type DrawnLevel } from "@/lib/levelsPrimitive";

export interface PriceChartProps {
  bars: readonly PriceBar[];
  levels: readonly ChartLevel[];
  isDark: boolean;
  height?: number;
}

/** Several table rows tall: the chart is what the injected row is for. */
export const CHART_HEIGHT = 650;

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
      fill: levelFill(level.kind, isDark),
      price,
      label: price === null || level.kind === "condor" ? null : levelLabel(level, price, word(level.kind), locale),
    };
  });
}

/**
 * La plage logique à afficher, marge comprise : tous les jours vides de `timeExtent` à droite,
 * et autant de créneaux vides à gauche, pour que la première bougie ne colle pas au bord.
 * `fitContent` ne convient pas ici : il repose le bord droit sur la dernière *bougie* (son
 * `applyDefaultOffset` écrase le décalage par celui des options, 0 par défaut), si bien que
 * les jours vides se retrouveraient tous à gauche au lieu de prolonger l'axe.
 */
export function visibleRange(candleCount: number, emptyCount: number): { from: number; to: number } {
  return { from: -CHART_MARGIN_DAYS, to: candleCount + emptyCount - 1 };
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
    const colors = chartColors(isDark);
    const chart = createChart(element, {
      height,
      layout: { background: { color: "transparent" }, textColor: colors.axisText, fontFamily: CHART_FONT, attributionLogo: true },
      grid: {
        vertLines: { color: colors.grid, style: LineStyle.Dotted },
        horzLines: { color: colors.grid, style: LineStyle.Dotted },
      },
      rightPriceScale: { borderColor: colors.axisBorder },
      timeScale: { borderColor: colors.axisBorder },
      crosshair: { mode: 0 },
      autoSize: true,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: colors.success,
      downColor: colors.destructive,
      borderVisible: false,
      wickUpColor: colors.success,
      wickDownColor: colors.destructive,
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
    // `attached` de LevelsPrimitive prend une série typée "Candlestick" ; l'interface générique
    // en attend une de n'importe quel type de série, d'où le seul cast de tout ce fichier.
    const seriesPrimitive = primitive as unknown as ISeriesPrimitive<Time>;
    series.attachPrimitive(seriesPrimitive);
    if (candles.length > 0) chart.timeScale().setVisibleLogicalRange(visibleRange(candles.length, empty.length));
    return () => {
      // Au changement de thème, l'effet de création démonte le graphe avant ce nettoyage-ci
      // (React nettoie dans l'ordre de déclaration) : détacher d'une série déjà détruite
      // programmerait un redessin sur un widget mort.
      if (seriesRef.current === series) series.detachPrimitive(seriesPrimitive);
    };
  }, [bars, levels, isDark, t, i18n.language]);

  return <div ref={holder} className="w-full" style={{ height }} data-testid="price-chart" />;
}
