import type { BackupFailure } from "@/api/backup";
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
    : {
        id: ROW_ID,
        enabled: true,
        key: generateBackupKey(),
        lastBackupAt: null,
        lastBackupBytes: null,
        lastBackupError: null,
      };
  await db.backup.put(row);
  return row;
}

/** Keeps the key: the user may re-enable, and the server blob is still theirs to read. */
export async function disableBackup(db: AppDatabase): Promise<void> {
  const existing = await readBackupState(db);
  if (existing) await db.backup.put({ ...existing, enabled: false });
}

/** Restoring on a new device: the recovery code's key replaces this browser's. */
export async function adoptBackupKey(
  db: AppDatabase,
  key: Uint8Array<ArrayBuffer>,
): Promise<BackupStateRecord> {
  const existing = await readBackupState(db);
  const row: BackupStateRecord = {
    id: ROW_ID,
    enabled: true,
    key,
    lastBackupAt: existing?.lastBackupAt ?? null,
    lastBackupBytes: existing?.lastBackupBytes ?? null,
    lastBackupError: existing?.lastBackupError ?? null,
  };
  await db.backup.put(row);
  return row;
}

/** A deposit that lands clears the last failure: the card must not warn about a state fixed. */
export async function recordBackup(db: AppDatabase, at: string, bytes: number): Promise<void> {
  const existing = await readBackupState(db);
  if (existing) {
    await db.backup.put({ ...existing, lastBackupAt: at, lastBackupBytes: bytes, lastBackupError: null });
  }
}

/**
 * A deposit that fails leaves the previous date and size standing — they still name a backup
 * that really is on the server — and records why the newer one never got there. The card shows
 * both, so "Dernier dépôt le <vieille date>" is never read as "tout va bien" on its own.
 */
export async function recordBackupFailure(db: AppDatabase, kind: BackupFailure): Promise<void> {
  const existing = await readBackupState(db);
  if (existing) await db.backup.put({ ...existing, lastBackupError: kind });
}

/**
 * After the server-side blob is deleted: this browser's own "last deposit" record now names
 * a backup that no longer exists, so it goes back to `null`, the same value a device that has
 * never deposited shows. `enabled` and `key` are untouched — deleting from the server does
 * not turn backup off, it only means the next deposit starts from nothing.
 */
export async function clearBackupRecord(db: AppDatabase): Promise<void> {
  const existing = await readBackupState(db);
  if (existing) {
    await db.backup.put({ ...existing, lastBackupAt: null, lastBackupBytes: null, lastBackupError: null });
  }
}
