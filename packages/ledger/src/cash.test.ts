import { describe, expect, it } from "vitest";
import { CASH_CHECK_TOLERANCE, anchoredBalances, cashImpact, isCashCheckOk, runningBalances, type CashCheck, type CashPoint } from "./cash.ts";
import { tx } from "./fixtures.ts";

describe("cashImpact", () => {
  it("adds the commission to the amount: both are signed by the broker", () => {
    expect(cashImpact(tx({ amount: -18050, commission: -1.5 }))).toBe(-18051.5);
  });

  it("treats a missing commission as nothing to add", () => {
    expect(cashImpact(tx({ amount: 610, commission: null }))).toBe(610);
  });

  it("is unknown when the amount is unknown, whatever the commission", () => {
    expect(cashImpact(tx({ amount: null, commission: -1 }))).toBeNull();
  });

  it("leaves the commission out of a currency conversion: IB charges it in the base currency", () => {
    expect(cashImpact(tx({ symbol: "EUR.USD", amount: 4641.84, commission: -1.7 }))).toBe(4641.84);
  });
});

describe("runningBalances", () => {
  const deposit = tx({
    externalId: "flex:cash:1",
    kind: "transfer",
    symbol: "",
    amount: 10000,
    commission: null,
    currency: "EUR",
    when: "2026-08-12T00:00:00.000Z",
  });
  const tsla = tx({
    externalId: "flex:trade:2",
    symbol: "TSLA",
    amount: -1100,
    commission: -1,
    when: "2026-08-20T09:05:00.000Z",
  });
  const msft = tx({
    externalId: "flex:trade:3",
    symbol: "MSFT",
    amount: 610,
    commission: -0.65,
    when: "2026-08-27T10:15:00.000Z",
  });
  const aapl = tx({
    externalId: "flex:trade:4",
    symbol: "AAPL",
    amount: -18050,
    commission: -1.5,
    when: "2026-08-28T14:30:00.000Z",
  });

  it("accumulates per currency in reference order, whatever the input order", () => {
    const rows = runningBalances([aapl, deposit, msft, tsla], ["USD", "EUR"]);
    expect(rows.map((r) => r.transaction.symbol)).toEqual(["", "TSLA", "MSFT", "AAPL"]);
    expect(rows.map((r) => r.balances.USD)).toEqual([0, -1101, -491.65, -18543.15]);
    expect(rows.map((r) => r.balances.EUR)).toEqual([10000, 10000, 10000, 10000]);
  });

  it("carries the other currency forward on a row that moves only one", () => {
    const [first, second] = runningBalances([deposit, tsla], ["USD", "EUR"]);
    expect(first.balances).toEqual({ USD: 0, EUR: 10000 });
    expect(second.balances).toEqual({ USD: -1101, EUR: 10000 });
  });

  it("reports the row's own cash impact next to the balances", () => {
    const [row] = runningBalances([aapl], ["USD"]);
    expect(row.cash).toBe(-18051.5);
  });

  it("splits a currency conversion over three fields: amount to the quote, quantity and commission to the base", () => {
    // SELL 1000 EUR at 1.10: +1100 USD, -1000 EUR, and the 2 EUR minimum commission in EUR.
    const conversion = tx({
      symbol: "EUR.USD",
      secType: "CASH",
      quantity: -1000,
      price: 1.1,
      amount: 1100,
      commission: -2,
      currency: "USD",
    });
    const [row] = runningBalances([conversion], ["USD", "EUR"]);
    expect(row.balances).toEqual({ USD: 1100, EUR: -1002 });
    expect(row.cash).toBe(1100);
  });

  it("skips the balance, not the row, when the amount is unknown", () => {
    const unknown = tx({ amount: null, commission: null, when: "2026-08-21T00:00:00.000Z" });
    const rows = runningBalances([tsla, unknown], ["USD"]);
    expect(rows[1].cash).toBeNull();
    expect(rows[1].balances.USD).toBe(-1101);
  });

  it("ignores currencies that were not asked for", () => {
    const [row] = runningBalances([deposit], ["USD"]);
    expect(row.balances).toEqual({ USD: 0 });
  });

  it("treats an unknown base amount on a conversion as zero: a running total has no 'unknown' to carry", () => {
    const conversion = tx({
      symbol: "EUR.USD",
      secType: "CASH",
      quantity: null,
      price: null,
      amount: 1100,
      commission: -2,
      currency: "USD",
    });
    const [row] = runningBalances([conversion], ["USD", "EUR"]);
    expect(row.balances).toEqual({ USD: 1100, EUR: -2 });
  });

  it("returns nothing for an empty ledger", () => {
    expect(runningBalances([], ["USD", "EUR"])).toEqual([]);
  });
});

