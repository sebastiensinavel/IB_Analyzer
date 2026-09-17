import { describe, expect, it } from "vitest";
import type { LedgerRow } from "@ib/ledger";
import { HISTORY_COLUMNS, historyColumnSpecs, historyTicker } from "@/lib/historyColumns";
import { SAMPLE_DEPOSIT, SAMPLE_TRANSACTIONS } from "@/mocks/ledger";

const t = (key: string) => `t:${key}`;

function row(transaction = SAMPLE_TRANSACTIONS[0]): LedgerRow {
  return { transaction, cash: -18051.5, balances: { USD: -18543.15, EUR: 10000 } } as LedgerRow;
}

describe("historyColumnSpecs", () => {
  it("types every column of the table, in its order", () => {
    const specs = historyColumnSpecs(t);
    expect(specs.map((spec) => spec.key)).toEqual(HISTORY_COLUMNS.map((column) => column.key));
    expect(specs.map((spec) => spec.type)).toEqual(["date", "enum", "text", "number", "number", "number", "number", "number", "text", "number", "number"]);
    expect(specs.every((spec) => spec.sortable)).toBe(true);
  });

  it("compares what the cells show", () => {
    const specs = Object.fromEntries(historyColumnSpecs(t).map((spec) => [spec.key, spec]));
    expect(specs.dateTime.value(row())).toBe("2026-08-28 14:30:00");
    expect(specs.type.value(row())).toBe("trade");
    expect(specs.type.label?.("trade")).toBe("t:history.kinds.trade");
    expect(specs.symbol.value(row())).toBe("AAPL");
    expect(specs.symbol.value(row(SAMPLE_DEPOSIT))).toBe("ELECTRONIC FUND TRANSFER");
    expect(specs.totalPrice.value(row())).toBe(-18050);
    expect(specs.fee.value(row())).toBe(-1.5);
    expect(specs.price.value(row({ ...SAMPLE_TRANSACTIONS[0], price: null }))).toBeNull();
    expect(specs.cash.value(row())).toBe(-18051.5);
    expect(specs.currency.value(row())).toBe("USD");
    expect(specs.usdCash.value(row())).toBe(-18543.15);
    expect(specs.eurCash.value(row())).toBe(10000);
  });

  it("reads the ticker of a row, the underlying for a packed option, null without a symbol", () => {
    expect(historyTicker(row({ ...SAMPLE_TRANSACTIONS[0], symbol: "OQZA  261016C00012000", secType: "OPT" }))).toBe("OQZA");
    expect(historyTicker(row(SAMPLE_DEPOSIT))).toBeNull();
  });
});
