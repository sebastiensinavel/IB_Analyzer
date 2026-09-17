import { planImport, type DroppedCount, type TransactionSource } from "@ib/ledger";
import { hasErrors, parseActivityStatement, parseFlexXml, type ParseIssue } from "@ib/ib-parsers";
import { byteLength } from "@/lib/format";
import { readFileText } from "./readFile";
import { statementId, type AccountRecord, type AppDatabase } from "./schema";
import { shouldReplaceSnapshot } from "./snapshot";
import { mergeContractRecords } from "./contracts";
import { mergeCashPoints } from "./cashPoints";
import { addMissingSectors } from "./sectors";

export type ImportFormat = Extract<TransactionSource, "flex" | "statement_html">;

export type ImportReport =
  | { status: "error"; fileName: string; source: ImportFormat | null; issues: ParseIssue[] }
  | {
      status: "ok";
      fileName: string;
      source: ImportFormat;
      period: { start: string; end: string };
      imported: number;
      skipped: number;
      /** Only the kinds not yet reported on this account. */
      dropped: DroppedCount[];
      issues: ParseIssue[];
      /** Positions written as the account's snapshot; `null` when the file carried none or was older. */
      positions: number | null;
      cashAvailable: number | null;
      /** The file's positions were older than the cached ones and were ignored. */
      staleSnapshot: boolean;
    };

type ErrorReport = Extract<ImportReport, { status: "error" }>;

/** A file read and parsed without error, nothing written yet. */
interface ParsedFile {
  status: "parsed";
  fileName: string;
  text: string;
  source: ImportFormat;
  period: { start: string; end: string };
  parsed: ReturnType<typeof parseFlexXml> | ReturnType<typeof parseActivityStatement>;
}

export function detectFormat(text: string): ImportFormat | null {
  const head = text.slice(0, 4000);
  if (/<FlexQueryResponse\b/.test(head)) return "flex";
  if (/<html\b/i.test(head)) return "statement_html";
  return null;
}

/**
 * The order "Relire les relevés" replays statements in, and a batch of files is written in:
 * by declared period, then by file name. One definition, so a batch leaves what a rebuild would.
 */
export function compareByPeriod(
  a: { period: { start: string; end: string }; fileName: string },
  b: { period: { start: string; end: string }; fileName: string },
): number {
  return a.period.start.localeCompare(b.period.start) || a.period.end.localeCompare(b.period.end) || a.fileName.localeCompare(b.fileName);
}

/**
 * File -> parse -> plan -> one IndexedDB transaction. A parse error writes
 * nothing; a failure inside the transaction rolls everything back.
 *
 * The account and the existing ledger are re-read inside the transaction, so
 * `account.warnedDroppedKinds` here is only used to identify the account
 * (`account.id`); the "already warned about" set actually compared is the
 * one read fresh from `db.accounts` at write time. Callers must still wrap
 * this call in `withImportLock` (see `importLock.ts`): the lock serializes
 * imports across their whole lifetime (parse included), while this
 * in-transaction read only protects the plan itself from a concurrent
 * writer.
 */
export async function importFile(db: AppDatabase, account: AccountRecord, file: File): Promise<ImportReport> {
  const read = await parseFile(account, file);
  return read.status === "error" ? read : writeFile(db, account, read);
}

/**
 * Several files picked together. All are read and parsed first, then written one by one in
 * `compareByPeriod` order, whatever the order they were picked in. Each keeps its own
 * transaction: a refused or failed file writes nothing, and the others still go in.
 *
 * Never rejects: a failure becomes that file's report. Written files are reported in the order
 * they were written, refused ones after them in the order they were picked. Callers hold
 * `withImportLock` around the whole batch, so no sync slips in between two of its files.
 */
export async function importFiles(db: AppDatabase, account: AccountRecord, files: readonly File[]): Promise<ImportReport[]> {
  const ready: ParsedFile[] = [];
  const refused: ImportReport[] = [];
  for (const file of files) {
    try {
      const read = await parseFile(account, file);
      if (read.status === "error") refused.push(read);
      else ready.push(read);
    } catch (e) {
      refused.push(failure(file.name, null, e));
    }
  }
  ready.sort(compareByPeriod);
  const written: ImportReport[] = [];
  for (const read of ready) {
    try {
      written.push(await writeFile(db, account, read));
    } catch (e) {
      written.push(failure(read.fileName, read.source, e));
    }
  }
  return [...written, ...refused];
}

/**
 * An unexpected rejection (a Dexie transaction failure, for example) must still reach the user
 * through the same report card, not vanish as an unhandled promise rejection.
 */
function failure(fileName: string, source: ImportFormat | null, e: unknown): ErrorReport {
  return {
    status: "error",
    fileName,
    source,
    issues: [{ severity: "error", code: "normalization", detail: e instanceof Error ? e.message : String(e) }],
  };
}

