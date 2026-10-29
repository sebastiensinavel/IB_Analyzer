import { beforeEach, describe, expect, it } from "vitest";
import type { Position, Transaction } from "@ib/ledger";
import { setActiveStrategies } from "@/db/accounts";
import { createManualAlert } from "@/db/alerts";
import { db, type AccountRecord } from "@/db/schema";
import { loadExport } from "./loadExport";

const account = (id: string, fields: Partial<AccountRecord> = {}): AccountRecord => ({
  id, label: id, ibAccountId: "U0000000", createdAt: "2026-09-01T00:00:00.000Z", warnedDroppedKinds: [], ...fields,
});

function position(fields: Partial<Position>): Position {
  return {
    symbol: "", secType: "STK", right: "", strike: null, expiry: null, multiplier: null, quantity: 0, avgPrice: null,
    marketPrice: null, marketValue: null, unrealizedPnl: null, dailyPnl: null, dayChange: null, currency: "USD", conid: "",
    description: "", ...fields,
  };
}

function trade(overrides: Partial<Transaction>): Transaction {
  return {
    accountId: "beta", externalId: "", source: "flex", kind: "trade", symbol: "", secType: "OPT", right: "", strike: null, expiry: null,
    quantity: null, price: null, amount: null, commission: -1, currency: "USD", when: "", description: "", ...overrides,
  };
}

const snapshot = (accountId: string, positions: Position[]) => ({
  accountId, source: "flex" as const, asOf: "2026-10-28", importedAt: "", positions, cashAvailable: null,
});

/** A put sold on ABC 45, open, in each account. */
const shortPut = (accountId: string, id: string, quantity: number) =>
  trade({
    accountId, externalId: `flex:trade:${id}`, symbol: "ABC   261120P00045000", right: "P", strike: 45, expiry: "2026-11-20",
    quantity, price: 1, amount: -100 * quantity, when: "2026-10-01T14:30:00.000Z",
  });

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe("loadExport", () => {
  it("lists every account's held tickers once, an option under its underlying", async () => {
    await db.accounts.bulkAdd([account("alpha"), account("beta")]);
    await db.snapshots.bulkPut([
      snapshot("alpha", [position({ symbol: "MSFT", quantity: 10 }), position({ symbol: "ABC", secType: "OPT", right: "P", strike: 45, quantity: -1 })]),
      snapshot("beta", [position({ symbol: "MSFT", quantity: 5 }), position({ symbol: "OLD", quantity: 0 })]),
    ]);
    const { tickers } = await loadExport(db);
    expect([...tickers].sort()).toEqual(["ABC", "MSFT"]);
  });

  it("sums the same level across accounts and adds the manual alerts' thresholds", async () => {
    await db.accounts.bulkAdd([account("alpha"), account("beta")]);
    await db.transactions.bulkAdd([shortPut("alpha", "1", -1), shortPut("beta", "2", -2)]);
    await createManualAlert(db, "alpha", { ticker: "ABC", price: 47, direction: "above" });
    const { levels } = await loadExport(db);
    expect(levels).toEqual([
      { ticker: "ABC", kind: "shortPut", price: 45, quantity: -3 },
      { ticker: "ABC", kind: "alert", price: 47, quantity: null },
    ]);
  });

  it("leaves out a disabled manual alert, and draws an inactive strategy's sale under Others", async () => {
    await db.accounts.add(account("beta"));
    await setActiveStrategies(db, "beta", ["leaps"]);
    const alertId = await createManualAlert(db, "beta", { ticker: "ZZZ", price: 10, direction: "below" });
    await db.alertStates.put({
      accountId: "beta", alertId, triggeredAt: null, acknowledgedAt: null, disabled: true, armed: true, anchor: null, override: null,
    });
    await db.transactions.add(shortPut("beta", "1", -1));
    const { levels } = await loadExport(db);
    // The wheel is off: the put falls into Others, which the export draws too.
    expect(levels).toEqual([{ ticker: "ABC", kind: "shortPut", price: 45, quantity: -1 }]);
  });
});
