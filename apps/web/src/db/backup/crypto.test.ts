import { describe, expect, it } from "vitest";
import { bytesOf } from "@/test/bytes";
import {
  BackupKeyError,
  BackupPackageError,
  decodePayload,
  decryptBlob,
  deriveWrapKeyForTest,
  encodePayload,
  encryptBlob,
  generateBackupKey,
  gunzip,
  gzip,
  MIN_PASSPHRASE_LENGTH,
  packBlob,
  readHeader,
  unwrapKey,
  wrapKey,
  WRAP_HEADER_BYTES,
  type BackupWrap,
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

describe("wrapKey / unwrapKey", () => {
  const PHRASE = "une phrase de passe";

  // Chaque test dérive une ou deux fois (crypto.ts), chaque dérivation coûtant quelques
  // secondes : le délai par défaut de vitest (5 000 ms) ne suffit pas, comme pour
  // deriveWrapKey ci-dessus.
  it(
    "rend la clé d'origine",
    async () => {
      const key = generateBackupKey();
      const wrap = await wrapKey(key, PHRASE);
      expect(Array.from(await unwrapKey(wrap, PHRASE))).toEqual(Array.from(key));
    },
    20000,
  );

  it(
    "refuse une phrase erronée par un BackupKeyError",
    async () => {
      const wrap = await wrapKey(generateBackupKey(), PHRASE);
      await expect(unwrapKey(wrap, "une autre phrase")).rejects.toBeInstanceOf(BackupKeyError);
    },
    20000,
  );

  it(
    "tire un sel neuf à chaque enveloppe",
    async () => {
      const key = generateBackupKey();
      const one = await wrapKey(key, PHRASE);
      const other = await wrapKey(key, PHRASE);
      expect(Array.from(one.salt)).not.toEqual(Array.from(other.salt));
      expect(Array.from(one.wrapped)).not.toEqual(Array.from(other.wrapped));
    },
    20000,
  );

  it(
    "enveloppe la clé en 48 octets : 32 de clé et 16 de balise",
    async () => {
      const wrap = await wrapKey(generateBackupKey(), PHRASE);
      expect(wrap.wrapped).toHaveLength(48);
      expect(wrap.salt).toHaveLength(16);
      expect(wrap.iv).toHaveLength(12);
    },
    20000,
  );
});

describe("packBlob / readHeader", () => {
  async function aWrap(): Promise<BackupWrap> {
    return wrapKey(generateBackupKey(), "une phrase de passe");
  }

  it(
    "rend l'enveloppe et le corps intacts",
    async () => {
      const wrap = await aWrap();
      const body = new Uint8Array([1, 2, 3, 4, 5]) as Uint8Array<ArrayBuffer>;
      const read = readHeader(packBlob(wrap, body));
      expect(Array.from(read.wrap.salt)).toEqual(Array.from(wrap.salt));
      expect(Array.from(read.wrap.iv)).toEqual(Array.from(wrap.iv));
      expect(Array.from(read.wrap.wrapped)).toEqual(Array.from(wrap.wrapped));
      expect(Array.from(read.body)).toEqual([1, 2, 3, 4, 5]);
    },
    20000,
  );

  it(
    "pose quatre-vingt-un octets devant le corps",
    async () => {
      const packed = packBlob(await aWrap(), new Uint8Array(10) as Uint8Array<ArrayBuffer>);
      expect(packed).toHaveLength(91);
      expect(WRAP_HEADER_BYTES).toBe(81);
    },
    20000,
  );

  it(
    "refuse un paquet sans la magie",
    async () => {
      const packed = packBlob(await aWrap(), new Uint8Array(20) as Uint8Array<ArrayBuffer>);
      packed[0] = 0;
      expect(() => readHeader(packed)).toThrow(BackupPackageError);
    },
    20000,
  );

  it(
    "refuse une version inconnue",
    async () => {
      const packed = packBlob(await aWrap(), new Uint8Array(20) as Uint8Array<ArrayBuffer>);
      packed[4] = 99;
      expect(() => readHeader(packed)).toThrow(BackupPackageError);
    },
    20000,
  );

  it("refuse un paquet trop court pour son propre en-tête", () => {
    expect(() => readHeader(new Uint8Array(40) as Uint8Array<ArrayBuffer>)).toThrow(BackupPackageError);
  });

  // Le corps fait 200 octets, pas 3 (correction de la tâche 3, Seb) : encryptBlob(3 octets) ne
  // rend que 31 octets (IV 12 + chiffré 19), sous le garde-fou de longueur de readHeader
  // (WRAP_HEADER_BYTES = 81). Le test échouerait alors sur ce garde-fou sans jamais exercer la
  // comparaison de la magie qu'il prétend vérifier. 200 octets de corps rendent un blob de
  // 228 octets, qui passe le garde-fou et atteint la comparaison de "IB2B".
  it("refuse un blob du sous-projet 25, qui n'a aucun en-tête", async () => {
    const legacy = await encryptBlob(generateBackupKey(), new Uint8Array(200) as Uint8Array<ArrayBuffer>);
    expect(() => readHeader(legacy)).toThrow(BackupPackageError);
  });
});
