import { describe, expect, it } from "vitest";
import {
  BackupKeyError,
  decodePayload,
  decryptBlob,
  encodePayload,
  encryptBlob,
  fromRecoveryCode,
  generateBackupKey,
  gunzip,
  gzip,
  toRecoveryCode,
} from "./crypto";

const payload = { format: 1, createdAt: "2026-09-21T00:00:00.000Z", tables: { sectors: [{ ticker: "ZXAG" }] } };

describe("gzip", () => {
  it("fait l'aller-retour et réduit un texte répétitif", async () => {
    const plain = new TextEncoder().encode("<tr><td>ligne</td></tr>".repeat(500));
    const packed = await gzip(plain);
    expect(packed.byteLength).toBeLessThan(plain.byteLength / 5);
    expect(await gunzip(packed)).toEqual(plain);
  });
});

describe("encryptBlob", () => {
  it("fait l'aller-retour avec la bonne clé", async () => {
    const key = generateBackupKey();
    const plain = encodePayload(payload);
    const blob = await encryptBlob(key, plain);

    expect(blob).not.toEqual(plain);
    expect(decodePayload(await decryptBlob(key, blob))).toEqual(payload);
  });

  it("change à chaque dépôt : l'IV n'est jamais réutilisé", async () => {
    const key = generateBackupKey();
    const plain = encodePayload(payload);
    expect(await encryptBlob(key, plain)).not.toEqual(await encryptBlob(key, plain));
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
    expect(fromRecoveryCode(code)).toEqual(key);
    expect(fromRecoveryCode(` ${code.replace(/\./g, "")} `)).toEqual(key);
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
      expect(fromRecoveryCode(code)).toEqual(key);
    }
  });
});
