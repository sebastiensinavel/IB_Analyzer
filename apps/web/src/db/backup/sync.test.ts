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
