import { describe, expect, it } from "vitest";
import { computeCapital, nextMonthStart } from "./capital.ts";
import type { JournalRow, MonthPnl, RowKind, StatsStrategy, StrategyStats } from "./types.ts";

/** A Wheel put: two MQZA 17 puts sold on 2026-08-03, still open. */
function row(overrides: Partial<JournalRow>): JournalRow {
  return {
    id: "x#1", strategy: "wheel", kind: "short_put", ticker: "MQZA", label: "MQZA", currency: "USD",
    contract: { ticker: "MQZA", secType: "OPT", right: "P", strike: 17, expiry: "2026-10-02", currency: "USD" },
    startWhen: "2026-08-03T14:30:00.000Z", quantity: -2, strike: 17,
    openPrice: 0.21, openTotal: 42, openCommission: -1, openNet: 41, assigned: false,
    endWhen: null, closePrice: null, closeTotal: null, closeCommission: null, closeNet: null, pnl: null, ongoing: true, event: null, orphan: false, note: null,
    openIds: [], closeIds: [], ...overrides,
  };
}

/** Wheel shares: 200 MQZA delivered at 17, still held. */
function shares(overrides: Partial<JournalRow>): JournalRow {
  return row({ kind: "shares", strike: null, quantity: 200, openPrice: 17, openTotal: -3400, openCommission: 0, openNet: -3400, assigned: true, ...overrides });
}

/** A LEAPS: one ZZZ 15 call bought at 3 on 2026-08-03, still open. */
function leaps(overrides: Partial<JournalRow>): JournalRow {
  return row({ strategy: "leaps", kind: "long_call", ticker: "ZZZ", quantity: 1, strike: 15, openPrice: 3, openTotal: -300, openCommission: -1, openNet: -301, ...overrides });
}

function leg(kind: RowKind, strike: number | null): JournalRow {
  return row({ strategy: "condors", kind, ticker: "SPY", strike, quantity: kind === "long_put" || kind === "long_call" ? 2 : -2 });
}

/** Two SPY condors sold on 2026-08-03, still open: puts 620/625, 5 wide, calls 660/670, 10 wide. */
function condor(overrides: Partial<JournalRow>): JournalRow {
  return row({
    strategy: "condors", kind: "condor", ticker: "SPY", strike: null, quantity: -2, openPrice: 0.5, openTotal: 100, openCommission: -8, openNet: 92,
    legs: [leg("long_put", 620), leg("short_put", 625), leg("short_call", 660), leg("long_call", 670)],
    ...overrides,
  });
}

function stats(months: MonthPnl[], currency = "USD"): StrategyStats {
  return { currency, total: months.reduce((n, m) => n + m.pnl, 0), months, incomplete: 0 };
}

const AUG_SEP: MonthPnl[] = [
  { month: "2026-08", pnl: 41 },
  { month: "2026-09", pnl: 99 },
];

const WHEEL = ["wheel"] as const;

describe("nextMonthStart", () => {
  it("gives the first day of the following month, across a year end", () => {
    expect(nextMonthStart("2026-08")).toBe("2026-09-01");
    expect(nextMonthStart("2026-12")).toBe("2027-01-01");
  });
});

