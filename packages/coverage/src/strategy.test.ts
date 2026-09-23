import { describe, expect, it } from "vitest";
import type { ContractKey, JournalRow, Position } from "@ib/ledger";
import { option, stock } from "./fixtures.ts";
import { buildRiskReport } from "./report.ts";
import { strategyPositions, type PricedSnapshot, migratedContracts, strategyCoverSources, type PositionsStrategy } from "./strategy.ts";
import type { CoverSource } from "./constants.ts";
import type { CoverageAllocation } from "./types.ts";

/** The two shapes the old API returned, so the tests below read as they did. */
const wheelPositions = (rows: readonly JournalRow[], snapshot: PricedSnapshot | null) => {
  const { shares, groups } = strategyPositions(rows, "wheel", snapshot);
  return { shares, optionSales: groups.optionSells };
};
const leapsPositions = (rows: readonly JournalRow[], snapshot: PricedSnapshot | null) => {
  const { groups } = strategyPositions(rows, "leaps", snapshot);
  return { optionBuys: groups.optionBuys, optionSales: groups.optionSells, shares: groups.long };
};

/** An open Wheel put on `contract`, one contract sold at 2. */
function row(overrides: Partial<JournalRow> & Pick<JournalRow, "contract">): JournalRow {
  const { contract } = overrides;
  return {
    id: "x#1", strategy: "wheel", kind: "short_put", ticker: contract.ticker, label: "", currency: contract.currency,
    startWhen: "2026-08-03T14:30:00.000Z", quantity: -1, strike: contract.strike, openPrice: 2, openTotal: 200, openCommission: -1, openNet: 199,
    assigned: false, endWhen: null, closePrice: null, closeTotal: null, closeCommission: null, closeNet: null, pnl: null,
    ongoing: true, event: null, orphan: false, note: null, openIds: [], closeIds: [], ...overrides,
  };
}

const opt = (ticker: string, right: "C" | "P", strike: number, expiry: string): ContractKey => ({ ticker, secType: "OPT", right, strike, expiry, currency: "USD" });
const shares = (ticker: string): ContractKey => ({ ticker, secType: "STK", right: "", strike: null, expiry: null, currency: "USD" });

const MARA_CALL = opt("MQZA", "C", 20, "2026-11-20");
const XOM_PUT = opt("XOM", "P", 100, "2026-10-16");
const MARA_CALL_15 = opt("MQZA", "C", 15, "2026-10-16");

/** 100 Wheel shares left under two Wheel calls: the engine covers one, the other is naked. */
function nakedCallLedger(): { rows: JournalRow[]; snapshot: PricedSnapshot } {
  const rows = [
    row({ id: "s#1", contract: shares("MQZA"), kind: "shares", quantity: 100, openPrice: 17, strike: null }),
    row({ id: "c#1", contract: MARA_CALL_15, kind: "short_call", quantity: -2, openPrice: 0.7 }),
  ];
  const snapshot = priced([
    stock({ symbol: "MQZA", quantity: 100, avgPrice: 17, marketPrice: 18, marketValue: 1800 }),
    option({ symbol: "MQZA", right: "C", strike: 15, expiry: "2026-10-16", quantity: -2, avgPrice: 0.7, marketPrice: 1, marketValue: -200 }),
  ]);
  return { rows, snapshot };
}

function priced(positions: Position[]): PricedSnapshot {
  return { positions, report: buildRiskReport(positions, null) };
}

describe("buildRiskReport", () => {
  it("keeps the report's positions in the snapshot's order, which the pricing relies on", () => {
    const positions = [
      option({ symbol: "XYZ", right: "C", strike: 110, quantity: 1 }),
      stock({ symbol: "AAPL", quantity: 100 }),
      option({ symbol: "XYZ", right: "C", strike: 105, quantity: -1 }),
      option({ symbol: "AAPL", right: "C", strike: 150, quantity: -1 }),
      option({ symbol: "XOM", right: "P", strike: 100, quantity: -2 }),
    ];
    const report = buildRiskReport(positions, null);
    expect(report.positions.map((p) => [p.symbol, p.strike, p.quantity])).toEqual(positions.map((p) => [p.symbol, p.strike ?? 0, p.quantity]));
  });
});

