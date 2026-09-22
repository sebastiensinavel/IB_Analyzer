import type { BackupFailure } from "@/api/backup";
import type { AppDatabase, BackupStateRecord } from "../schema";
import { BackupKeyError, generateBackupKey, wrapKey, type BackupWrap } from "./crypto";

const ROW_ID = "local" as const;

export type { BackupStateRecord };

export async function readBackupState(db: AppDatabase): Promise<BackupStateRecord | null> {
  return (await db.backup.get(ROW_ID)) ?? null;
}

/**
 * Off by default (architecture spec §7.5): a user who wants nothing on the server has
 * nothing to do. Enabling twice keeps the first key — regenerating it would strand the blob
 * already deposited — but always re-wraps with the passphrase just typed, which is the one
 * the user means to use from now on.
 */
export async function enableBackup(db: AppDatabase, passphrase: string): Promise<BackupStateRecord> {
  const existing = await readBackupState(db);
  const key = existing?.key ?? generateBackupKey();
  const row: BackupStateRecord = {
    id: ROW_ID,
    enabled: true,
    key,
    wrap: await wrapKey(key, passphrase),
    lastBackupAt: existing?.lastBackupAt ?? null,
    lastBackupBytes: existing?.lastBackupBytes ?? null,
    lastBackupError: existing?.lastBackupError ?? null,
  };
  await db.backup.put(row);
  return row;
}

/** Keeps the key: the user may re-enable, and the server blob is still theirs to read. */
export async function disableBackup(db: AppDatabase): Promise<void> {
  const existing = await readBackupState(db);
  if (existing) await db.backup.put({ ...existing, enabled: false });
}

/** Restoring on a new device: the key the passphrase opened, and the envelope it came in,
 *  replace this browser's — the two together, because the key alone is no longer a
 *  representable state. */
export async function adoptBackupKey(
  db: AppDatabase,
  key: Uint8Array<ArrayBuffer>,
  wrap: BackupWrap,
): Promise<BackupStateRecord> {
  const existing = await readBackupState(db);
  const row: BackupStateRecord = {
    id: ROW_ID,
    enabled: true,
    key,
    wrap,
    lastBackupAt: existing?.lastBackupAt ?? null,
    lastBackupBytes: existing?.lastBackupBytes ?? null,
    lastBackupError: existing?.lastBackupError ?? null,
  };
  await db.backup.put(row);
  return row;
}

/**
 * Changing the passphrase re-wraps the key this browser already holds in the clear; it never
 * unlocks anything, so the old passphrase is not asked for — requiring it would be a ritual
 * with no security property, on a device that already has everything (spec §5).
 *
 * The server still carries the old envelope until the deposit this triggers lands, so the old
 * passphrase still opens the backup until then. The card says so.
 */
export async function rewrapBackupKey(db: AppDatabase, passphrase: string): Promise<BackupStateRecord> {
  const existing = await readBackupState(db);
  if (!existing) throw new BackupKeyError("No backup key to re-wrap");
  const row: BackupStateRecord = { ...existing, wrap: await wrapKey(existing.key, passphrase) };
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
