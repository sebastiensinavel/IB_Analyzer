import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount } from "@/db/accounts";
import { AppDatabase } from "@/db/schema";
import { enableBackup, readBackupState } from "./state";
import { pullBackup, pushBackup } from "./sync";

let db: AppDatabase;

beforeEach(async () => {
  vi.restoreAllMocks();
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
  await createAccount(db, { label: "Beta", ibAccountId: "U1234567" });
});

describe("pushBackup", () => {
  it("ne fait rien tant que la sauvegarde n'est pas activée", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await pushBackup(db)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("dépose des octets que le serveur ne peut pas lire, et retient la date", async () => {
    await enableBackup(db);
    let deposited = new Uint8Array();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      deposited = new Uint8Array((init as RequestInit).body as ArrayBuffer);
      return new Response(JSON.stringify({ present: true, updatedAt: "2026-09-21T10:00:00Z", bytes: deposited.byteLength }), { status: 200 });
    });

    await pushBackup(db);

    expect(new TextDecoder().decode(deposited)).not.toContain("beta");
    expect(await readBackupState(db)).toMatchObject({ lastBackupAt: "2026-09-21T10:00:00Z" });
  });

  // Correction round 1: BackupSync fires pushBackup from a bare `setTimeout` with no `.catch`
  // (BackupSync.tsx). Its own pipeline — IndexedDB, gzip, WebCrypto — was unguarded, so a
  // failure there became an unhandled promise rejection. A deposit that fails is harmless: the
  // next write retriggers the whole pipeline. It must never throw.
  it("ne remonte jamais une exception quand son propre pipeline échoue", async () => {
    await enableBackup(db);
    // A key of the wrong length: crypto.subtle.importKey inside encryptBlob throws before any
    // network call is made — a real failure of this function's own pipeline, not the server's.
    const state = await readBackupState(db);
    await db.backup.put({ ...state!, key: new Uint8Array(4) });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(pushBackup(db)).resolves.toEqual({ ok: false, kind: "failed" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // An automatic deposit fires from a timer with nobody watching. Before this, a failure was
  // thrown away by `BackupSync`'s `void pushBackup(db)` and nothing was written anywhere: a
  // deposit failing for weeks left the card showing the last date that did work, and said
  // nothing. The failure is now part of the row, and a deposit that lands clears it.
  it("retient l'échec d'un dépôt, et l'efface au dépôt suivant qui réussit", async () => {
    await enableBackup(db);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 413 }));

    expect(await pushBackup(db)).toEqual({ ok: false, kind: "too-large" });
    expect(await readBackupState(db)).toMatchObject({ lastBackupError: "too-large", lastBackupAt: null });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ present: true, updatedAt: "2026-09-21T11:00:00Z", bytes: 12 }), { status: 200 }),
    );
    await pushBackup(db);

    expect(await readBackupState(db)).toMatchObject({ lastBackupError: null, lastBackupAt: "2026-09-21T11:00:00Z" });
  });

  it("retient aussi l'échec quand c'est son propre pipeline qui casse", async () => {
    await enableBackup(db);
    const state = await readBackupState(db);
    await db.backup.put({ ...state!, key: new Uint8Array(4) });

    await pushBackup(db);

    expect(await readBackupState(db)).toMatchObject({ lastBackupError: "failed" });
  });
});

describe("pullBackup", () => {
  it("fait l'aller-retour complet par le serveur", async () => {
    const state = await enableBackup(db);
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
    expect(await pullBackup(other, state.key)).toEqual({ ok: true, value: undefined });
    expect((await other.accounts.toArray()).map((a) => a.id)).toEqual(["beta"]);
  });
});