describe("wheelPositions — option sales", () => {
  it("keeps only the Wheel's part of a call shared with Others, and only the Wheel's cover of it", () => {
    const rows = [
      row({ contract: MARA_CALL, kind: "short_call", quantity: -1, openPrice: 0.5 }),
      row({ id: "y#1", contract: MARA_CALL, strategy: "others", kind: "short_call", quantity: -1, openPrice: 0.5 }),
    ];
    const snapshot = priced([
      stock({ symbol: "MQZA", quantity: 100, avgPrice: 17, marketPrice: 18, marketValue: 1800 }),
      option({ symbol: "MQZA", right: "C", strike: 20, expiry: "2026-11-20", quantity: -2, avgPrice: 0.5, marketPrice: 0.25, marketValue: -50 }),
    ]);
    const { optionSales } = wheelPositions(rows, snapshot);
    expect(optionSales).toHaveLength(1);
    expect(optionSales[0]).toMatchObject({
      contract: MARA_CALL, kind: "short_call", label: "sell of call", quantity: -1, avgPrice: 0.5,
      lastPrice: 0.25, marketValue: -25, unrealizedPnl: 25, decision: "buy back",
    });
    expect(optionSales[0].position).toMatchObject({ quantity: -2, uncoveredQuantity: 1 });
    // The naked contract belongs to the Others journal: its UNCOVERED is not the Wheel's.
    expect(optionSales[0].coverage).toEqual([expect.objectContaining({ source: "stock", quantity: 1 })]);
  });

  it("gives a sold put its cash cover", () => {
    const rows = [row({ contract: XOM_PUT, quantity: -2, openPrice: 2 })];
    const snapshot = priced([option({ symbol: "XOM", right: "P", strike: 100, expiry: "2026-10-16", quantity: -2, marketPrice: 1.5, marketValue: -300 })]);
    expect(wheelPositions(rows, snapshot).optionSales[0].coverage).toEqual([expect.objectContaining({ source: "cash", quantity: 2 })]);
  });

  it("prices nothing the snapshot does not hold, with or without a snapshot", () => {
    const rows = [row({ contract: XOM_PUT, quantity: -1, openPrice: 1.25 })];
    const blank = { quantity: -1, avgPrice: 1.25, lastPrice: null, marketValue: null, unrealizedPnl: null, decision: null, position: null, coverage: [] };
    expect(wheelPositions(rows, null).optionSales).toEqual([expect.objectContaining(blank)]);
    expect(wheelPositions(rows, priced([stock({ symbol: "AAPL" })])).optionSales).toEqual([expect.objectContaining(blank)]);
  });

  it("keeps a put sold at 2 that is worth 1.5 as a keep, and signs it like IB", () => {
    const rows = [row({ contract: XOM_PUT, quantity: -1, openPrice: 2 })];
    const snapshot = priced([option({ symbol: "XOM", right: "P", strike: 100, expiry: "2026-10-16", quantity: -1, marketPrice: 1.5, marketValue: -150 })]);
    expect(wheelPositions(rows, snapshot).optionSales[0]).toMatchObject({ marketValue: -150, unrealizedPnl: 50, decision: "keep" });
  });

  it("merges the open lines of one contract, the price weighted by quantity, and skips closed lines and bare settlements", () => {
    const rows = [
      row({ contract: XOM_PUT, quantity: -1, openPrice: 1 }),
      row({ id: "x#2", contract: XOM_PUT, quantity: -3, openPrice: 2 }),
      row({ id: "x#3", contract: XOM_PUT, quantity: -5, openPrice: 9, endWhen: "2026-09-01T14:30:00.000Z" }),
      row({ id: "x#4", contract: XOM_PUT, quantity: null, openPrice: null }),
    ];
    expect(wheelPositions(rows, null).optionSales).toEqual([expect.objectContaining({ quantity: -4, avgPrice: 1.75 })]);
  });

  it("sorts by ticker, expiry, right and strike", () => {
    const rows = [
      row({ contract: XOM_PUT }),
      row({ id: "a#1", contract: MARA_CALL, kind: "short_call" }),
      row({ id: "b#1", contract: opt("MQZA", "P", 17, "2026-10-16") }),
      row({ id: "c#1", contract: opt("MQZA", "C", 18, "2026-10-16"), kind: "short_call" }),
    ];
    expect(wheelPositions(rows, null).optionSales.map((line) => line.contract)).toEqual([
      opt("MQZA", "C", 18, "2026-10-16"),
      opt("MQZA", "P", 17, "2026-10-16"),
      MARA_CALL,
      XOM_PUT,
    ]);
  });
});

describe("wheelPositions — assigned shares", () => {
  const held = (callStrike: number | null) => [
    row({ contract: shares("MQZA"), kind: "shares", quantity: 200, openPrice: 17 }),
    ...(callStrike === null ? [] : [row({ id: "c#1", contract: opt("MQZA", "C", callStrike, "2026-11-20"), kind: "short_call", quantity: -1, openPrice: 0.5 })]),
  ];
  const snapshot = priced([stock({ symbol: "MQZA", quantity: 200, avgPrice: 16, marketPrice: 18, marketValue: 3600 })]);

  it("prices the holding from the IB shares at the assignment price, and flags a call struck below it", () => {
    expect(wheelPositions(held(15), snapshot).shares).toEqual([
      {
        ticker: "MQZA", currency: "USD", quantity: 200, averageAssignmentPrice: 17, assignedTotal: 3400, openCallContracts: 1,
        averageCallStrike: 15, coveredShares: 100, lastPrice: 18, unrealizedPnl: 200, dailyPnl: null, dayChange: null,
        callStrikeBelowAssignment: true,
      },
    ]);
  });

  it("never flags a call struck above the assignment price, nor a holding without a call", () => {
    expect(wheelPositions(held(20), snapshot).shares[0].callStrikeBelowAssignment).toBe(false);
    expect(wheelPositions(held(null), snapshot).shares[0].callStrikeBelowAssignment).toBe(false);
  });

  it("leaves the price and the P&L blank without the IB shares", () => {
    expect(wheelPositions(held(15), null).shares[0]).toMatchObject({ lastPrice: null, unrealizedPnl: null });
  });
});

