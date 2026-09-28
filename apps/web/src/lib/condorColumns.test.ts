import { describe, expect, it } from "vitest";
import type { CondorLine } from "@ib/coverage";
import { condorColumnSpecs } from "@/lib/condorColumns";
import { POSITION_COLUMNS } from "@/lib/positionColumns";

const LINE = {
  id: "ic#1", title: "SPY Aug29'26 IC 620/625/660/665", kind: "partial_iron_condor", label: "partial iron condor",
  contract: { ticker: "SPY", secType: "OPT", right: "", strike: null, expiry: "2026-08-29", currency: "USD" },
  quantity: -1, credit: 0.5, closingCost: 0.2, marketValue: -15, dailyPnl: 4, pnl: 39, realizedPnl: -21, decision: null, naked: 1, legs: [],
} as CondorLine;

describe("condorColumnSpecs", () => {
  it("reads the thirteen shared columns, in POSITION_COLUMNS order, on a condor line", () => {
    const specs = condorColumnSpecs(() => "ETF", () => null);
    expect(specs.map((s) => s.key)).toEqual(POSITION_COLUMNS.map((c) => c.key));
    const value = (key: string) => specs.find((s) => s.key === key)!.value(LINE);
    expect(value("position")).toBe("SPY Aug29'26 IC 620/625/660/665");
    expect(value("type")).toBe("partial_iron_condor");
    expect(value("sector")).toBe("ETF");
    expect(value("avgPrice")).toBe(0.5);
    expect(value("lastPrice")).toBe(0.2);
    expect(value("dayChange")).toBeNull();
    expect(value("unrealizedPnl")).toBe(39);
    expect(value("coverage")).toEqual(["UNCOVERED"]);
  });

  it("reads the underlying's day move on the contract's ticker, sortable unlike dayChange", () => {
    const specs = condorColumnSpecs(() => "ETF", (ticker) => (ticker === "SPY" ? -0.021 : null));
    const spec = specs.find((s) => s.key === "underlyingDayChange")!;
    expect(spec.sortable).toBe(true);
    expect(spec.type).toBe("number");
    expect(spec.value(LINE)).toBeCloseTo(-2.1, 10);
    expect(spec.value({ ...LINE, contract: { ...LINE.contract, ticker: "OTHER" } })).toBeNull();
  });
});
