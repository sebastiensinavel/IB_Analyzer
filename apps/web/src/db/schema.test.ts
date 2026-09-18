import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { AppDatabase, statementId, type StatementRecord } from "./schema";
import type { ContractRecord } from "./contracts";

/**
 * Replays the schema as it stood before version 4, to prove that an existing database —
 * one real users already have open in their browser — upgrades without losing what it
 * already held. Version 4 only adds the `statements` table, so Dexie's default upgrade
 * (carry every row forward unchanged) is exactly what should happen; this test is the
 * proof a code review of `schema.ts` alone cannot give.
 */
class LegacyDatabase extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      accounts: "id",
      transactions: "[accountId+externalId], accountId, [accountId+when]",
      imports: "++id, accountId",
    });
    this.version(2).stores({
      snapshots: "accountId",
      sectors: "ticker",
    });
    this.version(3).stores({
      accounts: "id",
    });
  }
}

describe("AppDatabase upgrades", () => {
  it("upgrades an older database without losing its accounts, and starts with no statement kept", async () => {
    const name = `ib-analyzer-migration-test-${Date.now()}`;
    const legacy = new LegacyDatabase(name);
    await legacy.open();
    await legacy.table("accounts").put({
      id: "beta",
      label: "Beta",
      ibAccountId: "U1234567",
      createdAt: "2026-09-01T00:00:00.000Z",
      warnedDroppedKinds: [],
    });
    legacy.close();

    const upgraded = new AppDatabase(name);
    await upgraded.open();
    try {
      expect(upgraded.verno).toBe(9);
      const account = await upgraded.accounts.get("beta");
      expect(account).toMatchObject({
        id: "beta",
        label: "Beta",
        ibAccountId: "U1234567",
        createdAt: "2026-09-01T00:00:00.000Z",
        warnedDroppedKinds: [],
      });
      // The new fields are simply absent, never defaulted to an empty value.
      expect(account?.flexToken).toBeUndefined();
      expect(account?.flexQueryId).toBeUndefined();
      // Statements imported before version 4 were never kept: the store starts empty, and
      // an empty store is what keeps "Replay the statements" from wiping their rows.
      expect(await upgraded.statements.count()).toBe(0);
      // Version 6 adds the cash points: none until a file with a Cash Report is imported.
      expect(await upgraded.cashPoints.count()).toBe(0);
    } finally {
      upgraded.close();
      await upgraded.delete();
    }
  });
});

/**
 * Replays the schema as it stood right before version 6, to prove the same thing one
 * version later: version 6 only adds the `cashPoints` table, so every row of every store
 * already declared — accounts, statements, contracts, snapshots — must come back exactly
 * as it went in, untouched by Dexie's default upgrade.
 */
class LegacyDatabaseV5 extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      accounts: "id",
      transactions: "[accountId+externalId], accountId, [accountId+when]",
      imports: "++id, accountId",
    });
    this.version(2).stores({
      snapshots: "accountId",
      sectors: "ticker",
    });
    this.version(3).stores({
      accounts: "id",
    });
    this.version(4).stores({
      statements: "id, accountId",
    });
    this.version(5).stores({
      contracts: "[accountId+conid], accountId",
    });
  }
}

