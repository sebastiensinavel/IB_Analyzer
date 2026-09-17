import { beforeEach, describe, expect, it, vi } from "vitest";
import flexXml from "../../../../packages/ib-parsers/tests/fixtures/flex_activity_sample.xml?raw";
import statementHtml from "../../../../packages/ib-parsers/tests/fixtures/activity_statement_sample.htm?raw";
import { detectFormat, importFile, importFiles } from "@/db/importFile";
import { withImportLock } from "./importLock";
import { AppDatabase, type AccountRecord, type SectorRecord } from "@/db/schema";

const account: AccountRecord = { id: "test", label: "Test", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [] };
let db: AppDatabase;

beforeEach(() => {
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
});

const file = (content: string, name: string) => new File([content], name, { type: "text/plain" });

/** The fixture again, declaring 2024: an older statement with the very same sections. */
const olderStatement = statementHtml.replace(
  "Activity Statement January 1, 2025 - December 31, 2025",
  "Activity Statement January 1, 2024 - December 31, 2024",
);

/** The account's cash points in a stable order, without the instant of the write. */
async function pointsOf() {
  const rows = await db.cashPoints.where("accountId").equals("test").toArray();
  return rows
    .map(({ importedAt: _importedAt, accountId: _accountId, ...rest }) => rest)
    .sort((a, b) => `${a.currency}|${a.kind}`.localeCompare(`${b.currency}|${b.kind}`));
}

describe("detectFormat", () => {
  it("tells a Flex response from a statement from anything else", () => {
    expect(detectFormat(flexXml)).toBe("flex");
    expect(detectFormat(statementHtml)).toBe("statement_html");
    expect(detectFormat("{}")).toBeNull();
  });
});

