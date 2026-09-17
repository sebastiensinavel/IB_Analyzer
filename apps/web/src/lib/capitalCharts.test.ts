import { describe, expect, it } from "vitest";
import type { LineSeriesOption, PieSeriesOption } from "echarts";
import type { Exposure, StrategyCapital } from "@ib/ledger";
import { CHART_COLORS } from "@/lib/chartColors";
import {
  type CapitalSeries,
  capitalOption,
  exposureOption,
  monthGrid,
  returnOption,
  SCOPE_SERIES,
  sectorSlices,
  seriesColor,
  swatchColor,
} from "@/lib/capitalCharts";

const colors = CHART_COLORS.light;
const SECTORS: Record<string, string> = { MQZA: "Crypto", RQZA: "Crypto", XOM: "Energy", AAPL: "Tech" };
const sectorOf = (ticker: string) => SECTORS[ticker] ?? null;
/** Each ticker its own sector, "SA" for "A": to line up more sectors than the table has. */
const ownSector = (ticker: string) => `S${ticker}`;

function exposure(ticker: string, assigned: number, putCash = 0, leaps = 0, condors = 0): Exposure {
  return { ticker, assigned, putCash, leaps, condors };
}

/** Six sectors, 600 down to 100, plus a seventh of 40: SF and SG fold into Other, 140. */
const SEVEN = [...["A", "B", "C", "D", "E", "F"].map((t, i) => exposure(t, 600 - i * 100)), exposure("G", 40)];

const CAPITAL: StrategyCapital = {
  currency: "USD",
  months: [
    { month: "2026-08", cumulativePnl: 41, assigned: 0, putCash: 3400, leaps: 0, condors: 0, allocated: 3400, invested: 3359, returnRate: 41 / 3400 },
    { month: "2026-09", cumulativePnl: 41, assigned: 0, putCash: 0, leaps: 0, condors: 0, allocated: 0, invested: -41, returnRate: null },
  ],
  exposure: [],
  incomplete: 0,
};

/** The Wheel's four lines. */
const SERIES: CapitalSeries[] = [
  { key: "cumulativePnl", name: "Cumul" },
  { key: "assigned", name: "Assigné" },
  { key: "allocated", name: "Alloué" },
  { key: "invested", name: "Investi" },
];
/** The French names: the first is the longest, 24 characters. */
const LONG_SERIES = SERIES.map((s) => (s.key === "cumulativePnl" ? { ...s, name: "Cumul des profits/pertes" } : s));
/** A strategy other than the Wheel: nothing assigned. */
const THREE = SERIES.filter((s) => s.key !== "assigned");

type LinePoint = { value: number; symbolSize: number } | null;
const valuesOf = (data: LineSeriesOption["data"]) => (data as LinePoint[]).map((point) => (point === null ? null : point.value));
/** Which points draw a visible symbol. */
const symbolsOf = (data: LineSeriesOption["data"]) => (data as LinePoint[]).map((point) => point !== null && point.symbolSize > 0);

describe("sectorSlices", () => {
  it("sums tickers per sector, puts an unknown ticker under the unclassified label, largest first", () => {
    const slices = sectorSlices([exposure("MQZA", 3400), exposure("RQZA", 0, 1000), exposure("XOM", 0, 11000), exposure("ZZZ", 600)], sectorOf, "Non classé");
    expect(slices).toEqual([
      { sector: "Energy", assigned: 0, putCash: 11000, total: 11000, share: 11000 / 16000, folded: false },
      { sector: "Crypto", assigned: 3400, putCash: 1000, total: 4400, share: 4400 / 16000, folded: false },
      { sector: "Non classé", assigned: 600, putCash: 0, total: 600, share: 600 / 16000, folded: false },
    ]);
  });

  it("totals every measure of a ticker, whichever strategy ties it up", () => {
    const slices = sectorSlices([exposure("MQZA", 3400), exposure("ZZZ", 0, 0, 300), exposure("SPY", 0, 0, 0, 500)], sectorOf, "Non classé");
    expect(slices).toEqual([
      { sector: "Crypto", assigned: 3400, putCash: 0, total: 3400, share: 3400 / 4200, folded: false },
      { sector: "Non classé", assigned: 0, putCash: 0, total: 800, share: 800 / 4200, folded: false },
    ]);
  });

  it("orders equal totals by sector name", () => {
    expect(sectorSlices([exposure("XOM", 100), exposure("AAPL", 100)], sectorOf, "Non classé").map((s) => s.sector)).toEqual(["Energy", "Tech"]);
  });

  it("folds nothing up to five sectors, and every sector past the fifth beyond that", () => {
    expect(sectorSlices(SEVEN.slice(0, 5), ownSector, "?").some((s) => s.folded)).toBe(false);
    expect(sectorSlices(SEVEN, ownSector, "?").map((s) => [s.sector, s.folded])).toEqual([
      ["SA", false], ["SB", false], ["SC", false], ["SD", false], ["SE", false], ["SF", true], ["SG", true],
    ]);
  });

  it("gives nothing for an empty exposure", () => {
    expect(sectorSlices([], sectorOf, "Non classé")).toEqual([]);
  });
});

