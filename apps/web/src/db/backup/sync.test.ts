import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount } from "@/db/accounts";
import { AppDatabase } from "@/db/schema";
import { BackupKeyError, BackupPackageError, encryptBlob, generateBackupKey, readHeader } from "./crypto";
import { enableBackup, readBackupState } from "./state";
import { pullBackup, pushBackup } from "./sync";

let db: AppDatabase;

beforeEach(async () => {
  vi.restoreAllMocks();
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
  await createAccount(db, { label: "Beta", ibAccountId: "U1234567" });
});

/** Le serveur en un objet : il retient le dernier dépôt et le ressert au téléchargement. */
function serveBackup(initial: Uint8Array | null = null) {
  const held = { blob: initial };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const method = (init as RequestInit | undefined)?.method ?? "GET";
    if (method === "POST") {
      held.blob = new Uint8Array((init as RequestInit).body as ArrayBuffer);
      return new Response(
        JSON.stringify({ present: true, updatedAt: "2026-09-22T10:00:00Z", bytes: held.blob.byteLength }),
        { status: 200 },
      );
    }
    if (held.blob === null) return new Response(null, { status: 404 });
    return new Response(held.blob as BodyInit, { status: 200 });
  });
  return held;
}

describe("pushBackup", () => {
  it("ne fait rien tant que la sauvegarde n'est pas activée", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await pushBackup(db)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it(
    "dépose des octets que le serveur ne peut pas lire, et retient la date",
    { timeout: 20_000 },
    async () => {
      await enableBackup(db, "une phrase de passe");
      let deposited = new Uint8Array();
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
        deposited = new Uint8Array((init as RequestInit).body as ArrayBuffer);
        return new Response(
          JSON.stringify({ present: true, updatedAt: "2026-09-21T10:00:00Z", bytes: deposited.byteLength }),
          { status: 200 },
        );
      });

      await pushBackup(db);

      expect(new TextDecoder().decode(deposited)).not.toContain("beta");
      expect(await readBackupState(db)).toMatchObject({ lastBackupAt: "2026-09-21T10:00:00Z" });
    },
  );

  // BackupSync runs pushBackup from a bare `setTimeout` with no `.catch`. Its own pipeline
  // — IndexedDB, gzip, WebCrypto — must never throw: any failure is harmless because the
  // next write retriggers the whole pipeline anyway.
  it(
    "ne remonte jamais une exception quand son propre pipeline échoue",
    { timeout: 20_000 },
    async () => {
      await enableBackup(db, "une phrase de passe");
      // A key of the wrong length: crypto.subtle.importKey inside encryptBlob throws before any
      // network call is made — a real failure of this function's own pipeline, not the server's.
      const state = await readBackupState(db);
      await db.backup.put({ ...state!, key: new Uint8Array(4) });
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await expect(pushBackup(db)).resolves.toEqual({ ok: false, kind: "failed" });
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  // An automatic deposit fires from a timer with nobody watching. Before this, a failure was
  // thrown away by `BackupSync`'s `void pushBackup(db)` and nothing was written anywhere: a
  // deposit failing for weeks left the card showing the last date that did work, and said
  // nothing. The failure is now part of the row, and a deposit that lands clears it.
  it(
    "retient l'échec d'un dépôt, et l'efface au dépôt suivant qui réussit",
    { timeout: 20_000 },
    async () => {
      await enableBackup(db, "une phrase de passe");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 413 }));

      expect(await pushBackup(db)).toEqual({ ok: false, kind: "too-large" });
      expect(await readBackupState(db)).toMatchObject({ lastBackupError: "too-large", lastBackupAt: null });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ present: true, updatedAt: "2026-09-21T11:00:00Z", bytes: 12 }), { status: 200 }),
      );
      await pushBackup(db);

      expect(await readBackupState(db)).toMatchObject({ lastBackupError: null, lastBackupAt: "2026-09-21T11:00:00Z" });
    },
  );

  it(
    "retient aussi l'échec quand c'est son propre pipeline qui casse",
    { timeout: 20_000 },
    async () => {
      await enableBackup(db, "une phrase de passe");
      const state = await readBackupState(db);
      await db.backup.put({ ...state!, key: new Uint8Array(4) });

      await pushBackup(db);

      expect(await readBackupState(db)).toMatchObject({ lastBackupError: "failed" });
    },
  );

  it(
    "dépose un blob qui porte l'en-tête",
    { timeout: 20_000 },
    async () => {
      await enableBackup(db, "une phrase de passe");
      const held = serveBackup();
      await pushBackup(db);
      expect(() => readHeader(held.blob as Uint8Array<ArrayBuffer>)).not.toThrow();
    },
  );
});

describe("pullBackup", () => {
  it(
    "fait l'aller-retour complet par le serveur",
    { timeout: 20_000 },
    async () => {
      const state = await enableBackup(db, "une phrase de passe");
      let deposited = new Uint8Array();
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
        if ((init as RequestInit)?.method === "POST") {
          deposited = new Uint8Array((init as RequestInit).body as ArrayBuffer);
          return new Response(JSON.stringify({ present: true, updatedAt: "2026-09-21T10:00:00Z", bytes: 1 }), { status: 200 });
        }
        return new Response(deposited as BodyInit, { status: 200 });
      });
      await pushBackup(db);

      const other = new AppDatabase(`test-${crypto.randomUUID()}`);
      expect(await pullBackup(other, { key: state.key })).toEqual({
        ok: true,
        value: { key: state.key, wrap: state.wrap },
      });
      expect((await other.accounts.toArray()).map((a) => a.id)).toEqual(["beta"]);
    },
  );

  it(
    "ouvre par la clé locale, sans toucher à la phrase",
    { timeout: 20_000 },
    async () => {
      const row = await enableBackup(db, "une phrase de passe");
      serveBackup();
      await pushBackup(db);
      const result = await pullBackup(db, { key: row.key });
      expect(result.ok).toBe(true);
    },
  );

  it(
    "ouvre par la phrase sur un navigateur qui n'a pas la clé",
    { timeout: 20_000 },
    async () => {
      const row = await enableBackup(db, "une phrase de passe");
      serveBackup();
      await pushBackup(db);
      await db.backup.clear();
      const result = await pullBackup(db, { passphrase: "une phrase de passe" });
      expect(result.ok).toBe(true);
      if (result.ok) expect(Array.from(result.value.key)).toEqual(Array.from(row.key));
    },
  );

  it(
    "refuse une phrase erronée par un BackupKeyError et n'écrit rien",
    { timeout: 20_000 },
    async () => {
      await enableBackup(db, "une phrase de passe");
      serveBackup();
      await pushBackup(db);
      await db.backup.clear();
      await db.accounts.clear();
      await expect(pullBackup(db, { passphrase: "mauvaise phrase" })).rejects.toBeInstanceOf(BackupKeyError);
      expect(await db.accounts.count()).toBe(0);
    },
  );

  it(
    "refuse un paquet sans en-tête par un BackupPackageError",
    { timeout: 20_000 },
    async () => {
      serveBackup(await encryptBlob(generateBackupKey(), new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer>));
      await expect(pullBackup(db, { passphrase: "une phrase de passe" })).rejects.toBeInstanceOf(BackupPackageError);
    },
  );
});
