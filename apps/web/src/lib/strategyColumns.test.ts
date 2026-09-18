import { describe, expect, it } from "vitest";
import type { StrategyLine, WheelShareLine } from "@ib/coverage";
import { POSITION_COLUMNS, WHEEL_SHARE_COLUMNS } from "@/lib/positionColumns";
import { strategyColumnSpecs, wheelShareColumnSpecs } from "@/lib/strategyColumns";

const CONTRACT = { ticker: "XOM", secType: "OPT", right: "P" as const, strike: 100, expiry: "2026-03-20", currency: "USD" };

function line(overrides: Partial<StrategyLine> = {}): StrategyLine {
  return {
    contract: CONTRACT, kind: "short_put", label: "sell of put", quantity: -2, avgPrice: 2, lastPrice: 1.5,
    marketValue: -300, unrealizedPnl: 100, decision: "keep", position: null, coverage: [], ...overrides,
  };
}

function holding(overrides: Partial<WheelShareLine> = {}): WheelShareLine {
  return {
    ticker: "MQZA", currency: "USD", quantity: 200, averageAssignmentPrice: 17, assignedTotal: 3400,
    openCallContracts: 1, averageCallStrike: 15, coveredShares: 100, lastPrice: 18, unrealizedPnl: 200,
    callStrikeBelowAssignment: true, ...overrides,
  };
}

describe("strategyColumnSpecs", () => {
  it("types the shared ten columns, in their order, coverage filterable but not sortable", () => {
    const specs = strategyColumnSpecs(() => null, "wheel");
    expect(specs.map((spec) => spec.key)).toEqual(POSITION_COLUMNS.map((column) => column.key));
    expect(specs.map((spec) => spec.type)).toEqual(["text", "enum", "enum", "number", "number", "number", "number", "number", "enum", "enum"]);
    expect(specs.filter((spec) => !spec.sortable).map((spec) => spec.key)).toEqual(["coverage"]);
  });

  it("compares what the row shows, the sector read on the contract's ticker", () => {
    const specs = Object.fromEntries(strategyColumnSpecs((symbol) => (symbol === "XOM" ? "Energy" : null), "wheel").map((spec) => [spec.key, spec]));
    expect(specs.position.value(line())).toBe("XOM Mar20'26 100 Put");
    expect(specs.type.value(line())).toBe("short_put");
    expect(specs.type.label?.("short_put")).toBe("sell of put");
    expect(specs.sector.value(line())).toBe("Energy");
    expect(specs.marketValue.value(line())).toBe(-300);
    expect(specs.decision.value(line())).toBe("keep");
  });

  it("filters a sold option of Others on UNCOVERED, whatever the snapshot says", () => {
    const specs = Object.fromEntries(strategyColumnSpecs(() => null, "others").map((spec) => [spec.key, spec]));
    expect(specs.coverage.value(line())).toEqual(["UNCOVERED"]);
  });

  it("filters a condor's sold leg on its spread allocation and its wing on its use", () => {
    const sold = line({ coverage: [{ source: "spread", quantity: 1, detail: "" }] });
    const wing = line({ kind: "long_put", quantity: 1, position: null });
    const specs = Object.fromEntries(strategyColumnSpecs(() => null, "condors").map((spec) => [spec.key, spec]));
    expect(specs.coverage.value(sold)).toEqual(["spread"]);
    expect(specs.coverage.value(wing)).toEqual(["unused"]);
  });
});

describe("wheelShareColumnSpecs", () => {
  it("types the nine columns of the assigned shares, in their order", () => {
    const specs = wheelShareColumnSpecs(() => null);
    expect(specs.map((spec) => spec.key)).toEqual(WHEEL_SHARE_COLUMNS.map((column) => column.key));
    expect(specs.map((spec) => spec.type)).toEqual(["text", "enum", "number", "number", "number", "number", "number", "number", "enum"]);
  });

  it("reads the ticker as the position and the cover as used or unused", () => {
    const specs = Object.fromEntries(wheelShareColumnSpecs((symbol) => (symbol === "MQZA" ? "Crypto" : null)).map((spec) => [spec.key, spec]));
    expect(specs.position.value(holding())).toBe("MQZA");
    expect(specs.sector.value(holding())).toBe("Crypto");
    expect(specs.averageCallStrike.value(holding())).toBe(15);
    expect(specs.coverage.value(holding())).toEqual(["used"]);
    expect(specs.coverage.value(holding({ coveredShares: 0 }))).toEqual(["unused"]);
  });
});
