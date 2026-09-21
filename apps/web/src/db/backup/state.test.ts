import { beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "@/db/schema";
import { bytesOf } from "@/test/bytes";
import { generateBackupKey } from "./crypto";
import { adoptBackupKey, clearBackupRecord, disableBackup, enableBackup, readBackupState, recordBackup } from "./state";

let db: AppDatabase;

beforeEach(() => {
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
});

describe("enableBackup", () => {
  it("part désactivée : rien ne quitte le navigateur sans un geste", async () => {
    expect(await readBackupState(db)).toBeNull();
  });

  it("engendre une clé une seule fois et la garde à travers une désactivation", async () => {
    const first = await enableBackup(db);
    expect(first.key).toHaveLength(32);
    expect(first.lastBackupAt).toBeNull();

    await disableBackup(db);
    const again = await enableBackup(db);
    expect(bytesOf(again.key)).toEqual(bytesOf(first.key));
    expect(again.enabled).toBe(true);
  });
});

describe("recordBackup", () => {
  it("retient la date et la taille du dernier dépôt", async () => {
    await enableBackup(db);
    await recordBackup(db, "2026-09-21T10:00:00.000Z", 4096);
    expect(await readBackupState(db)).toMatchObject({
      lastBackupAt: "2026-09-21T10:00:00.000Z",
      lastBackupBytes: 4096,
    });
  });
});

describe("clearBackupRecord", () => {
  // A server-side deletion of the backup should also clear the recorded date and size,
  // otherwise the Settings card would keep showing "Dernier dépôt le …" for a backup that
  // no longer exists until the next deposit overwrites it.
  it("efface le dernier dépôt connu, sans désactiver ni changer la clé", async () => {
    const enabled = await enableBackup(db);
    await recordBackup(db, "2026-09-21T10:00:00.000Z", 4096);

    await clearBackupRecord(db);

    const state = await readBackupState(db);
    expect(state).toMatchObject({ enabled: true, lastBackupAt: null, lastBackupBytes: null });
    expect(bytesOf(state!.key)).toEqual(bytesOf(enabled.key));
  });

  it("ne fait rien quand ce navigateur n'a jamais activé la sauvegarde", async () => {
    await clearBackupRecord(db);
    expect(await readBackupState(db)).toBeNull();
  });
});

describe("adoptBackupKey", () => {
  it("remplace la clé du poste par celle du code de récupération", async () => {
    await enableBackup(db);
    const other = generateBackupKey();
    await adoptBackupKey(db, other);
    const stored = (await readBackupState(db))?.key;
    expect(stored && bytesOf(stored)).toEqual(bytesOf(other));
  });
});
