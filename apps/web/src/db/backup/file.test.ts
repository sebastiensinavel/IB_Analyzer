import { beforeEach, describe, expect, it } from "vitest";
import { createAccount } from "@/db/accounts";
import { AppDatabase } from "@/db/schema";
import { backupFileName, exportToBlob, importFromFile } from "./file";

let db: AppDatabase;

beforeEach(async () => {
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
  await createAccount(db, { label: "Beta", ibAccountId: "U1234567" });
});

describe("backupFileName", () => {
  it("porte la date du jour", () => {
    expect(backupFileName(new Date("2026-09-21T22:00:00.000Z"))).toBe("ib-analyzer-2026-09-21.json.gz");
  });
});

describe("exportToBlob", () => {
  // Le chemin de sauvegarde de qui n'a pas de compte Django : il doit suffire à lui seul.
  it("fait l'aller-retour par un fichier, sans serveur ni compte", async () => {
    const blob = await exportToBlob(db);
    const file = new File([blob], backupFileName(new Date()));

    const other = new AppDatabase(`test-${crypto.randomUUID()}`);
    await importFromFile(other, file);

    expect((await other.accounts.toArray()).map((a) => a.id)).toEqual(["beta"]);
  });

  // La propriété la plus précieuse du fichier local : une restauration rend une base
  // encore reconstructible, HTML de relevé compris, pas seulement ses lignes dérivées.
  it("fait l'aller-retour d'un relevé HTML, texte compris", async () => {
    const statementText = "<html>relevé bêta</html>";
    await db.statements.put({
      id: "beta|2026-01-01|2026-01-31",
      accountId: "beta",
      fileName: "beta_2026_01.htm",
      period: { start: "2026-01-01", end: "2026-01-31" },
      importedAt: "2026-02-01T00:00:00.000Z",
      text: statementText,
      bytes: new TextEncoder().encode(statementText).byteLength,
    });

    const blob = await exportToBlob(db);
    const file = new File([blob], backupFileName(new Date()));

    const other = new AppDatabase(`test-${crypto.randomUUID()}`);
    await importFromFile(other, file);

    const restored = await other.statements.toArray();
    expect(restored).toHaveLength(1);
    expect(restored[0]?.text).toBe(statementText);
  });
});
