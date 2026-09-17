import { beforeEach, describe, expect, it } from "vitest";
import { anchoredBalances, buildJournals, wheelHoldings } from "@ib/ledger";
import { db } from "@/db/schema";
import { seedAccounts, seedDemo } from "@/mocks/seed";

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe("seedAccounts", () => {
  it("creates the two demo accounts and nothing else: a first visit", async () => {
    await seedAccounts();
    expect((await db.accounts.toArray()).map((a) => a.id).sort()).toEqual(["alpha", "beta"]);
    for (const table of [db.transactions, db.snapshots, db.cashPoints, db.statements, db.sectors, db.imports, db.contracts]) {
      expect(await table.count()).toBe(0);
    }
  });
});

describe("seedDemo", () => {
  it("seeds cash points that match each demo ledger exactly", async () => {
    await seedDemo();
    for (const accountId of ["alpha", "beta"]) {
      const ledger = await db.transactions.where("accountId").equals(accountId).toArray();
      const points = await db.cashPoints.where("accountId").equals(accountId).toArray();
      const { checks } = anchoredBalances(ledger, ["USD", "EUR"], points);
      for (const check of checks) {
        expect(check.end).not.toBeNull();
        expect(check.start?.gap).toBe(0);
      }
    }
  });

  it("seeds on beta every strategy open and matching its snapshot: a put beside assigned shares, a LEAPS, a condor, in four sectors", async () => {
    await seedDemo();
    const ledger = await db.transactions.where("accountId").equals("beta").toArray();
    const snapshot = await db.snapshots.where("accountId").equals("beta").first();
    const report = buildJournals(ledger, snapshot ? { asOf: snapshot.asOf, positions: snapshot.positions } : undefined);
    expect(report.reconciliation.differences).toEqual([]);
    expect(report.capital.wheel[0].exposure).toEqual([
      { ticker: "MQZA", assigned: 3400, putCash: 0, leaps: 0, condors: 0 },
      { ticker: "XOM", assigned: 0, putCash: 11000, leaps: 0, condors: 0 },
    ]);
    expect(report.capital.portfolio[0].exposure).toEqual([
      { ticker: "MQZA", assigned: 3400, putCash: 0, leaps: 0, condors: 0 },
      { ticker: "QQQ", assigned: 0, putCash: 0, leaps: 0, condors: 500 },
      { ticker: "XOM", assigned: 0, putCash: 11000, leaps: 0, condors: 0 },
      { ticker: "ZZZ", assigned: 0, putCash: 0, leaps: 300, condors: 0 },
    ]);
    const sectors = await db.sectors.bulkGet(["MQZA", "QQQ", "XOM", "ZZZ"]);
    expect(sectors.map((s) => s?.category)).toEqual(["Crypto", "ETF", "Energy", "Materials"]);

    // A Wheel call struck below the assignment price, for the yellow cell of the Wheel positions page.
    expect(wheelHoldings(report.rows)).toEqual([
      { ticker: "MQZA", currency: "USD", quantity: 200, averageAssignmentPrice: 17, assignedTotal: 3400, openCallContracts: 1, averageCallStrike: 15, coveredShares: 100 },
    ]);
  });
});
