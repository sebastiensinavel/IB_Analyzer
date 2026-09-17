import type { Transaction } from "@ib/ledger";

function trade(overrides: Partial<Transaction>): Transaction {
  return {
    accountId: "alpha",
    externalId: "flex:trade:1",
    source: "flex",
    kind: "trade",
    symbol: "AAPL",
    secType: "STK",
    right: "",
    strike: null,
    expiry: null,
    quantity: 100,
    price: 180.5,
    amount: -18050,
    commission: -1.5,
    currency: "USD",
    when: "2026-08-28T14:30:00.000Z",
    description: "",
    ...overrides,
  };
}

/** Chronology DEPOSIT -> TSLA -> MSFT -> AAPL; USD ends at -18543.15, EUR at 10000. */
export const SAMPLE_DEPOSIT: Transaction = trade({
  externalId: "flex:cash:1",
  kind: "transfer",
  symbol: "",
  secType: "",
  quantity: null,
  price: null,
  amount: 10000,
  commission: null,
  currency: "EUR",
  when: "2026-08-12T00:00:00.000Z",
  description: "ELECTRONIC FUND TRANSFER",
});

export const SAMPLE_TRANSACTIONS: Transaction[] = [
  trade({ externalId: "flex:trade:4" }),
  trade({ externalId: "flex:trade:3", symbol: "MSFT", quantity: -1, price: 6.1, amount: 610, commission: -0.65, when: "2026-08-27T10:15:00.000Z" }),
  trade({ externalId: "flex:trade:2", symbol: "TSLA", quantity: 5, price: 220, amount: -1100, commission: -1, when: "2026-08-20T09:05:00.000Z" }),
  SAMPLE_DEPOSIT,
];