describe("computeCapital — the Wheel", () => {
  it("counts a put sold at strike × 100 × contracts at every month end it is still open", () => {
    const [usd] = computeCapital([row({})], WHEEL, [stats(AUG_SEP)]);
    expect(usd.months.map((m) => [m.month, m.putCash, m.assigned, m.allocated])).toEqual([
      ["2026-08", 3400, 0, 3400],
      ["2026-09", 3400, 0, 3400],
    ]);
  });

  it("counts nothing at the end of the month for a put bought back before it, yet returns that month on the put's money", () => {
    const bought = row({ endWhen: "2026-08-20T15:00:00.000Z", ongoing: false, event: "buyback" });
    const [usd] = computeCapital([bought], WHEEL, [stats([{ month: "2026-08", pnl: 30 }, { month: "2026-09", pnl: 0 }])]);
    expect(usd.months).toEqual([
      { month: "2026-08", cumulativePnl: 30, assigned: 0, putCash: 0, leaps: 0, condors: 0, allocated: 0, invested: -30, returnRate: 30 / 3400 },
      { month: "2026-09", cumulativePnl: 30, assigned: 0, putCash: 0, leaps: 0, condors: 0, allocated: 0, invested: -30, returnRate: null },
    ]);
  });

  it("still counts a put closed at the very first instant of the next month", () => {
    const bought = row({ endWhen: "2026-09-01T00:00:00.000Z", ongoing: false, event: "buyback" });
    const [usd] = computeCapital([bought], WHEEL, [stats([{ month: "2026-08", pnl: 41 }, { month: "2026-09", pnl: 0 }])]);
    expect(usd.months.map((m) => m.putCash)).toEqual([3400, 0]);
  });

  it("moves an assigned put's money from the puts to the shares the month of the assignment, never both", () => {
    // The engine keeps an assigned put ongoing until its shares are sold: only endWhen may be read.
    const put = row({ endWhen: "2026-09-15T20:00:00.000Z", closePrice: 0, closeTotal: 0, closeNet: 0, pnl: 41, event: "assigned", assigned: true, ongoing: true });
    const held = shares({ id: "y#1", startWhen: "2026-09-15T20:00:00.000Z", endWhen: "2026-11-10T15:00:00.000Z", ongoing: false, event: "sold" });
    const months = [
      { month: "2026-08", pnl: 41 },
      { month: "2026-09", pnl: 34 },
      { month: "2026-10", pnl: 0 },
      { month: "2026-11", pnl: 199 },
    ];
    const [usd] = computeCapital([put, held], WHEEL, [stats(months)]);
    expect(usd.months.map((m) => [m.month, m.putCash, m.assigned])).toEqual([
      ["2026-08", 3400, 0],
      ["2026-09", 0, 3400],
      ["2026-10", 0, 3400],
      ["2026-11", 0, 0],
    ]);
    // The put ends at the very instant its shares start: September's peak is 3,400, not 6,800.
    expect(usd.months.map((m) => m.returnRate)).toEqual([41 / 3400, 34 / 3400, 0, 199 / 3400]);
    expect(usd.exposure).toEqual([]);
  });

  it("counts shares the Wheel took over at the strike of the call that took them", () => {
    const taken = shares({ quantity: 100, openPrice: 20, openTotal: -2000, openNet: -2000, assigned: false, note: { code: "takenOverAtStrike", contract: "MQZA Sep18'26 20 Call" } });
    const [usd] = computeCapital([taken], WHEEL, [stats(AUG_SEP)]);
    expect(usd.months.map((m) => m.assigned)).toEqual([2000, 2000]);
  });

  it("counts only the shares still held after a partial sale", () => {
    const sold = shares({ quantity: 100, openTotal: -1700, openNet: -1700, endWhen: "2026-09-10T15:00:00.000Z", ongoing: false, event: "sold" });
    const kept = shares({ id: "x#2", quantity: 100, openTotal: -1700, openNet: -1700 });
    const [usd] = computeCapital([sold, kept], WHEEL, [stats(AUG_SEP)]);
    expect(usd.months.map((m) => m.assigned)).toEqual([3400, 1700]);
  });

  it("accumulates the P/L, derives the cash invested and the monthly return on the money tied up", () => {
    const [usd] = computeCapital([row({})], WHEEL, [stats(AUG_SEP)]);
    expect(usd.months).toEqual([
      { month: "2026-08", cumulativePnl: 41, assigned: 0, putCash: 3400, leaps: 0, condors: 0, allocated: 3400, invested: 3359, returnRate: 41 / 3400 },
      { month: "2026-09", cumulativePnl: 140, assigned: 0, putCash: 3400, leaps: 0, condors: 0, allocated: 3400, invested: 3260, returnRate: 99 / 3400 },
    ]);
  });

  it("leaves out and counts a line whose amount cannot be computed", () => {
    const rows = [row({ strike: null }), shares({ id: "y#1", openPrice: null }), row({ id: "z#1", strike: 20, quantity: -1 })];
    const [usd] = computeCapital(rows, WHEEL, [stats(AUG_SEP)]);
    expect(usd.incomplete).toBe(2);
    expect(usd.months.map((m) => m.allocated)).toEqual([2000, 2000]);
  });

  it("sums the lines still open per ticker, sorted, and ignores calls and other strategies", () => {
    const rows = [
      row({ ticker: "XOM", strike: 110, quantity: -1 }),
      shares({ id: "a#1" }),
      row({ id: "b#1", strike: 15, quantity: -1 }),
      row({ id: "c#1", ticker: "ZZZ", endWhen: "2026-08-20T15:00:00.000Z", ongoing: false, event: "buyback" }),
      row({ id: "d#1", ticker: "ZZZ", kind: "short_call", strike: 20, quantity: -1 }),
      leaps({ id: "e#1", ticker: "LLL" }),
      shares({ id: "f#1", ticker: "AAPL", strategy: "others", assigned: false }),
    ];
    const [usd] = computeCapital(rows, WHEEL, [stats(AUG_SEP)]);
    expect(usd.exposure).toEqual([
      { ticker: "MQZA", assigned: 3400, putCash: 1500, leaps: 0, condors: 0 },
      { ticker: "XOM", assigned: 0, putCash: 11000, leaps: 0, condors: 0 },
    ]);
  });

  it("gives one entry per currency of the statistics, each counting its own lines", () => {
    const rows = [row({}), row({ id: "y#1", currency: "EUR", ticker: "SAP", strike: 50, quantity: -1 })];
    const capital = computeCapital(rows, WHEEL, [stats(AUG_SEP, "EUR"), stats(AUG_SEP)]);
    expect(capital.map((c) => [c.currency, c.months[0].putCash])).toEqual([
      ["EUR", 5000],
      ["USD", 3400],
    ]);
  });
});

