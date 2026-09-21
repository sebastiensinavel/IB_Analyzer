import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount } from "@/db/accounts";
import { AppDatabase } from "@/db/schema";
import { SAMPLE_SNAPSHOT } from "@/mocks/positions";
import { installBackupTrigger, suppressBackupTrigger } from "./trigger";

let db: AppDatabase;

beforeEach(() => {
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
});

describe("installBackupTrigger", () => {
  // La règle de la spec §5.3 : on sauvegarde ce qui ne se reconstruit pas tout seul.
  it("réagit à un compte créé", async () => {
    const onChange = vi.fn();
    installBackupTrigger(db, onChange);

    await createAccount(db, { label: "Beta", ibAccountId: "U1234567" });

    expect(onChange).toHaveBeenCalled();
  });

  it("ignore un snapshot de l'agent, qui revient toutes les cinq minutes", async () => {
    const onChange = vi.fn();
    installBackupTrigger(db, onChange);

    await db.snapshots.put({
      accountId: "beta",
      source: "agent",
      asOf: "2026-09-21T14:00:00.000Z",
      importedAt: "2026-09-21T14:00:00.000Z",
      positions: SAMPLE_SNAPSHOT.positions,
      cashAvailable: null,
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("se tait pendant une restauration, qui réécrit toute la base", async () => {
    const onChange = vi.fn();
    installBackupTrigger(db, onChange);

    await suppressBackupTrigger(async () => {
      await createAccount(db, { label: "Beta", ibAccountId: "U1234567" });
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("se débranche", async () => {
    const onChange = vi.fn();
    installBackupTrigger(db, onChange)();

    await createAccount(db, { label: "Beta", ibAccountId: "U1234567" });

    expect(onChange).not.toHaveBeenCalled();
  });
});