describe("importFile", () => {
  it("imports a Flex file and records the import", async () => {
    const report = await importFile(db, account, file(flexXml, "flex.xml"));
    expect(report).toMatchObject({ status: "ok", source: "flex", fileName: "flex.xml", skipped: 0, dropped: [] });
    expect(await db.transactions.where("accountId").equals("test").count()).toBe(report.status === "ok" ? report.imported : -1);
    const [record] = await db.imports.toArray();
    expect(record).toMatchObject({ accountId: "test", source: "flex", fileName: "flex.xml", period: { start: "2025-09-03", end: "2026-09-02" } });
  });

  it("is idempotent: the same file twice leaves the same rows", async () => {
    await importFile(db, account, file(flexXml, "flex.xml"));
    const before = await db.transactions.count();
    await importFile(db, account, file(flexXml, "flex.xml"));
    expect(await db.transactions.count()).toBe(before);
    expect(await db.imports.count()).toBe(2);
  });

  it("imports a statement before Flex and skips the rows Flex owns", async () => {
    // The statement covers 2025; the Flex fixture starts in late 2025.
    await importFile(db, account, file(flexXml, "flex.xml"));
    const flexRows = await db.transactions.where("accountId").equals("test").toArray();
    const firstFlexDay = flexRows.map((t) => t.when).sort()[0].slice(0, 10);

    const report = await importFile(db, account, file(statementHtml, "2025.htm"));
    expect(report.status).toBe("ok");
    const htmlRows = (await db.transactions.toArray()).filter((t) => t.source === "statement_html");
    expect(htmlRows.length).toBeGreaterThan(0);
    for (const row of htmlRows) expect(row.when.slice(0, 10) < firstFlexDay).toBe(true);
    expect(await db.transactions.count()).toBe(flexRows.length + htmlRows.length);
  });

  it("leaves out a Flex row dated before the window it declares, and the statement months it would have claimed", async () => {
    // IB books an adjustment with the date of the operation it corrects, months before the
    // window of the query. Owning that day would delete statement rows the response has
    // nothing to replace (`planFlex`, spec §6.2).
    const late = /<CashTransaction [^>]*\/>/.exec(flexXml)![0]
      .replace(/dateTime="\d+"/, 'dateTime="20250401"')
      .replace(/transactionID="\d+"/, 'transactionID="1000999"');
    const poisoned = flexXml.replace("<CashTransactions>", `<CashTransactions>${late}`);

    await importFile(db, account, file(statementHtml, "2025.htm"));
    const statementRows = (await db.transactions.toArray()).filter((tx) => tx.source === "statement_html");
    const inBetween = statementRows.filter((tx) => tx.when >= "2025-04-01" && tx.when < "2025-09-03");
    expect(inBetween.length).toBeGreaterThan(0);

    const report = await importFile(db, account, file(poisoned, "flex.xml"));
    expect(report).toMatchObject({ status: "ok", skipped: 1 });
    const after = await db.transactions.toArray();
    // Nothing of the adjustment was written, so it never becomes the oldest Flex row either.
    expect(after.filter((tx) => tx.source === "flex" && tx.when < "2025-09-03")).toEqual([]);
    // The statement keeps every row Flex did not actually report on: the months in between.
    const kept = new Set(after.map((tx) => tx.externalId));
    const firstFlexDay = after.filter((tx) => tx.source === "flex").map((tx) => tx.when).sort()[0];
    for (const tx of statementRows.filter((tx) => tx.when < firstFlexDay)) expect(kept.has(tx.externalId)).toBe(true);
    expect(inBetween.every((tx) => kept.has(tx.externalId))).toBe(true);
  });

  it("re-importing an overlapping statement replaces, never duplicates", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    const before = await db.transactions.count();
    await importFile(db, account, file(statementHtml, "2025-again.htm"));
    expect(await db.transactions.count()).toBe(before);
  });

  it("reports what a Flex import dropped, once per kind, and remembers it on the account", async () => {
    await db.accounts.add(account);
    const inside = (externalId: string, when: string) => ({
      accountId: "test", externalId, source: "statement_html" as const, kind: "transfer" as const, symbol: "", secType: "",
      right: "" as const, strike: null, expiry: null, quantity: null, price: null, amount: 5, commission: null,
      currency: "USD", when, description: "statement row inside the Flex range",
    });
    await db.transactions.put(inside("html:inside", "2026-06-01T00:00:00.000Z"));

    const first = await importFile(db, account, file(flexXml, "flex.xml"));
    expect(first).toMatchObject({ status: "ok", dropped: [{ kind: "transfer", count: 1 }] });
    expect(await db.transactions.get(["test", "html:inside"])).toBeUndefined();
    const updated = (await db.accounts.get("test"))!;
    expect(updated.warnedDroppedKinds).toEqual(["transfer"]);

    await db.transactions.put(inside("html:inside2", "2026-06-02T00:00:00.000Z"));
    const second = await importFile(db, updated, file(flexXml, "flex.xml"));
    expect(second).toMatchObject({ status: "ok", dropped: [] });
    const [, record] = await db.imports.orderBy("id").toArray();
    // The import record keeps the full count; only the report filters it.
    expect(record.dropped).toEqual([{ kind: "transfer", count: 1 }]);
  });

  it("writes nothing and reports the error on a file of another account", async () => {
    const report = await importFile(db, { ...account, ibAccountId: "U9999999" }, file(flexXml, "flex.xml"));
    expect(report).toMatchObject({ status: "error", source: "flex" });
    expect(report.issues[0]).toMatchObject({ code: "account-mismatch" });
    expect(await db.transactions.count()).toBe(0);
    expect(await db.imports.count()).toBe(0);
  });

  it("writes nothing on an unrecognized file", async () => {
    const report = await importFile(db, account, file("hello", "notes.txt"));
    expect(report).toMatchObject({ status: "error", source: null });
    expect(await db.transactions.count()).toBe(0);
  });

  it("keeps the parser's warnings in the report and in the import record", async () => {
    // The real export now carries every section, so parsing it produces no warning
    // any more; strip Open Positions back out of an otherwise-real file to give the
    // parser a genuine one to report.
    const withoutOpenPositions = flexXml.replace(/<OpenPositions>[\s\S]*?<\/OpenPositions>/, "");
    const report = await importFile(db, account, file(withoutOpenPositions, "flex.xml"));
    expect(report.issues).toContainEqual({ severity: "warning", code: "section-missing", detail: "Open Positions" });
    const [record] = await db.imports.toArray();
    expect(record.issues).toEqual(report.issues);
  });

  it("rolls back every write when a step inside the transaction fails", async () => {
    // Dexie's own "creating" hook fires synchronously as part of the write
    // that produces the `imports` row, inside the same transaction. Throwing
    // from it is a genuine failure of one of the transacted writes, not a
    // mock that bypasses Dexie's transaction machinery: it exercises the
    // real abort path, so the assertions below prove real rollback.
    const boom = new Error("boom");
    db.imports.hook("creating", () => {
      throw boom;
    });

    await expect(importFile(db, account, file(flexXml, "flex.xml"))).rejects.toThrow("boom");
    expect(await db.transactions.count()).toBe(0);
    expect(await db.imports.count()).toBe(0);
  });

  it("stores the statement's own declared period, not the Flex field names", async () => {
    const report = await importFile(db, account, file(statementHtml, "2025.htm"));
    expect(report).toMatchObject({ status: "ok", period: { start: "2025-01-01", end: "2025-12-31" } });
    const [record] = await db.imports.toArray();
    expect(record.period).toEqual({ start: "2025-01-01", end: "2025-12-31" });
  });

  it("two concurrent imports of the same account agree on one ledger", async () => {
    const flexFile = () => file(flexXml, "flex.xml");

    const [first, second] = await Promise.all([
      withImportLock("test", () => importFile(db, account, flexFile())),
      withImportLock("test", () => importFile(db, account, flexFile())),
    ]);

    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
    const rows = await db.transactions.where("accountId").equals("test").toArray();
    // The second import replaces the first one's range: no duplicate, no loss.
    expect(rows).toHaveLength((first as { imported: number }).imported);
    expect(await db.imports.where("accountId").equals("test").count()).toBe(2);
  });

  it("does not let a stale AccountRecord clobber warnedDroppedKinds written by an import in between", async () => {
    // Reproduces the debt exactly as the sub-project 2 review described it: two
    // callers holding the account from before an earlier importFile call. The plan
    // (and now the account's warnedDroppedKinds) must be re-read where it is
    // written, not trusted from whichever snapshot the caller happened to pass in.
    await db.accounts.add(account);
    const inside = (externalId: string, kind: "transfer" | "dividend", when: string) => ({
      accountId: "test", externalId, source: "statement_html" as const, kind, symbol: "", secType: "",
      right: "" as const, strike: null, expiry: null, quantity: null, price: null, amount: 5, commission: null,
      currency: "USD", when, description: "statement row inside the Flex range",
    });
    await db.transactions.put(inside("html:transfer", "transfer", "2026-06-01T00:00:00.000Z"));

    // `account` is the only reference the test holds; a caller that keeps it
    // around across two calls (e.g. React state not yet re-rendered) never
    // refreshes it itself.
    const first = await importFile(db, account, file(flexXml, "flex-a.xml"));
    expect(first).toMatchObject({ status: "ok", dropped: [{ kind: "transfer", count: 1 }] });
    expect((await db.accounts.get("test"))?.warnedDroppedKinds).toEqual(["transfer"]);

    await db.transactions.put(inside("html:dividend", "dividend", "2026-06-02T00:00:00.000Z"));
    // Passing the SAME stale `account` (warnedDroppedKinds still []) a second
    // time: a caller that never re-fetched it between the two calls.
    const second = await importFile(db, account, file(flexXml, "flex-b.xml"));
    expect(second).toMatchObject({ status: "ok", dropped: [{ kind: "dividend", count: 1 }] });

    // The account read fresh inside the transaction, not the stale parameter,
    // decides what's "already warned about": both kinds must survive.
    expect((await db.accounts.get("test"))?.warnedDroppedKinds).toEqual(["transfer", "dividend"]);
  });

  it("lets a Flex file of the same day replace an agent snapshot, whatever the asOf string order says", async () => {
    // "2026-09-02" < "2026-09-02T15:00:00.000Z" as strings: only the day rule lets the file in.
    await db.snapshots.put({ accountId: "test", source: "agent", asOf: "2026-09-02T15:00:00.000Z", importedAt: "", positions: [], cashAvailable: null });
    const report = await importFile(db, account, file(flexXml, "flex.xml"));
    expect(report).toMatchObject({ status: "ok", staleSnapshot: false });
    expect((await db.snapshots.get("test"))?.source).toBe("flex");
  });

  it("never lets a file older than the agent snapshot's day replace it", async () => {
    await db.snapshots.put({ accountId: "test", source: "agent", asOf: "2026-09-03T15:00:00.000Z", importedAt: "", positions: [], cashAvailable: null });
    const report = await importFile(db, account, file(flexXml, "flex.xml"));
    expect(report).toMatchObject({ status: "ok", staleSnapshot: true, positions: null });
    expect((await db.snapshots.get("test"))?.source).toBe("agent");
  });
});

