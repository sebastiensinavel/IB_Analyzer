import { describe, expect, it } from "vitest";
import { computeStats, monthsBetween } from "./stats.ts";
import type { JournalRow } from "./types.ts";

function row(overrides: Partial<JournalRow>): JournalRow {
  return {
    id: "x#1", strategy: "wheel", kind: "short_put", ticker: "MQZA", label: "MQZA", currency: "USD",
    contract: { ticker: "MQZA", secType: "OPT", right: "P", strike: 17, expiry: "2026-10-02", currency: "USD" },
    startWhen: "2026-08-01T14:30:00.000Z", quantity: -1,
    strike: 17,
    openPrice: 0.2, openTotal: 20, openCommission: -1, openNet: 19, assigned: false,
    endWhen: null, closePrice: null, closeTotal: null, closeCommission: null, closeNet: null, pnl: null, ongoing: true, event: null, orphan: false, note: null,
    openIds: [], closeIds: [], ...overrides,
  };
}

describe("monthsBetween", () => {
  it("lists every month from the first to the last, inclusive, across a year end", () => {
    expect(monthsBetween("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(monthsBetween("2026-08", "2026-08")).toEqual(["2026-08"]);
  });
});

describe("computeStats", () => {
  it("counts a premium the month it is received and a buyback the month it is paid, months in between at zero", () => {
    const stats = computeStats([row({ endWhen: "2026-10-10T15:00:00.000Z", closeTotal: -5, closeCommission: -1, closeNet: -6, pnl: 13, ongoing: false, event: "buyback" })], ["wheel"], null);
    expect(stats).toEqual([{ currency: "USD", total: 13, months: [{ month: "2026-08", pnl: 19 }, { month: "2026-09", pnl: 0 }, { month: "2026-10", pnl: -6 }], incomplete: 0 }]);
  });

  it("counts an open position's premium already", () => {
    expect(computeStats([row({})], ["wheel"], null)).toEqual([{ currency: "USD", total: 19, months: [{ month: "2026-08", pnl: 19 }], incomplete: 0 }]);
  });

  it("counts delivered shares at their sale only, never at the delivery", () => {
    const held = row({ kind: "shares", assigned: true, quantity: 100, startWhen: "2026-09-01T20:00:00.000Z", openTotal: -1700, openCommission: 0, openNet: -1700 });
    expect(computeStats([held], ["wheel"], null)).toEqual([{ currency: "USD", total: 0, months: [], incomplete: 0 }]);
    const sold = row({ ...held, endWhen: "2026-11-15T15:00:00.000Z", closeTotal: 1800, closeCommission: -1, closeNet: 1799, pnl: 99, ongoing: false, event: "sold" });
    expect(computeStats([sold], ["wheel"], null)).toEqual([{ currency: "USD", total: 99, months: [{ month: "2026-11", pnl: 99 }], incomplete: 0 }]);
  });

  it("counts shares the Wheel took over at their sale, though nothing was assigned", () => {
    const taken = row({
      kind: "shares", assigned: false, quantity: 100, startWhen: "2026-08-03T14:30:00.000Z",
      openTotal: -2000, openCommission: 0, openNet: -2000,
      note: { code: "takenOverAtStrike", contract: "MQZA Sep18'26 20 Call" },
    });
    expect(computeStats([taken], ["wheel"], null)).toEqual([{ currency: "USD", total: 0, months: [], incomplete: 0 }]);
    const sold = row({ ...taken, endWhen: "2026-09-01T14:30:00.000Z", closeTotal: 2500, closeCommission: -1, closeNet: 2499, pnl: 499, ongoing: false, event: "sold" });
    expect(computeStats([sold], ["wheel"], null)).toEqual([{ currency: "USD", total: 499, months: [{ month: "2026-09", pnl: 499 }], incomplete: 0 }]);
  });

  it("counts a condor like an option and a LEAPS purchase like delivered shares: nothing until the sale", () => {
    const condor = row({ strategy: "condors", kind: "condor", openNet: 46, endWhen: "2026-08-29T20:00:00.000Z", closeNet: 0, pnl: 46, ongoing: false, event: "expired" });
    expect(computeStats([condor], ["condors"], null)[0]).toMatchObject({ total: 46, months: [{ month: "2026-08", pnl: 46 }] });
    const leaps = row({ strategy: "leaps", kind: "long_call", quantity: 1, openTotal: -300, openCommission: -1, openNet: -301 });
    expect(computeStats([leaps], ["leaps"], null)).toEqual([{ currency: "USD", total: 0, months: [], incomplete: 0 }]);
    const soldLeaps = row({ ...leaps, endWhen: "2026-12-01T15:00:00.000Z", closeNet: 399, pnl: 98, ongoing: false, event: "sold" });
    expect(computeStats([soldLeaps], ["leaps"], null)[0]).toMatchObject({ total: 98, months: [{ month: "2026-12", pnl: 98 }] });
  });

  it("keeps currencies apart and in order, and ignores other strategies", () => {
    const stats = computeStats([row({ currency: "USD" }), row({ id: "y#1", currency: "EUR", openNet: 5 }), row({ id: "z#1", strategy: "others" })], ["wheel"], null);
    expect(stats.map((s) => [s.currency, s.total])).toEqual([["EUR", 5], ["USD", 19]]);
  });

  it("skips and counts a contribution without an amount", () => {
    const stats = computeStats([row({ openTotal: null, openNet: null }), row({ id: "y#1" })], ["wheel"], null);
    expect(stats).toEqual([{ currency: "USD", total: 19, months: [{ month: "2026-08", pnl: 19 }], incomplete: 1 }]);
  });

  it("runs the months on to the month of the ledger's last transaction, at zero", () => {
    expect(computeStats([row({})], ["wheel"], "2026-10-15T15:00:00.000Z")[0].months).toEqual([
      { month: "2026-08", pnl: 19 },
      { month: "2026-09", pnl: 0 },
      { month: "2026-10", pnl: 0 },
    ]);
  });

  it("never cuts the months short of the last flow when the last transaction is older", () => {
    expect(computeStats([row({})], ["wheel"], "2026-07-01T00:00:00.000Z")[0].months).toEqual([{ month: "2026-08", pnl: 19 }]);
  });

  it("adds no month to a strategy that has no flow yet", () => {
    const held = row({ kind: "shares", strike: null, assigned: true, quantity: 100, openTotal: -1700, openCommission: 0, openNet: -1700 });
    expect(computeStats([held], ["wheel"], "2026-10-15T15:00:00.000Z")).toEqual([{ currency: "USD", total: 0, months: [], incomplete: 0 }]);
  });

  it("counts several strategies at once: months from the first flow of any, each total summed, never Others", () => {
    const rows = [
      row({}),
      row({ id: "y#1", strategy: "leaps", kind: "short_call", startWhen: "2026-06-10T14:30:00.000Z", openNet: 49 }),
      row({ id: "z#1", strategy: "condors", kind: "condor", strike: null, startWhen: "2026-09-03T14:30:00.000Z", openNet: 46 }),
      row({ id: "o#1", strategy: "others", kind: "short_call", openNet: 500 }),
    ];
    const [all] = computeStats(rows, ["wheel", "leaps", "condors"], null);
    expect(all).toEqual({
      currency: "USD",
      total: 114,
      months: [
        { month: "2026-06", pnl: 49 },
        { month: "2026-07", pnl: 0 },
        { month: "2026-08", pnl: 19 },
        { month: "2026-09", pnl: 46 },
      ],
      incomplete: 0,
    });
    const each = (["wheel", "leaps", "condors"] as const).map((strategy) => computeStats(rows, [strategy], null)[0].total);
    expect(all.total).toBe(each.reduce((n, total) => n + total, 0));
  });
});
