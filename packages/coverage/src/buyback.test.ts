import { describe, expect, it } from "vitest";
import type { JournalRow } from "@ib/ledger";
import { averageSaleInstant, evaluateBuyback, saleInstants } from "./buyback.ts";

// Sold 2026-09-01 16:00, expiry 2026-10-01 16:00: T = 30 days.
const timing = (asOf: string) => ({ soldAt: "2026-09-01T16:00:00.000Z", expiry: "2026-10-01", asOf });

describe("evaluateBuyback", () => {
  it("with 10 days left of 30, a 30 sale buys back at 10 and no higher", () => {
    const at = "2026-09-21T16:00:00.000Z";
    expect(evaluateBuyback(30, 10, timing(at))).toEqual({ decision: "buy back", threshold: 10, remainingDays: 10, totalDays: 30 });
    expect(evaluateBuyback(30, 10.01, timing(at)).decision).toBe("keep");
  });

  it("keeps 40% of the premium at 3 days from expiry", () => {
    const advice = evaluateBuyback(30, 12, timing("2026-09-28T16:00:00.000Z"));
    expect(advice.decision).toBe("keep");
    expect(advice.threshold).toBeCloseTo(3, 10);
  });

  it("caps the threshold at half the sale in the first half of the life", () => {
    const advice = evaluateBuyback(30, 15, timing("2026-09-06T16:00:00.000Z")); // 25 days left
    expect(advice).toEqual({ decision: "buy back", threshold: 15, remainingDays: 25, totalDays: 30 });
  });

  it("switches to the time rule at mid-life", () => {
    expect(evaluateBuyback(30, 15, timing("2026-09-16T16:00:00.000Z")).threshold).toBe(15);
    expect(evaluateBuyback(30, 15, timing("2026-09-17T16:00:00.000Z")).decision).toBe("keep");
  });

  it("reads a day-only asOf as that day's 16:00 close", () => {
    expect(evaluateBuyback(30, 10, timing("2026-09-21"))).toEqual({ decision: "buy back", threshold: 10, remainingDays: 10, totalDays: 30 });
  });

  it("keeps an option expired at the price's instant, even at 0", () => {
    expect(evaluateBuyback(30, 0, timing("2026-10-01"))).toEqual({ decision: "keep", threshold: 0, remainingDays: 0, totalDays: 30 });
    expect(evaluateBuyback(30, 0, timing("2026-10-02")).decision).toBe("keep");
  });

  it("falls back to the 50% rule without timing, or with incoherent dates", () => {
    const half = { decision: "buy back", threshold: 15, remainingDays: null, totalDays: null };
    expect(evaluateBuyback(30, 15, null)).toEqual(half);
    expect(evaluateBuyback(30, 15, { soldAt: "2026-10-02T10:00:00.000Z", expiry: "2026-10-01", asOf: "2026-10-01" })).toEqual(half); // T <= 0
    expect(evaluateBuyback(30, 15, timing("2026-08-30T10:00:00.000Z"))).toEqual(half); // asOf before the sale
    expect(evaluateBuyback(30, 15, { soldAt: "nonsense", expiry: "2026-10-01", asOf: "2026-09-21" })).toEqual(half);
  });

  it("uses absolute prices and keeps a zero sale", () => {
    expect(evaluateBuyback(-30, -10, timing("2026-09-21T16:00:00.000Z")).decision).toBe("buy back");
    expect(evaluateBuyback(0, 0, null)).toEqual({ decision: "keep", threshold: 0, remainingDays: null, totalDays: null });
  });
});

describe("averageSaleInstant", () => {
  it("weights each sale by its unsigned quantity", () => {
    expect(
      averageSaleInstant([
        { when: "2026-09-01T00:00:00.000Z", quantity: -1 },
        { when: "2026-09-05T00:00:00.000Z", quantity: -3 },
      ]),
    ).toBe("2026-09-04T00:00:00.000Z");
  });

  it("is null for nothing to weigh", () => {
    expect(averageSaleInstant([])).toBeNull();
    expect(averageSaleInstant([{ when: "2026-09-01T00:00:00.000Z", quantity: 0 }])).toBeNull();
  });
});

describe("saleInstants", () => {
  const contract = (right: "C" | "P", strike: number) => ({ ticker: "SPY", secType: "OPT", right, strike, expiry: "2026-10-16", currency: "USD" });
  const row = (over: Partial<JournalRow>): JournalRow =>
    ({ id: "r", strategy: "wheel", kind: "short_put", ticker: "SPY", label: "", currency: "USD", contract: contract("P", 600),
       startWhen: "2026-09-01T10:00:00.000Z", quantity: -1, strike: 600, openPrice: 1, openTotal: null, openCommission: null,
       openNet: null, assigned: false, endWhen: null, closePrice: null, closeTotal: null, closeCommission: null, closeNet: null,
       pnl: null, ongoing: true, event: null, orphan: false, note: null, openIds: [], closeIds: [], ...over }) as JournalRow;

  it("averages the open sold option lines of every strategy by contract", () => {
    const map = saleInstants([
      row({ id: "a", strategy: "wheel", startWhen: "2026-09-01T00:00:00.000Z", quantity: -1 }),
      row({ id: "b", strategy: "others", startWhen: "2026-09-03T00:00:00.000Z", quantity: -1 }),
      row({ id: "closed", endWhen: "2026-09-02T00:00:00.000Z", startWhen: "2026-08-01T00:00:00.000Z" }),
      row({ id: "long", kind: "long_call", contract: contract("C", 700), quantity: 1 }),
    ]);
    expect([...map.entries()]).toEqual([[expect.any(String), "2026-09-02T00:00:00.000Z"]]);
  });

  it("reads a condor's sold legs, never its composite", () => {
    const leg = row({ id: "leg", strategy: "condors", kind: "short_call", contract: contract("C", 660), startWhen: "2026-09-10T00:00:00.000Z" });
    const composite = row({ id: "ic", strategy: "condors", kind: "condor", contract: { ...contract("C", 0), right: "", strike: null }, legs: [leg] });
    expect([...saleInstants([composite]).values()]).toEqual(["2026-09-10T00:00:00.000Z"]);
  });
});
