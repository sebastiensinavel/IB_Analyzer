import { beforeEach, describe, expect, it } from "vitest";
import flexXml from "../../../../packages/ib-parsers/tests/fixtures/flex_activity_sample.xml?raw";
import statementHtml from "../../../../packages/ib-parsers/tests/fixtures/activity_statement_sample.htm?raw";
import type { Transaction } from "@ib/ledger";
import { importFile } from "@/db/importFile";
import { countOrphanRows, deleteStatement, replayStatements } from "@/db/replayStatements";
import { AppDatabase, type AccountRecord, type SectorRecord } from "@/db/schema";

const account: AccountRecord = { id: "test", label: "Test", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [] };
let db: AppDatabase;

beforeEach(() => {
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
});

const file = (content: string, name: string) => new File([content], name, { type: "text/plain" });

/** The declared period lives in the title; this makes a second, older statement out of the fixture. */
const olderStatement = statementHtml.replace(
  "Activity Statement January 1, 2025 - December 31, 2025",
  "Activity Statement January 1, 2024 - December 31, 2024",
);

/** The account's contracts, in a stable order and without the instant of the last write. */
async function contractsOf() {
  const rows = await db.contracts.where("accountId").equals("test").toArray();
  return rows
    .sort((a, b) => a.conid.localeCompare(b.conid))
    .map(({ updatedAt: _updatedAt, ...rest }) => rest);
}

async function ledgerOf(): Promise<Transaction[]> {
  const rows = await db.transactions.where("accountId").equals("test").toArray();
  return rows.sort((a, b) => a.externalId.localeCompare(b.externalId));
}

async function pointsOf() {
  const rows = await db.cashPoints.where("accountId").equals("test").toArray();
  return rows
    .map(({ importedAt: _importedAt, accountId: _accountId, ...rest }) => rest)
    .sort((a, b) => `${a.currency}|${a.kind}`.localeCompare(`${b.currency}|${b.kind}`));
}

describe("replayStatements", () => {
  it("rebuilds the very ledger the imports had built", async () => {
    await importFile(db, account, file(flexXml, "flex.xml"));
    await importFile(db, account, file(statementHtml, "2025.htm"));
    const before = await ledgerOf();
    expect(before.some((tx) => tx.source === "statement_html")).toBe(true);

    const report = await replayStatements(db, account);

    expect(report).toMatchObject({ status: "ok", statements: 1 });
    expect(await ledgerOf()).toEqual(before);
  });

  it("never touches the rows of the other sources", async () => {
    await importFile(db, account, file(flexXml, "flex.xml"));
    await importFile(db, account, file(statementHtml, "2025.htm"));
    const agentRow = {
      accountId: "test", externalId: "agent:1", source: "agent" as const, kind: "trade" as const, symbol: "AAPL",
      secType: "STK", right: "" as const, strike: null, expiry: null, quantity: 1, price: 1, amount: -1,
      commission: null, currency: "USD", when: "2026-09-08T13:00:00.000Z", description: "agent fill",
    };
    await db.transactions.put(agentRow);
    const foreign = (await ledgerOf()).filter((tx) => tx.source !== "statement_html");

    await replayStatements(db, account);

    expect((await ledgerOf()).filter((tx) => tx.source !== "statement_html")).toEqual(foreign);
  });

  it("forgets the rows of a statement that is no longer stored", async () => {
    await importFile(db, account, file(flexXml, "flex.xml"));
    await importFile(db, account, file(statementHtml, "2025.htm"));
    const flexRows = (await ledgerOf()).filter((tx) => tx.source === "flex");
    await db.statements.clear();

    const report = await replayStatements(db, account);

    expect(report).toMatchObject({ status: "ok", statements: 0, imported: 0 });
    expect(await ledgerOf()).toEqual(flexRows);
  });

  it("writes nothing at all when a stored statement no longer parses", async () => {
    await importFile(db, account, file(flexXml, "flex.xml"));
    await importFile(db, account, file(statementHtml, "2025.htm"));
    const before = await ledgerOf();
    const importsBefore = await db.imports.count();
    const stored = (await db.statements.toArray())[0];
    await db.statements.put({ ...stored, text: "<html><body>gone</body></html>" });

    const report = await replayStatements(db, account);

    expect(report).toMatchObject({ status: "error", fileName: stored.fileName });
    expect(await ledgerOf()).toEqual(before);
    expect(await db.imports.count()).toBe(importsBefore);
  });

  it("records one import per statement, oldest declared period first", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    await importFile(db, account, file(olderStatement, "2024.htm"));
    await db.imports.clear();

    const report = await replayStatements(db, account);

    expect(report).toMatchObject({ status: "ok", statements: 2 });
    const records = await db.imports.orderBy("id").toArray();
    expect(records.map((r) => [r.fileName, r.period?.start])).toEqual([
      ["2024.htm", "2024-01-01"],
      ["2025.htm", "2025-01-01"],
    ]);
    for (const record of records) expect(record.source).toBe("statement_html");
  });

  it("treats two files declaring the same period as one statement", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    const stored = (await db.statements.toArray())[0];
    // A copy the store would never make on its own, but a re-keying can: same period, two rows.
    await db.statements.put({ ...stored, id: `${stored.id}|copy`, fileName: "2025-copy.htm" });

    const report = await replayStatements(db, account);

    expect(report).toMatchObject({ status: "ok", statements: 1 });
    expect((await db.statements.toArray()).map((s) => s.fileName)).toEqual(["2025.htm"]);
    expect(await db.imports.where("accountId").equals("test").count()).toBe(2);
  });

  it("re-keys a stored statement on the period the parser now reads", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    const stored = (await db.statements.toArray())[0];
    await db.statements.clear();
    await db.statements.put({ ...stored, id: "test|1999-01-01|1999-12-31", period: { start: "1999-01-01", end: "1999-12-31" } });

    await replayStatements(db, account);

    const after = await db.statements.toArray();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: stored.id, period: stored.period, fileName: "2025.htm" });
  });
});

