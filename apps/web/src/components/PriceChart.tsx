/**
 * One candlestick chart (Lightweight Charts v5), with the two annotations the prototype has to
 * prove: a horizontal level on the price scale, and a vertical mark on a date.
 *
 * The vertical line is a series primitive: v5 draws horizontal price lines itself
 * (`createPriceLine`) but has nothing for a date, so the line is painted on the pane canvas at
 * the coordinate the time scale gives for that day, and repainted on every zoom and scroll.
 */
import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import type { PriceBar } from "@/agent/client";

export interface PriceChartProps {
  bars: readonly PriceBar[];
  /** Horizontal green line: an entry, a strike. */
  level?: number | null;
  /** Vertical dashed line: the day something happened. */
  eventDate?: string | null;
  isDark: boolean;
  height?: number;
}

const GREEN = "#16a34a";
const UP = "#26a69a";
const DOWN = "#ef5350";

interface Scope {
  context: CanvasRenderingContext2D;
  bitmapSize: { width: number; height: number };
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
}

/** Paints one dashed vertical line at `x`, in bitmap space so it stays crisp on any screen. */
class VerticalLineRenderer {
  private readonly x: number | null;
  private readonly color: string;

  constructor(x: number | null, color: string) {
    this.x = x;
    this.color = color;
  }

  draw(target: { useBitmapCoordinateSpace: (cb: (scope: Scope) => void) => void }) {
    if (this.x === null) return;
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const x = Math.round(this.x! * scope.horizontalPixelRatio) + 0.5;
      ctx.save();
      ctx.strokeStyle = this.color;
      ctx.lineWidth = Math.max(1, Math.floor(scope.horizontalPixelRatio));
      ctx.setLineDash([6 * scope.verticalPixelRatio, 4 * scope.verticalPixelRatio]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, scope.bitmapSize.height);
      ctx.stroke();
      ctx.restore();
    });
  }
}

class VerticalLine {
  private chart: IChartApi | null = null;
  private x: number | null = null;
  private readonly time: Time;
  private readonly color: string;

  constructor(time: Time, color: string) {
    this.time = time;
    this.color = color;
  }

  attached(param: { chart: IChartApi }) {
    this.chart = param.chart;
  }

  detached() {
    this.chart = null;
  }

  updateAllViews() {
    this.x = this.chart ? this.chart.timeScale().timeToCoordinate(this.time) : null;
  }

  paneViews() {
    const x = this.x;
    const color = this.color;
    return [{ renderer: () => new VerticalLineRenderer(x, color), zOrder: () => "top" as const }];
  }
}

export function PriceChart({ bars, level = null, eventDate = null, isDark, height = 260 }: PriceChartProps) {
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
    series.setData(
      bars.map((bar) => ({
        time: bar.date as Time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      })),
    );
    const priceLine =
      level === null
        ? null
        : series.createPriceLine({ price: level, color: GREEN, lineWidth: 2, title: level.toString() });
    const vertical = eventDate === null ? null : new VerticalLine(eventDate as Time, GREEN);
    if (vertical) series.attachPrimitive(vertical);
    chart.timeScale().fitContent();
    return () => {
      if (priceLine) series.removePriceLine(priceLine);
      if (vertical) series.detachPrimitive(vertical);
    };
  }, [bars, level, eventDate]);

  return <div ref={holder} className="w-full" style={{ height }} data-testid="price-chart" />;
}
