import { getBackup, putBackup, type BackupResult } from "@/api/backup";
import type { AppDatabase } from "../schema";
import { decodePayload, decryptBlob, encodePayload, encryptBlob, gunzip, gzip } from "./crypto";
import { buildPayload, restorePayload } from "./payload";
import { readBackupState, recordBackup } from "./state";
import { suppressBackupTrigger } from "./trigger";

/** `null` when the backup is off: not an error, simply nothing to do. */
export async function pushBackup(
  db: AppDatabase,
): Promise<BackupResult<{ updatedAt: string; bytes: number }> | null> {
  const state = await readBackupState(db);
  if (!state?.enabled) return null;

  const blob = await encryptBlob(state.key, await gzip(encodePayload(await buildPayload(db))));
  const result = await putBackup(blob);
  if (result.ok) await recordBackup(db, result.value.updatedAt, result.value.bytes);
  return result;
}

export async function pullBackup(db: AppDatabase, key: Uint8Array): Promise<BackupResult<void>> {
  const blob = await getBackup();
  if (!blob.ok) return blob;
  const payload = decodePayload(await gunzip(await decryptBlob(key, blob.value)));
  await suppressBackupTrigger(() => restorePayload(db, payload));
  return { ok: true, value: undefined };
}
