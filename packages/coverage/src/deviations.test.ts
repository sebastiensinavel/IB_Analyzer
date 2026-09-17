import { describe, expect, it } from "vitest";
import { analyze } from "./classify.ts";
import { option, stock } from "./fixtures.ts";
import { buildRiskReport, cashOk, isOk, issues, riskValue } from "./report.ts";

// Spec §3.3: the Python engine only ever saw numbers. Here an absent figure
// stays null on the way out, and counts as 0 only where the engine has to
// compute with it. These cases are covered here and nowhere else.
describe("null inputs (deviation 2)", () => {
  it("passes null display fields through analyze untouched", () => {
    const result = analyze(option({ marketValue: null, avgPrice: null, marketPrice: null, unrealizedPnl: null }));
    expect(result).toMatchObject({ marketValue: null, avgPrice: null, lastPrice: null, unrealizedPnl: null });
  });

  it("keeps a short option with no known sale price, rather than advising a trade", () => {
    expect(analyze(option({ avgPrice: null, marketPrice: 0 })).decision).toBe("keep");
  });

  it("gives no decision for a short option with no known current price, rather than advising a trade", () => {
    expect(analyze(option({ avgPrice: 2, marketPrice: null })).decision).toBeNull();
  });

  it("counts an unknown premium as 0 in a structure's credit", () => {
    const report = buildRiskReport(
      [
        option({ symbol: "XYZ", expiry: "2026-03-20", right: "C", strike: 105, quantity: -1, avgPrice: null }),
        option({ symbol: "XYZ", expiry: "2026-03-20", right: "C", strike: 110, quantity: 1, avgPrice: 1 }),
      ],
      0,
    );
    expect(report.structures[0].credit).toBe(-100);
  });

  it("counts an unknown stock cost as 0: the cover is detailed at 0.00 and no risk note is raised", () => {
    const report = buildRiskReport(
      [stock({ symbol: "AAPL", quantity: 100, avgPrice: null }), option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150 })],
      0,
    );
    const short = report.positions.find((p) => p.kind === "short_call");
    expect(short?.allocations[0].detail).toBe("100 shares @ 0.00");
    expect(short?.riskNotes).toEqual([]);
  });

  it("has no risk value for a long position without market value", () => {
    expect(riskValue(analyze(stock({ marketValue: null })))).toBeNull();
    expect(riskValue(analyze(option({ right: "P", quantity: -1, marketValue: null })))).toBe(0);
  });
});

describe("unknown cash (deviation 3)", () => {
  it("gives no cash verdict and no cash issue, whatever the short puts", () => {
    const report = buildRiskReport([option({ symbol: "AAPL", right: "P", quantity: -3, strike: 100 })], null);
    expect(report.cashAvailable).toBeNull();
    expect(cashOk(report)).toBeNull();
    expect(issues(report)).toEqual([]);
    expect(isOk(report)).toBe(true);
  });

  it("still reports the other problems", () => {
    const report = buildRiskReport([option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150 })], null);
    expect(issues(report)).toEqual(["AAPL 2026-01-16 C 150: 1 contract(s) not covered - unlimited loss risk"]);
  });
});