describe("deleteStatement", () => {
  it("takes the rows of the deleted statement out of the ledger at once", async () => {
    await importFile(db, account, file(flexXml, "flex.xml"));
    await importFile(db, account, file(statementHtml, "2025.htm"));
    const flexRows = (await ledgerOf()).filter((tx) => tx.source === "flex");
    const stored = (await db.statements.toArray())[0];

    const report = await deleteStatement(db, account, stored.id);

    expect(report).toMatchObject({ status: "ok", statements: 0 });
    expect(await db.statements.count()).toBe(0);
    expect(await ledgerOf()).toEqual(flexRows);
  });

  it("leaves the other statements alone", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    await importFile(db, account, file(olderStatement, "2024.htm"));
    const older = (await db.statements.toArray()).find((s) => s.period.start === "2024-01-01")!;

    await deleteStatement(db, account, older.id);

    expect((await db.statements.toArray()).map((s) => s.fileName)).toEqual(["2025.htm"]);
    expect((await ledgerOf()).length).toBeGreaterThan(0);
  });

  it("keeps the deleted statement when the rebuild cannot run", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    await importFile(db, account, file(olderStatement, "2024.htm"));
    const good = (await db.statements.toArray()).find((s) => s.period.start === "2025-01-01")!;
    const broken = (await db.statements.toArray()).find((s) => s.period.start === "2024-01-01")!;
    await db.statements.put({ ...broken, text: "<html><body>gone</body></html>" });

    const report = await deleteStatement(db, account, good.id);

    // Nothing was written, so nothing was lost either: the file the user asked to
    // delete is still there to try again with.
    expect(report.status).toBe("error");
    expect((await db.statements.toArray()).map((s) => s.id).sort()).toEqual([broken.id, good.id].sort());
  });
});

describe("replayStatements: what a rebuild would drop", () => {
  it("counts the statement rows no kept file could write again", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    const kept = await db.transactions.where("accountId").equals("test").count();
    expect(await countOrphanRows(db, account)).toBe(0);

    // A row from a statement imported before the files were kept: outside every
    // declared period, so the rebuild would delete it with nothing to write back.
    await db.transactions.put({
      accountId: "test", externalId: "html:old", source: "statement_html", kind: "trade", symbol: "AAPL",
      secType: "STK", right: "", strike: null, expiry: null, quantity: 1, price: 1, amount: -1,
      commission: null, currency: "USD", when: "2019-05-02T13:00:00.000Z", description: "deep history",
    });

    expect(await countOrphanRows(db, account)).toBe(1);
    await replayStatements(db, account);
    expect(await db.transactions.where("accountId").equals("test").count()).toBe(kept);
  });

  it("puts back the contract identities its statements declare", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    const before = await contractsOf();
    expect(before.length).toBeGreaterThan(0);
    await db.contracts.clear();

    await replayStatements(db, account);

    expect(await contractsOf()).toEqual(before);
  });

  it("never drops a contract only another source knows", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    const foreign = {
      accountId: "test", conid: "999999", isin: "US0000000000", secType: "STK", currency: "USD",
      description: "Known to Flex alone", aliases: [{ ticker: "ZZZZ", firstSeen: "2020-01-01", lastSeen: "2020-12-31" }],
      updatedAt: "2020-12-31T00:00:00.000Z",
    };
    await db.contracts.put(foreign);

    await replayStatements(db, account);

    expect(await db.contracts.get(["test", "999999"])).toEqual(foreign);
  });
});

