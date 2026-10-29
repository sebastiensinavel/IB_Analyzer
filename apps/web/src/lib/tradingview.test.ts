import { describe, expect, it } from "vitest";
import type { ChartLevel } from "@ib/ledger";
import { CHART_COLORS } from "@/lib/chartColors";
import { exportLevelsOf, mergeExportLevels, pineKey, pineScript, tradingViewSymbol, watchlistText, type ExportLevel } from "./tradingview";

const WORDS = { shares: "Long", shortPut: "Put", shortCall: "Call", condor: "Condor", alert: "Alerte" };

describe("tradingViewSymbol", () => {
  it("keeps a plain ticker bare, prefixes an index with its exchange, dots a share class", () => {
    expect(tradingViewSymbol("AAPL")).toBe("AAPL");
    expect(tradingViewSymbol("XSP")).toBe("CBOE:XSP");
    expect(tradingViewSymbol("BRK B")).toBe("BRK.B");
  });

  it("keys the script on the ticker without its exchange, the form syminfo.ticker returns", () => {
    expect(pineKey("XSP")).toBe("XSP");
    expect(pineKey("BRK B")).toBe("BRK.B");
  });
});

describe("watchlistText", () => {
  it("writes every ticker once, sorted, comma-separated on one line", () => {
    expect(watchlistText(["MSFT", "XSP", "AAPL", "MSFT"])).toBe("AAPL,CBOE:XSP,MSFT");
  });

  it("is empty with nothing held", () => {
    expect(watchlistText([])).toBe("");
  });
});

describe("exportLevelsOf", () => {
  it("turns shares and short options into one level each and a condor into its four strikes, dropping LEAPS buys", () => {
    const levels: ChartLevel[] = [
      { kind: "shares", price: 50, quantity: 100 },
      { kind: "shortPut", price: 45, quantity: -2, expiries: ["2026-11-20"] },
      { kind: "shortCall", price: 55, quantity: -1, expiries: ["2026-11-20"] },
      { kind: "leapsBuy", when: "2026-01-02", quantity: 1 },
      { kind: "condor", from: "2026-10-01", to: "2026-11-20", putStrikes: [40, 42], callStrikes: [58, 60], quantity: -1 },
    ];
    expect(exportLevelsOf("ABC", levels).map((l) => [l.kind, l.price, l.quantity])).toEqual([
      ["shares", 50, 100],
      ["shortPut", 45, -2],
      ["shortCall", 55, -1],
      ["condor", 40, -1],
      ["condor", 42, -1],
      ["condor", 58, -1],
      ["condor", 60, -1],
    ]);
  });
});

describe("mergeExportLevels", () => {
  it("sums the same level of two accounts and keeps one alert per price", () => {
    const levels: ExportLevel[] = [
      { ticker: "ABC", kind: "shortPut", price: 45, quantity: -2 },
      { ticker: "ABC", kind: "shortPut", price: 45, quantity: -1 },
      { ticker: "ABC", kind: "shortCall", price: 45, quantity: -1 },
      { ticker: "ABC", kind: "alert", price: 47, quantity: null },
      { ticker: "ABC", kind: "alert", price: 47, quantity: null },
      { ticker: "ABD", kind: "shortPut", price: 45, quantity: -3 },
    ];
    expect(mergeExportLevels(levels)).toEqual([
      { ticker: "ABC", kind: "shortPut", price: 45, quantity: -3 },
      { ticker: "ABC", kind: "shortCall", price: 45, quantity: -1 },
      { ticker: "ABC", kind: "alert", price: 47, quantity: null },
      { ticker: "ABD", kind: "shortPut", price: 45, quantity: -3 },
    ]);
  });
});

describe("pineScript", () => {
  const script = pineScript(
    [
      { ticker: "XSP", kind: "condor", price: 580, quantity: -1 },
      { ticker: "ABC", kind: "shortPut", price: 17.5, quantity: -6 },
      { ticker: "ABC", kind: "alert", price: 16.125, quantity: null },
    ],
    WORDS,
  );

  it("is a Pine v6 overlay indicator", () => {
    expect(script.startsWith("//@version=6\n")).toBe(true);
    expect(script).toContain("overlay = true");
    expect(script).toContain("barstate.islast");
  });

  it("draws each ticker's levels under its own syminfo.ticker branch, tickers sorted", () => {
    const abc = script.indexOf('syminfo.ticker == "ABC"');
    const xsp = script.indexOf('syminfo.ticker == "XSP"');
    expect(abc).toBeGreaterThan(-1);
    expect(xsp).toBeGreaterThan(abc);
    expect(script).toContain(`level(17.5, ${CHART_COLORS.dark.series[2]}, line.style_solid, "17.5 Put: -6"`);
    expect(script).toContain(`level(16.13, ${CHART_COLORS.dark.warning}, line.style_dotted, "Alerte 16.13"`);
    expect(script).toContain('"580 Condor: -1"');
  });

  it("still compiles to a script with no level at all", () => {
    const empty = pineScript([], WORDS);
    expect(empty).toContain("indicator(");
    expect(empty).not.toContain("syminfo.ticker ==");
  });
});
