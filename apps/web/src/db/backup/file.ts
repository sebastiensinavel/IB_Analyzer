import type { AppDatabase } from "../schema";
import { decodePayload, encodePayload, gunzip, gzip } from "./crypto";
import { buildPayload, restorePayload } from "./payload";

/**
 * The local file is the backup of whoever never creates a Django account — the first
 * requirement of sub-project 25. It is not encrypted, and deliberately stays that way
 * (sub-project 26, spec §10): it never leaves the machine, and encrypting it would impose a
 * passphrase on exactly the person who chose to have no secret to manage. It does carry the
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