describe("replayStatements: positions and cash points", () => {
  it("puts back the snapshot of the latest statement", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    await importFile(db, account, file(olderStatement, "2024.htm"));
    await db.snapshots.clear();

    await replayStatements(db, account);

    expect(await db.snapshots.get("test")).toMatchObject({ source: "statement_html", asOf: "2025-12-31", cashAvailable: 2803.63 });
  });

  it("falls back on the statement that remains when the one holding the snapshot is deleted, and drops it with the last", async () => {
    await importFile(db, account, file(olderStatement, "2024.htm"));
    await importFile(db, account, file(statementHtml, "2025.htm"));
    const [older, newer] = (await db.statements.toArray()).sort((a, b) => a.period.start.localeCompare(b.period.start));

    await deleteStatement(db, account, newer.id);
    expect(await db.snapshots.get("test")).toMatchObject({ source: "statement_html", asOf: "2024-12-31" });

    await deleteStatement(db, account, older.id);
    expect(await db.snapshots.get("test")).toBeUndefined();
  });

  it("never touches a newer Flex snapshot", async () => {
    await importFile(db, account, file(flexXml, "flex.xml"));
    await importFile(db, account, file(statementHtml, "2025.htm"));
    const flexSnapshot = await db.snapshots.get("test");

    await replayStatements(db, account);

    expect(await db.snapshots.get("test")).toEqual(flexSnapshot);
  });

  it("replaces an older Flex snapshot, exactly as an import would", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    await db.snapshots.put({ accountId: "test", source: "flex", asOf: "2025-06-30", importedAt: "", positions: [], cashAvailable: null });

    await replayStatements(db, account);

    expect(await db.snapshots.get("test")).toMatchObject({ source: "statement_html", asOf: "2025-12-31" });
  });

  it("records the positions on the import of the statement that wrote the snapshot, and on no other", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    await importFile(db, account, file(olderStatement, "2024.htm"));
    await db.imports.clear();
    await db.snapshots.clear();

    await replayStatements(db, account);

    const records = await db.imports.orderBy("id").toArray();
    expect(records.map((r) => [r.fileName, r.positions, r.cashAvailable])).toEqual([
      ["2024.htm", null, null],
      ["2025.htm", 3, 2803.63],
    ]);
  });

  it("rebuilds the statement cash points over the Flex ones", async () => {
    await importFile(db, account, file(flexXml, "flex.xml"));
    await importFile(db, account, file(statementHtml, "2025.htm"));
    const before = await pointsOf();
    const usdStart = (await db.cashPoints.get(["test", "USD", "start"]))!;
    await db.cashPoints.put({ ...usdStart, amount: 42 });

    await replayStatements(db, account);

    expect(await pointsOf()).toEqual(before);
    expect(before.filter((p) => p.kind === "end").map((p) => p.source)).toEqual(["flex", "flex"]);
  });

  it("moves the start points back to the statement that remains, and forgets them with the last one", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    await importFile(db, account, file(olderStatement, "2024.htm"));
    const [older, newer] = (await db.statements.toArray()).sort((a, b) => a.period.start.localeCompare(b.period.start));

    await deleteStatement(db, account, older.id);
    expect((await pointsOf()).filter((p) => p.kind === "start").map((p) => p.asOf)).toEqual(["2025-01-01", "2025-01-01"]);

    await deleteStatement(db, account, newer.id);
    expect(await db.cashPoints.count()).toBe(0);
  });
});

describe("replayStatements: sector table", () => {
  it("re-adds the tickers of the statements it replays and leaves a known row alone", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    await db.sectors.clear();
    const known: SectorRecord = { ticker: "TESTX", name: "Mine", category: "Tech", score: 8, status: "on", updatedAt: "2026-01-01T00:00:00.000Z" };
    await db.sectors.put(known);

    await replayStatements(db, account);

    expect((await db.sectors.toCollection().primaryKeys()).sort()).toEqual(["TESTC", "TESTE", "TESTH", "TESTP", "TESTX", "TWINX", "ZQX"]);
    expect(await db.sectors.get("TESTX")).toEqual(known);
  });
});