describe("importFiles", () => {
  it("writes the files in the order of their declared periods, whatever the order they were picked in", async () => {
    // The order "Relire les relevés" replays them in: a batch leaves what a rebuild would.
    const reports = await importFiles(db, account, [
      file(flexXml, "flex.xml"),
      file(statementHtml, "2025.htm"),
      file(olderStatement, "2024.htm"),
    ]);
    expect(reports.map((r) => [r.status, r.fileName])).toEqual([
      ["ok", "2024.htm"],
      ["ok", "2025.htm"],
      ["ok", "flex.xml"],
    ]);
    expect((await db.imports.orderBy("id").toArray()).map((r) => r.fileName)).toEqual(["2024.htm", "2025.htm", "flex.xml"]);
  });

  it("writes the other files when one is refused, and reports the refused one after them", async () => {
    const reports = await importFiles(db, account, [file("hello", "notes.txt"), file(statementHtml, "2025.htm")]);
    expect(reports).toMatchObject([
      { status: "ok", fileName: "2025.htm" },
      { status: "error", fileName: "notes.txt", source: null },
    ]);
    expect((await db.imports.toArray()).map((r) => r.fileName)).toEqual(["2025.htm"]);
  });

  it("turns a failed transaction into that file's report, rolls back only that file, and carries on", async () => {
    // The statement comes first in period order: its transaction is the one that fails.
    const spy = vi.spyOn(db.imports, "add").mockRejectedValueOnce(new Error("boom"));
    try {
      const reports = await importFiles(db, account, [file(flexXml, "flex.xml"), file(statementHtml, "2025.htm")]);
      expect(reports).toMatchObject([
        { status: "error", fileName: "2025.htm", source: "statement_html", issues: [{ severity: "error", code: "normalization", detail: "boom" }] },
        { status: "ok", fileName: "flex.xml" },
      ]);
    } finally {
      spy.mockRestore();
    }
    expect(await db.statements.count()).toBe(0);
    expect(new Set((await db.transactions.toArray()).map((tx) => tx.source))).toEqual(new Set(["flex"]));
  });
});

