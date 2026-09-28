import { describe, expect, it } from "vitest";
import type { Position } from "@ib/ledger";
import { liquidationValue } from "./totals.ts";

const position = (overrides: Partial<Position>): Position =>
  ({
    symbol: "AAPL", secType: "STK", right: "", strike: null, expiry: null, multiplier: 1, quantity: 10, avgPrice: 100,
    marketPrice: 110, marketValue: 1100, unrealizedPnl: 100, dailyPnl: null, dayChange: null, currency: "USD", conid: "", description: "AAPL", ...overrides,
  }) as Position;

describe("liquidationValue", () => {
  it("adds the positions' market values, a sold option negative, and the cash", () => {
    const positions = [position({}), position({ secType: "OPT", marketValue: -250, description: "AAPL P" })];
    expect(liquidationValue(positions, { USD: 5000 })).toEqual([{ currency: "USD", total: 5850, missing: 0, count: 3 }]);
  });
  it("counts the cash of each held currency as missing while it is not known yet", () => {
    expect(liquidationValue([position({}), position({ currency: "EUR", marketValue: 30 })], undefined)).toEqual([
      { currency: "EUR", total: 30, missing: 1, count: 2 },
      { currency: "USD", total: 1100, missing: 1, count: 2 },
    ]);
  });
  it("counts an unknown cash as missing, and a currency with cash only", () => {
    expect(liquidationValue([position({})], { USD: null, EUR: 40 })).toEqual([
      { currency: "EUR", total: 40, missing: 0, count: 1 },
      { currency: "USD", total: 1100, missing: 1, count: 2 },
    ]);
  });
});