describe("AppDatabase version 6", () => {
  it("upgrades a version 5 database without losing its accounts, statements, contracts or snapshot", async () => {
    const name = `ib-analyzer-v6-migration-test-${Date.now()}`;
    const legacy = new LegacyDatabaseV5(name);
    await legacy.open();

    const account = {
      id: "beta",
      label: "Beta",
      ibAccountId: "U1234567",
      createdAt: "2026-09-01T00:00:00.000Z",
      warnedDroppedKinds: [],
    };
    const period = { start: "2025-01-01", end: "2025-12-31" };
    const statement: StatementRecord = {
      id: statementId("beta", period),
      accountId: "beta",
      fileName: "2025.htm",
      period,
      importedAt: "2026-09-01T00:00:00.000Z",
      text: "<html></html>",
      bytes: 13,
    };
    const contract: ContractRecord = {
      accountId: "beta",
      conid: "123",
      isin: "US0000000001",
      secType: "STK",
      currency: "USD",
      description: "TESTX",
      aliases: [{ ticker: "TESTX", firstSeen: "2025-01-01", lastSeen: "2025-12-31" }],
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const snapshot = {
      accountId: "beta",
      source: "statement_html" as const,
      asOf: "2025-12-31",
      importedAt: "2026-09-01T00:00:00.000Z",
      positions: [],
      cashAvailable: null,
    };
    await legacy.table("accounts").put(account);
    await legacy.table("statements").put(statement);
    await legacy.table("contracts").put(contract);
    await legacy.table("snapshots").put(snapshot);
    legacy.close();

    const upgraded = new AppDatabase(name);
    await upgraded.open();
    try {
      expect(upgraded.verno).toBe(9);
      expect(await upgraded.accounts.get("beta")).toEqual(account);
      expect(await upgraded.statements.get(statement.id)).toEqual(statement);
      expect(await upgraded.contracts.get(["beta", "123"])).toEqual(contract);
      expect(await upgraded.snapshots.get("beta")).toEqual(snapshot);
      expect(await upgraded.cashPoints.count()).toBe(0);
    } finally {
      upgraded.close();
      await upgraded.delete();
    }
  });
});

/**
 * Replays the schema as it stood right before version 7. Version 7 is the first upgrade that
 * rewrites rows instead of only adding a store: every sector row trades `importedAt` for
 * `updatedAt`, since a row is now also written by hand and by the IB imports.
 */
class LegacyDatabaseV6 extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      accounts: "id",
      transactions: "[accountId+externalId], accountId, [accountId+when]",
      imports: "++id, accountId",
    });
    this.version(2).stores({
      snapshots: "accountId",
      sectors: "ticker",
    });
    this.version(3).stores({
      accounts: "id",
    });
    this.version(4).stores({
      statements: "id, accountId",
    });
    this.version(5).stores({
      contracts: "[accountId+conid], accountId",
    });
    this.version(6).stores({
      cashPoints: "[accountId+currency+kind], accountId",
    });
  }
}

describe("AppDatabase version 7", () => {
  it("renames importedAt to updatedAt on every sector row and leaves the other stores alone", async () => {
    const name = `ib-analyzer-v7-migration-test-${Date.now()}`;
    const legacy = new LegacyDatabaseV6(name);
    await legacy.open();
    const account = {
      id: "beta",
      label: "Beta",
      ibAccountId: "U1234567",
      createdAt: "2026-09-01T00:00:00.000Z",
      warnedDroppedKinds: [],
    };
    await legacy.table("accounts").put(account);
    await legacy.table("sectors").bulkPut([
      { ticker: "AAPL", name: "Apple Inc.", category: "Tech", score: 7.5, status: "on", importedAt: "2026-09-03T08:00:00.000Z" },
      { ticker: "XOM", name: "Exxon Mobil", category: "Energy", score: null, status: "off", importedAt: "2026-09-04T08:00:00.000Z" },
    ]);
    legacy.close();

    const upgraded = new AppDatabase(name);
    await upgraded.open();
    try {
      expect(upgraded.verno).toBe(9);
      const rows = await upgraded.sectors.toArray();
      expect(rows).toEqual([
        { ticker: "AAPL", name: "Apple Inc.", category: "Tech", score: 7.5, status: "on", updatedAt: "2026-09-03T08:00:00.000Z" },
        { ticker: "XOM", name: "Exxon Mobil", category: "Energy", score: null, status: "off", updatedAt: "2026-09-04T08:00:00.000Z" },
      ]);
      // toEqual ignores an undefined key, not a present one: this is the proof the key is gone.
      expect(rows.some((row) => "importedAt" in row)).toBe(false);
      expect(await upgraded.accounts.get("beta")).toEqual(account);
    } finally {
      upgraded.close();
      await upgraded.delete();
    }
  });
});

