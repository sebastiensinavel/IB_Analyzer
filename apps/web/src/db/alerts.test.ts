import { beforeEach, describe, expect, it } from "vitest";
import { INITIAL_STATE } from "@ib/alerts";
import {
  createManualAlert,
  deleteAlertStates,
  deleteManualAlert,
  patchAlertStates,
  setAlertAnchor,
  setAlertOverride,
  updateManualAlert,
} from "./alerts";
import { AppDatabase } from "./schema";

let db: AppDatabase;
beforeEach(() => {
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
});

const anchor = (price: number) => ({ price, source: "live" as const, observedAt: "2026-09-30T14:00:00.000Z" });

describe("alertes manuelles", () => {
  it("crée avec un id manual: et une date ISO, note absente vaut null", async () => {
    const id = await createManualAlert(db, "beta", { ticker: "AAPL", price: 200, direction: "above" });
    expect(id).toMatch(/^manual:/);
    const row = await db.alerts.get(id);
    expect(row).toMatchObject({ accountId: "beta", ticker: "AAPL", price: 200, direction: "above", note: null });
    expect(new Date(row!.createdAt).toISOString()).toBe(row!.createdAt);
  });

  it("modifie prix, sens et note, sans toucher au reste", async () => {
    const id = await createManualAlert(db, "beta", { ticker: "AAPL", price: 200, direction: "above", note: "x" });
    await updateManualAlert(db, "beta", id, { price: 190, direction: "below" });
    expect(await db.alerts.get(id)).toMatchObject({ ticker: "AAPL", price: 190, direction: "below", note: "x" });
  });

  it("supprime l'alerte et son état, pas ceux d'un autre compte", async () => {
    const id = await createManualAlert(db, "beta", { ticker: "AAPL", price: 200, direction: "above" });
    await patchAlertStates(db, "beta", [{ alertId: id, patch: { disabled: true } }]);
    await patchAlertStates(db, "alpha", [{ alertId: id, patch: { disabled: true } }]);
    await deleteManualAlert(db, "beta", id);
    expect(await db.alerts.get(id)).toBeUndefined();
    expect(await db.alertStates.get(["beta", id])).toBeUndefined();
    expect(await db.alertStates.get(["alpha", id])).toBeDefined();
  });
});

describe("états", () => {
  it("patchAlertStates part d'INITIAL_STATE quand l'état manque, et fusionne sinon", async () => {
    await patchAlertStates(db, "beta", [
      { alertId: "wheel:1", patch: { triggeredAt: "2026-09-30T15:00:00.000Z" } },
      { alertId: "wheel:2", patch: { armed: false } },
    ]);
    expect(await db.alertStates.get(["beta", "wheel:1"])).toEqual({
      ...INITIAL_STATE, accountId: "beta", alertId: "wheel:1", triggeredAt: "2026-09-30T15:00:00.000Z",
    });
    await patchAlertStates(db, "beta", [{ alertId: "wheel:1", patch: { acknowledgedAt: "t" } }]);
    expect(await db.alertStates.get(["beta", "wheel:1"])).toMatchObject({ triggeredAt: "2026-09-30T15:00:00.000Z", acknowledgedAt: "t" });
  });

  it("setAlertAnchor n'écrit jamais une ancre déjà posée", async () => {
    await setAlertAnchor(db, "beta", "wheel:1", anchor(100));
    await setAlertAnchor(db, "beta", "wheel:1", anchor(120));
    expect((await db.alertStates.get(["beta", "wheel:1"]))?.anchor?.price).toBe(100);
  });

  it("setAlertAnchor pose l'ancre sur un état existant sans ancre", async () => {
    await patchAlertStates(db, "beta", [{ alertId: "wheel:1", patch: { armed: false } }]);
    await setAlertAnchor(db, "beta", "wheel:1", anchor(100));
    expect(await db.alertStates.get(["beta", "wheel:1"])).toMatchObject({ armed: false, anchor: { price: 100 } });
  });

  it("setAlertOverride pose puis retire la valeur propre", async () => {
    await setAlertOverride(db, "beta", "wheel:1", 0.5);
    expect((await db.alertStates.get(["beta", "wheel:1"]))?.override).toBe(0.5);
    await setAlertOverride(db, "beta", "wheel:1", null);
    expect((await db.alertStates.get(["beta", "wheel:1"]))?.override).toBeNull();
  });

  it("deleteAlertStates n'efface que les ids du compte donné", async () => {
    await patchAlertStates(db, "beta", [{ alertId: "a", patch: {} }, { alertId: "b", patch: {} }]);
    await patchAlertStates(db, "alpha", [{ alertId: "a", patch: {} }]);
    await deleteAlertStates(db, "beta", ["a"]);
    expect((await db.alertStates.toArray()).map((s) => `${s.accountId}/${s.alertId}`).sort()).toEqual(["alpha/a", "beta/b"]);
  });
});
