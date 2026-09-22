import { describe, expect, it } from "vitest";
import { bytesOf } from "@/test/bytes";
import {
  BackupKeyError,
  decodePayload,
  decryptBlob,
  deriveWrapKeyForTest,
  encodePayload,
  encryptBlob,
  fromRecoveryCode,
  generateBackupKey,
  gunzip,
  gzip,
  MIN_PASSPHRASE_LENGTH,
  toRecoveryCode,
} from "./crypto";

const payload = { format: 1, createdAt: "2026-09-21T00:00:00.000Z", tables: { sectors: [{ ticker: "ZXAG" }] } };

describe("gzip", () => {
  it("fait l'aller-retour et réduit un texte répétitif", async () => {
    const plain = new TextEncoder().encode("<tr><td>ligne</td></tr>".repeat(500));
    const packed = await gzip(plain);
    expect(packed.byteLength).toBeLessThan(plain.byteLength / 5);
    expect(bytesOf(await gunzip(packed))).toEqual(bytesOf(plain));
  });
});

describe("encryptBlob", () => {
  it("fait l'aller-retour avec la bonne clé", async () => {
    const key = generateBackupKey();
    const plain = encodePayload(payload);
    const blob = await encryptBlob(key, plain);

    expect(bytesOf(blob)).not.toEqual(bytesOf(plain));
    expect(decodePayload(await decryptBlob(key, blob))).toEqual(payload);
  });

  it("change à chaque dépôt : l'IV n'est jamais réutilisé", async () => {
    const key = generateBackupKey();
    const plain = encodePayload(payload);
    expect(bytesOf(await encryptBlob(key, plain))).not.toEqual(bytesOf(await encryptBlob(key, plain)));
  });

  it("échoue avec une autre clé plutôt que de rendre n'importe quoi", async () => {
    const blob = await encryptBlob(generateBackupKey(), encodePayload(payload));
    await expect(decryptBlob(generateBackupKey(), blob)).rejects.toThrow();
  });
});

describe("toRecoveryCode", () => {
  it("fait l'aller-retour, groupes et casse compris", () => {
    const key = generateBackupKey();
    const code = toRecoveryCode(key);
    // Separator is a dot, not a dash: base64url's own alphabet already contains "-", so
    // grouping on "-" would be ambiguous to split back apart, and fromRecoveryCode would
    // have to strip data along with the separators. See crypto.ts for the full rationale.
    expect(code).toMatch(/^[A-Za-z0-9_-]{8}(\.[A-Za-z0-9_-]{1,8})+$/);
    expect(bytesOf(fromRecoveryCode(code))).toEqual(bytesOf(key));
    expect(bytesOf(fromRecoveryCode(` ${code.replace(/\./g, "")} `))).toEqual(bytesOf(key));
  });

  it("refuse un code tronqué", () => {
    expect(() => fromRecoveryCode("trop-court")).toThrow(BackupKeyError);
  });

  it("fait l'aller-retour sur 200 clés tirées au hasard", () => {
    // A single fixed key can pass by chance: base64url's alphabet contains "-", and a
    // dash-separated code destroys any "-" that happens to fall inside the data, not just
    // the ones it inserted as separators. The bug is intermittent, keyed on which bytes
    // the RNG produced, so only a large sample of keys can catch it reliably.
    for (let i = 0; i < 200; i++) {
      const key = generateBackupKey();
      const code = toRecoveryCode(key);
      expect(bytesOf(fromRecoveryCode(code))).toEqual(bytesOf(key));
    }
  });
});

describe("deriveWrapKey", () => {
  // Chaque dérivation coûte, mesurée, quelques secondes (crypto.ts) ; un test qui en fait
  // deux dépasse le délai par défaut de vitest (5 000 ms), pas parce qu'il est lent à tort.
  it(
    "rend la même clé pour la même phrase et le même sel",
    async () => {
      const salt = new Uint8Array(16).fill(3) as Uint8Array<ArrayBuffer>;
      const first = await deriveWrapKeyForTest("phrase de passe longue", salt);
      const second = await deriveWrapKeyForTest("phrase de passe longue", salt);
      expect(Array.from(first)).toEqual(Array.from(second));
      expect(first).toHaveLength(32);
    },
    20000,
  );

  it(
    "rend une clé différente pour un autre sel",
    async () => {
      const one = await deriveWrapKeyForTest(
        "phrase de passe longue",
        new Uint8Array(16).fill(1) as Uint8Array<ArrayBuffer>,
      );
      const other = await deriveWrapKeyForTest(
        "phrase de passe longue",
        new Uint8Array(16).fill(2) as Uint8Array<ArrayBuffer>,
      );
      expect(Array.from(one)).not.toEqual(Array.from(other));
    },
    20000,
  );

  it("exige douze caractères", () => {
    expect(MIN_PASSPHRASE_LENGTH).toBe(12);
  });
});
