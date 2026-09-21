import type { AppDatabase } from "../schema";

export const BACKUP_FORMAT = 1;

/**
 * Tables a backup must never carry. `backup` holds the key that encrypts the payload.
 *
 * When a new table is added, fix the resulting test failure by deciding where it lives:
 * in BACKUP_TABLES (if it should be backed up) or added here (if not). Never silence the
 * test by hardcoding a list — the test is the guard against accidents.
 */
export const NEVER_BACKED_UP: readonly string[] = ["backup"];

/**
 * Every table of the database — `statements` included, and the `backup` table excluded.
 *
 * The raw statement HTML is in, decided the 2026-09-21 (spec §5.2): a backup that hands
 * back the rows without the files that produced them hands back a database that can no
 * longer be rebuilt, and turns "Relire les relevés" from a safety net into a trap. HTML
 * compresses ten to twenty fold, so the weight is no longer the argument it was.
 *
 * `backup` is out, and must stay out: it holds the key that encrypts this very payload.
 * A key saved inside what it encrypts saves nothing, and a restore must never overwrite
 * the key the device is currently using.
 */
export const BACKUP_TABLES = [
  "accounts",
  "transactions",
  "imports",
  "snapshots",
  "sectors",
  "statements",
  "contracts",
  "cashPoints",
] as const;

export interface BackupPayload {
  format: number;
  createdAt: string;
  /**
   * The Dexie schema version the rows were read from — `BACKUP_FORMAT` versions the envelope,
   * this versions their shape. Optional because a package written before the field existed
   * cannot grow one after the fact; such a package predates every version that carries it, so
   * it is read as "older" and accepted.
   */
  dexie?: number;
  tables: Record<string, unknown[]>;
}

export class BackupFormatError extends Error {
  constructor(format: unknown) {
    super(`Unsupported backup format: ${String(format)}`);
    this.name = "BackupFormatError";
  }
}

export class BackupSchemaError extends Error {
  constructor(payloadVersion: number, localVersion: number) {
    super(`Backup written on Dexie schema ${payloadVersion}, newer than this browser's ${localVersion}`);
    this.name = "BackupSchemaError";
  }
}

export async function buildPayload(db: AppDatabase): Promise<BackupPayload> {
  const tables: Record<string, unknown[]> = {};
  for (const name of BACKUP_TABLES) {
    tables[name] = await db.table(name).toArray();
  }
  return { format: BACKUP_FORMAT, createdAt: new Date().toISOString(), dexie: db.verno, tables };
}

/**
 * Replaces, never merges (spec §7): two concurrent snapshots, two account records and two
 * hand-edited sector tables have no defined reconciliation, and the app has no arbiter to
 * offer. One transaction, so a failure leaves the database as it was.
 */
export async function restorePayload(db: AppDatabase, payload: BackupPayload): Promise<void> {
  if (payload.format !== BACKUP_FORMAT) throw new BackupFormatError(payload.format);
  // A package from a newer schema is refused, never written. Its rows carry shapes the
  // migrations of this build have not been written for, and restoring them would put them in
  // the database past every upgrade between the two versions — the exact hole version 9 had to
  // go back and fill for `dailyPnl`/`dayChange`, where the missing field was `undefined` where
  // the rule of this repository wants `null`. An older package is welcome: Dexie runs the
  // upgrades it has missed the next time the database opens.
  if (typeof payload.dexie === "number" && payload.dexie > db.verno) {
    throw new BackupSchemaError(payload.dexie, db.verno);
  }
  await db.transaction("rw", BACKUP_TABLES.map((name) => db.table(name)), async () => {
    for (const name of BACKUP_TABLES) {
      await db.table(name).clear();
      const rows = payload.tables[name];
      if (Array.isArray(rows) && rows.length > 0) await db.table(name).bulkPut(rows);
    }
  });
}