describe("strategyPositions — the Wheel's shares card counts only the covered calls", () => {
  it("turns 'used 100/100' honest when a call has lost its shares", () => {
    const { rows, snapshot } = nakedCallLedger();
    const { shares: held } = wheelPositions(rows, snapshot);
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({
      ticker: "MQZA", quantity: 100, averageAssignmentPrice: 17, assignedTotal: 1700,
      openCallContracts: 1, averageCallStrike: 15, coveredShares: 100,
      lastPrice: 18, unrealizedPnl: 100, callStrikeBelowAssignment: true,
    });
  });

  it("averages the strikes of the covered calls only", () => {
    const rows = [
      row({ id: "s#1", contract: shares("MQZA"), kind: "shares", quantity: 100, openPrice: 17, strike: null }),
      row({ id: "c#1", contract: MARA_CALL_15, kind: "short_call", quantity: -1, openPrice: 0.7 }),
      row({ id: "c#2", contract: opt("MQZA", "C", 25, "2026-10-16"), kind: "short_call", quantity: -1, openPrice: 0.2 }),
    ];
    const snapshot = priced([
      stock({ symbol: "MQZA", quantity: 100, avgPrice: 17, marketPrice: 18, marketValue: 1800 }),
      option({ symbol: "MQZA", right: "C", strike: 15, expiry: "2026-10-16", quantity: -1, marketPrice: 1, marketValue: -100 }),
      option({ symbol: "MQZA", right: "C", strike: 25, expiry: "2026-10-16", quantity: -1, marketPrice: 0.1, marketValue: -10 }),
    ]);
    // The engine covers the nearest expiry, lowest strike first: the 15 call keeps the shares.
    const { shares: held } = wheelPositions(rows, snapshot);
    expect(held[0]).toMatchObject({ openCallContracts: 1, averageCallStrike: 15, coveredShares: 100 });
  });

  it("leaves the card alone when every call is still covered", () => {
    const rows = [
      row({ id: "s#1", contract: shares("MQZA"), kind: "shares", quantity: 200, openPrice: 17, strike: null }),
      row({ id: "c#1", contract: MARA_CALL_15, kind: "short_call", quantity: -1, openPrice: 0.7 }),
    ];
    const snapshot = priced([
      stock({ symbol: "MQZA", quantity: 200, avgPrice: 17, marketPrice: 18, marketValue: 3600 }),
      option({ symbol: "MQZA", right: "C", strike: 15, expiry: "2026-10-16", quantity: -1, marketPrice: 1, marketValue: -100 }),
    ]);
    expect(wheelPositions(rows, snapshot).shares[0]).toMatchObject({ openCallContracts: 1, coveredShares: 100 });
  });

  it("reads openCallContracts 0 and a null average strike, never 0, once the Wheel's only call has migrated whole", () => {
    // A non-Wheel call at a nearer expiry sorts first in coverShortCalls and takes the 100 shares,
    // leaving the Wheel's own call naked: migratedContracts hands it whole to Others, so it drops
    // out of groups.optionSells and coveredCallsByTicker falls back to its zero default.
    const NEARER_CALL = opt("MQZA", "C", 22, "2026-09-25");
    const rows = [
      row({ id: "s#1", contract: shares("MQZA"), kind: "shares", quantity: 100, openPrice: 17, strike: null }),
      row({ id: "c#1", contract: MARA_CALL, kind: "short_call", quantity: -1, openPrice: 0.5 }),
      row({ id: "o#1", contract: NEARER_CALL, strategy: "others", kind: "short_call", quantity: -1, openPrice: 0.4 }),
    ];
    const snapshot = priced([
      stock({ symbol: "MQZA", quantity: 100, avgPrice: 17, marketPrice: 18, marketValue: 1800 }),
      option({ symbol: "MQZA", right: "C", strike: 22, expiry: "2026-09-25", quantity: -1, avgPrice: 0.4, marketPrice: 0.3, marketValue: -30 }),
      option({ symbol: "MQZA", right: "C", strike: 20, expiry: "2026-11-20", quantity: -1, avgPrice: 0.5, marketPrice: 1, marketValue: -100 }),
    ]);
    const { shares: held, optionSales } = wheelPositions(rows, snapshot);
    expect(optionSales).toEqual([]);
    expect(held[0]).toMatchObject({ openCallContracts: 0, averageCallStrike: null, coveredShares: 0 });
  });

  it("also reads null, never 0, from a surviving call whose contract carries no strike (unstruck)", () => {
    // A contract without a strike has no matching snapshot position, so it never migrates and
    // stays in groups.optionSells whole: coveredCallsByTicker marks it unstruck instead of
    // averaging a strike of 0 into the card.
    const UNSTRUCK: ContractKey = { ticker: "MQZA", secType: "OPT", right: "C", strike: null, expiry: "2026-11-20", currency: "USD" };
    const rows = [
      row({ id: "s#1", contract: shares("MQZA"), kind: "shares", quantity: 100, openPrice: 17, strike: null }),
      row({ id: "c#1", contract: UNSTRUCK, kind: "short_call", quantity: -1, openPrice: 0.5 }),
    ];
    const snapshot = priced([stock({ symbol: "MQZA", quantity: 100, avgPrice: 17, marketPrice: 18, marketValue: 1800 })]);
    const { shares: held } = wheelPositions(rows, snapshot);
    expect(held[0]).toMatchObject({ openCallContracts: 1, averageCallStrike: null, coveredShares: 100 });
  });
});

