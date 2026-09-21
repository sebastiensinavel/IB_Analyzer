import type { AppDatabase } from "../schema";
import { decodePayload, encodePayload, gunzip, gzip } from "./crypto";
import { buildPayload, restorePayload } from "./payload";

/**
 * The local file is the backup of whoever never creates a Django account — the first
 * requirement of this sub-project. It is not encrypted: it never leaves the machine, and
 * one more key to remember would make it a backup nobody can read back. It does carry the
 * Flex token, since it carries the account records; the Settings card says so.
 */
export function backupFileName(now: Date): string {
  return `ib-analyzer-${now.toISOString().slice(0, 10)}.json.gz`;
}

export async function exportToBlob(db: AppDatabase): Promise<Blob> {
  const packed = await gzip(encodePayload(await buildPayload(db)));
  return new Blob([packed as BlobPart], { type: "application/gzip" });
}

export async function importFromFile(db: AppDatabase, file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  await restorePayload(db, decodePayload(await gunzip(bytes)));
}
