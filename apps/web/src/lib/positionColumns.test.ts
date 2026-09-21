import { describe, expect, it } from "vitest";
import { buildRiskReport, type AnalyzedPosition } from "@ib/coverage";
import { POSITION_COLUMNS, positionColumnSpecs } from "@/lib/positionColumns";
import { SAMPLE_POSITIONS } from "@/mocks/positions";

function positionWith(overrides: Partial<AnalyzedPosition>): AnalyzedPosition {
  return {
    description: "TEST", kind: "long_stock", label: "long stock", marketValue: 0, quantity: 1,
    avgPrice: 1, lastPrice: 1, dailyPnl: null, dayChange: null, unrealizedPnl: 0, action: "to evaluate", decision: null,
    symbol: "TEST", secType: "STK", currency: "USD", right: "", strike: 0, expiry: "", multiplier: 1,
    allocations: [], uncoveredQuantity: 0, usedQuantity: 0, requiredCash: 0, riskNotes: [], ...overrides,
  };
}

describe("positionColumnSpecs", () => {
  it("types every shared column, in its order, coverage filterable but not sortable", () => {
    const specs = positionColumnSpecs(() => null);
    expect(specs.map((spec) => spec.key)).toEqual(POSITION_COLUMNS.map((column) => column.key));
    expect(specs.map((spec) => spec.type)).toEqual([
      "text", "enum", "enum", "number", "number", "number", "number", "number", "number", "number", "enum", "enum",
    ]);
    expect(specs.filter((spec) => !spec.sortable).map((spec) => spec.key)).toEqual(["coverage"]);
  });

  it("compares what the row shows, the sector read through sectorOf", () => {
    const report = buildRiskReport(SAMPLE_POSITIONS, 42000);
    const put = report.positions.find((position) => position.symbol === "XOM")!;
    const specs = Object.fromEntries(positionColumnSpecs((symbol) => (symbol === "XOM" ? "Energy" : null)).map((spec) => [spec.key, spec]));
    expect(specs.position.value(put)).toBe("XOM Mar20'26 100 Put");
    expect(specs.type.value(put)).toBe("short_put");
    expect(specs.type.label?.("short_put")).toBe("sell of put");
    expect(specs.sector.value(put)).toBe("Energy");
    expect(specs.unrealizedPnl.value(put)).toBe(490);
    expect(specs.decision.value(put)).toBe(put.decision);
    expect(specs.coverage.value(put)).toEqual(["cash"]);
  });

  it("sorts and filters the day columns as numbers, the move in percent", () => {
    const specs = positionColumnSpecs(() => null);
    const byKey = Object.fromEntries(specs.map((s) => [s.key, s]));

    expect(byKey.dailyPnl.type).toBe("number");
    expect(byKey.dayChange.type).toBe("number");
    // Stored as a fraction, compared as a percentage: "> 5" has to mean +5 %.
    expect(byKey.dayChange.value(positionWith({ dayChange: 0.0215 }))).toBeCloseTo(2.15, 12);
    expect(byKey.dayChange.value(positionWith({ dayChange: null }))).toBeNull();
  });
});

describe("POSITION_COLUMNS widths", () => {
  it("declares the twelve shared columns in order, summing to 100", () => {
    expect(POSITION_COLUMNS.map((c) => c.key)).toEqual([
      "position", "type", "sector", "marketValue", "quantity", "avgPrice",
      "lastPrice", "dayChange", "dailyPnl", "unrealizedPnl", "decision", "coverage",
    ]);
    const total = POSITION_COLUMNS.reduce((n, c) => n + Number.parseFloat(c.width), 0);
    expect(total).toBeCloseTo(100, 6);
  });
});
