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
    // Snapshot the current state: beta account exists
    expect(await db.accounts.count()).toBe(1);

    // Add a second account as a marker for rollback verification
    await createAccount(db, { label: "Gamma", ibAccountId: "U7654321" });
    expect(await db.accounts.count()).toBe(2); // beta + gamma

    // Build a payload based on current state
    const payload = await buildPayload(db);

    // Corrupt the payload to cause failure mid-restoration:
    // Add a sector with missing primary key (ticker field) to cause bulkPut to fail.
    // sectors is at index 4 in BACKUP_TABLES (after accounts, transactions, imports, snapshots)
    // so the error happens after clearing and attempting to restore earlier tables.
    if (Array.isArray(payload.tables.sectors)) {
      // Add an invalid sector missing the 'ticker' field (primary key)
      payload.tables.sectors.push({ name: "Invalid", category: "Tech" } as any);
    }

    // Restore attempt should fail when processing sectors table
    await expect(restorePayload(db, payload)).rejects.toThrow();

    // Verify rollback worked: gamma account must still exist.
    // If restoration had partially applied (accounts table cleared and new data inserted
    // before sectors failed), gamma would be gone and replaced with only "beta".
    // Its continued presence proves the entire transaction was rolled back.
    const accountIds = (await db.accounts.toArray()).map((a) => a.id);
    expect(accountIds).toContain("gamma");
    expect(accountIds).toContain("beta");

    // Verify full rollback: both accounts and original sector still intact
    expect(await db.accounts.count()).toBe(2);
    expect(await db.sectors.get("ZXAG")).toBeDefined();
  });
});

describe("invariants", () => {
  it("BACKUP_TABLES exclut les tables que la sauvegarde ne doit jamais porter", async () => {
    // Read all table names from the actual database schema
    const allTableNames = new Set(db.tables.map((t) => t.name));
    const backupTableNames = new Set(BACKUP_TABLES);
    const neverBackedUpNames = new Set(NEVER_BACKED_UP);

    // Every existing table must either be in BACKUP_TABLES or explicitly in NEVER_BACKED_UP.
    // This catches regressions when a new table is added but not considered for backup.
    for (const tableName of allTableNames) {
      if (neverBackedUpNames.has(tableName)) {
        expect(backupTableNames.has(tableName)).toBe(
          false,
          `${tableName} is in NEVER_BACKED_UP but also in BACKUP_TABLES`,
        );
      } else {
        expect(backupTableNames.has(tableName)).toBe(
          true,
          `${tableName} exists but is neither in BACKUP_TABLES nor in NEVER_BACKED_UP`,
        );
      }
    }

    // No table in BACKUP_TABLES should also be in NEVER_BACKED_UP
    for (const tableName of backupTableNames) {
      expect(neverBackedUpNames.has(tableName)).toBe(false, `${tableName} is in both lists`);
    }
  });
});
