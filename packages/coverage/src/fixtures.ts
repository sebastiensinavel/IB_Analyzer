import type { Position } from "@ib/ledger";

/** A short call, one contract, sold at 2.00 per unit, worth 1.00 now. */
export function option(overrides: Partial<Position> = {}): Position {
  return {
    symbol: "AAPL",
    secType: "OPT",
    right: "C",
    strike: 150,
    expiry: "2026-01-16",
    multiplier: 100,
    quantity: -1,
    avgPrice: 2,
    marketPrice: 1,
    marketValue: -100,
    unrealizedPnl: 100,
    dailyPnl: null,
    dayChange: null,
    currency: "USD",
    conid: "",
    description: "",
    ...overrides,
  };
}

/** 100 shares bought at 140, worth 150 now. */
export function stock(overrides: Partial<Position> = {}): Position {
  return {
    symbol: "AAPL",
    secType: "STK",
    right: "",
    strike: null,
    expiry: null,
    multiplier: 1,
    quantity: 100,
    avgPrice: 140,
    marketPrice: 150,
    marketValue: 15000,
    unrealizedPnl: 1000,
    dailyPnl: null,
    dayChange: null,
    currency: "USD",
    conid: "",
    description: "",
    ...overrides,
  };
}
