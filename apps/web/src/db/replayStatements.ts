import { dayOf, planImport, type Transaction } from "@ib/ledger";
import {
  hasErrors,
  parseActivityStatement,
  type CashReport,
  type ContractIdentity,
  type FileSnapshot,
  type ParseIssue,
} from "@ib/ib-parsers";
import { mergeCashPoints } from "./cashPoints";
import { compareByPeriod } from "./importFile";
import { mergeContractRecords, type ContractRecord } from "./contracts";
import { addMissingSectors } from "./sectors";
import { statementId, type AccountRecord, type AppDatabase, type CashPointRecord, type StatementRecord } from "./schema";
import { shouldReplaceSnapshot } from "./snapshot";

export type ReplayReport =
  | { status: "error"; fileName: string; issues: ParseIssue[] }
  | {
      status: "ok";
      /** Statements replayed. Zero is a legitimate outcome: it wipes the statement layer. */
      statements: number;
      /** Statement rows in the ledger once the rebuild is done. */
      imported: number;
      skipped: number;
      issues: ParseIssue[];
    };

export interface ReplayOptions {
  /** Statement to forget, dropped inside the rebuild's own transaction (see `deleteStatement`). */
  drop?: string;
}

interface ParsedStatement {
  id: string;
  fileName: string;
  text: string;
  bytes: number;
  importedAt: string;
  period: { start: string; end: string };
  transactions: readonly Transaction[];
  identities: readonly ContractIdentity[];
  issues: ParseIssue[];
  snapshot: FileSnapshot | null;
  cashReport: CashReport | null;
}

/**
 * Parses every statement kept for one account, in the order a rebuild would replay them:
 * by the period the parser reads today, which is the authority on both the order and the
 * key each file is stored under. Two files that declare the same period are the same
 * statement, so only the last of them survives.
 *
 * Returns the offending file instead of a list when one no longer parses: pure CPU work,
 * done before any transaction opens, so a rebuild aborts before deleting a single row.
 */
function parseAll(
  stored: readonly StatementRecord[],
  account: AccountRecord,
): { ok: true; parsed: ParsedStatement[] } | { ok: false; fileName: string; issues: ParseIssue[] } {
  const target = { accountId: account.id, ibAccountId: account.ibAccountId };
  const parsed: ParsedStatement[] = [];
  for (const record of stored) {
    const result = parseActivityStatement(record.text, target);
    if (hasErrors(result.issues) || !result.statement) {
      return { ok: false, fileName: record.fileName, issues: result.issues };
    }
    const period = { start: result.statement.periodStart, end: result.statement.periodEnd };
    parsed.push({
      id: statementId(account.id, period),
      fileName: record.fileName,
      text: record.text,
      bytes: record.bytes,
      importedAt: record.importedAt,
      period,
      transactions: result.transactions,
      identities: result.identities,
      issues: result.issues,
      snapshot: result.snapshot,
      cashReport: result.cashReport,
    });
  }
  parsed.sort(compareByPeriod);
  return { ok: true, parsed: [...new Map(parsed.map((statement) => [statement.id, statement])).values()] };
}

/**
 * Statement rows of the ledger that no kept file declares: a rebuild deletes the whole
 * statement layer, so these are the rows it would drop with nothing to write back.
 *
 * They are the deep history of statements imported before the files were kept — the very
 * history a user may no longer have the downloads for. The Sources page asks before a
 * rebuild that would lose them.
 */
export async function countOrphanRows(db: AppDatabase, account: AccountRecord): Promise<number> {
  const stored = await db.statements.where("accountId").equals(account.id).toArray();
  const result = parseAll(stored, account);
  const periods = result.ok ? result.parsed.map((statement) => statement.period) : [];
  const rows = await db.transactions.where("accountId").equals(account.id).toArray();
  return rows.filter((tx) => {
    if (tx.source !== "statement_html") return false;
    const day = dayOf(tx.when);
    return !periods.some((period) => day >= period.start && day <= period.end);
  }).length;
}

/**
 * Rebuilds the whole `statement_html` layer of one account from the files kept by
 * `importFile`. Flex and agent rows are never read for anything but the range they
 * own, and never written: only a statement's own layer is torn down and laid again.
 *
 * The purge is what a plain re-import cannot do. `planStatement` replaces a statement's
 * rows inside the period it declares; a row an older parser wrote *outside* that period
 * has nothing to replace it and would survive a re-import forever. The flip side is that
 * a rebuild also drops the rows of statements whose file is gone — see `countOrphanRows`.
 *
 * Callers must hold `withImportLock` (see `importLock.ts`), as for an import.
 */
