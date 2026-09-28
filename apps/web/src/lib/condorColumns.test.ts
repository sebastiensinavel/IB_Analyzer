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
  it("reads the twelve shared columns, in POSITION_COLUMNS order, on a condor line", () => {
    const specs = condorColumnSpecs(() => "ETF");
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
});
