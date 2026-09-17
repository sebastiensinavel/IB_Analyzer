import { describe, expect, it } from "vitest";
import type { Position } from "@ib/ledger";
import { analyze } from "./classify.ts";
import {
  COVER_CASH,
  COVER_LEAPS,
  COVER_SPREAD,
  COVER_STOCK,
  MAX_STRUCTURE_LOSS,
  STRUCT_CALL_SPREAD,
  STRUCT_IRON_CONDOR,
  STRUCT_PUT_SPREAD,
  type CoverSource,
} from "./constants.ts";
import { computeCoverage, normalizeExpiry } from "./coverage.ts";
import { option, stock } from "./fixtures.ts";
import {
  breaches,
  buildRiskReport,
  cashOk,
  cashRequired,
  ironCondors,
  isOk,
  issues,
  moderateShortCalls,
  structureMaxLoss,
  structureOk,
  uncovered,
} from "./report.ts";
import type { AnalyzedPosition, RiskReport, Structure } from "./types.ts";

// The whole point of the engine is to make an unbounded loss impossible to
// miss, so every scenario asserts either "covered and the account is OK" or
// "naked and the report screams". A long leg can only be used once: double
// counting would silently turn a naked short into a covered one.

function reportFor(positions: Position[], cash: number | null = 1_000_000): RiskReport {
  return buildRiskReport(positions, cash);
}

function find(positions: readonly AnalyzedPosition[], needle: string): AnalyzedPosition {
  const matches = positions.filter((p) => p.description.includes(needle));
  expect(matches, `${needle} matched ${matches.length} positions`).toHaveLength(1);
  return matches[0];
}

const sources = (pos: AnalyzedPosition): CoverSource[] => pos.allocations.map((a) => a.source);
const quantityFrom = (pos: AnalyzedPosition, source: CoverSource): number =>
  pos.allocations.filter((a) => a.source === source).reduce((sum, a) => sum + a.quantity, 0);

describe("normalizeExpiry", () => {
  it.each([
    ["2026-01-16", "20260116"],
    ["20260116", "20260116"],
    ["202601", "20260131"],
    ["", ""],
  ])("normalizes %j to %j", (raw, expected) => {
    expect(normalizeExpiry(raw)).toBe(expected);
  });

  it("orders expiries chronologically under plain string comparison, which the LEAPS rule relies on", () => {
    expect(normalizeExpiry("2026-01-16") < normalizeExpiry("2027-01-15")).toBe(true);
    expect(normalizeExpiry("202601") < normalizeExpiry("2026-03-01")).toBe(true);
  });
});

describe("short calls covered by stock", () => {
  it("fully covers a short call with 100 shares", () => {
    const report = reportFor([
      stock({ symbol: "AAPL", quantity: 100, avgPrice: 140 }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150 }),
    ]);
    const short = find(report.positions, "C 150");
    expect(sources(short)).toEqual([COVER_STOCK]);
    expect(short.uncoveredQuantity).toBe(0);
    expect(isOk(report)).toBe(true);
  });

  it("covers one contract per hundred shares: 300 shares back three contracts, not four", () => {
    const report = reportFor([
      stock({ symbol: "AAPL", quantity: 300, avgPrice: 140 }),
      option({ symbol: "AAPL", right: "C", quantity: -4, strike: 150 }),
    ]);
    const short = find(report.positions, "C 150");
    expect(quantityFrom(short, COVER_STOCK)).toBe(3);
    expect(short.uncoveredQuantity).toBe(1);
    expect(isOk(report)).toBe(false);
  });

  it("covers nothing with a partial lot: 99 shares, rounding up would hide a naked call", () => {
    const report = reportFor([
      stock({ symbol: "AAPL", quantity: 99, avgPrice: 140 }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150 }),
    ]);
    const short = find(report.positions, "C 150");
    expect(short.allocations).toEqual([]);
    expect(short.uncoveredQuantity).toBe(1);
    expect(isOk(report)).toBe(false);
  });

  it("does not share 100 shares between two short calls: the earliest expiry gets them", () => {
    const report = reportFor([
      stock({ symbol: "AAPL", quantity: 100, avgPrice: 140 }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150, expiry: "2026-01-16" }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150, expiry: "2026-02-20" }),
    ]);
    expect(sources(find(report.positions, "2026-01-16"))).toEqual([COVER_STOCK]);
    expect(find(report.positions, "2026-02-20").uncoveredQuantity).toBe(1);
    expect(isOk(report)).toBe(false);
  });

  it("does not cover with the stock of another symbol", () => {
    const report = reportFor([
      stock({ symbol: "MSFT", quantity: 500, avgPrice: 300 }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150 }),
    ]);
    expect(find(report.positions, "AAPL").uncoveredQuantity).toBe(1);
    expect(isOk(report)).toBe(false);
  });
});

