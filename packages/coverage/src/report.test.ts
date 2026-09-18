import { describe, expect, it } from "vitest";
import { analyze } from "./classify.ts";
import { DETAIL_GROUPS, KIND_LABELS, POSITION_KINDS, STRUCT_IRON_CONDOR, type PositionKind } from "./constants.ts";
import { option, stock } from "./fixtures.ts";
import {
  buildRiskReport,
  cashOk,
  cashRequired,
  groupedPositions,
  ironCondorCashRequired,
  putCashRequired,
  riskValue,
  structureAssignmentCash,
  structureMaxLoss,
} from "./report.ts";
import type { AnalyzedPosition } from "./types.ts";

describe("riskValue", () => {
  it.each([
    ["long stock", stock({ symbol: "AAPL", marketValue: 15_000 })],
    ["short call", option({ symbol: "AAPL", right: "C", quantity: -1, marketValue: -250 })],
    ["long call", option({ symbol: "AAPL", right: "C", quantity: 1, marketValue: 250 })],
    ["long put", option({ symbol: "AAPL", right: "P", quantity: 1, marketValue: 250 })],
  ])("is the absolute market value for a %s", (_, pos) => {
    const analyzed = analyze(pos);
    expect(riskValue(analyzed)).toBe(Math.abs(analyzed.marketValue ?? Number.NaN));
  });

  it("is the assignment amount of a short put, not its premium", () => {
    const report = buildRiskReport(
      [option({ symbol: "XOM", right: "P", quantity: -1, strike: 100, marketValue: -200 })],
      1_000_000,
    );
    expect(riskValue(report.positions[0])).toBe(10_000);
  });

  it("reuses requiredCash for a short put: the very figure of the headroom card", () => {
    const report = buildRiskReport(
      [option({ symbol: "XOM", right: "P", quantity: -3, strike: 55, marketValue: -600 })],
      1_000_000,
    );
    expect(riskValue(report.positions[0])).toBe(report.positions[0].requiredCash);
    expect(riskValue(report.positions[0])).toBe(55 * 100 * 3);
  });

  it("is zero for a spread-protected short put: the risk shows up as the spread's max loss", () => {
    const report = buildRiskReport(
      [
        option({ symbol: "XYZ", right: "P", quantity: 1, strike: 90, expiry: "2026-03-20" }),
        option({ symbol: "XYZ", right: "P", quantity: -1, strike: 95, expiry: "2026-03-20" }),
      ],
      1_000_000,
    );
    const shortPut = report.positions.find((p) => p.kind === "short_put");
    expect(shortPut?.requiredCash).toBe(0);
    expect(riskValue(shortPut as AnalyzedPosition)).toBe(0);
  });

  it("is zero for a short put before coverage runs", () => {
    expect(riskValue(analyze(option({ symbol: "XOM", right: "P", quantity: -1, strike: 100 })))).toBe(0);
  });
});

describe("cash required by a structure", () => {
  // Every condor test in coverage.test.ts runs against the default 1,000,000
  // cash, so nothing else pins the condor's own contribution. It is the gross
  // assignment amount of the worse side, never the credit-netted max loss:
  // the credit is already sitting in cashAvailable.
  const condor = [
    option({ symbol: "XYZ", right: "P", strike: 90, expiry: "2026-03-20", quantity: 1, avgPrice: 1 }),
    option({ symbol: "XYZ", right: "P", strike: 95, expiry: "2026-03-20", quantity: -1, avgPrice: 2 }),
    option({ symbol: "XYZ", right: "C", strike: 105, expiry: "2026-03-20", quantity: -1, avgPrice: 2 }),
    option({ symbol: "XYZ", right: "C", strike: 110, expiry: "2026-03-20", quantity: 1, avgPrice: 1 }),
  ];

  it("counts an iron condor's gross assignment cash, not its max loss", () => {
    const report = buildRiskReport(condor, 10_000);
    expect(structureAssignmentCash(report.structures[0])).toBe(500);
    expect(structureMaxLoss(report.structures[0])).toBe(300);
    expect(ironCondorCashRequired(report)).toBe(500);
    expect(putCashRequired(report)).toBe(0);
    expect(cashRequired(report)).toBe(500);
  });

  it("adds the condor's margin to the short puts' assignment cash", () => {
    const report = buildRiskReport(
      [...condor, option({ symbol: "XOM", right: "P", strike: 100, expiry: "2026-03-20", quantity: -2 })],
      10_000,
    );
    expect(cashRequired(report)).toBe(20_500);
    expect(cashOk(report)).toBe(false);
  });

  it("ignores a call spread's risk: only condors reserve margin", () => {
    const report = buildRiskReport(
      [
        option({ symbol: "ABC", right: "C", strike: 105, expiry: "2026-03-20", quantity: -1, avgPrice: 2 }),
        option({ symbol: "ABC", right: "C", strike: 110, expiry: "2026-03-20", quantity: 1, avgPrice: 1 }),
      ],
      10_000,
    );
    expect(report.structures[0].kind).not.toBe(STRUCT_IRON_CONDOR);
    expect(ironCondorCashRequired(report)).toBe(0);
    expect(cashRequired(report)).toBe(0);
  });
});