describe("anchoredBalances", () => {
  const deposit = tx({ externalId: "a:1", kind: "transfer", symbol: "", amount: 10000, commission: null, currency: "EUR", when: "2026-08-12T00:00:00.000Z" });
  const tsla = tx({ externalId: "a:2", symbol: "TSLA", amount: -1100, commission: -1, when: "2026-08-20T09:05:00.000Z" });
  const msft = tx({ externalId: "a:3", symbol: "MSFT", amount: 610, commission: -0.65, when: "2026-08-27T10:15:00.000Z" });
  const aapl = tx({ externalId: "a:4", symbol: "AAPL", amount: -18050, commission: -1.5, when: "2026-08-28T14:30:00.000Z" });
  const ledger = [aapl, deposit, msft, tsla];
  // Raw USD after each row, in reference order: 0, -1101, -491.65, -18543.15.
  const end = (asOf: string, amount: number, currency = "USD"): CashPoint => ({ currency, kind: "end", asOf, amount });
  const start = (asOf: string, amount: number, currency = "USD"): CashPoint => ({ currency, kind: "start", asOf, amount });

  it("shifts every balance of a currency so that it ends on the end point, and leaves the others raw", () => {
    const { rows, checks } = anchoredBalances(ledger, ["USD", "EUR"], [end("2026-08-28", 1456.85)]);
    // The offset is itself a float difference: every shifted balance is compared approximately.
    expect(rows.map((r) => r.balances.USD)).toEqual([
      expect.closeTo(20000, 6),
      expect.closeTo(18899, 6),
      expect.closeTo(19508.35, 6),
      expect.closeTo(1456.85, 6),
    ]);
    expect(rows.map((r) => r.balances.EUR)).toEqual([10000, 10000, 10000, 10000]);
    expect(checks).toEqual([
      { currency: "USD", offset: expect.closeTo(20000, 6), end: { asOf: "2026-08-28", amount: 1456.85 }, start: null },
      { currency: "EUR", offset: 0, end: null, start: null },
    ]);
  });

  it("counts the rows of the end point's own day, and none after it", () => {
    const { rows } = anchoredBalances(ledger, ["USD"], [end("2026-08-27", 1000)]);
    expect(rows[2].balances.USD).toBeCloseTo(1000, 6);
    expect(rows[3].balances.USD).toBeCloseTo(-17051.5, 6);
  });

  it("measures the start at the close of the day before it, the day's own rows left out", () => {
    const onTheDay = anchoredBalances(ledger, ["USD"], [end("2026-08-28", 1456.85), start("2026-08-20", 20000)]).checks[0];
    expect(onTheDay.start).toEqual({ asOf: "2026-08-20", amount: 20000, balance: expect.closeTo(20000, 6), gap: 0 });
    const dayAfter = anchoredBalances(ledger, ["USD"], [end("2026-08-28", 1456.85), start("2026-08-21", 20000)]).checks[0];
    expect(dayAfter.start?.gap).toBe(-1101);
  });

  it("rounds the gap to the cent, and never to minus zero", () => {
    const up = anchoredBalances(ledger, ["USD"], [end("2026-08-28", 1456.851), start("2026-08-20", 20000)]).checks[0];
    expect(up.start?.gap).toBe(0);
    const down = anchoredBalances(ledger, ["USD"], [end("2026-08-28", 1456.846), start("2026-08-20", 20000)]).checks[0];
    expect(down.start?.gap).toBe(0);
    expect(Object.is(down.start?.gap, -0)).toBe(false);
  });

  it("counts rows older than the start point in the measure, whatever their age", () => {
    const old = tx({ externalId: "a:0", symbol: "OLD", amount: 500, commission: null, when: "2019-01-02T00:00:00.000Z" });
    const check = anchoredBalances([...ledger, old], ["USD"], [end("2026-08-28", 1956.85), start("2026-08-20", 20500)]).checks[0];
    expect(check.start?.gap).toBe(0);
  });

  it("checks a start without an end on the raw balances", () => {
    const check = anchoredBalances(ledger, ["USD"], [start("2026-08-21", -1101)]).checks[0];
    expect(check).toEqual({ currency: "USD", offset: 0, end: null, start: { asOf: "2026-08-21", amount: -1101, balance: -1101, gap: 0 } });
  });

  it("anchors the base side of a currency conversion too", () => {
    const conversion = tx({ externalId: "a:5", symbol: "EUR.USD", quantity: -1000, amount: 1100, commission: -2, currency: "USD", when: "2026-08-15T10:00:00.000Z" });
    const { rows } = anchoredBalances([...ledger, conversion], ["USD", "EUR"], [end("2026-08-28", 9000, "EUR")]);
    // Raw EUR ends on 10000 - 1000 - 2 = 8998: the offset is 2.
    expect(rows[rows.length - 1].balances.EUR).toBeCloseTo(9000, 6);
    expect(rows[0].balances.EUR).toBeCloseTo(10002, 6);
  });

  it("returns no row and raw checks for an empty ledger", () => {
    expect(anchoredBalances([], ["USD"], [end("2026-08-28", 5), start("2026-01-01", 5)])).toEqual({
      rows: [],
      checks: [{ currency: "USD", offset: 5, end: { asOf: "2026-08-28", amount: 5 }, start: { asOf: "2026-01-01", amount: 5, balance: 5, gap: 0 } }],
    });
  });
});

describe("isCashCheckOk", () => {
  const withGap = (gap: number): CashCheck => ({ currency: "USD", offset: 0, end: null, start: { asOf: "2026-01-01", amount: 0, balance: gap, gap } });

  it("has no verdict without a start point", () => {
    expect(isCashCheckOk({ currency: "USD", offset: 0, end: { asOf: "2026-01-01", amount: 1 }, start: null })).toBeNull();
  });

  it("accepts a gap up to the tolerance, in either direction, and refuses one beyond it", () => {
    expect(CASH_CHECK_TOLERANCE).toBe(10);
    expect(isCashCheckOk(withGap(10))).toBe(true);
    expect(isCashCheckOk(withGap(-10))).toBe(true);
    expect(isCashCheckOk(withGap(10.01))).toBe(false);
    expect(isCashCheckOk(withGap(-10.01))).toBe(false);
  });
});
