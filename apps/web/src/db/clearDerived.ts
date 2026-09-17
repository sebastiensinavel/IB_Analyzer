import type { AccountRecord, AppDatabase } from "./schema";

/** What the purge actually removed, so the page can tell the user rather than guess. */
export interface ClearDerivedReport {
  transactions: number;
  contracts: number;
  snapshots: number;
  cashPoints: number;
  imports: number;
}

/**
 * Drops everything one account's imports have *derived* — the ledger, the contract identities,
 * the positions snapshot, the cash points and the import journal — and nothing else. The account
 * record (label, Flex credentials, TWS port), the statements kept for it and the shared sector
 * table all survive: the point is to recompute from the files already held, not to make the user
 * set the account up again.
 *
 * A statement replay brings back transactions, contracts, the statement snapshot and the
 * statement cash points; a Flex sync brings back its own; an agent pass only its transactions,
 * contracts and snapshot. Callers must hold `withImportLock` (see `importLock.ts`), as for an
 * import: these are the rows an import writes.
 */
export async function clearDerived(db: AppDatabase, account: AccountRecord): Promise<ClearDerivedReport> {
  const report: ClearDerivedReport = { transactions: 0, contracts: 0, snapshots: 0, cashPoints: 0, imports: 0 };
  await db.transaction("rw", [db.transactions, db.contracts, db.snapshots, db.cashPoints, db.imports], async () => {
    report.transactions = await db.transactions.where("accountId").equals(account.id).delete();
    report.contracts = await db.contracts.where("accountId").equals(account.id).delete();
    report.snapshots = await db.snapshots.where("accountId").equals(account.id).delete();
    report.cashPoints = await db.cashPoints.where("accountId").equals(account.id).delete();
    report.imports = await db.imports.where("accountId").equals(account.id).delete();
  });
  return report;
}