describe("day's values on a strategy line", () => {
  it("prorates the day's P&L to the strategy's share and keeps the move whole", () => {
    // The Wheel holds 2 of the 5 contracts IB reports; the move does not depend on the quantity.
    const rows = [
      row({ contract: MARA_CALL, kind: "short_call", quantity: -2, openPrice: 0.5 }),
      row({ id: "y#1", contract: MARA_CALL, strategy: "others", kind: "short_call", quantity: -3, openPrice: 0.5 }),
    ];
    const snapshot = priced([
      stock({ symbol: "MQZA", quantity: 500, avgPrice: 17, marketPrice: 18, marketValue: 9000 }),
      option({
        symbol: "MQZA", right: "C", strike: 20, expiry: "2026-11-20", quantity: -5, avgPrice: 0.5,
        marketPrice: 0.25, marketValue: -1250, dailyPnl: -250, dayChange: 0.08,
      }),
    ]);
    const { optionSales } = wheelPositions(rows, snapshot);
    expect(optionSales[0].dailyPnl).toBeCloseTo(-100, 12);
    expect(optionSales[0].dayChange).toBeCloseTo(0.08, 12);
  });

  it("gives a line no day values when the position's move is unknown", () => {
    // A contract traded today: IB's dailyPnL starts from the execution price, so the shares
    // entered this morning do not carry the same day's P&L per unit as those held since yesterday.
    const rows = [row({ contract: XOM_PUT, quantity: -1, openPrice: 1.25 })];
    const snapshot = priced([
      option({ symbol: "XOM", right: "P", strike: 100, expiry: "2026-10-16", quantity: -1, dailyPnl: -250, dayChange: null }),
    ]);
    expect(wheelPositions(rows, snapshot).optionSales[0].dailyPnl).toBeNull();
    expect(wheelPositions(rows, snapshot).optionSales[0].dayChange).toBeNull();
  });

  it("gives a line without a position in the snapshot no day values", () => {
    const rows = [row({ contract: XOM_PUT, quantity: -1, openPrice: 1.25 })];
    expect(wheelPositions(rows, null).optionSales[0].dailyPnl).toBeNull();
    expect(wheelPositions(rows, null).optionSales[0].dayChange).toBeNull();
  });

  it("guards a priced position of zero quantity against a division by zero", () => {
    const rows = [row({ contract: XOM_PUT, quantity: -1, openPrice: 1.25 })];
    const snapshot = priced([
      option({ symbol: "XOM", right: "P", strike: 100, expiry: "2026-10-16", quantity: 0, marketValue: 0, dailyPnl: 5, dayChange: 0.1 }),
    ]);
    const sold = wheelPositions(rows, snapshot).optionSales[0];
    expect(sold.dailyPnl).toBeNull();
    expect(sold.dayChange).toBeNull();
  });

  it("prorates the day's P&L of the Wheel's shares too", () => {
    const rows = [row({ id: "s#1", kind: "shares", contract: shares("MQZA"), quantity: 100, openPrice: 17, strike: null })];
    const snapshot = priced([
      stock({ symbol: "MQZA", quantity: 200, avgPrice: 16, marketPrice: 18, marketValue: 3600, dailyPnl: 40, dayChange: 0.01 }),
    ]);
    const held = wheelPositions(rows, snapshot).shares;
    expect(held[0].dailyPnl).toBeCloseTo(20, 12);
    expect(held[0].dayChange).toBeCloseTo(0.01, 12);
  });
});

describe("leapsPositions", () => {
  const LEAPS = opt("ZZZ", "C", 15, "2027-06-18");
  const SOLD = opt("ZZZ", "C", 20, "2026-09-18");
  const rows = [
    row({ contract: LEAPS, strategy: "leaps", kind: "long_call", quantity: 1, openPrice: 3 }),
    row({ id: "s#1", contract: SOLD, strategy: "leaps", kind: "short_call", quantity: -1, openPrice: 0.5 }),
    row({ id: "d#1", contract: shares("ZZZ"), strategy: "leaps", kind: "shares", quantity: 100, openPrice: 20 }),
    row({ id: "w#1", contract: XOM_PUT }),
  ];
  const snapshot = priced([
    option({ symbol: "ZZZ", right: "C", strike: 15, expiry: "2027-06-18", quantity: 1, avgPrice: 3, marketPrice: 4, marketValue: 400 }),
    option({ symbol: "ZZZ", right: "C", strike: 20, expiry: "2026-09-18", quantity: -1, avgPrice: 0.5, marketPrice: 0.25, marketValue: -25 }),
    stock({ symbol: "ZZZ", quantity: 100, multiplier: null, avgPrice: 20, marketPrice: 21, marketValue: 2100 }),
  ]);

  it("splits the LEAPS bought, the calls sold against them and the shares they delivered, leaving the Wheel out", () => {
    const { optionBuys, optionSales, shares: delivered } = leapsPositions(rows, snapshot);
    expect(optionBuys).toEqual([expect.objectContaining({ kind: "long_call", label: "buy of call", marketValue: 400, unrealizedPnl: 100, decision: null })]);
    expect(optionSales).toEqual([expect.objectContaining({ kind: "short_call", marketValue: -25, unrealizedPnl: 25, decision: "buy back" })]);
    // The whole IB position, whatever covers it there: the 100 ZZZ shares of this snapshot come first.
    expect(optionSales[0].position).toMatchObject({ symbol: "ZZZ", strike: 20, quantity: -1 });
    // Shares count one unit each, whatever multiplier the IB row carries or lacks.
    expect(delivered).toEqual([expect.objectContaining({ kind: "long_stock", label: "long", quantity: 100, marketValue: 2100, unrealizedPnl: 100, decision: null })]);
  });

  it("tells how much of a LEAPS line the cover uses, capped by the line, null on what is sold", () => {
    // Without the 100 ZZZ shares, the short call has nothing left to cover it but the LEAPS.
    const noStock = priced([
      option({ symbol: "ZZZ", right: "C", strike: 15, expiry: "2027-06-18", quantity: 1, avgPrice: 3, marketPrice: 4, marketValue: 400 }),
      option({ symbol: "ZZZ", right: "C", strike: 20, expiry: "2026-09-18", quantity: -1, avgPrice: 0.5, marketPrice: 0.25, marketValue: -25 }),
    ]);
    const { optionBuys, optionSales } = leapsPositions(rows, noStock);
    expect(optionBuys[0].used).toBe(1);
    expect(optionSales[0].used).toBeNull();
    expect(leapsPositions(rows, null).optionBuys[0].used).toBeNull();
  });

  it("caps used by the line's own quantity, never the IB position's whole usedQuantity", () => {
    // The IB position holds 2 LEAPS calls, fully used by the 2 short calls sold against them — no
    // stock in this snapshot, so the LEAPS cover applies — but this journal line only carries 1 of
    // the 2 contracts: Math.min(|quantity|, usedQuantity) must keep the line's own 1, not the
    // position's 2.
    const twoSold = [
      row({ contract: LEAPS, strategy: "leaps", kind: "long_call", quantity: 1, openPrice: 3 }),
      row({ id: "s#1", contract: SOLD, strategy: "leaps", kind: "short_call", quantity: -2, openPrice: 0.5 }),
    ];
    const twoContracts = priced([
      option({ symbol: "ZZZ", right: "C", strike: 15, expiry: "2027-06-18", quantity: 2, avgPrice: 3, marketPrice: 4, marketValue: 800 }),
      option({ symbol: "ZZZ", right: "C", strike: 20, expiry: "2026-09-18", quantity: -2, avgPrice: 0.5, marketPrice: 0.25, marketValue: -50 }),
    ]);
    expect(leapsPositions(twoSold, twoContracts).optionBuys[0].used).toBe(1);
  });
});

