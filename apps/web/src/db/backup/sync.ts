import { getBackup, putBackup, type BackupResult } from "@/api/backup";
import type { AppDatabase } from "../schema";
import {
  BackupKeyError,
  decodePayload,
  decryptBlob,
  encodePayload,
  encryptBlob,
  gunzip,
  gzip,
  packBlob,
  readHeader,
  unwrapKey,
  type BackupWrap,
} from "./crypto";
import { buildPayload, restorePayload } from "./payload";
import { readBackupState, recordBackup, recordBackupFailure } from "./state";
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
  try {
    const state = await readBackupState(db);
    if (!state?.enabled) return null;
    const body = await encryptBlob(state.key, await gzip(encodePayload(await buildPayload(db))));
    const result = await putBackup(packBlob(state.wrap, body));
    if (result.ok) await recordBackup(db, result.value.updatedAt, result.value.bytes);
    else await recordBackupFailure(db, result.kind);
    return result;
  } catch {
    // The pipeline itself broke (IndexedDB, gzip, WebCrypto). Writing that down must not throw
    // in turn, or the silence this guard exists to break would simply come back one level up.
    await recordBackupFailure(db, "failed").catch(() => undefined);
    return { ok: false, kind: "failed" };
  }
}

/** Ce avec quoi on ouvre : la clé que ce navigateur détient déjà, ou la phrase qu'on vient
 *  de taper sur un navigateur neuf. Jamais les deux. */
export type BackupOpener = { key: Uint8Array<ArrayBuffer> } | { passphrase: string };

/**
 * Une phrase — ou une clé — qui n'ouvre pas le blob remonte en `BackupKeyError`, jamais en
 * échec générique : AES-GCM authentifie son propre chiffré, donc un rejet de `decrypt` veut
 * dire exactement une chose. Un paquet que cette version ne sait pas lire remonte en
 * `BackupPackageError`, qui est une autre chose : l'appelant doit pouvoir dire « retapez
 * votre phrase » sans le dire devant un blob corrompu.
 *
 * Rend la clé et l'enveloppe dont le paquet s'est ouvert, pour que l'appelant les adopte —
 * et seulement après que la restauration a réussi.
 */
export async function pullBackup(
  db: AppDatabase,
  opener: BackupOpener,
): Promise<BackupResult<{ key: Uint8Array<ArrayBuffer>; wrap: BackupWrap }>> {
  const blob = await getBackup();
  if (!blob.ok) return blob;
  const { wrap, body } = readHeader(blob.value);
  const key = "key" in opener ? opener.key : await unwrapKey(wrap, opener.passphrase);
  let plain: Uint8Array<ArrayBuffer>;
  try {
    plain = await decryptBlob(key, body);
  } catch (error) {
    throw error instanceof BackupKeyError ? error : new BackupKeyError("This key does not open the backup");
  }
  const payload = decodePayload(await gunzip(plain));
  await suppressBackupTrigger(() => restorePayload(db, payload));
  return { ok: true, value: { key, wrap } };
}
