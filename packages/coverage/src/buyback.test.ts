import { describe, expect, it } from "vitest";
import type { JournalRow } from "@ib/ledger";
import { averageSaleInstant, evaluateBuyback, saleInstants } from "./buyback.ts";

// Sold 2026-09-01 16:00, expiry 2026-10-01 16:00: T = 30 days.
const timing = (asOf: string) => ({ soldAt: "2026-09-01T16:00:00.000Z", expiry: "2026-10-01", asOf });

describe("evaluateBuyback", () => {
  // Threshold: min(0.4 × S, S × r / (1.2 × T) − 0.01 × legs).
  it("with 10 days left of 30, a 30 sale buys back at 30 × 10 / 36 − 0.01 and no higher", () => {
    const advice = evaluateBuyback(30, 8.32, timing("2026-09-21T16:00:00.000Z"));
    expect(advice).toMatchObject({ decision: "buy back", remainingDays: 10, totalDays: 30 });
    expect(advice.threshold).toBeCloseTo(30 * 10 / 36 - 0.01, 10);
    expect(evaluateBuyback(30, 8.33, timing("2026-09-21T16:00:00.000Z")).decision).toBe("keep");
  });

  it("keeps 40% of the premium at 3 days from expiry", () => {
    const advice = evaluateBuyback(30, 12, timing("2026-09-28T16:00:00.000Z"));
    expect(advice.decision).toBe("keep");
    expect(advice.threshold).toBeCloseTo(30 * 3 / 36 - 0.01, 10);
  });

  it("caps the threshold at 40% of the sale early in the life", () => {
    const advice = evaluateBuyback(30, 12, timing("2026-09-06T16:00:00.000Z")); // 25 days left
    expect(advice).toEqual({ decision: "buy back", threshold: 12, remainingDays: 25, totalDays: 30 });
    expect(evaluateBuyback(30, 12.01, timing("2026-09-06T16:00:00.000Z")).decision).toBe("keep");
  });

  it("switches to the time rule once the rest earns less than the sale's pace over 1.2", () => {
    expect(evaluateBuyback(30, 12, timing("2026-09-16T16:00:00.000Z")).threshold).toBe(12); // 15 days left
    expect(evaluateBuyback(30, 12, timing("2026-09-17T16:00:00.000Z")).decision).toBe("keep"); // 14 days left
  });

  it("still buys back a cheap remainder the day before expiry", () => {
    const advice = evaluateBuyback(30, 0.8, timing("2026-09-30T16:00:00.000Z"));
    expect(advice.decision).toBe("buy back");
    expect(advice.threshold).toBeCloseTo(30 / 36 - 0.01, 10);
  });

  it("counts the commission against a penny premium, and never buys back when it eats the gain", () => {
    expect(evaluateBuyback(0.05, 0.02, timing("2026-09-21T16:00:00.000Z")).decision).toBe("keep");
    expect(evaluateBuyback(0.05, 0.003, timing("2026-09-21T16:00:00.000Z")).decision).toBe("buy back");
    // 6 days left: 0.05 × 6 / 36 < 0.01, nothing to gain even at 0.
    expect(evaluateBuyback(0.05, 0, timing("2026-09-25T16:00:00.000Z"))).toMatchObject({ decision: "keep", threshold: 0 });
  });

  it("pays one commission per leg", () => {
    const at = timing("2026-09-21T16:00:00.000Z");
    expect(evaluateBuyback(30, 8.3, at, 4).threshold).toBeCloseTo(30 * 10 / 36 - 0.04, 10);
    expect(evaluateBuyback(30, 8.3, at, 4).decision).toBe("keep");
  });

  it("reads a day-only asOf as that day's 16:00 close", () => {
    expect(evaluateBuyback(30, 8, timing("2026-09-21"))).toMatchObject({ decision: "buy back", remainingDays: 10, totalDays: 30 });
  });

  it("keeps an option expired at the price's instant, even at 0", () => {
    expect(evaluateBuyback(30, 0, timing("2026-10-01"))).toEqual({ decision: "keep", threshold: 0, remainingDays: 0, totalDays: 30 });
    expect(evaluateBuyback(30, 0, timing("2026-10-02")).decision).toBe("keep");
  });

  it("falls back to the 40% rule without timing, or with incoherent dates", () => {
    const share = { decision: "buy back", threshold: 12, remainingDays: null, totalDays: null };
    expect(evaluateBuyback(30, 12, null)).toEqual(share);
    expect(evaluateBuyback(30, 12, { soldAt: "2026-10-02T10:00:00.000Z", expiry: "2026-10-01", asOf: "2026-10-01" })).toEqual(share); // T <= 0
    expect(evaluateBuyback(30, 12, timing("2026-08-30T10:00:00.000Z"))).toEqual(share); // asOf before the sale
    expect(evaluateBuyback(30, 12, { soldAt: "nonsense", expiry: "2026-10-01", asOf: "2026-09-21" })).toEqual(share);
    expect(evaluateBuyback(30, 12.01, null).decision).toBe("keep");
  });

  it("uses absolute prices and keeps a zero sale", () => {
    expect(evaluateBuyback(-30, -8, timing("2026-09-21T16:00:00.000Z")).decision).toBe("buy back");
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
