import { beforeEach, describe, expect, it } from "vitest";
import flexXml from "../../../../packages/ib-parsers/tests/fixtures/flex_activity_sample.xml?raw";
import statementHtml from "../../../../packages/ib-parsers/tests/fixtures/activity_statement_sample.htm?raw";
import { clearDerived } from "@/db/clearDerived";
import { importFile } from "@/db/importFile";
import { replayStatements } from "@/db/replayStatements";
import { AppDatabase, type AccountRecord } from "@/db/schema";

const account: AccountRecord = { id: "test", label: "Test", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [] };
let db: AppDatabase;

beforeEach(() => {
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
});

const file = (content: string, name: string) => new File([content], name, { type: "text/plain" });

describe("clearDerived", () => {
  it("empties the five tables an import feeds", async () => {
    await db.accounts.put(account);
    await importFile(db, account, file(flexXml, "flex.xml"));
    await importFile(db, account, file(statementHtml, "2025.htm"));
    expect(await db.transactions.count()).toBeGreaterThan(0);
    expect(await db.contracts.count()).toBeGreaterThan(0);
    expect(await db.snapshots.count()).toBe(1);
    expect(await db.cashPoints.count()).toBe(4);
    expect(await db.imports.count()).toBe(2);

    const report = await clearDerived(db, account);

    expect(await db.transactions.count()).toBe(0);
    expect(await db.contracts.count()).toBe(0);
    expect(await db.snapshots.count()).toBe(0);
    expect(await db.cashPoints.count()).toBe(0);
    expect(await db.imports.count()).toBe(0);
    expect(report).toEqual({ transactions: expect.any(Number), contracts: expect.any(Number), snapshots: 1, cashPoints: 4, imports: 2 });
  });

  it("touches no other account", async () => {
    const other: AccountRecord = { ...account, id: "other", label: "Other" };
    await db.accounts.bulkPut([account, other]);
    await importFile(db, account, file(flexXml, "flex.xml"));
    await importFile(db, other, file(flexXml, "flex.xml"));
    const kept = {
      transactions: await db.transactions.where("accountId").equals("other").toArray(),
      contracts: await db.contracts.where("accountId").equals("other").toArray(),
      snapshot: await db.snapshots.get("other"),
      cashPoints: await db.cashPoints.where("accountId").equals("other").toArray(),
      imports: await db.imports.where("accountId").equals("other").toArray(),
    };

    await clearDerived(db, account);

    expect(await db.transactions.where("accountId").equals("other").toArray()).toEqual(kept.transactions);
    expect(await db.contracts.where("accountId").equals("other").toArray()).toEqual(kept.contracts);
    expect(await db.snapshots.get("other")).toEqual(kept.snapshot);
    expect(await db.cashPoints.where("accountId").equals("other").toArray()).toEqual(kept.cashPoints);
    expect(await db.imports.where("accountId").equals("other").toArray()).toEqual(kept.imports);
  });

  it("keeps the configuration, the statements and the sector table", async () => {
    const configured: AccountRecord = { ...account, flexToken: "secret", flexQueryId: "42", twsPort: 7496 };
    await db.accounts.put(configured);
    await db.sectors.put({ ticker: "AAPL", name: "Apple", category: "Tech", score: 3, status: "ok", updatedAt: "" });
    await importFile(db, configured, file(statementHtml, "2025.htm"));
    const statements = await db.statements.where("accountId").equals("test").toArray();
    expect(statements).toHaveLength(1);
    // Includes the tickers importFile itself just added: clearDerived purges no sector row.
    const sectors = await db.sectors.toArray();
    expect(sectors.length).toBeGreaterThan(1);

    await clearDerived(db, configured);

    expect(await db.accounts.get("test")).toEqual(configured);
    expect(await db.statements.where("accountId").equals("test").toArray()).toEqual(statements);
    expect(await db.sectors.toArray()).toEqual(sectors);
  });

  it("lets a statement replay bring the positions and the cash points back from the files", async () => {
    await db.accounts.put(account);
    await importFile(db, account, file(statementHtml, "2025.htm"));
    await clearDerived(db, account);
    expect(await db.snapshots.count()).toBe(0);

    await replayStatements(db, account);

    expect(await db.snapshots.get("test")).toMatchObject({ source: "statement_html" });
    expect(await db.cashPoints.count()).toBe(4);
  });
});