describe("importFile: contract identities", () => {
  it("writes the contract identities of the file it imported", async () => {
    await importFile(db, account, file(statementHtml, "statement.htm"));
    const records = await db.contracts.where("accountId").equals(account.id).toArray();
    expect(records.map((r) => r.conid).sort()).toEqual(["700000001", "810000001", "900000105", "900000106"]);
    const quanergy = records.find((r) => r.conid === "900000106")!;
    expect(quanergy.aliases.map((a) => a.ticker)).toEqual(["ZXAB", "ZXABQ"]);
    expect(quanergy.aliases[0]).toMatchObject({ firstSeen: "2025-01-01", lastSeen: "2025-12-31" });
  });

  it("widens the window when the same statement is imported twice", async () => {
    await importFile(db, account, file(statementHtml, "statement.htm"));
    await importFile(db, account, file(statementHtml, "statement.htm"));
    const records = await db.contracts.where("accountId").equals(account.id).toArray();
    expect(records).toHaveLength(4);
  });

  it("rolls the contracts back with everything else when a later step of the transaction fails", async () => {
    // `db.imports.add` is the last write in the block, after the contracts write:
    // rejecting it forces a genuine in-transaction failure with `db.contracts.bulkPut`
    // already having run, not a parse error that never reaches the transaction.
    const spy = vi.spyOn(db.imports, "add").mockRejectedValueOnce(new Error("boom"));
    try {
      await expect(importFile(db, account, file(statementHtml, "statement.htm"))).rejects.toThrow("boom");
    } finally {
      spy.mockRestore();
    }
    expect(await db.contracts.count()).toBe(0);
    expect(await db.transactions.count()).toBe(0);
  });
});