async function parseFile(account: AccountRecord, file: File): Promise<ParsedFile | ErrorReport> {
  const text = await readFileText(file);
  const source = detectFormat(text);
  if (!source) {
    return {
      status: "error",
      fileName: file.name,
      source: null,
      issues: [{ severity: "error", code: "normalization", detail: "Unrecognized file: expected a Flex query XML or an activity statement HTML" }],
    };
  }

  const target = { accountId: account.id, ibAccountId: account.ibAccountId };
  const parsed = source === "flex" ? parseFlexXml(text, target) : parseActivityStatement(text, target);
  if (hasErrors(parsed.issues) || !parsed.statement) {
    return { status: "error", fileName: file.name, source, issues: parsed.issues };
  }
  const period =
    "fromDate" in parsed.statement
      ? { start: parsed.statement.fromDate, end: parsed.statement.toDate }
      : { start: parsed.statement.periodStart, end: parsed.statement.periodEnd };
  return { status: "parsed", fileName: file.name, text, source, period, parsed };
}

async function writeFile(db: AppDatabase, account: AccountRecord, read: ParsedFile): Promise<ImportReport> {
  const { fileName, text, source, period, parsed } = read;
  let plan!: ReturnType<typeof planImport>;
  let newlyDropped: DroppedCount[] = [];
  const at = new Date().toISOString();

  const snapshot = parsed.snapshot;
  let positionsWritten: number | null = null;
  // What this import actually wrote to the snapshot, not what the file (possibly rejected as stale) reported.
  let cashWritten: number | null = null;
  let staleSnapshot = false;

  // Eight tables: past five, Dexie's typed overloads want the array form.
  await db.transaction(
    "rw",
    [db.transactions, db.imports, db.accounts, db.snapshots, db.statements, db.contracts, db.cashPoints, db.sectors],
    async () => {
    // Read inside the transaction: a concurrent import must not make this plan
    // stale between the read and the write.
    const fresh = (await db.accounts.get(account.id)) ?? account;
    const existing = await db.transactions.where("accountId").equals(account.id).toArray();
    plan = planImport(existing, { source, transactions: parsed.transactions, period });
    newlyDropped = plan.dropped.filter((d) => !fresh.warnedDroppedKinds.includes(d.kind));

    await db.transactions.bulkDelete(plan.delete.map((externalId) => [account.id, externalId]));
    await db.transactions.bulkPut(plan.upsert);
    if (snapshot) {
      const current = await db.snapshots.get(account.id);
      if (shouldReplaceSnapshot(current, { source, asOf: snapshot.asOf })) {
        await db.snapshots.put({
          accountId: account.id,
          source,
          asOf: snapshot.asOf,
          importedAt: at,
          positions: snapshot.positions,
          cashAvailable: snapshot.cashAvailable,
        });
        positionsWritten = snapshot.positions.length;
        cashWritten = snapshot.cashAvailable;
      } else {
        staleSnapshot = true;
      }
    }
    if (parsed.cashReport) {
      const currentPoints = await db.cashPoints.where("accountId").equals(account.id).toArray();
      await db.cashPoints.bulkPut(mergeCashPoints(account.id, currentPoints, parsed.cashReport, source, at));
    }
    if (source === "statement_html") {
      // Kept so `replayStatements` can rebuild the ledger from the files themselves.
      // A Flex response is never kept: it is one proxy call away.
      await db.statements.put({
        id: statementId(account.id, period),
        accountId: account.id,
        fileName,
        period,
        importedAt: at,
        text,
        bytes: byteLength(text),
      });
    }
    // Every row the file parsed, including one `planImport` chose not to write: a conid and
    // its ticker are true whatever the range that row falls in, and the table only ever merges.
    const identities = "identities" in parsed ? parsed.identities : [];
    if (identities.length > 0) {
      const current = await db.contracts.where("accountId").equals(account.id).toArray();
      await db.contracts.bulkPut(mergeContractRecords(account.id, current, identities, period, at));
    }
    // Every share and option the file read, for the same reason as the contracts above: a new
    // ticker enters the sector table, a known one is never touched.
    await addMissingSectors(db, { transactions: parsed.transactions, positions: snapshot?.positions ?? [], identities }, at);
    await db.imports.add({
      accountId: account.id,
      source,
      at,
      fileName,
      period,
      imported: plan.upsert.length,
      skipped: plan.skipped,
      dropped: plan.dropped,
      issues: parsed.issues,
      positions: positionsWritten,
      cashAvailable: cashWritten,
    });
    if (newlyDropped.length > 0) {
      await db.accounts.update(account.id, {
        warnedDroppedKinds: [...fresh.warnedDroppedKinds, ...newlyDropped.map((d) => d.kind)],
      });
    }
    },
  );

  return {
    status: "ok",
    fileName,
    source,
    period,
    imported: plan.upsert.length,
    skipped: plan.skipped,
    dropped: newlyDropped,
    issues: parsed.issues,
    positions: positionsWritten,
    cashAvailable: cashWritten,
    staleSnapshot,
  };
}