/** The schema as it stood right before version 8: version 7 renamed the sectors' `importedAt`. */
class LegacyDatabaseV7 extends LegacyDatabaseV6 {
  constructor(name: string) {
    super(name);
    this.version(7).stores({ sectors: "ticker" });
  }
}

describe("AppDatabase version 8", () => {
  it("brings the agent's transactions and snapshot to New York's wall clock and leaves every other time alone", async () => {
    const name = `ib-analyzer-v8-migration-test-${Date.now()}`;
    const legacy = new LegacyDatabaseV7(name);
    await legacy.open();
    const row = (source: string, externalId: string, when: string) => ({
      accountId: "beta", externalId, source, kind: "trade", symbol: "IQZA", secType: "STK", right: "", strike: null,
      expiry: null, quantity: 100, price: 60, amount: -6000, commission: null, currency: "USD", when, description: "",
    });
    await legacy.table("transactions").bulkPut([
      row("agent", "agent:e1", "2026-09-16T02:13:46.000Z"),
      row("flex", "flex:trade:1", "2026-09-15T16:20:00.000Z"),
    ]);
    await legacy.table("snapshots").bulkPut([
      { accountId: "beta", source: "agent", asOf: "2026-09-16T15:04:26.000Z", importedAt: "2026-09-16T15:04:27.000Z", positions: [], cashAvailable: null },
      { accountId: "alpha", source: "flex", asOf: "2026-09-15", importedAt: "2026-09-16T07:00:00.000Z", positions: [], cashAvailable: null },
    ]);
    const account = {
      id: "beta", label: "Beta", ibAccountId: "U1234567", createdAt: "2026-09-01T00:00:00.000Z",
      warnedDroppedKinds: [], lastAgentSyncAt: "2026-09-16T15:04:27.000Z",
    };
    await legacy.table("accounts").put(account);
    legacy.close();

    const upgraded = new AppDatabase(name);
    await upgraded.open();
    try {
      expect(upgraded.verno).toBe(9);
      expect((await upgraded.transactions.get(["beta", "agent:e1"]))?.when).toBe("2026-09-15T22:13:46.000Z");
      expect((await upgraded.transactions.get(["beta", "flex:trade:1"]))?.when).toBe("2026-09-15T16:20:00.000Z");
      // The compound index follows the rewrite: the row is found by its new time.
      expect(
        await upgraded.transactions.where("[accountId+when]").equals(["beta", "2026-09-15T22:13:46.000Z"]).count(),
      ).toBe(1);
      expect(await upgraded.snapshots.get("beta")).toMatchObject({ asOf: "2026-09-16T11:04:26.000Z", importedAt: "2026-09-16T15:04:27.000Z" });
      expect((await upgraded.snapshots.get("alpha"))?.asOf).toBe("2026-09-15");
      expect(await upgraded.accounts.get("beta")).toEqual(account);
    } finally {
      upgraded.close();
      await upgraded.delete();
    }
  });

  it("leaves a row with an unreadable time as it is, rather than aborting the whole upgrade", async () => {
    const name = `ib-analyzer-v8-migration-unreadable-test-${Date.now()}`;
    const legacy = new LegacyDatabaseV7(name);
    await legacy.open();
    const row = (source: string, externalId: string, when: string) => ({
      accountId: "beta", externalId, source, kind: "trade", symbol: "IQZA", secType: "STK", right: "", strike: null,
      expiry: null, quantity: 100, price: 60, amount: -6000, commission: null, currency: "USD", when, description: "",
    });
    await legacy.table("transactions").bulkPut([
      row("agent", "agent:bad", "not a date"),
      row("agent", "agent:good", "2026-09-16T02:13:46.000Z"),
    ]);
    await legacy.table("snapshots").bulkPut([
      { accountId: "alpha", source: "agent", asOf: "not a date", importedAt: "2026-09-16T15:04:27.000Z", positions: [], cashAvailable: null },
    ]);
    legacy.close();

    const upgraded = new AppDatabase(name);
    await upgraded.open();
    try {
      expect(upgraded.verno).toBe(9);
      expect((await upgraded.transactions.get(["beta", "agent:bad"]))?.when).toBe("not a date");
      expect((await upgraded.transactions.get(["beta", "agent:good"]))?.when).toBe("2026-09-15T22:13:46.000Z");
      expect((await upgraded.snapshots.get("alpha"))?.asOf).toBe("not a date");
    } finally {
      upgraded.close();
      await upgraded.delete();
    }
  });
});