describe("importFile: positions snapshot", () => {
  it("writes the Flex open positions and cash as the account's snapshot", async () => {
    const report = await importFile(db, account, file(flexXml, "flex.xml"));
    expect(report).toMatchObject({ status: "ok", positions: 30, staleSnapshot: false });
    expect(report.status === "ok" && report.cashAvailable).toBeGreaterThan(0);
    const snapshot = await db.snapshots.get("test");
    expect(snapshot).toMatchObject({ accountId: "test", source: "flex", asOf: "2026-09-02" });
    expect(snapshot?.positions).toHaveLength(30);
    const [record] = await db.imports.toArray();
    expect(record).toMatchObject({ positions: 30, cashAvailable: snapshot?.cashAvailable });
  });

  it("replaces the snapshot with a file of the same day, and keeps it against an older one", async () => {
    await importFile(db, account, file(flexXml, "flex.xml"));
    const first = await db.snapshots.get("test");

    const sameDay = await importFile(db, account, file(flexXml, "flex-again.xml"));
    expect(sameDay).toMatchObject({ status: "ok", positions: 30, staleSnapshot: false });
    expect((await db.snapshots.get("test"))?.importedAt).not.toBe(first?.importedAt);

    const older = flexXml.replaceAll('reportDate="20260902"', 'reportDate="20260101"');
    const report = await importFile(db, account, file(older, "old.xml"));
    expect(report).toMatchObject({ status: "ok", positions: null, cashAvailable: null, staleSnapshot: true });
    expect((await db.snapshots.get("test"))?.asOf).toBe("2026-09-02");
    expect(await db.snapshots.count()).toBe(1);
    const [, , staleRecord] = await db.imports.orderBy("id").toArray();
    expect(staleRecord).toMatchObject({ positions: null, cashAvailable: null });
  });

  it("keeps a newer Flex snapshot against an older statement, and says so", async () => {
    await importFile(db, account, file(flexXml, "flex.xml"));
    const report = await importFile(db, account, file(statementHtml, "2025.htm"));
    expect(report).toMatchObject({ status: "ok", positions: null, cashAvailable: null, staleSnapshot: true });
    expect(await db.snapshots.get("test")).toMatchObject({ source: "flex", asOf: "2026-09-02" });
  });

  it("leaves the snapshot alone on a Flex without Open Positions", async () => {
    await importFile(db, account, file(flexXml, "flex.xml"));
    const noPositions = flexXml.replace(/<OpenPositions>[\s\S]*?<\/OpenPositions>/, "");
    const report = await importFile(db, account, file(noPositions, "bare.xml"));
    expect(report).toMatchObject({ status: "ok", positions: null, cashAvailable: null, staleSnapshot: false });
    expect((await db.snapshots.get("test"))?.positions).toHaveLength(30);
  });

  it("scopes the snapshot to the account", async () => {
    const otherSnapshot = { accountId: "other", source: "flex" as const, asOf: "2020-01-01", importedAt: "2020-01-01T00:00:00.000Z", positions: [], cashAvailable: 42 };
    await db.snapshots.put(otherSnapshot);

    await importFile(db, account, file(flexXml, "flex.xml"));

    expect(await db.snapshots.get("other")).toEqual(otherSnapshot);
  });
});

describe("importFile and the statement store", () => {
  it("keeps the raw HTML of a statement, keyed by its declared period", async () => {
    const report = await importFile(db, account, file(statementHtml, "2025.htm"));
    expect(report.status).toBe("ok");
    const stored = await db.statements.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ accountId: "test", fileName: "2025.htm", text: statementHtml });
    expect(stored[0].id).toBe(`test|${stored[0].period.start}|${stored[0].period.end}`);
  });

  it("keeps nothing of a Flex response", async () => {
    await importFile(db, account, file(flexXml, "flex.xml"));
    expect(await db.statements.count()).toBe(0);
  });

  it("replaces the stored copy when the same period is imported again", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    await importFile(db, account, file(statementHtml, "2025 (1).htm"));
    const stored = await db.statements.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0].fileName).toBe("2025 (1).htm");
  });

  it("keeps nothing when the file cannot be parsed", async () => {
    const report = await importFile(db, account, file("<html><body>nothing</body></html>", "broken.htm"));
    expect(report.status).toBe("error");
    expect(await db.statements.count()).toBe(0);
  });
});