describe("short calls covered by LEAPS", () => {
  it("covers a short call with a longer-dated long call", () => {
    const report = reportFor([
      option({ symbol: "AAPL", right: "C", quantity: 1, strike: 120, expiry: "2027-01-15" }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150, expiry: "2026-01-16" }),
    ]);
    expect(sources(find(report.positions, "2026-01-16"))).toEqual([COVER_LEAPS]);
    expect(find(report.positions, "2027-01-15").usedQuantity).toBe(1);
    expect(isOk(report)).toBe(true);
  });

  it("does not count a shorter-dated long call as a LEAPS cover", () => {
    const report = reportFor([
      option({ symbol: "AAPL", right: "C", quantity: 1, strike: 120, expiry: "2026-01-16" }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150, expiry: "2027-01-15" }),
    ]);
    expect(find(report.positions, "2027-01-15").uncoveredQuantity).toBe(1);
    expect(isOk(report)).toBe(false);
  });

  it("uses stock and LEAPS together: 3 sold, 100 shares held, 2 LEAPS owned", () => {
    const report = reportFor([
      stock({ symbol: "AAPL", quantity: 100, avgPrice: 140 }),
      option({ symbol: "AAPL", right: "C", quantity: 2, strike: 120, expiry: "2027-01-15" }),
      option({ symbol: "AAPL", right: "C", quantity: -3, strike: 150, expiry: "2026-01-16" }),
    ]);
    const short = find(report.positions, "2026-01-16");
    expect(sources(short)).toEqual([COVER_STOCK, COVER_LEAPS]);
    expect(quantityFrom(short, COVER_STOCK)).toBe(1);
    expect(quantityFrom(short, COVER_LEAPS)).toBe(2);
    expect(short.uncoveredQuantity).toBe(0);
    expect(isOk(report)).toBe(true);
  });

  it("consumes the LEAPS quantity across short calls: the second one stays naked", () => {
    const report = reportFor([
      option({ symbol: "AAPL", right: "C", quantity: 1, strike: 120, expiry: "2028-01-19" }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150, expiry: "2026-01-16" }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150, expiry: "2026-02-20" }),
    ]);
    expect(find(report.positions, "2026-01-16").uncoveredQuantity).toBe(0);
    expect(find(report.positions, "2026-02-20").uncoveredQuantity).toBe(1);
    expect(isOk(report)).toBe(false);
  });
});

describe("short puts secured by cash", () => {
  it("requires the full assignment cash", () => {
    const report = reportFor([option({ symbol: "AAPL", right: "P", quantity: -2, strike: 100 })], 50_000);
    const short = find(report.positions, "P 100");
    expect(sources(short)).toEqual([COVER_CASH]);
    expect(short.requiredCash).toBe(20_000);
    expect(cashRequired(report)).toBe(20_000);
    expect(cashOk(report)).toBe(true);
    expect(isOk(report)).toBe(true);
  });

  it("flags short puts exceeding the cash", () => {
    const report = reportFor([option({ symbol: "AAPL", right: "P", quantity: -3, strike: 100 })], 25_000);
    expect(cashRequired(report)).toBe(30_000);
    expect(cashOk(report)).toBe(false);
    expect(isOk(report)).toBe(false);
    expect(issues(report).some((issue) => issue.includes("only"))).toBe(true);
  });

  it("sums the cash requirement across symbols", () => {
    const report = reportFor(
      [
        option({ symbol: "AAPL", right: "P", quantity: -1, strike: 100 }),
        option({ symbol: "MSFT", right: "P", quantity: -2, strike: 300 }),
      ],
      100_000,
    );
    expect(cashRequired(report)).toBe(10_000 + 60_000);
  });

  it("locks no cash for a short put inside a spread: the long put caps the loss", () => {
    const report = reportFor(
      [
        option({ symbol: "AAPL", right: "P", quantity: 1, strike: 90, expiry: "2026-03-20" }),
        option({ symbol: "AAPL", right: "P", quantity: -1, strike: 95, expiry: "2026-03-20" }),
      ],
      0,
    );
    const short = find(report.positions, "P 95");
    expect(sources(short)).toEqual([COVER_SPREAD]);
    expect(short.requiredCash).toBe(0);
    expect(cashRequired(report)).toBe(0);
  });

  it("never reports a short put as uncovered: the danger is the cash bill, not the leg", () => {
    const report = reportFor([option({ symbol: "AAPL", right: "P", quantity: -1, strike: 100 })], 0);
    expect(uncovered(report)).toEqual([]);
    expect(isOk(report)).toBe(false);
  });
});