describe("coverage of a call shared between the Wheel and the LEAPS", () => {
  const CALL = opt("MQZA", "C", 20, "2026-11-20");
  const LEAPS = opt("MQZA", "C", 15, "2028-01-21");
  const rows = [
    row({ contract: CALL, kind: "short_call", quantity: -1, openPrice: 0.5 }),
    row({ id: "l#1", contract: CALL, strategy: "leaps", kind: "short_call", quantity: -1, openPrice: 0.5 }),
    row({ id: "b#1", contract: LEAPS, strategy: "leaps", kind: "long_call", quantity: 1, openPrice: 6 }),
    row({ id: "d#1", contract: shares("MQZA"), strategy: "leaps", kind: "shares", quantity: 100, openPrice: 15 }),
  ];
  // IB covers the two contracts sold with the 100 shares and the LEAPS, one each.
  const snapshot = priced([
    stock({ symbol: "MQZA", quantity: 100, marketPrice: 18, marketValue: 1800 }),
    option({ symbol: "MQZA", right: "C", strike: 15, expiry: "2028-01-21", quantity: 1, marketPrice: 7, marketValue: 700 }),
    option({ symbol: "MQZA", right: "C", strike: 20, expiry: "2026-11-20", quantity: -2, marketPrice: 0.25, marketValue: -50 }),
  ]);

  it("shows the Wheel the shares' cover only", () => {
    expect(wheelPositions(rows, snapshot).optionSales[0].coverage).toEqual([expect.objectContaining({ source: "stock", quantity: 1 })]);
  });

  it("shows the LEAPS the LEAPS' cover only, and no cover on what is bought", () => {
    const { optionBuys, optionSales, shares: held } = leapsPositions(rows, snapshot);
    expect(optionSales[0].coverage).toEqual([expect.objectContaining({ source: "leaps", quantity: 1 })]);
    expect(optionBuys[0].coverage).toEqual([]);
    expect(held[0].coverage).toEqual([]);
  });
});

const SPY = (right: "C" | "P", strike: number) => opt("SPY", right, strike, "2026-08-29");

/**
 * One condor: a composite row carrying its four legs, as the journals engine builds it. `legId`
 * distinguishes the legs of two composites in the same test — a real journals engine never gives
 * two rows the same id — and `legOverrides` lets a caller close every leg (and, separately, the
 * composite itself via `overrides`) to build a bought-back condor.
 */
function condor(overrides: Partial<JournalRow> = {}, legOverrides: Partial<JournalRow> = {}, legId = "1"): JournalRow {
  const leg = (contract: ContractKey, quantity: number, openPrice: number) =>
    row({ id: `leg${contract.strike}#${legId}`, contract, strategy: "condors", kind: quantity < 0 ? (contract.right === "P" ? "short_put" : "short_call") : contract.right === "P" ? "long_put" : "long_call", quantity, openPrice, ...legOverrides });
  return row({
    id: "ic#1",
    strategy: "condors",
    kind: "condor",
    contract: { ticker: "SPY", secType: "OPT", right: "", strike: null, expiry: "2026-08-29", currency: "USD" },
    quantity: -1,
    legs: [leg(SPY("P", 620), 1, 0.3), leg(SPY("P", 625), -1, 0.6), leg(SPY("C", 660), -1, 0.5), leg(SPY("C", 665), 1, 0.3)],
    ...overrides,
  });
}

describe("strategyPositions — condors", () => {
  it("reads a condor on its legs: a composite has no right nor strike, so nothing prices it", () => {
    const snapshot = priced([
      option({ symbol: "SPY", right: "P", strike: 625, expiry: "2026-08-29", quantity: -1, marketPrice: 0.2, marketValue: -20 }),
      option({ symbol: "SPY", right: "P", strike: 620, expiry: "2026-08-29", quantity: 1, marketPrice: 0.1, marketValue: 10 }),
    ]);
    const { groups } = strategyPositions([condor()], "condors", snapshot);
    expect(groups.optionSells.map((line) => [line.contract.right, line.contract.strike, line.quantity])).toEqual([
      ["C", 660, -1],
      ["P", 625, -1],
    ]);
    expect(groups.optionBuys.map((line) => [line.contract.right, line.contract.strike, line.quantity])).toEqual([
      ["C", 665, 1],
      ["P", 620, 1],
    ]);
    // The sold put is priced from the snapshot; the sold call, absent from it, is not.
    const put = groups.optionSells.find((line) => line.contract.strike === 625)!;
    expect(put).toMatchObject({ lastPrice: 0.2, marketValue: -20, kind: "short_put" });
    expect(groups.optionSells.find((line) => line.contract.strike === 660)!.lastPrice).toBeNull();
    // No composite line anywhere: a condor is its legs.
    expect(groups.other).toEqual([]);
  });

  it("reads only the still-open composite of a partly bought-back condor", () => {
    const closeWhen = "2026-08-20T14:30:00.000Z";
    // The engine splits a partial buyback into two composites: `second`, closed (every leg and
    // the composite itself carry an `endWhen`), and `first`, still open. Only `first` should
    // count — a test that just summed two open composites would pass even without the
    // `endWhen !== null` guard in `linesByGroup`.
    const first = condor();
    const second = condor({ id: "ic#2", endWhen: closeWhen }, { endWhen: closeWhen }, "2");
    const { groups } = strategyPositions([first, second], "condors", null);
    expect(groups.optionSells.find((line) => line.contract.strike === 625)!.quantity).toBe(-1);
  });

  it("gives a sold leg the spread cover, and the wings their used badge", () => {
    const snapshot = priced([
      option({ symbol: "SPY", right: "P", strike: 625, expiry: "2026-08-29", quantity: -1, marketPrice: 0.2, marketValue: -20 }),
      option({ symbol: "SPY", right: "P", strike: 620, expiry: "2026-08-29", quantity: 1, marketPrice: 0.1, marketValue: 10 }),
    ]);
    const { groups } = strategyPositions([condor()], "condors", snapshot);
    const put = groups.optionSells.find((line) => line.contract.strike === 625)!;
    expect(put.coverage.map((allocation) => allocation.source)).toEqual(["spread"]);
    // The wing that covered it (pairLegs, coverage.ts) is marked used on its own IB position.
    const wing = groups.optionBuys.find((line) => line.contract.strike === 620)!;
    expect(wing.position!.usedQuantity).toBe(1);
  });
});

