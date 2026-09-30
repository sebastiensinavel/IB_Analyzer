import { describe, expect, it } from "vitest";
import type { BarSeriesOption } from "echarts";
import type { Exposure } from "@ib/ledger";
import { seriesColor } from "@/lib/capitalCharts";
import { CHART_COLORS } from "@/lib/chartColors";
import { allocationBars, allocationOption, TICKER_ROW_HEIGHT, tickerChartHeight, tickerPnlOption } from "@/lib/tickerCharts";

const colors = CHART_COLORS.light;
const NAMES = { assigned: "Assigné", putCash: "Couverture des puts", allocated: "Alloué" };

function exposure(ticker: string, assigned: number, putCash: number): Exposure {
  return { ticker, assigned, putCash, leaps: 0, condors: 0 };
}

const EXPOSURE = [exposure("AAA", 1000, 0), exposure("XOM", 3400, 11000), exposure("BBB", 0, 1000), exposure("MQZA", 3400, 0)];

describe("allocationBars", () => {
  it("orders the tickers from the most allocated to the least, equal amounts by name", () => {
    expect(allocationBars(EXPOSURE)).toEqual([
      { ticker: "XOM", assigned: 3400, putCash: 11000, allocated: 14400 },
      { ticker: "MQZA", assigned: 3400, putCash: 0, allocated: 3400 },
      { ticker: "AAA", assigned: 1000, putCash: 0, allocated: 1000 },
      { ticker: "BBB", assigned: 0, putCash: 1000, allocated: 1000 },
    ]);
  });
});

describe("allocationOption", () => {
  const option = allocationOption(allocationBars(EXPOSURE), NAMES, colors, "USD");
  const series = option.series as BarSeriesOption[];

  it("stacks the assigned amount then the puts' cash on one horizontal bar per ticker, the largest at the top", () => {
    expect(option.yAxis).toMatchObject({ type: "category", inverse: true, data: ["XOM", "MQZA", "AAA", "BBB"] });
    expect(option.xAxis).toMatchObject({ type: "value" });
    expect(series.map((s) => [s.id, s.name, s.stack, s.data])).toEqual([
      ["assigned", "Assigné", "allocated", [3400, 3400, 1000, 0]],
      ["putCash", "Couverture des puts", "allocated", [11000, 0, 0, 1000]],
    ]);
  });

  it("gives Assigned the hue of the capital chart's line and the puts' cash the hue of the puts sold", () => {
    expect(series.map((s) => s.color)).toEqual([seriesColor("assigned", colors), colors.series[2]]);
  });

  it("says in its tooltip the ticker, escaped, the allocated total, then each part, in the currency", () => {
    const formatter = (option.tooltip as { formatter: (params: unknown) => string }).formatter;
    const html = formatter([
      { name: "<b>X", marker: "(a)", seriesName: "Assigné", value: 3400 },
      { name: "<b>X", marker: "(p)", seriesName: "Couverture des puts", value: 11000 },
    ]);
    expect(html).toBe("<b>&lt;b&gt;X</b><br/>Alloué : <b>14,400.00 USD</b><br/>(a) Assigné : <b>3,400.00 USD</b><br/>(p) Couverture des puts : <b>11,000.00 USD</b>");
    expect(option.tooltip).toMatchObject({ trigger: "axis", confine: true });
  });
});

describe("tickerPnlOption", () => {
  const option = tickerPnlOption([{ ticker: "XOM", pnl: 120 }, { ticker: "AAA", pnl: 0 }, { ticker: "MQZA", pnl: -27 }], colors, "USD");

  it("draws one horizontal bar per ticker in the order given, teal for a gain and red for a loss", () => {
    expect(option.yAxis).toMatchObject({ type: "category", inverse: true, data: ["XOM", "AAA", "MQZA"] });
    const [bars] = option.series as BarSeriesOption[];
    expect(bars.data).toEqual([
      { value: 120, itemStyle: { color: colors.success } },
      { value: 0, itemStyle: { color: colors.success } },
      { value: -27, itemStyle: { color: colors.destructive } },
    ]);
  });

  it("formats its tooltip as an amount in the currency, inside the chart", () => {
    const tooltip = option.tooltip as { confine: boolean; valueFormatter: (value: unknown) => string };
    expect(tooltip.confine).toBe(true);
    expect(tooltip.valueFormatter(-27)).toBe("-27.00 USD");
  });
});

describe("tickerChartHeight", () => {
  it("grows by one row per ticker over the room its frame takes", () => {
    expect(tickerChartHeight(5, 48) - tickerChartHeight(2, 48)).toBe(3 * TICKER_ROW_HEIGHT);
    expect(tickerChartHeight(1, 48)).toBe(48 + TICKER_ROW_HEIGHT);
  });
});
