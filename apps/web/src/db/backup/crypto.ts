import type { BackupPayload } from "./payload";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const GROUP = 8;

export class BackupKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupKeyError";
  }
}

// A ReadableStream built directly from the bytes, not via `new Blob([...]).stream()`:
// jsdom's Blob implementation has no `.stream()` method, so the tests would fail under
// jsdom even though CompressionStream/DecompressionStream themselves are present.
function toReadableStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function through(bytes: Uint8Array, stream: ReadableWritablePair<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const source = toReadableStream(bytes).pipeThrough(stream);
  return new Uint8Array(await new Response(source).arrayBuffer());
}

// lib.dom.d.ts types CompressionStream/DecompressionStream's `writable` as
// WritableStream<BufferSource>, wider than the Uint8Array `pipeThrough` above expects; a
// Uint8Array is a valid BufferSource at runtime, so this is a type-only mismatch, not a real
// one, and the cast reflects that rather than papering over an actual chunk mismatch.
export function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return through(bytes, new CompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
}

export function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  return through(bytes, new DecompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
}

export function encodePayload(payload: BackupPayload): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

export function decodePayload(bytes: Uint8Array): BackupPayload {
  return JSON.parse(new TextDecoder().decode(bytes)) as BackupPayload;
}

/** Raw bytes, not a `CryptoKey`: a key is re-imported at each use, and raw bytes survive
 *  IndexedDB and `fake-indexeddb` alike, where a non-extractable `CryptoKey` does not. */
export function generateBackupKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(KEY_BYTES));
}

function importKey(key: Uint8Array): Promise<CryptoKey> {
  if (key.byteLength !== KEY_BYTES) throw new BackupKeyError(`A backup key is ${KEY_BYTES} bytes`);
  return crypto.subtle.importKey("raw", key as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** `iv ‖ ciphertext`. A fresh IV per deposit: AES-GCM forgives nothing here. */
export async function encryptBlob(key: Uint8Array, plain: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importKey(key), plain as BufferSource);
  const out = new Uint8Array(IV_BYTES + cipher.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(cipher), IV_BYTES);
  return out;
}

export async function decryptBlob(key: Uint8Array, blob: Uint8Array): Promise<Uint8Array> {
  if (blob.byteLength <= IV_BYTES) throw new BackupKeyError("Backup blob too short to carry an IV");
  const iv = blob.subarray(0, IV_BYTES);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    await importKey(key),
    blob.subarray(IV_BYTES) as BufferSource,
  );
  return new Uint8Array(plain);
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Groups of eight, so a human can read it aloud and type it back.
 *
 * The separator between groups is a dot, not a dash. base64url's own alphabet already
 * contains "-" (it's the substitute for "+"), so a dash-separated code is ambiguous to
 * read back: `fromRecoveryCode` can't tell a separator dash from a data dash, and
 * stripping every "-" would silently corrupt any key whose base64url form happens to
 * contain one — which, at 43 characters, is most of them. A dot never appears in
 * base64url output, so it can be stripped unconditionally without touching the data.
 */
export function toRecoveryCode(key: Uint8Array): string {
  return (base64url(key).match(new RegExp(`.{1,${GROUP}}`, "g")) ?? []).join(".");
}

export function fromRecoveryCode(code: string): Uint8Array {
  const normalized = code.trim().replace(/[.\s]/g, "");
  let binary: string;
  try {
    binary = atob(normalized.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    throw new BackupKeyError("Recovery code is not readable");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.byteLength !== KEY_BYTES) throw new BackupKeyError(`A backup key is ${KEY_BYTES} bytes`);
  return bytes;
}
