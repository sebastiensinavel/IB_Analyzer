import { argon2idAsync } from "@noble/hashes/argon2.js";
import type { BackupPayload } from "./payload";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const SALT_BYTES = 16;

/**
 * Douze caractères, et rien d'autre : une règle, un test, aucune dépendance (spec §5).
 * La règle mesure la longueur et non l'entropie, donc `motdepasse123` passe — c'est assumé.
 * Le rempart contre une attaque hors ligne est Argon2id, pas un jugement sur le texte.
 */
export const MIN_PASSPHRASE_LENGTH = 12;

/**
 * La suite que l'octet de version 2 du format désigne (spec §2). Ces paramètres ne voyagent
 * **pas** dans le blob : un coût mémoire lu dans un fichier est un paramètre fourni par
 * l'attaquant, et un blob forgé annonçant quatre gigaoctets ferait tomber le navigateur qui
 * tente de le restaurer. Les changer un jour sera une version 3, que le lecteur aiguillera.
 *
 * `m: 32768` (32 Mio), pas 64 : mesuré à l'étape 2 de la tâche 1 sur la machine de
 * développement, `m: 65536` dépassait le plafond de cinq secondes (~6.2 s, deux mesures),
 * là où `m: 32768` tient (~2.5–3.3 s). Le spec est corrigé dans le même commit.
 *
 * `asyncTick` rend la main à la boucle d'événements : l'onglet reste vivant et le spinner
 * s'affiche réellement pendant les quelques secondes de dérivation. C'est ce qui dispense
 * d'un Web Worker.
 */
const ARGON2 = { m: 32768, t: 3, p: 1, dkLen: KEY_BYTES, asyncTick: 1 } as const;

async function deriveWrapKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await argon2idAsync(passphrase, salt, ARGON2));
}

/** Exporté sous ce nom pour que les tests mesurent la dérivation seule ; aucun code de
 *  production n'appelle cette fonction hors de ce fichier. */
export const deriveWrapKeyForTest = deriveWrapKey;

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

async function through(
  bytes: Uint8Array,
  stream: ReadableWritablePair<Uint8Array, Uint8Array>,
): Promise<Uint8Array<ArrayBuffer>> {
  const source = toReadableStream(bytes).pipeThrough(stream);
  return new Uint8Array(await new Response(source).arrayBuffer());
}

// lib.dom.d.ts types CompressionStream/DecompressionStream's `writable` as
// WritableStream<BufferSource>, wider than the Uint8Array `pipeThrough` above expects; a
// Uint8Array is a valid BufferSource at runtime, so this is a type-only mismatch, not a real
// one, and the cast reflects that rather than papering over an actual chunk mismatch.
export function gzip(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return through(bytes, new CompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
}

export function gunzip(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return through(bytes, new DecompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
}

export function encodePayload(payload: BackupPayload): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(payload));
}

export function decodePayload(bytes: Uint8Array): BackupPayload {
  return JSON.parse(new TextDecoder().decode(bytes)) as BackupPayload;
}

/** Raw bytes, not a `CryptoKey`: a key is re-imported at each use, and raw bytes survive
 *  IndexedDB and `fake-indexeddb` alike, where a non-extractable `CryptoKey` does not. */
export function generateBackupKey(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(KEY_BYTES));
}

/**
 * Every byte array that reaches `crypto.subtle` is typed `Uint8Array<ArrayBuffer>`, not the
 * default `Uint8Array<ArrayBufferLike>`: WebCrypto's `BufferSource` excludes a view backed by a
 * `SharedArrayBuffer`, so the wider type would need a cast at each of the four call sites below.
 * Nothing here is ever shared-backed — the bytes come from `getRandomValues`, from an unwrapped
 * envelope or from a `Response`'s own buffer — so narrowing states the truth instead.
 */
function importKey(key: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (key.byteLength !== KEY_BYTES) throw new BackupKeyError(`A backup key is ${KEY_BYTES} bytes`);
  return crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** `iv ‖ ciphertext`. A fresh IV per deposit: AES-GCM forgives nothing here. */
export async function encryptBlob(
  key: Uint8Array<ArrayBuffer>,
  plain: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importKey(key), plain);
  const out = new Uint8Array(IV_BYTES + cipher.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(cipher), IV_BYTES);
  return out;
}

export async function decryptBlob(
  key: Uint8Array<ArrayBuffer>,
  blob: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  if (blob.byteLength <= IV_BYTES) throw new BackupKeyError("Backup blob too short to carry an IV");
  const iv = blob.subarray(0, IV_BYTES);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await importKey(key), blob.subarray(IV_BYTES));
  return new Uint8Array(plain);
}

