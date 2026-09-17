import { describe, expect, it } from "vitest";
import type { Position } from "../types.ts";
import type { OpenPosition } from "./book.ts";
import { sharesContract, type ContractKey } from "./contract.ts";
import { reconcile } from "./reconcile.ts";

const PUT: ContractKey = { ticker: "MQZA", secType: "OPT", right: "P", strike: 17, expiry: "2026-10-02", currency: "USD" };

function position(overrides: Partial<Position>): Position {
  return {
    symbol: "MQZA", secType: "OPT", right: "P", strike: 17, expiry: "2026-10-02", multiplier: 100, quantity: -2,
    avgPrice: 0.2, marketPrice: 0.1, marketValue: -20, unrealizedPnl: 20, currency: "USD", conid: "", description: "", ...overrides,
  };
}

function ledger(entries: OpenPosition[]): Map<string, OpenPosition> {
  return new Map(entries.map((e) => [`${e.contract.ticker}|${e.contract.secType}|${e.contract.right}|${e.contract.strike ?? ""}|${e.contract.expiry ?? ""}|${e.contract.currency}`, e]));
}

describe("reconcile", () => {
  it("is clean when every contract matches in quantity, whatever the prices", () => {
    const result = reconcile(ledger([{ contract: PUT, quantity: -2 }, { contract: sharesContract("MQZA", "USD"), quantity: 200 }]), {
      asOf: "2026-09-02",
      positions: [position({}), position({ secType: "STK", right: "", strike: null, expiry: null, quantity: 200, avgPrice: 99 })],
    });
    expect(result).toEqual({ asOf: "2026-09-02", differences: [], orphans: [] });
  });

  it("reports a quantity mismatch, a contract only the ledger has, and one only the snapshot has, by label", () => {
    const result = reconcile(ledger([{ contract: PUT, quantity: -3 }, { contract: sharesContract("AAA", "USD"), quantity: 100 }]), {
      asOf: "2026-09-02",
      positions: [position({}), position({ symbol: "ZZZ", quantity: 1 })],
    });
    expect(result.differences).toEqual([
      { contract: sharesContract("AAA", "USD"), label: "AAA", ledgerQty: 100, snapshotQty: 0 },
      { contract: PUT, label: "MQZA Oct02'26 17 Put", ledgerQty: -3, snapshotQty: -2 },
      { contract: { ...PUT, ticker: "ZZZ" }, label: "ZZZ Oct02'26 17 Put", ledgerQty: 0, snapshotQty: 1 },
    ]);
  });

  it("ignores snapshot positions that are neither shares nor options", () => {
    const result = reconcile(ledger([]), { asOf: "2026-09-02", positions: [position({ symbol: "WRT", secType: "WAR", right: "", strike: null, expiry: null, quantity: 10 })] });
    expect(result.differences).toEqual([]);
  });
});
