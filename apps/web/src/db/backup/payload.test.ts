import { beforeEach, describe, expect, it } from "vitest";
import { createAccount } from "@/db/accounts";
import { AppDatabase } from "@/db/schema";
import { BACKUP_FORMAT, BackupFormatError, buildPayload, restorePayload } from "./payload";

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
});