/** Les trois morceaux que l'en-tête du blob transporte (spec §2). */
export interface BackupWrap {
  salt: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  wrapped: Uint8Array<ArrayBuffer>;
}

/**
 * La phrase ne chiffre jamais le paquet, seulement les 32 octets de la clé qui, elle, le
 * chiffre. Changer de phrase réécrit donc 48 octets, jamais 20 Mo.
 */
export async function wrapKey(key: Uint8Array<ArrayBuffer>, passphrase: string): Promise<BackupWrap> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const wrapping = await deriveWrapKey(passphrase, salt);
  const wrapped = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importKey(wrapping), key),
  );
  return { salt, iv, wrapped };
}

/**
 * Une phrase erronée dérive une clé d'enveloppe erronée, dont la balise d'authentification
 * d'AES-GCM échoue sur quarante-huit octets — jamais sur vingt mégaoctets. C'est tout ce qui
 * distingue une mauvaise phrase, et c'est suffisant : AES-GCM authentifie son propre chiffré.
 */
export async function unwrapKey(wrap: BackupWrap, passphrase: string): Promise<Uint8Array<ArrayBuffer>> {
  const wrapping = await deriveWrapKey(passphrase, wrap.salt);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: wrap.iv },
      await importKey(wrapping),
      wrap.wrapped,
    );
    return new Uint8Array(plain);
  } catch {
    throw new BackupKeyError("This passphrase does not open the backup");
  }
}

/** "IB2B". Un blob du sous-projet 25 n'avait aucun en-tête : il ne porte donc pas cette
 *  magie, et c'est par là qu'il est refusé (spec §10). */
const MAGIC = new Uint8Array([0x49, 0x42, 0x32, 0x42]);

/** L'octet de version nomme la suite entière : Argon2id 32 Mio/3/1, puis AES-GCM 256. */
export const BLOB_VERSION = 2;

const SALT_AT = MAGIC.length + 1;
const WRAP_IV_AT = SALT_AT + SALT_BYTES;
const WRAPPED_AT = WRAP_IV_AT + IV_BYTES;
const WRAPPED_BYTES = KEY_BYTES + 16;

/** 81 octets. Les 93 du spec §2 les comptent avec l'IV du corps, qu'`encryptBlob` écrit lui-même. */
export const WRAP_HEADER_BYTES = WRAPPED_AT + WRAPPED_BYTES;

/**
 * Un paquet que cette version ne sait pas lire — magie absente, version inconnue, trop court.
 * Distinct de `BackupKeyError` : dire « phrase de passe invalide » devant un blob corrompu
 * enverrait l'utilisateur retaper indéfiniment une phrase qui n'est pas en cause.
 */
export class BackupPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupPackageError";
  }
}

export function packBlob(wrap: BackupWrap, body: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(WRAP_HEADER_BYTES + body.byteLength);
  out.set(MAGIC, 0);
  out[MAGIC.length] = BLOB_VERSION;
  out.set(wrap.salt, SALT_AT);
  out.set(wrap.iv, WRAP_IV_AT);
  out.set(wrap.wrapped, WRAPPED_AT);
  out.set(body, WRAP_HEADER_BYTES);
  return out;
}

export function readHeader(blob: Uint8Array<ArrayBuffer>): { wrap: BackupWrap; body: Uint8Array<ArrayBuffer> } {
  // Strictement WRAP_HEADER_BYTES, jamais + IV_BYTES : un corps de test peut être plus court
  // que l'IV d'un `encryptBlob` réel (5 octets, ci-dessous), et n'a pas à l'être pour que
  // l'en-tête tienne. Le garde-fou ne protège que la lecture de l'en-tête lui-même.
  if (blob.byteLength <= WRAP_HEADER_BYTES) {
    throw new BackupPackageError("Backup package too short to carry a header");
  }
  if (!MAGIC.every((byte, index) => blob[index] === byte)) {
    throw new BackupPackageError("Not a backup package");
  }
  if (blob[MAGIC.length] !== BLOB_VERSION) {
    throw new BackupPackageError(`Unsupported backup package version: ${String(blob[MAGIC.length])}`);
  }
  // `slice`, jamais `subarray` : une vue garderait vivant le tampon des vingt mégaoctets
  // entiers pour quarante-huit octets de clé, et rendrait `Uint8Array<ArrayBufferLike>`
  // là où WebCrypto veut `Uint8Array<ArrayBuffer>`.
  return {
    wrap: {
      salt: blob.slice(SALT_AT, WRAP_IV_AT),
      iv: blob.slice(WRAP_IV_AT, WRAPPED_AT),
      wrapped: blob.slice(WRAPPED_AT, WRAP_HEADER_BYTES),
    },
    body: blob.slice(WRAP_HEADER_BYTES),
  };
}