describe("swatchColor", () => {
  it("gives a named slice its series color by rank, and a folded one the gray of Other", () => {
    const slices = sectorSlices(SEVEN, ownSector, "?");
    expect(slices.map((slice, index) => swatchColor(slice, index, colors))).toEqual([...colors.series, colors.other, colors.other]);
  });
});

describe("exposureOption", () => {
  it("draws five named slices in the series colors and one gray Other slice summing the rest", () => {
    const [pie] = exposureOption(sectorSlices(SEVEN, ownSector, "?"), "Autres", colors, "USD").series as PieSeriesOption[];
    expect(pie.type).toBe("pie");
    expect(pie.data).toEqual([
      { name: "SA", value: 600, itemStyle: { color: colors.series[0] } },
      { name: "SB", value: 500, itemStyle: { color: colors.series[1] } },
      { name: "SC", value: 400, itemStyle: { color: colors.series[2] } },
      { name: "SD", value: 300, itemStyle: { color: colors.series[3] } },
      { name: "SE", value: 200, itemStyle: { color: colors.series[4] } },
      { name: "Autres", value: 140, itemStyle: { color: colors.other } },
    ]);
  });

  it("adds no Other slice when nothing is folded, and parts the slices with the card's own color", () => {
    const [pie] = exposureOption(sectorSlices(SEVEN.slice(0, 2), ownSector, "?"), "Autres", colors, "USD").series as PieSeriesOption[];
    expect((pie.data as { name: string }[]).map((d) => d.name)).toEqual(["SA", "SB"]);
    expect(pie.itemStyle).toMatchObject({ borderColor: colors.surface, borderWidth: 2 });
  });
});

describe("SCOPE_SERIES and seriesColor", () => {
  it("draws the assigned line on the Wheel only", () => {
    expect(SCOPE_SERIES).toEqual({
      wheel: ["cumulativePnl", "assigned", "allocated", "invested"],
      leaps: ["cumulativePnl", "allocated", "invested"],
      condors: ["cumulativePnl", "allocated", "invested"],
      portfolio: ["cumulativePnl", "allocated", "invested"],
    });
  });

  it("gives a line the same hue whatever lines stand beside it", () => {
    expect(["cumulativePnl", "assigned", "allocated", "invested"].map((key) => seriesColor(key as CapitalSeries["key"], colors))).toEqual(colors.series.slice(0, 4));
  });
});

describe("monthGrid", () => {
  it("makes room on the right for the longest end label, wrapped past fourteen characters", () => {
    // "Assigné" and "Investi", seven characters: ceil(7 × 7.5) = 53, plus the label's distance of 8 and 4 to spare.
    expect(monthGrid(SERIES)).toEqual({ left: 64, right: 65 });
    // "Cumul des profits/pertes" wraps to "Cumul des" / "profits/pertes": fourteen characters wide, 105 + 12.
    expect(monthGrid(LONG_SERIES)).toEqual({ left: 64, right: 117 });
  });

  it("measures only the lines it is given", () => {
    // "Cumul", five characters: ceil(5 × 7.5) = 38, plus 12.
    expect(monthGrid([{ key: "cumulativePnl", name: "Cumul" }])).toEqual({ left: 64, right: 50 });
  });
});