function position(description: string, kind: PositionKind, overrides: Partial<AnalyzedPosition> = {}): AnalyzedPosition {
  return {
    description,
    kind,
    label: KIND_LABELS[kind],
    marketValue: -100,
    quantity: -1,
    avgPrice: 2,
    lastPrice: 0.8,
    unrealizedPnl: 120,
    dailyPnl: null,
    dayChange: null,
    action: "to evaluate",
    decision: "buy back",
    symbol: description.split(" ")[0],
    secType: "OPT",
    right: "C",
    strike: 150,
    expiry: "2026-01-16",
    multiplier: 100,
    allocations: [],
    uncoveredQuantity: 0,
    usedQuantity: 0,
    requiredCash: 0,
    riskNotes: [],
    ...overrides,
  };
}

describe("groupedPositions", () => {
  it("has a group for every kind, the catch-all included", () => {
    const grouped = new Set(DETAIL_GROUPS.flatMap((g) => (g.kinds ? [...g.kinds] : [])));
    expect(DETAIL_GROUPS.some((g) => g.kinds === null)).toBe(true);
    for (const kind of grouped) expect(POSITION_KINDS).toContain(kind);
  });

  it("returns the groups in declared order", () => {
    const groups = groupedPositions([
      position("ZZZZ (STK)", "long_stock"),
      position("AAAA 2026-01-16 C 150", "short_call"),
      position("MMMM 2026-01-16 P 100", "long_put"),
    ]);
    expect(groups.map((g) => g.id)).toEqual(DETAIL_GROUPS.map((g) => g.id));
    expect(groups.map((g) => g.title)).toEqual(DETAIL_GROUPS.map((g) => g.title));
  });

  it("sorts alphabetically within a group", () => {
    const groups = groupedPositions([
      position("ZZZZ 2026-01-16 C 150", "short_call"),
      position("AAAA 2026-01-16 C 150", "short_call"),
      position("MMMM 2026-01-16 P 100", "short_put"),
    ]);
    const sells = groups.find((g) => g.id === "optionSells")?.positions.map((p) => p.description);
    expect(sells).toEqual(["AAAA 2026-01-16 C 150", "MMMM 2026-01-16 P 100", "ZZZZ 2026-01-16 C 150"]);
  });

  it("does not mutate the input list", () => {
    const positions = [position("ZZZZ 2026-01-16 C 150", "short_call"), position("AAAA 2026-01-16 C 150", "short_call")];
    const original = [...positions];
    groupedPositions(positions);
    expect(positions).toEqual(original);
  });

  it("puts unknown kinds in the catch-all group", () => {
    const groups = groupedPositions([position("WEIRD (BOND)", "other"), position("SHRT (STK)", "short_stock")]);
    expect(groups.find((g) => g.id === "other")?.positions.map((p) => p.description)).toEqual(["SHRT (STK)", "WEIRD (BOND)"]);
  });

  it("keeps empty groups", () => {
    const groups = groupedPositions([]);
    expect(groups).toHaveLength(DETAIL_GROUPS.length);
    for (const group of groups) expect(group.positions).toEqual([]);
  });
});
