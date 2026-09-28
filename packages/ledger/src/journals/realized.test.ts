import { describe, expect, it } from "vitest";
import { realizedOnDay } from "./realized.ts";
import type { JournalRow } from "./types.ts";

function row(overrides: Partial<JournalRow>): JournalRow {
  return {
    id: "x#1", strategy: "wheel", kind: "short_put", ticker: "MQZA", label: "MQZA", currency: "USD",
    contract: { ticker: "MQZA", secType: "OPT", right: "P", strike: 17, expiry: "2026-10-02", currency: "USD" },
    startWhen: "2026-08-01T14:30:00.000Z", quantity: -1, strike: 17,
    openPrice: 0.2, openTotal: 20, openCommission: -1, openNet: 19, assigned: false,
    endWhen: null, closePrice: null, closeTotal: null, closeCommission: null, closeNet: null, pnl: null,
    ongoing: true, event: null, orphan: false, note: null, openIds: [], closeIds: [], ...overrides,
  };
}

const closed = (endWhen: string, pnl: number | null, extra: Partial<JournalRow> = {}) =>
  row({ endWhen, pnl, ongoing: false, event: "buyback", ...extra });

describe("realizedOnDay", () => {
  it("sums the pnl of the lines closed that market day, across strategies, Others included", () => {
    const rows = [
      closed("2026-09-25T15:00:00.000Z", 200),
      closed("2026-09-25T10:00:00.000Z", 500, { strategy: "others", kind: "shares" }),
      closed("2026-09-24T15:00:00.000Z", 999),
    ];
    expect(realizedOnDay(rows, "2026-09-25")).toEqual([{ currency: "USD", total: 700, missing: 0, count: 2 }]);
  });

  it("never counts a line opened that day: a premium received realizes nothing", () => {
    expect(realizedOnDay([row({ startWhen: "2026-09-25T15:00:00.000Z" })], "2026-09-25")).toEqual([]);
  });

  it("counts an assignment stamped Saturday 01:02 on the Friday it belongs to", () => {
    const rows = [closed("2026-09-26T01:02:00.000Z", 150, { event: "assigned" })];
    expect(realizedOnDay(rows, "2026-09-25")).toEqual([{ currency: "USD", total: 150, missing: 0, count: 1 }]);
  });

  it("counts a line without pnl as missing, total null when none has one", () => {
    expect(realizedOnDay([closed("2026-09-25T15:00:00.000Z", null)], "2026-09-25")).toEqual([
      { currency: "USD", total: null, missing: 1, count: 1 },
    ]);
    expect(realizedOnDay([closed("2026-09-25T15:00:00.000Z", null), closed("2026-09-25T16:00:00.000Z", 10)], "2026-09-25")).toEqual([
      { currency: "USD", total: 10, missing: 1, count: 2 },
    ]);
  });

  it("counts a condor once, on the day its composite closes", () => {
    const condor = closed("2026-09-25T15:00:00.000Z", 120, { strategy: "condors", kind: "condor" });
    expect(realizedOnDay([condor], "2026-09-25")).toEqual([{ currency: "USD", total: 120, missing: 0, count: 1 }]);
  });

  it("keeps one entry per currency, sorted by code", () => {
    const rows = [closed("2026-09-25T15:00:00.000Z", 5, { currency: "USD" }), closed("2026-09-25T15:00:00.000Z", 3, { currency: "EUR" })];
    expect(realizedOnDay(rows, "2026-09-25").map((t) => t.currency)).toEqual(["EUR", "USD"]);
  });
});