describe("capitalOption", () => {
  it("draws four straight lines on one axis, in fixed order and colors, each named at its end", () => {
    const option = capitalOption(CAPITAL, SERIES, colors);
    expect(Array.isArray(option.yAxis)).toBe(false);
    expect(option.xAxis).toMatchObject({ type: "category", data: ["2026-08", "2026-09"] });
    const series = option.series as LineSeriesOption[];
    expect(series.map((s) => [s.type, s.name, s.smooth, s.color, valuesOf(s.data)])).toEqual([
      ["line", "Cumul", false, colors.series[0], [41, 41]],
      ["line", "Assigné", false, colors.series[1], [0, 0]],
      ["line", "Alloué", false, colors.series[2], [3400, 0]],
      ["line", "Investi", false, colors.series[3], [3359, -41]],
    ]);
    expect(series.every((s) => s.endLabel?.show === true)).toBe(true);
  });

  it("draws a strategy with nothing assigned as three lines, each keeping the hue of its key", () => {
    const series = capitalOption(CAPITAL, THREE, colors).series as LineSeriesOption[];
    expect(series.map((s) => [s.name, s.color, valuesOf(s.data)])).toEqual([
      ["Cumul", colors.series[0], [41, 41]],
      ["Alloué", colors.series[2], [3400, 0]],
      ["Investi", colors.series[3], [3359, -41]],
    ]);
  });

  it("keeps its end labels readable: pushed apart where lines meet, wrapped, inside a margin made for the longest", () => {
    const option = capitalOption(CAPITAL, LONG_SERIES, colors);
    const series = option.series as LineSeriesOption[];
    expect(series.map((s) => s.labelLayout)).toEqual(Array(4).fill({ moveOverlap: "shiftY" }));
    expect(series.map((s) => s.endLabel)).toEqual(Array(4).fill(expect.objectContaining({ width: 105, overflow: "break", distance: 8 })));
    // Pushed down a pile at 0, a label covers the month under it instead of mixing its letters with it.
    expect(series.map((s) => s.endLabel)).toEqual(Array(4).fill(expect.objectContaining({ backgroundColor: colors.surface, padding: [0, 2] })));
    expect(option.grid).toMatchObject(monthGrid(LONG_SERIES));
    // One row of legend, paged when it runs out of width, above a plot that starts below it.
    expect(option.legend).toMatchObject({ type: "scroll", top: 0 });
    expect(option.grid).toMatchObject({ top: 40 });
    // The cumulative P/L ends near 0: its two-line label reaches below the axis, the months sit lower.
    expect(option.xAxis).toMatchObject({ axisLabel: { margin: 14 } });
    expect(option.grid).toMatchObject({ bottom: 40 });
  });

  it("lines its months up with the bars: the same frame, each point at the center of its month", () => {
    const option = capitalOption(CAPITAL, SERIES, colors);
    expect(option.grid).toMatchObject(monthGrid(SERIES));
    expect(option.xAxis).toMatchObject({ boundaryGap: true });
  });

  it("shows the points of a one-month scope, which draw no segment, and no symbol on a line that has one", () => {
    const oneMonth: StrategyCapital = { ...CAPITAL, months: CAPITAL.months.slice(0, 1) };
    expect((capitalOption(oneMonth, SERIES, colors).series as LineSeriesOption[]).map((s) => symbolsOf(s.data))).toEqual(Array(4).fill([true]));
    expect((capitalOption(CAPITAL, SERIES, colors).series as LineSeriesOption[]).map((s) => symbolsOf(s.data))).toEqual(Array(4).fill([false, false]));
  });

  it("formats the tooltip values as amounts in the capital's currency", () => {
    const { valueFormatter } = capitalOption(CAPITAL, SERIES, colors).tooltip as { valueFormatter: (value: unknown) => string };
    expect(valueFormatter(3359)).toBe("3,359.00 USD");
  });
});

describe("returnOption", () => {
  it("draws the monthly return as one straight line, a gap where nothing was tied up all month, over a zero baseline", () => {
    const option = returnOption(CAPITAL, SERIES, colors);
    expect(option.legend).toBeUndefined();
    const [line] = option.series as LineSeriesOption[];
    expect(line).toMatchObject({ type: "line", smooth: false, connectNulls: false });
    expect(valuesOf(line.data)).toEqual([41 / 3400, null]);
    expect(line.markLine?.data).toEqual([{ yAxis: 0 }]);
  });

  it("shows a month whose return stands between two gaps, which draws no segment, and only that one", () => {
    const rates = [null, 0.02, null, 0.01, 0.03];
    const months = rates.map((returnRate, i) => ({ ...CAPITAL.months[0], month: `2026-0${i + 1}`, returnRate }));
    const [line] = returnOption({ ...CAPITAL, months }, SERIES, colors).series as LineSeriesOption[];
    expect(valuesOf(line.data)).toEqual(rates);
    expect(symbolsOf(line.data)).toEqual([false, true, false, false, false]);
    // Every symbol drawn, never sampled away on a long axis: the isolated one would go with them.
    expect(line).toMatchObject({ showSymbol: true, showAllSymbol: true });
  });

  it("lines its months up with the capital chart's", () => {
    const option = returnOption(CAPITAL, LONG_SERIES, colors);
    expect(option.grid).toMatchObject(monthGrid(LONG_SERIES));
    expect(option.xAxis).toMatchObject({ boundaryGap: true });
  });

  it("never prints the same axis label twice on a flat return: a step of at least 0.1%", () => {
    expect(returnOption(CAPITAL, SERIES, colors).yAxis).toMatchObject({ minInterval: 0.001 });
  });

  it("formats the tooltip as a rate, a dash for a month without one", () => {
    const { valueFormatter } = returnOption(CAPITAL, SERIES, colors).tooltip as { valueFormatter: (value: unknown) => string };
    expect(valueFormatter(0.01206)).toBe("1.2%");
    expect(valueFormatter(null)).toBe("—");
  });
});
