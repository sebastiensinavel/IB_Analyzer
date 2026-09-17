import { describe, expect, it } from "vitest";
import { BUYBACK_RATIO, DEFAULT_MULTIPLIER, KIND_LABELS } from "./constants.ts";
import { analyze, describeContract, evaluateBuyback } from "./classify.ts";
import { option, stock } from "./fixtures.ts";

describe("evaluateBuyback", () => {
  it.each([
    [2.0, 1.0, "buy back"],
    [2.0, 0.99, "buy back"],
    [2.0, 0.1, "buy back"],
    [2.0, 1.01, "keep"],
    [2.0, 2.0, "keep"],
    [2.0, 5.0, "keep"],
    [0.5, 0.25, "buy back"],
    [0.5, 0.26, "keep"],
  ])("sold at %s, now %s -> %s", (sale, current, expected) => {
    expect(evaluateBuyback(sale, current)).toBe(expected);
  });

  it("follows BUYBACK_RATIO, not a hard-coded 2", () => {
    const sale = 3;
    const threshold = sale / BUYBACK_RATIO;
    expect(evaluateBuyback(sale, threshold)).toBe("buy back");
    expect(evaluateBuyback(sale, threshold * 1.01)).toBe("keep");
  });

  it.each([
    [-2.0, 1.0],
    [2.0, -1.0],
    [-2.0, -1.0],
  ])("ignores signs (%s, %s): IB bookkeeping, the rule compares magnitudes", (sale, current) => {
    expect(evaluateBuyback(sale, current)).toBe("buy back");
  });

  it.each([0, -0])("stays safe on a zero sale price (%s)", (sale) => {
    expect(evaluateBuyback(sale, 0)).toBe("keep");
  });

  it("buys back a worthless option", () => {
    expect(evaluateBuyback(1.5, 0)).toBe("buy back");
  });
});

describe("analyze", () => {
  it("evaluates a short call and decides to buy it back", () => {
    const result = analyze(option({ right: "C", quantity: -1, avgPrice: 2, marketPrice: 0.8 }));
    expect(result).toMatchObject({
      kind: "short_call",
      label: "sell of call",
      action: "to evaluate",
      avgPrice: 2,
      lastPrice: 0.8,
      decision: "buy back",
    });
  });

  it("keeps a short put above the threshold", () => {
    const result = analyze(option({ right: "P", quantity: -2, avgPrice: 3, marketPrice: 2.5 }));
    expect(result).toMatchObject({ kind: "short_put", action: "to evaluate", decision: "keep" });
  });

  it.each([
    { right: "C", quantity: 1 },
    { right: "P", quantity: 1 },
  ] as const)("ignores a long option %j", (overrides) => {
    const result = analyze(option(overrides));
    expect(result.action).toBe("ignore");
    expect(result.decision).toBeNull();
  });

  it("ignores a stock and keeps its average cost", () => {
    const result = analyze(stock({ quantity: 100, avgPrice: 140, marketPrice: 150 }));
    expect(result).toMatchObject({ kind: "long_stock", action: "ignore", decision: null, avgPrice: 140 });
  });

  // Spec §3.3, deviation 1: Position.avgPrice is already per unit. The
  // Python divided IB's per-contract averageCost here; that division now
  // belongs to the agent adapter of sub-project 4.
  it("keeps the per-unit average price of an option as given, whatever the multiplier", () => {
    expect(analyze(option({ avgPrice: 5, multiplier: 50, quantity: -1 })).avgPrice).toBe(5);
    expect(analyze(option({ avgPrice: 5, multiplier: null, quantity: -1 })).avgPrice).toBe(5);
  });

  it("falls back to the default multiplier when the contract has none", () => {
    expect(analyze(option({ multiplier: null })).multiplier).toBe(DEFAULT_MULTIPLIER);
  });

  it("copies the market fields verbatim", () => {
    const result = analyze(option({ quantity: -3, marketValue: -450, unrealizedPnl: 150, marketPrice: 1.5 }));
    expect(result).toMatchObject({ marketValue: -450, quantity: -3, unrealizedPnl: 150, lastPrice: 1.5 });
  });

  it("describes the contract with describeContract", () => {
    const pos = option({ symbol: "TSLA", right: "P", strike: 250, expiry: "2026-09-18" });
    expect(analyze(pos).description).toBe(describeContract(pos));
  });

  it("uses the label table", () => {
    expect(analyze(option({ right: "C", quantity: -1 })).label).toBe(KIND_LABELS.short_call);
  });

  it("starts with an empty coverage", () => {
    expect(analyze(option())).toMatchObject({
      allocations: [],
      uncoveredQuantity: 0,
      usedQuantity: 0,
      requiredCash: 0,
      riskNotes: [],
    });
  });

  it("maps a missing strike to 0 and a missing expiry to an empty string", () => {
    expect(analyze(stock())).toMatchObject({ strike: 0, expiry: "", right: "" });
  });
});