describe("computeCapital — LEAPS", () => {
  it("counts a LEAPS at its purchase price × 100 × contracts while it is open, and a call sold against it at nothing", () => {
    const bought = leaps({ quantity: 2, openTotal: -600, openNet: -602, endWhen: "2026-09-10T15:00:00.000Z", closeNet: 799, pnl: 197, ongoing: false, event: "sold" });
    const sold = leaps({ id: "y#1", kind: "short_call", strike: 20, quantity: -1, openPrice: 0.5, openTotal: 50, openNet: 49 });
    const [usd] = computeCapital([bought, sold], ["leaps"], [stats(AUG_SEP)]);
    expect(usd.months.map((m) => [m.month, m.leaps, m.allocated])).toEqual([
      ["2026-08", 600, 600],
      ["2026-09", 0, 0],
    ]);
  });

  it("moves an exercised LEAPS from its purchase price to the strike of its shares the month of the exercise, never both", () => {
    const exercised = leaps({ endWhen: "2026-09-15T20:00:00.000Z", closePrice: 0, closeTotal: 0, closeNet: 0, pnl: -301, event: "exercised", assigned: true, ongoing: true });
    const held = shares({ id: "y#1", strategy: "leaps", ticker: "ZZZ", quantity: 100, openPrice: 15, openTotal: -1500, openNet: -1500, startWhen: "2026-09-15T20:00:00.000Z" });
    const [usd] = computeCapital([exercised, held], ["leaps"], [stats(AUG_SEP)]);
    expect(usd.months.map((m) => [m.month, m.leaps, m.assigned])).toEqual([
      ["2026-08", 300, 0],
      ["2026-09", 1500, 0],
    ]);
    expect(usd.exposure).toEqual([{ ticker: "ZZZ", assigned: 0, putCash: 0, leaps: 1500, condors: 0 }]);
  });

  it("leaves out and counts a LEAPS without a price", () => {
    expect(computeCapital([leaps({ openPrice: null })], ["leaps"], [stats(AUG_SEP)])[0].incomplete).toBe(1);
  });
});