/** The schema as it stood right before version 9: version 8 touched no store, only rows. */
class LegacyDatabaseV8 extends LegacyDatabaseV7 {
  constructor(name: string) {
    super(name);
    this.version(8).stores({});
  }
}

describe("AppDatabase version 9", () => {
  const position = (overrides: Record<string, unknown> = {}) => ({
    symbol: "AAPL", secType: "STK", right: "", strike: null, expiry: null, multiplier: null,
    quantity: 100, avgPrice: 150, marketPrice: 160, marketValue: 16000, unrealizedPnl: 1000,
    currency: "USD", conid: "265598",
    ...overrides,
  });

  it("gives a stored snapshot's positions the two day fields, at null", async () => {
    const name = `ib-analyzer-v9-migration-test-${Date.now()}`;
    const legacy = new LegacyDatabaseV8(name);
    await legacy.open();
    // A snapshot written before sub-project 23 has neither field: the fixture below omits them,
    // exactly like every stored row does today.
    await legacy.table("snapshots").put({
      accountId: "alpha", source: "agent", asOf: "2026-09-17T15:04:26.000Z",
      importedAt: "2026-09-17T15:04:27.000Z", positions: [position()], cashAvailable: 500,
    });
    legacy.close();

    const upgraded = new AppDatabase(name);
    await upgraded.open();
    try {
      expect(upgraded.verno).toBe(9);
      const snapshot = await upgraded.snapshots.get("alpha");
      expect(snapshot?.positions[0]).toMatchObject({ dailyPnl: null, dayChange: null });
    } finally {
      upgraded.close();
      await upgraded.delete();
    }
  });

  it("leaves a position's day fields alone when it already carries them, and tolerates a snapshot with no positions array", async () => {
    const name = `ib-analyzer-v9-migration-edge-test-${Date.now()}`;
    const legacy = new LegacyDatabaseV8(name);
    await legacy.open();
    await legacy.table("snapshots").bulkPut([
      {
        // A position already carrying a value — an agent sync landed before this tab reopened —
        // must not be clobbered back to null by `??=`.
        accountId: "beta", source: "agent", asOf: "2026-09-17T15:04:26.000Z",
        importedAt: "2026-09-17T15:04:27.000Z",
        positions: [position({ dailyPnl: 0, dayChange: -0.1 })], cashAvailable: null,
      },
      {
        // No positions array at all must not throw inside `modify` and abort the whole upgrade.
        accountId: "gamma", source: "flex", asOf: "2025-12-31", importedAt: "2026-09-17T15:04:27.000Z",
        cashAvailable: null,
      },
    ]);
    legacy.close();

    const upgraded = new AppDatabase(name);
    await upgraded.open();
    try {
      expect(upgraded.verno).toBe(9);
      const beta = await upgraded.snapshots.get("beta");
      expect(beta?.positions[0]).toMatchObject({ dailyPnl: 0, dayChange: -0.1 });
      const gamma = await upgraded.snapshots.get("gamma");
      expect(gamma?.positions).toBeUndefined();
    } finally {
      upgraded.close();
      await upgraded.delete();
    }
  });
});
