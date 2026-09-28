import { describe, expect, it } from "vitest";
import type { LedgerRow } from "@ib/ledger";
import { HISTORY_COLUMNS, historyColumnSpecs, historyTicker } from "@/lib/historyColumns";
import { SAMPLE_DEPOSIT, SAMPLE_TRANSACTIONS } from "@/mocks/ledger";

const t = (key: string) => `t:${key}`;
const ready = (id: string) => (id === "flex:trade:4" ? (["wheel", "others"] as const) : []);

function row(transaction = SAMPLE_TRANSACTIONS[0]): LedgerRow {
  return { transaction, cash: -18051.5, balances: { USD: -18543.15, EUR: 10000 } } as LedgerRow;
}

describe("historyColumnSpecs", () => {
  it("types every column of the table, in its order", () => {
    const specs = historyColumnSpecs(t, ready);
    expect(specs.map((spec) => spec.key)).toEqual(HISTORY_COLUMNS.map((column) => column.key));
    expect(specs.map((spec) => spec.key).slice(2, 4)).toEqual(["symbol", "strategy"]);
    expect(specs.map((spec) => spec.type)).toEqual(["date", "enum", "text", "enum", "number", "number", "number", "number", "number", "text", "number", "number"]);
    expect(specs.filter((spec) => !spec.sortable).map((spec) => spec.key)).toEqual(["strategy"]);
  });

  it("reads a row's strategies, an empty list for none and while the journals load", () => {
    const strategy = historyColumnSpecs(t, ready).find((spec) => spec.key === "strategy")!;
    expect(strategy.value(row())).toEqual(["wheel", "others"]);
    expect(strategy.value(row(SAMPLE_DEPOSIT))).toEqual([]);
    expect(strategy.label?.("others")).toBe("t:history.strategies.others");
    expect(historyColumnSpecs(t, null).find((spec) => spec.key === "strategy")!.value(row())).toEqual([]);
  });

  it("compares what the cells show", () => {
    const specs = Object.fromEntries(historyColumnSpecs(t, ready).map((spec) => [spec.key, spec]));
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

  it("labels an unknown kind by the kind itself, as its row does", () => {
    const translate = (key: string, options?: { defaultValue?: string }) => (key.startsWith("history.kinds.") ? (options?.defaultValue ?? key) : key);
    const type = historyColumnSpecs(translate, null).find((spec) => spec.key === "type");
    expect(type?.label?.("mystery_kind")).toBe("mystery_kind");
  });

  it("reads the ticker of a row, the underlying for a packed option, null without a symbol", () => {
    expect(historyTicker(row({ ...SAMPLE_TRANSACTIONS[0], symbol: "OQZA  261016C00012000", secType: "OPT" }))).toBe("OQZA");
    expect(historyTicker(row(SAMPLE_DEPOSIT))).toBeNull();
  });
});

describe("HISTORY_COLUMNS widths", () => {
  it("add up to 100%, so a rebalancing never silently drops a column's share", () => {
    const total = HISTORY_COLUMNS.reduce((sum, column) => sum + Number.parseFloat(column.width), 0);
    expect(total).toBeCloseTo(100, 5);
  });
});