describe("computeCapital — Condors", () => {
  it("counts a condor at its worst wing × 100 × contracts, credit not deducted, until its last leg closes", () => {
    const closed = condor({ endWhen: "2026-09-18T20:00:00.000Z", closeTotal: 0, closeCommission: 0, closeNet: 0, pnl: 92, ongoing: false, event: "expired" });
    const [usd] = computeCapital([closed], ["condors"], [stats(AUG_SEP)]);
    expect(usd.months.map((m) => [m.month, m.condors, m.allocated])).toEqual([
      ["2026-08", 2000, 2000],
      ["2026-09", 0, 0],
    ]);
  });

  it("returns a month's loss on the condor closed during it, though nothing is open at its end", () => {
    const stopped = condor({ endWhen: "2026-09-10T15:00:00.000Z", closeTotal: -400, closeCommission: -8, closeNet: -408, pnl: -316, ongoing: false, event: "buyback" });
    const [usd] = computeCapital([stopped], ["condors"], [stats([{ month: "2026-08", pnl: 92 }, { month: "2026-09", pnl: -408 }])]);
    expect(usd.months.map((m) => [m.month, m.allocated, m.returnRate])).toEqual([
      ["2026-08", 2000, 92 / 2000],
      ["2026-09", 0, -408 / 2000],
    ]);
  });

  it("returns a month on the most money its condors tied up at once, never their sum nor its month end", () => {
    // One condor, then a second after it closes, then a third opened while the second is still open.
    const first = condor({ endWhen: "2026-08-10T15:00:00.000Z", ongoing: false, event: "buyback" });
    const second = condor({ id: "y#1", startWhen: "2026-08-12T14:30:00.000Z", endWhen: "2026-08-20T15:00:00.000Z", ongoing: false, event: "buyback" });
    const third = condor({ id: "z#1", startWhen: "2026-08-17T14:30:00.000Z" });
    const [usd] = computeCapital([first, second, third], ["condors"], [stats([{ month: "2026-08", pnl: 100 }])]);
    expect(usd.months).toMatchObject([{ allocated: 2000, returnRate: 100 / 4000 }]);
  });

  it("takes whichever wing is wider, the put wing as well as the call wing", () => {
    const widePut = condor({ legs: [leg("long_put", 610), leg("short_put", 625), leg("short_call", 660), leg("long_call", 670)] });
    const [usd] = computeCapital([widePut], ["condors"], [stats(AUG_SEP)]);
    expect(usd.months[0].condors).toBe(3000);
    expect(usd.exposure).toEqual([{ ticker: "SPY", assigned: 0, putCash: 0, leaps: 0, condors: 3000 }]);
  });

  it("leaves out and counts a condor without its legs or without a strike on one of them", () => {
    const rows = [
      condor({ legs: undefined }),
      condor({ id: "y#1", legs: [leg("long_put", null), leg("short_put", 625), leg("short_call", 660), leg("long_call", 670)] }),
      condor({ id: "z#1" }),
    ];
    const [usd] = computeCapital(rows, ["condors"], [stats(AUG_SEP)]);
    expect(usd.incomplete).toBe(2);
    expect(usd.months[0].condors).toBe(2000);
  });
});

describe("computeCapital — scopes", () => {
  it("counts a line only in the scopes that read its strategy, the portfolio every measure at once", () => {
    const rows = [row({}), leaps({ id: "b#1" }), condor({ id: "c#1" }), shares({ id: "d#1", strategy: "others", ticker: "AAPL", assigned: false })];
    const first = (strategies: readonly StatsStrategy[]) => computeCapital(rows, strategies, [stats(AUG_SEP)])[0].months[0];
    expect(first(["wheel"])).toMatchObject({ assigned: 0, putCash: 3400, leaps: 0, condors: 0, allocated: 3400 });
    expect(first(["leaps"])).toMatchObject({ assigned: 0, putCash: 0, leaps: 300, condors: 0, allocated: 300 });
    expect(first(["condors"])).toMatchObject({ assigned: 0, putCash: 0, leaps: 0, condors: 2000, allocated: 2000 });
    expect(first(["wheel", "leaps", "condors"])).toMatchObject({ assigned: 0, putCash: 3400, leaps: 300, condors: 2000, allocated: 5700, returnRate: 41 / 5700 });
  });
});
