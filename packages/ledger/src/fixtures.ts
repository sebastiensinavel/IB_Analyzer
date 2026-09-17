import type { Transaction } from "./types.ts";

export function tx(overrides: Partial<Transaction>): Transaction {
  return {
    accountId: "test",
    externalId: "flex:trade:1",
    source: "flex",
    kind: "trade",
    symbol: "AAPL",
    secType: "STK",
    right: "",
    strike: null,
    expiry: null,
    quantity: 1,
    price: 10,
    amount: -10,
    commission: -1,
    currency: "USD",
    when: "2026-01-01T00:00:00.000Z",
    description: "",
    ...overrides,
  };
}