describe("strategyPositions — others", () => {
  it("splits what fits nowhere else into the four groups of the Positions page", () => {
    const rows = [
      row({ id: "a#1", strategy: "others", kind: "shares", contract: shares("AAPL"), quantity: 10, openPrice: 180 }),
      row({ id: "b#1", strategy: "others", kind: "short_call", contract: MARA_CALL, quantity: -1, openPrice: 0.5 }),
      row({ id: "c#1", strategy: "others", kind: "long_put", contract: XOM_PUT, quantity: 1, openPrice: 2 }),
      row({ id: "d#1", strategy: "others", kind: "short_shares", contract: shares("TSLA"), quantity: -5, openPrice: 300 }),
    ];
    const { groups, shares: wheelShares } = strategyPositions(rows, "others", null);
    expect(groups.long.map((line) => line.contract.ticker)).toEqual(["AAPL"]);
    expect(groups.optionBuys.map((line) => line.kind)).toEqual(["long_put"]);
    expect(groups.optionSells.map((line) => line.kind)).toEqual(["short_call"]);
    expect(groups.other.map((line) => [line.contract.ticker, line.kind])).toEqual([["TSLA", "short_stock"]]);
    expect(wheelShares).toEqual([]);
  });

  it("leaves a sold option of Others without an allocation: its cover is nothing at all", () => {
    // This unit test builds its lines by hand: it exercises the strategy filter alone, not which
    // journal the journals engine would file this call under (a Wheel call shares MQZA shares in
    // other tests above; here the point is only that Others reads none of a real allocation).
    const rows = [row({ id: "b#1", strategy: "others", kind: "short_call", contract: MARA_CALL, quantity: -1, openPrice: 0.5 })];
    const snapshot = priced([
      stock({ symbol: "MQZA", quantity: 100, marketPrice: 18, marketValue: 1800 }),
      option({ symbol: "MQZA", right: "C", strike: 20, expiry: "2026-11-20", quantity: -1, marketPrice: 0.25, marketValue: -25 }),
    ]);
    const sold = strategyPositions(rows, "others", snapshot).groups.optionSells[0];
    // The engine really allocates the stock as cover on the IB position...
    expect(sold.position!.allocations).toEqual([expect.objectContaining({ source: "stock" })]);
    // ...but strategyCoverSources("others") is empty with every strategy active, so Others reads
    // none of it: the filter, not an absent allocation, is what leaves this line's coverage empty.
    expect(sold.coverage).toEqual([]);
  });
});

describe("strategyPositions — wheel", () => {
  it("puts the Wheel's shares in `shares` and leaves its long group empty, so they show once", () => {
    const rows = [
      row({ id: "s#1", kind: "shares", contract: shares("MQZA"), quantity: 200, openPrice: 17 }),
      row({ id: "c#1", kind: "short_call", contract: MARA_CALL, quantity: -2, openPrice: 0.5 }),
    ];
    const { shares: holdings, groups } = strategyPositions(rows, "wheel", null);
    expect(holdings.map((holding) => holding.ticker)).toEqual(["MQZA"]);
    expect(groups.long).toEqual([]);
    expect(groups.optionSells).toHaveLength(1);
  });
});

const alloc = (source: CoverSource, quantity: number): CoverageAllocation => ({ source, quantity, detail: "" });
const shortsOf = (entries: [PositionsStrategy, number][]) => new Map<PositionsStrategy, number>(entries);

describe("migratedContracts", () => {
  it("migrates nothing when the engine says nothing is naked", () => {
    expect(migratedContracts(shortsOf([["wheel", 2]]), [alloc("stock", 2)], 0)).toEqual(new Map());
  });

  it("migrates the part of a Wheel call its own shares no longer cover", () => {
    expect(migratedContracts(shortsOf([["wheel", 2]]), [alloc("stock", 1)], 1)).toEqual(new Map([["wheel", 1]]));
  });

  it("counts what Others already holds against the naked total", () => {
    // IB holds 3 short: shares cover 2, one is naked — and that one is already Others' own line.
    expect(migratedContracts(shortsOf([["wheel", 2], ["others", 1]]), [alloc("stock", 2)], 1)).toEqual(new Map());
  });

  it("never migrates more than the engine calls naked, serving wheel before leaps", () => {
    // The journal is longer than the IB position: 4 contracts of journal, 2 of position, 1 naked.
    expect(migratedContracts(shortsOf([["wheel", 2], ["leaps", 2]]), [alloc("stock", 1)], 1)).toEqual(new Map([["wheel", 1]]));
  });

  it("leaves alone a line covered by a source that is not the strategy's own", () => {
    expect(migratedContracts(shortsOf([["wheel", 1]]), [alloc("leaps", 1)], 0)).toEqual(new Map());
  });

  it("migrates a whole line when nothing covers it", () => {
    expect(migratedContracts(shortsOf([["wheel", 1]]), [], 1)).toEqual(new Map([["wheel", 1]]));
  });

  it("migrates from the condors too", () => {
    expect(migratedContracts(shortsOf([["condors", 2]]), [alloc("spread", 1)], 1)).toEqual(new Map([["condors", 1]]));
  });
});

