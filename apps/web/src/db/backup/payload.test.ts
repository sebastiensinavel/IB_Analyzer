import { beforeEach, describe, expect, it } from "vitest";
import { createAccount } from "@/db/accounts";
import { AppDatabase } from "@/db/schema";
import { BACKUP_FORMAT, BACKUP_TABLES, BackupFormatError, buildPayload, restorePayload, NEVER_BACKED_UP } from "./payload";

let db: AppDatabase;

beforeEach(async () => {
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
  await createAccount(db, { label: "Beta", ibAccountId: "U1234567" });
  await db.statements.put({
    id: "beta|2025-01-01|2025-12-31",
    accountId: "beta",
    fileName: "beta.htm",
    period: { start: "2025-01-01", end: "2025-12-31" },
    importedAt: "2026-01-02T00:00:00.000Z",
    text: "<html>relevé</html>",
    bytes: 19,
  });
  await db.sectors.put({
    ticker: "ZXAG",
    name: "Zxag",
    category: "Tech",
    score: 4,
    status: "",
    updatedAt: "2026-01-02T00:00:00.000Z",
  });
});

describe("buildPayload", () => {
  it("emporte les relevés HTML bruts, pas seulement le dérivé", async () => {
    const payload = await buildPayload(db);
    expect(payload.format).toBe(BACKUP_FORMAT);
    expect(payload.tables.statements).toHaveLength(1);
    expect((payload.tables.statements[0] as { text: string }).text).toBe("<html>relevé</html>");
  });
});

describe("restorePayload", () => {
  it("remplace la base, il ne fusionne pas", async () => {
    const payload = await buildPayload(db);
    await createAccount(db, { label: "Gamma", ibAccountId: "U7654321" });
    expect(await db.accounts.count()).toBe(2);

    await restorePayload(db, payload);

    expect((await db.accounts.toArray()).map((a) => a.id)).toEqual(["beta"]);
    expect(await db.sectors.get("ZXAG")).toMatchObject({ score: 4 });
    expect(await db.statements.count()).toBe(1);
  });

  it("vide une table absente du paquet plutôt que de la laisser derrière", async () => {
    const payload = await buildPayload(db);
    delete payload.tables.sectors;

    await restorePayload(db, payload);

    expect(await db.sectors.count()).toBe(0);
  });

  it("refuse un format qu'il ne connaît pas", async () => {
    await expect(restorePayload(db, { format: 99, createdAt: "", tables: {} })).rejects.toThrow(
      BackupFormatError,
    );
  });

  it("atomicité : l'échec en cours de restauration annule toute la transaction", async () => {
    // CORRECT SEQUENCE (order matters for atomicity testing):
    // 1. Seed the database with beta
    expect(await db.accounts.count(), "Setup: beta account").toBe(1);

    // 2. Build a payload at this point — it contains only beta, no gamma
    const payload = await buildPayload(db);
    expect(
      (payload.tables.accounts as any[]).map((a) => a.id),
      "Payload contains only beta",
    ).toEqual(["beta"]);

    // 3. THEN create gamma — it is now in the database but NOT in the payload
    await createAccount(db, { label: "Gamma", ibAccountId: "U7654321" });
    expect(await db.accounts.count(), "Both beta and gamma exist").toBe(2);

    // 4. Corrupt the payload to cause failure mid-restoration:
    // Add a sector with missing primary key (ticker field) to cause bulkPut to fail.
    // sectors is at index 4 in BACKUP_TABLES (after accounts, transactions, imports, snapshots)
    if (Array.isArray(payload.tables.sectors)) {
      payload.tables.sectors.push({ name: "Invalid", category: "Tech" } as any);
    }

    // 5. Restore attempt should fail when processing sectors table
    await expect(
      restorePayload(db, payload),
      "Restore fails on invalid sector",
    ).rejects.toThrow();

    // 6. Verify rollback worked: gamma MUST still exist.
    // Gamma is NOT in the payload. If atomicity worked, the clear() of accounts was rolled back.
    // If atomicity failed, clear() succeeded and accounts were rewritten with only beta.
    // Gamma's survival is the proof of atomic rollback.
    const accountIds = (await db.accounts.toArray()).map((a) => a.id);
    expect(accountIds, "Gamma survived: clear() of accounts was rolled back").toContain("gamma");
    expect(accountIds, "Beta also survived").toContain("beta");
    expect(await db.accounts.count(), "Both accounts still in database").toBe(2);
  });
});

describe("invariants", () => {
  it("BACKUP_TABLES exclut les tables que la sauvegarde ne doit jamais porter", async () => {
    // Read all table names from the actual database schema
    const allTableNames = new Set(db.tables.map((t) => t.name));
    // Widened to `string`: `db.tables[].name` is a plain string, and this set is compared
    // against it below, not just against BACKUP_TABLES's own literal members.
    const backupTableNames = new Set<string>(BACKUP_TABLES);
    const neverBackedUpNames = new Set(NEVER_BACKED_UP);

    // Every existing table must either be in BACKUP_TABLES or explicitly in NEVER_BACKED_UP.
    // This catches regressions when a new table is added but not considered for backup.
    for (const tableName of allTableNames) {
      if (neverBackedUpNames.has(tableName)) {
        expect(
          backupTableNames.has(tableName),
          `${tableName} is in NEVER_BACKED_UP but also in BACKUP_TABLES`,
        ).toBe(false);
      } else {
        expect(
          backupTableNames.has(tableName),
          `${tableName} exists but is neither in BACKUP_TABLES nor in NEVER_BACKED_UP`,
        ).toBe(true);
      }
    }

    // No table in BACKUP_TABLES should also be in NEVER_BACKED_UP
    for (const tableName of backupTableNames) {
      expect(
        neverBackedUpNames.has(tableName),
        `${tableName} is in both lists`,
      ).toBe(false);
    }
  });
});