/** The four legs of an iron condor, premiums per unit. */
function ironCondor({
  symbol = "XYZ",
  expiry = "2026-03-20",
  longPut = 90,
  shortPut = 95,
  shortCall = 105,
  longCall = 110,
  qty = 1,
  shortPremium = 2,
  longPremium = 1,
} = {}): Position[] {
  return [
    option({ symbol, expiry, right: "P", strike: longPut, quantity: qty, avgPrice: longPremium }),
    option({ symbol, expiry, right: "P", strike: shortPut, quantity: -qty, avgPrice: shortPremium }),
    option({ symbol, expiry, right: "C", strike: shortCall, quantity: -qty, avgPrice: shortPremium }),
    option({ symbol, expiry, right: "C", strike: longCall, quantity: qty, avgPrice: longPremium }),
  ];
}

describe("defined-risk structures", () => {
  it("builds no structure from short legs that no long leg of their expiry protects", () => {
    const report = reportFor([
      stock(),
      option({ right: "C", strike: 160 }),
      option({ right: "P", strike: 130 }),
      option({ right: "C", strike: 170, expiry: "2026-06-19", quantity: 1 }),
    ]);
    expect(report.structures).toEqual([]);
  });

  it("detects an iron condor", () => {
    const report = reportFor(ironCondor());
    expect(ironCondors(report)).toHaveLength(1);
    expect(ironCondors(report)[0].symbol).toBe("XYZ");
  });

  it("tags the condor's short legs as spread", () => {
    const report = reportFor(ironCondor());
    for (const needle of ["C 105", "P 95"]) expect(sources(find(report.positions, needle))).toEqual([COVER_SPREAD]);
  });

  it("caps the max loss at the wider side minus the credit: 5-wide wings, 1.00 net per side -> 500 - 200", () => {
    const report = reportFor(ironCondor());
    const structure = ironCondors(report)[0];
    expect(structure.callRisk).toBe(500);
    expect(structure.putRisk).toBe(500);
    expect(structure.credit).toBe(200);
    expect(structureMaxLoss(structure)).toBe(300);
    expect(structureOk(structure)).toBe(true);
    expect(isOk(report)).toBe(true);
  });

  it("takes the wider wing of an asymmetric condor", () => {
    const structure = ironCondors(reportFor(ironCondor({ longPut: 85 })))[0];
    expect(structure.putRisk).toBe(1000);
    expect(structureMaxLoss(structure)).toBe(1000 - 200);
  });

  it("flags a condor over the loss limit: a 20-wide wing loses far more than the budget", () => {
    const report = reportFor(ironCondor({ longPut: 75 }));
    const structure = ironCondors(report)[0];
    expect(structureMaxLoss(structure)).toBe(2000 - 200);
    expect(structureOk(structure)).toBe(false);
    expect(breaches(report)).toContain(structure);
    expect(isOk(report)).toBe(false);
    expect(issues(report).some((issue) => issue.includes("exceeds"))).toBe(true);
  });

  it("drives the loss limit by MAX_STRUCTURE_LOSS, not a hard-coded 1000", () => {
    const structure: Structure = {
      symbol: "X",
      expiry: "2026-03-20",
      kind: STRUCT_IRON_CONDOR,
      contracts: 2,
      callRisk: MAX_STRUCTURE_LOSS,
      putRisk: 0,
      credit: 0,
    };
    expect(structureOk(structure)).toBe(true);
    expect(structureOk({ ...structure, callRisk: MAX_STRUCTURE_LOSS + 0.01 })).toBe(false);
  });

  it("scales the risk with the number of condors", () => {
    const structure = ironCondors(reportFor(ironCondor({ qty: 3 })))[0];
    expect(structure.contracts).toBe(6);
    expect(structureMaxLoss(structure)).toBe(1500 - 600);
  });

  it("keeps condors on different expiries as separate structures", () => {
    const report = reportFor([...ironCondor({ expiry: "2026-03-20" }), ...ironCondor({ expiry: "2026-06-19" })]);
    expect(ironCondors(report)).toHaveLength(2);
  });

  it("calls a call side alone a call spread, not a condor", () => {
    const report = reportFor([
      option({ symbol: "XYZ", expiry: "2026-03-20", right: "C", strike: 105, quantity: -1, avgPrice: 2 }),
      option({ symbol: "XYZ", expiry: "2026-03-20", right: "C", strike: 110, quantity: 1, avgPrice: 1 }),
    ]);
    expect(ironCondors(report)).toEqual([]);
    expect(report.structures.map((s) => s.kind)).toEqual([STRUCT_CALL_SPREAD]);
    expect(structureMaxLoss(report.structures[0])).toBe(500 - 100);
    expect(isOk(report)).toBe(true);
  });

  it("calls a put side alone a put spread", () => {
    const report = reportFor(
      [
        option({ symbol: "XYZ", expiry: "2026-03-20", right: "P", strike: 95, quantity: -1, avgPrice: 2 }),
        option({ symbol: "XYZ", expiry: "2026-03-20", right: "P", strike: 90, quantity: 1, avgPrice: 1 }),
      ],
      0,
    );
    expect(report.structures.map((s) => s.kind)).toEqual([STRUCT_PUT_SPREAD]);
  });

  it("removes the risk when the long leg sits below the short strike: a debit spread", () => {
    const report = reportFor([
      option({ symbol: "XYZ", expiry: "2026-03-20", right: "C", strike: 150, quantity: -1, avgPrice: 2 }),
      option({ symbol: "XYZ", expiry: "2026-03-20", right: "C", strike: 100, quantity: 1, avgPrice: 1 }),
    ]);
    expect(report.structures[0].callRisk).toBe(0);
    expect(isOk(report)).toBe(true);
  });

  it("gives the tightest protection to the closest short strike: 105 pairs with 100, 205 with 200", () => {
    const report = reportFor([
      option({ symbol: "XYZ", expiry: "2026-03-20", right: "C", strike: 100, quantity: -1, avgPrice: 0 }),
      option({ symbol: "XYZ", expiry: "2026-03-20", right: "C", strike: 200, quantity: -1, avgPrice: 0 }),
      option({ symbol: "XYZ", expiry: "2026-03-20", right: "C", strike: 105, quantity: 1, avgPrice: 0 }),
      option({ symbol: "XYZ", expiry: "2026-03-20", right: "C", strike: 205, quantity: 1, avgPrice: 0 }),
    ]);
    expect(report.structures[0].callRisk).toBe(1000);
  });

  it("leaves the short leg of a partial condor uncovered", () => {
    const legs = ironCondor().filter((leg) => !(leg.right === "C" && leg.strike === 110));
    const report = reportFor(legs, 1_000_000);
    expect(find(report.positions, "C 105").uncoveredQuantity).toBe(1);
    expect(isOk(report)).toBe(false);
  });
});

