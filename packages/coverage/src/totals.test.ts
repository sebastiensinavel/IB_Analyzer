import { describe, expect, it } from "vitest";
import type { Position } from "@ib/ledger";
import { addTotals, liquidationValue, sumByCurrency } from "./totals.ts";

type R = { c: string; v: number | null };
const sum = (rows: R[]) => sumByCurrency(rows, (r) => r.c, (r) => r.v);

describe("sumByCurrency", () => {
  it("adds the known values and counts the missing ones", () => {
    expect(sum([{ c: "USD", v: 10 }, { c: "USD", v: null }, { c: "USD", v: -3 }])).toEqual([{ currency: "USD", total: 7, missing: 1, count: 3 }]);
  });
  it("gives null only when no line has a value", () => {
    expect(sum([{ c: "USD", v: null }])).toEqual([{ currency: "USD", total: null, missing: 1, count: 1 }]);
  });
  it("never converts: one entry per currency, sorted", () => {
    expect(sum([{ c: "USD", v: 1 }, { c: "EUR", v: 2 }])).toEqual([
      { currency: "EUR", total: 2, missing: 0, count: 1 },
      { currency: "USD", total: 1, missing: 0, count: 1 },
    ]);
  });
  it("returns nothing for no rows", () => {
    expect(sum([])).toEqual([]);
  });
});

const position = (overrides: Partial<Position>): Position =>
  ({
    symbol: "AAPL", secType: "STK", right: "", strike: null, expiry: null, multiplier: 1, quantity: 10, avgPrice: 100,
    marketPrice: 110, marketValue: 1100, unrealizedPnl: 100, dailyPnl: null, dayChange: null, currency: "USD", conid: "", description: "AAPL", ...overrides,
  }) as Position;

describe("addTotals", () => {
  it("adds by currency, null plus a value giving the value, missing and count summed", () => {
    expect(addTotals(
      [{ currency: "USD", total: 10, missing: 0, count: 1 }],
      [{ currency: "USD", total: null, missing: 1, count: 1 }, { currency: "EUR", total: 2, missing: 0, count: 1 }],
    )).toEqual([
      { currency: "EUR", total: 2, missing: 0, count: 1 },
      { currency: "USD", total: 10, missing: 1, count: 2 },
    ]);
  });
  it("keeps null when no part knows a value", () => {
    expect(addTotals([{ currency: "USD", total: null, missing: 2, count: 2 }], [])).toEqual([{ currency: "USD", total: null, missing: 2, count: 2 }]);
  });
});

describe("liquidationValue", () => {
  it("adds the positions' market values, a sold option negative, and the cash", () => {
    const positions = [position({}), position({ secType: "OPT", marketValue: -250, description: "AAPL P" })];
    expect(liquidationValue(positions, { USD: 5000 })).toEqual([{ currency: "USD", total: 5850, missing: 0, count: 3 }]);
  });
  it("counts an unknown cash as missing, and a currency with cash only", () => {
    expect(liquidationValue([position({})], { USD: null, EUR: 40 })).toEqual([
      { currency: "EUR", total: 40, missing: 0, count: 1 },
      { currency: "USD", total: 1100, missing: 1, count: 2 },
    ]);
  });
});
