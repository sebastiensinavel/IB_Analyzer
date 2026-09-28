import { describe, expect, it } from "vitest";
import { addTotals, sumByCurrency } from "./totals.ts";

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