describe("moderate-risk short calls", () => {
  it("notes a short call below the stock cost: assignment at 150 on shares bought at 165 locks in a loss", () => {
    const report = reportFor([
      stock({ symbol: "AAPL", quantity: 100, avgPrice: 165 }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150 }),
    ]);
    const moderate = moderateShortCalls(report);
    expect(moderate.map((p) => p.description)).toEqual(["AAPL 2026-01-16 C 150"]);
    expect(moderate[0].riskNotes[0]).toContain("stock cost");
    expect(isOk(report)).toBe(true);
  });

  it("does not note a short call above the stock cost", () => {
    const report = reportFor([
      stock({ symbol: "AAPL", quantity: 100, avgPrice: 140 }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150 }),
    ]);
    expect(moderateShortCalls(report)).toEqual([]);
  });

  it("notes a short call below the LEAPS strike", () => {
    const report = reportFor([
      option({ symbol: "AAPL", right: "C", quantity: 1, strike: 160, expiry: "2027-01-15" }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150, expiry: "2026-01-16" }),
    ]);
    const moderate = moderateShortCalls(report);
    expect(moderate).toHaveLength(1);
    expect(moderate[0].riskNotes[0]).toContain("LEAPS strike");
    expect(isOk(report)).toBe(true);
  });

  it("does not note a short call above the LEAPS strike", () => {
    const report = reportFor([
      option({ symbol: "AAPL", right: "C", quantity: 1, strike: 120, expiry: "2027-01-15" }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150, expiry: "2026-01-16" }),
    ]);
    expect(moderateShortCalls(report)).toEqual([]);
  });

  it("uses the weighted average stock cost: 100 @ 100 and 100 @ 200 -> 150, so a 140 strike is at risk", () => {
    const report = reportFor([
      stock({ symbol: "AAPL", quantity: 100, avgPrice: 100 }),
      stock({ symbol: "AAPL", quantity: 100, avgPrice: 200 }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 140 }),
    ]);
    expect(moderateShortCalls(report)).toHaveLength(1);
  });
});