describe("strategyCoverSources", () => {
  it("gives each strategy its own sources, and Others those of the inactive strategies", () => {
    expect(strategyCoverSources("wheel")).toEqual(["cash", "stock"]);
    expect(strategyCoverSources("leaps", ["wheel"])).toEqual(["leaps"]);
    expect(strategyCoverSources("others")).toEqual([]);
    expect(strategyCoverSources("others", ["wheel"])).toEqual(["leaps", "spread"]);
    expect(strategyCoverSources("others", [])).toEqual(["cash", "stock", "leaps", "spread"]);
  });
});

describe("migratedContracts — Others covered", () => {
  it("only counts Others' naked part against what may migrate", () => {
    // Wheel holds 1 naked call, Others 1 call its (inactive) LEAPS cover: the engine calls 1 naked.
    expect(
      migratedContracts(shortsOf([["wheel", 1], ["others", 1]]), [alloc("leaps", 1)], 1, ["wheel"]),
    ).toEqual(new Map([["wheel", 1]]));
  });

  it("still counts every Others sale as naked when every strategy is active", () => {
    expect(migratedContracts(shortsOf([["wheel", 1], ["others", 1]]), [alloc("leaps", 1)], 1)).toEqual(new Map());
  });
});

describe("strategyPositions — Others reads the cover of an inactive strategy", () => {
  const LONG = opt("MQZA", "C", 15, "2027-06-18");
  const SHORT = opt("MQZA", "C", 20, "2026-10-16");
  const rows = [
    row({ id: "l#1", strategy: "others", contract: LONG, kind: "long_call", quantity: 1, openPrice: 3 }),
    row({ id: "s#1", strategy: "others", contract: SHORT, kind: "short_call", quantity: -1, openPrice: 0.5 }),
  ];
  const snapshot = priced([
    option({ symbol: "MQZA", right: "C", strike: 15, expiry: "2027-06-18", quantity: 1, avgPrice: 3, marketPrice: 4, marketValue: 400 }),
    option({ symbol: "MQZA", right: "C", strike: 20, expiry: "2026-10-16", quantity: -1, avgPrice: 0.5, marketPrice: 0.4, marketValue: -40 }),
  ]);

  it("puts the leaps allocation on the sold call once the LEAPS are inactive", () => {
    const sold = strategyPositions(rows, "others", snapshot, ["wheel"]).groups.optionSells[0];
    expect(sold.coverage.map((allocation) => [allocation.source, allocation.quantity])).toEqual([["leaps", 1]]);
  });

  it("puts none on it while the LEAPS are active", () => {
    expect(strategyPositions(rows, "others", snapshot).groups.optionSells[0].coverage).toEqual([]);
  });
});

describe("strategyPositions — Others takes the naked part in", () => {
  const othersSales = (rows: readonly JournalRow[], snapshot: PricedSnapshot | null) =>
    strategyPositions(rows, "others", snapshot).groups.optionSells;

  it("shows the contract the Wheel no longer covers, without saying where it comes from", () => {
    const { rows, snapshot } = nakedCallLedger();
    const sales = othersSales(rows, snapshot);
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({
      contract: MARA_CALL_15, kind: "short_call", label: "sell of call",
      quantity: -1, avgPrice: 0.7, lastPrice: 1, marketValue: -100, unrealizedPnl: -30,
    });
    expect(sales[0].coverage).toEqual([]);
  });

  it("melts what it already holds of the contract into one line, prices weighted", () => {
    const rows = [
      row({ id: "s#1", contract: shares("MQZA"), kind: "shares", quantity: 100, openPrice: 17, strike: null }),
      row({ id: "c#1", contract: MARA_CALL_15, kind: "short_call", quantity: -2, openPrice: 0.9 }),
      row({ id: "o#1", contract: MARA_CALL_15, strategy: "others", kind: "short_call", quantity: -1, openPrice: 0.3 }),
    ];
    const snapshot = priced([
      stock({ symbol: "MQZA", quantity: 100, avgPrice: 17, marketPrice: 18, marketValue: 1800 }),
      option({ symbol: "MQZA", right: "C", strike: 15, expiry: "2026-10-16", quantity: -3, marketPrice: 1, marketValue: -300 }),
    ]);
    const sales = othersSales(rows, snapshot);
    expect(sales).toHaveLength(1);
    // One contract of its own at 0.30, one taken over at the Wheel line's 0.90.
    expect(sales[0]).toMatchObject({ quantity: -2, avgPrice: 0.6 });
    expect(wheelPositions(rows, snapshot).optionSales[0].quantity).toBe(-1);
  });

  it("has no price when a contributing line has none", () => {
    const rows = [
      row({ id: "c#1", contract: MARA_CALL_15, kind: "short_call", quantity: -1, openPrice: null }),
      row({ id: "o#1", contract: MARA_CALL_15, strategy: "others", kind: "short_call", quantity: -1, openPrice: 0.3 }),
    ];
    const snapshot = priced([option({ symbol: "MQZA", right: "C", strike: 15, expiry: "2026-10-16", quantity: -2, marketPrice: 1, marketValue: -200 })]);
    expect(othersSales(rows, snapshot)[0]).toMatchObject({ quantity: -2, avgPrice: null, unrealizedPnl: null });
  });

  it("keeps its own lines untouched when nothing migrates", () => {
    const rows = [row({ id: "o#1", contract: MARA_CALL_15, strategy: "others", kind: "short_call", quantity: -1, openPrice: 0.3 })];
    const snapshot = priced([option({ symbol: "MQZA", right: "C", strike: 15, expiry: "2026-10-16", quantity: -1, marketPrice: 1, marketValue: -100 })]);
    expect(othersSales(rows, snapshot)[0]).toMatchObject({ quantity: -1, avgPrice: 0.3 });
  });

  it("takes in both strategies migrating on the same uncovered contract, one contribution each at its own price", () => {
    // Wheel −1 at 0.5, LEAPS −1 at 0.9, nothing covers either: contributionsTakenIn must push one
    // contribution per covered strategy still holding the contract, not stop after the first —
    // otherwise Others would under-report the quantity and the conservation invariant would break.
    const TWO_STRAT_CALL = opt("NFLX", "C", 30, "2026-12-18");
    const rows = [
      row({ contract: TWO_STRAT_CALL, kind: "short_call", quantity: -1, openPrice: 0.5 }),
      row({ id: "l#1", contract: TWO_STRAT_CALL, strategy: "leaps", kind: "short_call", quantity: -1, openPrice: 0.9 }),
    ];
    const snapshot = priced([option({ symbol: "NFLX", right: "C", strike: 30, expiry: "2026-12-18", quantity: -2, marketPrice: 1, marketValue: -200 })]);
    expect(othersSales(rows, snapshot)).toEqual([expect.objectContaining({ quantity: -2, avgPrice: 0.7 })]);
    expect(wheelPositions(rows, snapshot).optionSales).toEqual([]);
    expect(leapsPositions(rows, snapshot).optionSales).toEqual([]);
  });
});

