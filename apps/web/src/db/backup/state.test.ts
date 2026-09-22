import { beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "@/db/schema";
import { bytesOf } from "@/test/bytes";
import { BackupKeyError, generateBackupKey, unwrapKey, wrapKey } from "./crypto";
import {
  adoptBackupKey,
  clearBackupRecord,
  disableBackup,
  enableBackup,
  readBackupState,
  recordBackup,
  rewrapBackupKey,
} from "./state";

let db: AppDatabase;

beforeEach(() => {
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
});

describe("enableBackup", () => {
  it("part désactivée : rien ne quitte le navigateur sans un geste", async () => {
    expect(await readBackupState(db)).toBeNull();
  });

  it(
    "engendre une clé une seule fois et la garde à travers une désactivation",
    { timeout: 20_000 },
    async () => {
      const first = await enableBackup(db, "une phrase de passe");
      expect(first.key).toHaveLength(32);
      expect(first.lastBackupAt).toBeNull();

      await disableBackup(db);
      const again = await enableBackup(db, "une phrase de passe");
      expect(bytesOf(again.key)).toEqual(bytesOf(first.key));
      expect(again.enabled).toBe(true);
    },
  );

  it(
    "écrit une enveloppe à l'activation",
    { timeout: 20_000 },
    async () => {
      const row = await enableBackup(db, "une phrase de passe");
      expect(row.wrap.salt).toHaveLength(16);
      expect(Array.from(await unwrapKey(row.wrap, "une phrase de passe"))).toEqual(Array.from(row.key));
    },
  );

  it(
    "garde la clé quand on réactive, et réenveloppe avec la phrase donnée",
    { timeout: 20_000 },
    async () => {
      const first = await enableBackup(db, "première phrase");
      await disableBackup(db);
      const second = await enableBackup(db, "deuxième phrase");
      expect(Array.from(second.key)).toEqual(Array.from(first.key));
      expect(Array.from(await unwrapKey(second.wrap, "deuxième phrase"))).toEqual(Array.from(first.key));
    },
  );
});

describe("recordBackup", () => {
  it(
    "retient la date et la taille du dernier dépôt",
    { timeout: 20_000 },
    async () => {
      await enableBackup(db, "une phrase de passe");
      await recordBackup(db, "2026-09-21T10:00:00.000Z", 4096);
      expect(await readBackupState(db)).toMatchObject({
        lastBackupAt: "2026-09-21T10:00:00.000Z",
        lastBackupBytes: 4096,
      });
    },
  );
});

describe("clearBackupRecord", () => {
  // A server-side deletion of the backup should also clear the recorded date and size,
  // otherwise the Settings card would keep showing "Dernier dépôt le …" for a backup that
  // no longer exists until the next deposit overwrites it.
  it(
    "efface le dernier dépôt connu, sans désactiver ni changer la clé",
    { timeout: 20_000 },
    async () => {
      const enabled = await enableBackup(db, "une phrase de passe");
      await recordBackup(db, "2026-09-21T10:00:00.000Z", 4096);

      await clearBackupRecord(db);

      const state = await readBackupState(db);
      expect(state).toMatchObject({ enabled: true, lastBackupAt: null, lastBackupBytes: null });
      expect(bytesOf(state!.key)).toEqual(bytesOf(enabled.key));
    },
  );

  it("ne fait rien quand ce navigateur n'a jamais activé la sauvegarde", async () => {
    await clearBackupRecord(db);
    expect(await readBackupState(db)).toBeNull();
  });
});

describe("adoptBackupKey", () => {
  it(
    "remplace la clé du poste par celle que l'enveloppe adoptée a ouverte",
    { timeout: 20_000 },
    async () => {
      await enableBackup(db, "une phrase de passe");
      const other = generateBackupKey();
      const wrap = await wrapKey(other, "une autre phrase");
      await adoptBackupKey(db, other, wrap);
      const stored = (await readBackupState(db))?.key;
      expect(stored && bytesOf(stored)).toEqual(bytesOf(other));
    },
  );

  it(
    "adopte la clé et l'enveloppe ensemble",
    { timeout: 20_000 },
    async () => {
      const key = generateBackupKey();
      const wrap = await wrapKey(key, "phrase adoptée");
      const row = await adoptBackupKey(db, key, wrap);
      expect(row.enabled).toBe(true);
      expect(Array.from(row.key)).toEqual(Array.from(key));
      expect(Array.from(row.wrap.wrapped)).toEqual(Array.from(wrap.wrapped));
    },
  );
});

describe("rewrapBackupKey", () => {
  it(
    "réenveloppe sans toucher à la clé",
    { timeout: 20_000 },
    async () => {
      const before = await enableBackup(db, "ancienne phrase");
      const after = await rewrapBackupKey(db, "nouvelle phrase longue");
      expect(Array.from(after.key)).toEqual(Array.from(before.key));
      expect(Array.from(await unwrapKey(after.wrap, "nouvelle phrase longue"))).toEqual(Array.from(before.key));
      await expect(unwrapKey(after.wrap, "ancienne phrase")).rejects.toBeInstanceOf(BackupKeyError);
    },
  );

  it(
    "refuse de réenvelopper quand rien n'est activé",
    { timeout: 20_000 },
    async () => {
      await expect(rewrapBackupKey(db, "une phrase de passe")).rejects.toBeInstanceOf(BackupKeyError);
    },
  );
});