describe("other dangerous positions and sanity", () => {
  it("flags short stock", () => {
    const report = reportFor([stock({ symbol: "AAPL", quantity: -100 })]);
    expect(isOk(report)).toBe(false);
    expect(issues(report).some((issue) => issue.includes("short stock"))).toBe(true);
  });

  it("is fine with an empty portfolio", () => {
    const report = buildRiskReport([], 0);
    expect(isOk(report)).toBe(true);
    expect(cashRequired(report)).toBe(0);
    expect(ironCondors(report)).toEqual([]);
  });

  it("is fine with a long-only portfolio", () => {
    const report = reportFor([
      stock({ symbol: "AAPL", quantity: 100 }),
      option({ symbol: "AAPL", right: "C", quantity: 2, strike: 150 }),
    ]);
    expect(isOk(report)).toBe(true);
  });

  it("computes coverage idempotently: running it twice does not double count", () => {
    const positions = [
      stock({ symbol: "AAPL", quantity: 100, avgPrice: 140 }),
      option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150 }),
    ].map(analyze);
    computeCoverage(positions);
    const first = positions.map((p) => [...p.allocations]);
    computeCoverage(positions);
    expect(positions.map((p) => [...p.allocations])).toEqual(first);
    expect(find(positions, "(STK)").usedQuantity).toBe(100);
  });
});

describe("strings the engine builds (character for character)", () => {
  it("details a stock cover and a cash cover the way the Python did", () => {
    const report = reportFor(
      [
        stock({ symbol: "AAPL", quantity: 100, avgPrice: 165 }),
        option({ symbol: "AAPL", right: "C", quantity: -1, strike: 150 }),
        option({ symbol: "XOM", right: "P", quantity: -2, strike: 55 }),
      ],
      1000,
    );
    expect(find(report.positions, "C 150").allocations[0].detail).toBe("100 shares @ 165.00");
    expect(find(report.positions, "C 150").riskNotes).toEqual(["strike 150 below stock cost 165.00"]);
    expect(find(report.positions, "P 55").allocations[0].detail).toBe("11,000.00 USD");
    expect(issues(report)).toEqual([
      "cash required (short puts + iron condors) needs 11,000.00 USD but only 1,000.00 USD is available",
    ]);
  });

  it("describes a breached structure and an uncovered leg the way the Python did", () => {
    const report = reportFor([
      ...ironCondor({ longPut: 75 }),
      stock({ symbol: "TSLA", quantity: -10 }),
      option({ symbol: "MSFT", right: "C", quantity: -2, strike: 400, expiry: "2026-03-20" }),
    ]);
    expect(issues(report)).toEqual([
      "MSFT 2026-03-20 C 400: 2 contract(s) not covered - unlimited loss risk",
      "TSLA (STK): short stock position - unlimited loss risk",
      "XYZ 2026-03-20 iron condor: max loss 1,800.00 USD exceeds the 1,000.00 USD limit",
    ]);
  });
});
