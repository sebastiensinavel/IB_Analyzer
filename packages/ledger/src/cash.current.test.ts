import { describe, expect, it } from "vitest";
import { currentCashBalances, type CashCheck, type LedgerRow } from "./cash.ts";

const check = (currency: string, offset: number, end: CashCheck["end"]): CashCheck => ({ currency, offset, end, start: null });

describe("currentCashBalances", () => {
  it("reads each currency on the last ledger row", () => {
    const rows = [{ balances: { USD: 10, EUR: 1 } }, { balances: { USD: 42, EUR: 7 } }] as unknown as LedgerRow[];
    expect(currentCashBalances(rows, [check("USD", 0, null), check("EUR", 0, null)])).toEqual({ USD: 42, EUR: 7 });
  });

  it("falls back on the Ending Cash alone for an empty ledger, null without it", () => {
    expect(currentCashBalances([], [check("USD", 1234, { asOf: "2026-09-01", amount: 1234 }), check("EUR", 0, null)])).toEqual({ USD: 1234, EUR: null });
  });
});