describe("strategyPositions — the naked part leaves the strategy", () => {
  it("shows the Wheel only the contracts its shares still cover", () => {
    const { rows, snapshot } = nakedCallLedger();
    const { optionSales } = wheelPositions(rows, snapshot);
    expect(optionSales).toHaveLength(1);
    expect(optionSales[0]).toMatchObject({ quantity: -1, avgPrice: 0.7, lastPrice: 1, marketValue: -100, unrealizedPnl: -30 });
    expect(optionSales[0].coverage).toEqual([expect.objectContaining({ source: "stock", quantity: 1 })]);
  });

  it("drops the line entirely when nothing covers it any more", () => {
    const rows = [row({ id: "c#1", contract: MARA_CALL_15, kind: "short_call", quantity: -1, openPrice: 0.7 })];
    const snapshot = priced([option({ symbol: "MQZA", right: "C", strike: 15, expiry: "2026-10-16", quantity: -1, marketPrice: 1, marketValue: -100 })]);
    expect(wheelPositions(rows, snapshot).optionSales).toEqual([]);
  });

  it("caps a badge at the quantity the line shows", () => {
    // IB holds 2 short calls against 200 shares: stock ×2. The Wheel's line is one of them.
    const rows = [
      row({ id: "s#1", contract: shares("MQZA"), kind: "shares", quantity: 200, openPrice: 17, strike: null }),
      row({ id: "c#1", contract: MARA_CALL_15, kind: "short_call", quantity: -1, openPrice: 0.7 }),
      row({ id: "o#1", contract: MARA_CALL_15, strategy: "others", kind: "short_call", quantity: -1, openPrice: 0.7 }),
    ];
    const snapshot = priced([
      stock({ symbol: "MQZA", quantity: 200, avgPrice: 17, marketPrice: 18, marketValue: 3600 }),
      option({ symbol: "MQZA", right: "C", strike: 15, expiry: "2026-10-16", quantity: -2, marketPrice: 1, marketValue: -200 }),
    ]);
    const { optionSales } = wheelPositions(rows, snapshot);
    expect(optionSales[0].quantity).toBe(-1);
    expect(optionSales[0].coverage).toEqual([expect.objectContaining({ source: "stock", quantity: 1 })]);
  });

  it("never migrates a sold put: the engine always secures it with cash", () => {
    const rows = [row({ contract: XOM_PUT, quantity: -2, openPrice: 2 })];
    const snapshot = priced([option({ symbol: "XOM", right: "P", strike: 100, expiry: "2026-10-16", quantity: -2, marketPrice: 1.5, marketValue: -300 })]);
    expect(wheelPositions(rows, snapshot).optionSales[0].quantity).toBe(-2);
    expect(strategyPositions(rows, "others", snapshot).groups.optionSells).toEqual([]);
  });

  it("migrates nothing without a snapshot, nor on a contract the snapshot lacks", () => {
    const { rows } = nakedCallLedger();
    expect(wheelPositions(rows, null).optionSales[0].quantity).toBe(-2);
    const elsewhere = priced([stock({ symbol: "AAPL", quantity: 10 })]);
    expect(wheelPositions(rows, elsewhere).optionSales[0].quantity).toBe(-2);
  });

  it("leaves a long position alone", () => {
    const rows = [row({ id: "l#1", contract: opt("ZZZ", "C", 15, "2027-06-18"), strategy: "leaps", kind: "long_call", quantity: 1, openPrice: 3 })];
    const snapshot = priced([option({ symbol: "ZZZ", right: "C", strike: 15, expiry: "2027-06-18", quantity: 1, marketPrice: 4, marketValue: 400 })]);
    expect(strategyPositions(rows, "leaps", snapshot).groups.optionBuys[0].quantity).toBe(1);
  });
});
