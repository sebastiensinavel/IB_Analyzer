import type { AppDatabase, BackupStateRecord } from "../schema";
import { generateBackupKey } from "./crypto";

const ROW_ID = "local" as const;

export type { BackupStateRecord };

export async function readBackupState(db: AppDatabase): Promise<BackupStateRecord | null> {
  return (await db.backup.get(ROW_ID)) ?? null;
}

/**
 * Off by default (architecture spec §7.5): a user who wants nothing on the server has
 * nothing to do. Enabling twice keeps the first key — regenerating it would strand the
 * blob already deposited, and the recovery code already written down.
 */
export async function enableBackup(db: AppDatabase): Promise<BackupStateRecord> {
  const existing = await readBackupState(db);
  const row: BackupStateRecord = existing
    ? { ...existing, enabled: true }
    : { id: ROW_ID, enabled: true, key: generateBackupKey(), lastBackupAt: null, lastBackupBytes: null };
  await db.backup.put(row);
  return row;
}

/** Keeps the key: the user may re-enable, and the server blob is still theirs to read. */
export async function disableBackup(db: AppDatabase): Promise<void> {
  const existing = await readBackupState(db);
  if (existing) await db.backup.put({ ...existing, enabled: false });
}

/** Restoring on a new device: the recovery code's key replaces this browser's. */
export async function adoptBackupKey(db: AppDatabase, key: Uint8Array): Promise<BackupStateRecord> {
  const existing = await readBackupState(db);
  const row: BackupStateRecord = {
    id: ROW_ID,
    enabled: true,
    key,
    lastBackupAt: existing?.lastBackupAt ?? null,
    lastBackupBytes: existing?.lastBackupBytes ?? null,
  };
  await db.backup.put(row);
  return row;
}

export async function recordBackup(db: AppDatabase, at: string, bytes: number): Promise<void> {
  const existing = await readBackupState(db);
  if (existing) await db.backup.put({ ...existing, lastBackupAt: at, lastBackupBytes: bytes });
}