describe("importFile: a statement alone", () => {
  it("writes the statement's positions and cash as the account's snapshot", async () => {
    const report = await importFile(db, account, file(statementHtml, "2025.htm"));
    expect(report).toMatchObject({ status: "ok", positions: 3, cashAvailable: 2803.63, staleSnapshot: false });
    const snapshot = await db.snapshots.get("test");
    expect(snapshot).toMatchObject({ accountId: "test", source: "statement_html", asOf: "2025-12-31", cashAvailable: 2803.63 });
    expect(snapshot?.positions.map((p) => p.description)).toEqual(["TESTE", "TWINX", "TESTX 16JAN26 15 P"]);
    const [record] = await db.imports.toArray();
    expect(record).toMatchObject({ positions: 3, cashAvailable: 2803.63 });
  });

  it("lets a newer Flex replace the statement's snapshot", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    await importFile(db, account, file(flexXml, "flex.xml"));
    expect(await db.snapshots.get("test")).toMatchObject({ source: "flex", asOf: "2026-09-02" });
  });

  it("writes both cash points of every currency", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    expect(await pointsOf()).toEqual([
      { currency: "EUR", kind: "end", asOf: "2025-12-31", amount: 7597.7, source: "statement_html" },
      { currency: "EUR", kind: "start", asOf: "2025-01-01", amount: 0, source: "statement_html" },
      { currency: "USD", kind: "end", asOf: "2025-12-31", amount: 2803.63, source: "statement_html" },
      { currency: "USD", kind: "start", asOf: "2025-01-01", amount: 1000, source: "statement_html" },
    ]);
  });

  it("moves the end point forward and the start point back as the files come in", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    await importFile(db, account, file(flexXml, "flex.xml"));
    await importFile(db, account, file(olderStatement, "2024.htm"));
    expect(await pointsOf()).toEqual([
      { currency: "EUR", kind: "end", asOf: "2026-09-02", amount: 45.7032, source: "flex" },
      { currency: "EUR", kind: "start", asOf: "2024-01-01", amount: 0, source: "statement_html" },
      { currency: "USD", kind: "end", asOf: "2026-09-02", amount: 63448.2072, source: "flex" },
      { currency: "USD", kind: "start", asOf: "2024-01-01", amount: 1000, source: "statement_html" },
    ]);
  });

  it("keeps the statement's cash points through a Flex without Cash Report", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    const before = await pointsOf();
    const noCash = flexXml.replace(/<CashReport>[\s\S]*?<\/CashReport>/, "");
    await importFile(db, account, file(noCash, "flex.xml"));
    expect(await pointsOf()).toEqual(before);
  });

  it("rolls the cash points and the snapshot back with everything else", async () => {
    const spy = vi.spyOn(db.imports, "add").mockRejectedValueOnce(new Error("boom"));
    try {
      await expect(importFile(db, account, file(statementHtml, "2025.htm"))).rejects.toThrow("boom");
    } finally {
      spy.mockRestore();
    }
    expect(await db.cashPoints.count()).toBe(0);
    expect(await db.snapshots.count()).toBe(0);
    expect(await db.sectors.count()).toBe(0);
  });
});

describe("importFile: sector table", () => {
  it("adds every share and option ticker of a Flex file, named from its trades, and leaves a known row alone", async () => {
    const known: SectorRecord = { ticker: "SYM2", name: "Mine", category: "Tech", score: 8, status: "on", updatedAt: "2026-01-01T00:00:00.000Z" };
    await db.sectors.put(known);

    await importFile(db, account, file(flexXml, "flex.xml"));

    const expected = Array.from({ length: 23 }, (_, i) => `SYM${i + 1}`).sort();
    expect((await db.sectors.toCollection().primaryKeys()).sort()).toEqual(expected);
    expect(await db.sectors.get("SYM1")).toMatchObject({ name: "ANON ANON X INC", category: "", score: null, status: "" });
    // Seen only through options: no company name to take.
    expect(await db.sectors.get("SYM7")).toMatchObject({ name: "" });
    expect(await db.sectors.get("SYM2")).toEqual(known);
  });

  it("adds the tickers of a statement, never a cash pair nor a .OLD spelling", async () => {
    await importFile(db, account, file(statementHtml, "2025.htm"));
    expect((await db.sectors.toCollection().primaryKeys()).sort()).toEqual(["TESTC", "TESTE", "TESTH", "TESTP", "TESTX", "TWINX", "ZQX"]);
  });

  it("adds nothing when the file is refused", async () => {
    await importFile(db, account, file("{}", "nothing.json"));
    expect(await db.sectors.count()).toBe(0);
  });
});