export async function replayStatements(
  db: AppDatabase,
  account: AccountRecord,
  options: ReplayOptions = {},
): Promise<ReplayReport> {
  const stored = (await db.statements.where("accountId").equals(account.id).toArray()).filter(
    (record) => record.id !== options.drop,
  );
  const result = parseAll(stored, account);
  if (!result.ok) return { status: "error", fileName: result.fileName, issues: result.issues };
  const parsed = result.parsed;

  // The statement snapshot a rebuild stands on: the one of the latest declared period, the last in
  // replay order on a tie — the very one an import of every file in that order would leave.
  let latest: ParsedStatement | null = null;
  for (const statement of parsed) {
    if (statement.snapshot && (!latest || statement.period.end >= latest.period.end)) latest = statement;
  }

  const at = new Date().toISOString();
  let imported = 0;
  let skipped = 0;
  const issues: ParseIssue[] = [];

  await db.transaction(
    "rw",
    [db.transactions, db.imports, db.statements, db.contracts, db.snapshots, db.cashPoints, db.sectors],
    async () => {
    // A snapshot from a statement belongs to the statement layer and is rebuilt with it; a Flex or
    // agent snapshot is only replaced when an import of the latest statement would replace it.
    const currentSnapshot = await db.snapshots.get(account.id);
    const latestSnapshot = latest?.snapshot ?? null;
    const statementOwned = !currentSnapshot || currentSnapshot.source === "statement_html";
    const writeSnapshot =
      latestSnapshot !== null &&
      (statementOwned || shouldReplaceSnapshot(currentSnapshot, { source: "statement_html", asOf: latestSnapshot.asOf }));
    if (writeSnapshot) {
      await db.snapshots.put({
        accountId: account.id,
        source: "statement_html",
        asOf: latestSnapshot!.asOf,
        importedAt: at,
        positions: latestSnapshot!.positions,
        cashAvailable: latestSnapshot!.cashAvailable,
      });
    } else if (statementOwned && currentSnapshot) {
      await db.snapshots.delete(account.id);
    }

    // Cash points: those of the other sources stand, those of the statements are laid again.
    const kept = (await db.cashPoints.where("accountId").equals(account.id).toArray()).filter(
      (point) => point.source !== "statement_html",
    );
    await db.cashPoints.where("accountId").equals(account.id).filter((point) => point.source === "statement_html").delete();
    let points: CashPointRecord[] = kept;

    // Contracts are merged, never rebuilt: a conid a Flex response or an agent pass is the
    // only one to know has no statement to write it back, and a replay must not forget it.
    const contracts = new Map(
      (await db.contracts.where("accountId").equals(account.id).toArray()).map((record) => [record.conid, record]),
    );
    const changedContracts = new Map<string, ContractRecord>();
    const existing = await db.transactions.where("accountId").equals(account.id).toArray();
    const doomed = existing.filter((tx) => tx.source === "statement_html").map((tx) => tx.externalId);
    // The ledger the plans are computed against: the other sources as they stand, plus
    // the rows each statement lays down, so a later statement can still retire an
    // earlier one's rows over a period they share.
    const ledger = new Map<string, Transaction>(
      existing.filter((tx) => tx.source !== "statement_html").map((tx) => [tx.externalId, tx]),
    );

    for (const statement of parsed) {
      const plan = planImport([...ledger.values()], {
        source: "statement_html",
        transactions: statement.transactions,
        period: statement.period,
      });
      for (const record of mergeContractRecords(
        account.id,
        [...contracts.values()],
        statement.identities,
        statement.period,
        at,
      )) {
        contracts.set(record.conid, record);
        changedContracts.set(record.conid, record);
      }
      for (const externalId of plan.delete) ledger.delete(externalId);
      for (const tx of plan.upsert) ledger.set(tx.externalId, tx);
      skipped += plan.skipped;
      issues.push(...statement.issues);
      if (statement.cashReport) {
        const changed = mergeCashPoints(account.id, points, statement.cashReport, "statement_html", at);
        points = [...points.filter((p) => !changed.some((c) => c.currency === p.currency && c.kind === p.kind)), ...changed];
      }
      await db.imports.add({
        accountId: account.id,
        source: "statement_html",
        at,
        fileName: statement.fileName,
        period: statement.period,
        imported: plan.upsert.length,
        skipped: plan.skipped,
        // A statement never retires another source's rows.
        dropped: [],
        issues: statement.issues,
        positions: writeSnapshot && statement === latest ? latestSnapshot!.positions.length : null,
        cashAvailable: writeSnapshot && statement === latest ? latestSnapshot!.cashAvailable : null,
      });
    }

    const written = [...ledger.values()].filter((tx) => tx.source === "statement_html");
    // What the layer holds once rebuilt, not the sum of the plans: two statements sharing
    // a period write some of the same rows twice, and the user is told what is there.
    imported = written.length;
    await db.transactions.bulkDelete(doomed.map((externalId) => [account.id, externalId]));
    await db.transactions.bulkPut(written);
    await db.contracts.bulkPut([...changedContracts.values()]);
    await db.cashPoints.bulkPut(points.filter((point) => point.source === "statement_html"));

    // Every share and option of every file replayed: a rebuild re-adds a ticker the user deleted
    // by hand if the statements still name it, exactly as importing them again would.
    await addMissingSectors(
      db,
      {
        transactions: parsed.flatMap((statement) => statement.transactions),
        positions: parsed.flatMap((statement) => statement.snapshot?.positions ?? []),
        identities: parsed.flatMap((statement) => statement.identities),
      },
      at,
    );

    // The files themselves are rewritten only when the rebuild actually changes the set —
    // a dropped file, a re-keyed one. Otherwise it would push megabytes back for nothing.
    const before = stored.map((record) => record.id);
    const after = parsed.map((statement) => statement.id);
    if (options.drop !== undefined || before.length !== after.length || before.some((id, i) => id !== after[i])) {
      await db.statements.where("accountId").equals(account.id).delete();
      await db.statements.bulkPut(
        parsed.map((statement) => ({
          id: statement.id,
          accountId: account.id,
          fileName: statement.fileName,
          period: statement.period,
          importedAt: statement.importedAt,
          text: statement.text,
          bytes: statement.bytes,
        })),
      );
    }
    },
  );

  return { status: "ok", statements: parsed.length, imported, skipped, issues };
}

/**
 * Forgets one stored statement and rebuilds the layer from those that remain, so the
 * ledger on screen always matches the files actually kept. The file is dropped inside the
 * rebuild's transaction: a rebuild that cannot run leaves it in place to try again with.
 * Callers must hold `withImportLock`, as for an import.
 */
export async function deleteStatement(db: AppDatabase, account: AccountRecord, id: string): Promise<ReplayReport> {
  return replayStatements(db, account, { drop: id });
}
