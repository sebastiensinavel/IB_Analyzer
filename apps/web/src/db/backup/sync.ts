import { getBackup, putBackup, type BackupResult } from "@/api/backup";
import type { AppDatabase } from "../schema";
import { decodePayload, decryptBlob, encodePayload, encryptBlob, gunzip, gzip } from "./crypto";
import { buildPayload, restorePayload } from "./payload";
import { readBackupState, recordBackup } from "./state";
import { suppressBackupTrigger } from "./trigger";

/**
 * `null` when the backup is off: not an error, simply nothing to do.
 *
 * `BackupSync` fires this from a bare `setTimeout` with no `.catch`, so an exception here
 * would surface as an unhandled promise rejection. `putBackup` already turns a network or
 * server failure into a `BackupResult`, but this function's own pipeline — reading IndexedDB,
 * gzip, WebCrypto — was not guarded. A deposit that fails is harmless: the write that follows
 * retriggers the whole pipeline, so any failure here is reported, never thrown.
 */
export async function pushBackup(
  db: AppDatabase,
): Promise<BackupResult<{ updatedAt: string; bytes: number }> | null> {
  const state = await readBackupState(db);
  if (!state?.enabled) return null;

  try {
    const blob = await encryptBlob(state.key, await gzip(encodePayload(await buildPayload(db))));
    const result = await putBackup(blob);
    if (result.ok) await recordBackup(db, result.value.updatedAt, result.value.bytes);
    return result;
  } catch {
    return { ok: false, kind: "failed" };
  }
}

export async function pullBackup(db: AppDatabase, key: Uint8Array): Promise<BackupResult<void>> {
  const blob = await getBackup();
  if (!blob.ok) return blob;
  const payload = decodePayload(await gunzip(await decryptBlob(key, blob.value)));
  await suppressBackupTrigger(() => restorePayload(db, payload));
  return { ok: true, value: undefined };
}
