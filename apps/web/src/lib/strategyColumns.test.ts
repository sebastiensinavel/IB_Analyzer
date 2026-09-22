import { describe, expect, it } from "vitest";
import type { AnalyzedPosition, StrategyLine, WheelShareLine } from "@ib/coverage";
import { POSITION_COLUMNS, WHEEL_SHARE_COLUMNS } from "@/lib/positionColumns";
import { strategyColumnSpecs, wheelShareColumnSpecs } from "@/lib/strategyColumns";

const CONTRACT = { ticker: "XOM", secType: "OPT", right: "P" as const, strike: 100, expiry: "2026-03-20", currency: "USD" };

function analyzedPosition(overrides: Partial<AnalyzedPosition> = {}): AnalyzedPosition {
  return {
    description: "TEST", kind: "long_put", label: "buy of put", marketValue: 0, quantity: 1,
    avgPrice: 1, lastPrice: 1, dailyPnl: null, dayChange: null, unrealizedPnl: 0, action: "to evaluate", decision: null,
    symbol: "XOM", secType: "OPT", currency: "USD", right: "P", strike: 100, expiry: "2026-03-20", multiplier: 100,
    allocations: [], uncoveredQuantity: 0, usedQuantity: 0, requiredCash: 0, riskNotes: [], ...overrides,
  };
}

function line(overrides: Partial<StrategyLine> = {}): StrategyLine {
  return {
    contract: CONTRACT, kind: "short_put", label: "sell of put", quantity: -2, avgPrice: 2, lastPrice: 1.5,
    marketValue: -300, dailyPnl: null, dayChange: null, unrealizedPnl: 100, decision: "keep", position: null, coverage: [], used: null, ...overrides,
  };
}

function holding(overrides: Partial<WheelShareLine> = {}): WheelShareLine {
  return {
    ticker: "MQZA", currency: "USD", quantity: 200, averageAssignmentPrice: 17, assignedTotal: 3400,
    openCallContracts: 1, averageCallStrike: 15, coveredShares: 100, lastPrice: 18, dailyPnl: null, dayChange: null, unrealizedPnl: 200,
    callStrikeBelowAssignment: true, ...overrides,
  };
}

describe("strategyColumnSpecs", () => {
  it("types the shared twelve columns, in their order, coverage filterable but not sortable", () => {
    const specs = strategyColumnSpecs(() => null, "wheel");
    expect(specs.map((spec) => spec.key)).toEqual(POSITION_COLUMNS.map((column) => column.key));
    expect(specs.map((spec) => spec.type)).toEqual([
      "text", "enum", "enum", "number", "number", "number", "number", "number", "number", "number", "enum", "enum",
    ]);
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
    const usedWing = line({ kind: "long_put", quantity: 1, position: analyzedPosition({ usedQuantity: 1 }) });
    const specs = Object.fromEntries(strategyColumnSpecs(() => null, "condors").map((spec) => [spec.key, spec]));
    expect(specs.coverage.value(sold)).toEqual(["spread"]);
    expect(specs.coverage.value(usedWing)).toEqual(["used"]);
    // No position at all — the journal reads the wing open, the snapshot does not carry it — files
    // under no filterable value, same as the empty badge cell (riskReport.test.ts mirrors this).
    const wingWithoutPosition = line({ kind: "long_put", quantity: 1, position: null });
    expect(specs.coverage.value(wingWithoutPosition)).toEqual([]);
  });
});

describe("wheelShareColumnSpecs", () => {
  it("types the eleven columns of the assigned shares, in their order", () => {
    const specs = wheelShareColumnSpecs(() => null);
    expect(specs.map((spec) => spec.key)).toEqual(WHEEL_SHARE_COLUMNS.map((column) => column.key));
    expect(specs.map((spec) => spec.type)).toEqual([
      "text", "enum", "number", "number", "number", "number", "number", "number", "number", "number", "enum",
    ]);
  });

  it("reads the ticker as the position and the cover as used or unused", () => {
    const specs = Object.fromEntries(wheelShareColumnSpecs((symbol) => (symbol === "MQZA" ? "Crypto" : null)).map((spec) => [spec.key, spec]));
    expect(specs.position.value(holding())).toBe("MQZA");
    expect(specs.sector.value(holding())).toBe("Crypto");
    expect(specs.averageCallStrike.value(holding())).toBe(15);
    expect(specs.coverage.value(holding())).toEqual(["used"]);
    expect(specs.coverage.value(holding({ coveredShares: 0 }))).toEqual(["unused"]);
  });

  it("sorts and filters the day columns as numbers, the move in percent", () => {
    const specs = wheelShareColumnSpecs(() => null);
    const byKey = Object.fromEntries(specs.map((s) => [s.key, s]));

    expect(byKey.dailyPnl.type).toBe("number");
    expect(byKey.dayChange.type).toBe("number");
    // Stored as a fraction, compared as a percentage: "> 5" has to mean +5 %.
    expect(byKey.dayChange.value(holding({ dayChange: 0.0215 }))).toBeCloseTo(2.15, 12);
    expect(byKey.dayChange.value(holding({ dayChange: null }))).toBeNull();
  });
});

describe("WHEEL_SHARE_COLUMNS widths", () => {
  it("declares the eleven columns of the Wheel's shares, summing to 100", () => {
    expect(WHEEL_SHARE_COLUMNS.map((c) => c.key)).toEqual([
      "position", "sector", "quantity", "averageAssignmentPrice", "averageCallStrike",
      "assignedTotal", "lastPrice", "dayChange", "dailyPnl", "unrealizedPnl", "coverage",
    ]);
    const total = WHEEL_SHARE_COLUMNS.reduce((n, c) => n + Number.parseFloat(c.width), 0);
    expect(total).toBeCloseTo(100, 6);
  });
});
