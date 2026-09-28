import { describe, expect, it } from "vitest";
import type { Position } from "@ib/ledger";
import { buildHeldDayChange, resolveUnderlyingDayChange } from "@/lib/underlyingDayChange";

function stock(overrides: Partial<Position> = {}): Position {
  return {
    symbol: "AAPL", secType: "STK", right: "", strike: null, expiry: null, multiplier: 1,
    quantity: 100, avgPrice: 140, marketPrice: 150, marketValue: 15000, unrealizedPnl: 1000,
    dailyPnl: 50, dayChange: 0.03, currency: "USD", conid: "", description: "APPLE INC",
    ...overrides,
  };
}

describe("buildHeldDayChange", () => {
  it("keeps only STK, USD, non-null dayChange positions, keyed by upper-cased ticker", () => {
    const held = buildHeldDayChange([
      stock({ symbol: "aapl", dayChange: 0.0215 }),
      stock({ symbol: "MSFT", secType: "OPT", dayChange: 0.05 }),
      stock({ symbol: "SAP", currency: "EUR", dayChange: 0.01 }),
      stock({ symbol: "ONDS", dayChange: null }),
    ]);
    expect(held).toEqual(new Map([["AAPL", 0.0215]]));
  });

  it("is empty for no positions", () => {
    expect(buildHeldDayChange([])).toEqual(new Map());
  });
});

describe("resolveUnderlyingDayChange", () => {
  it("prefers the account's live dayChange over the quotes store, with no tooltip", () => {
    const held = new Map([["AAPL", 0.0821]]);
    const quotes = new Map<string, number | null>([["AAPL", -0.5]]); // a stale/different value: must be ignored
    expect(resolveUnderlyingDayChange("AAPL", held, quotes)).toEqual({ value: 0.0821, delayed: false, proxy: null });
  });

  it("falls back to the delayed quote for a ticker not held as stock", () => {
    // Also covers a held-but-null dayChange: buildHeldDayChange already drops it (see above),
    // so the caller only ever sees an empty/absent entry there, exactly like this case.
    const quotes = new Map<string, number | null>([["XOM", -0.0312]]);
    expect(resolveUnderlyingDayChange("XOM", new Map(), quotes)).toEqual({ value: -0.0312, delayed: true, proxy: null });
  });

  it("reads XSP's delayed quote from SPY and names the substitute", () => {
    const quotes = new Map<string, number | null>([["SPY", 0.004]]);
    expect(resolveUnderlyingDayChange("XSP", new Map(), quotes)).toEqual({ value: 0.004, delayed: true, proxy: "SPY" });
  });

  it("is null, undelayed, unproxied without either source", () => {
    expect(resolveUnderlyingDayChange("ZZZZ", new Map(), new Map())).toEqual({ value: null, delayed: false, proxy: null });
  });

  it("is case-insensitive on the ticker for both sources", () => {
    const held = new Map([["AAPL", 0.02]]);
    expect(resolveUnderlyingDayChange("aapl", held, new Map())).toEqual({ value: 0.02, delayed: false, proxy: null });
  });
});
