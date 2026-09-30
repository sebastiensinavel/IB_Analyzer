import { contractId } from "@ib/ledger";
import { describe, expect, it } from "vitest";
import { autoAlerts } from "./auto.ts";
import { call, condor, shares } from "./fixtures.ts";
import { INITIAL_STATE, type AlertState } from "./types.ts";

const margins = { wheel: 0.7, condor: 0.15 };
const anchored = (id: string, price: number, extra: Partial<AlertState> = {}): Map<string, AlertState> =>
  new Map([[id, { alertId: id, ...INITIAL_STATE, anchor: { price, source: "live", observedAt: "2026-09-01T19:00:00Z" }, ...extra }]]);

describe("alertes Wheel", () => {
  const sold = call("c1", "ABC", 40);
  const id = `wheel:${contractId(sold.contract)}`;

  it("place le seuil à S₀ + (K − S₀) × 0,7, au cent", () => {
    const [alert] = autoAlerts([shares("ABC", 45), sold], margins, anchored(id, 34));
    expect(alert).toMatchObject({ id, kind: "wheel", strike: 40, averageAssignmentPrice: 45, thresholds: [{ price: 38.2, direction: "above" }] });
  });

  it("ne crée rien quand K atteint le prix moyen, ni sans prix moyen", () => {
    expect(autoAlerts([shares("ABC", 45), call("c", "ABC", 45)], margins, new Map())).toEqual([]);
    expect(autoAlerts([shares("ABC", 45), call("c", "ABC", 50)], margins, new Map())).toEqual([]);
    expect(autoAlerts([shares("ABC", null), sold], margins, new Map())).toEqual([]);
  });

  it("garde une alerte sans seuil quand S₀ manque", () => {
    const [alert] = autoAlerts([shares("ABC", 45), sold], margins, new Map());
    expect(alert.thresholds).toBeNull();
  });

  it("fond deux lignes d'un même contrat : quantités sommées, vente la plus ancienne", () => {
    const later = call("c2", "ABC", 40, { startWhen: "2026-09-10T15:00:00.000Z", quantity: -2 });
    const alerts = autoAlerts([shares("ABC", 45), later, sold], margins, new Map());
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ quantity: -3, saleWhen: "2026-09-01T15:00:00.000Z" });
  });

  it("préfère la surcharge de l'alerte à la marge du compte", () => {
    const rows = [shares("ABC", 45), sold];
    expect(autoAlerts(rows, margins, anchored(id, 34, { override: 0.5 }))[0].thresholds).toEqual([{ price: 37, direction: "above" }]);
    expect(autoAlerts(rows, { wheel: 0.8, condor: 0.15 }, anchored(id, 34))[0].thresholds).toEqual([{ price: 38.8, direction: "above" }]);
  });

  it("ignore un call fermé", () => {
    expect(autoAlerts([shares("ABC", 45), call("c", "ABC", 40, { endWhen: "2026-09-05T15:00:00.000Z" })], margins, new Map())).toEqual([]);
  });
});

describe("alertes Condors", () => {
  const strikes: [number, number, number, number] = [740, 750, 790, 800];

  it("pose une marge de 15 % de l'écart des strikes vendus devant chaque aile", () => {
    const [alert] = autoAlerts([condor("k1", strikes)], margins, new Map());
    expect(alert).toMatchObject({
      id: "condor:k1", kind: "condor", offset: 6, strikes,
      thresholds: [{ price: 756, direction: "below" }, { price: 784, direction: "above" }],
    });
  });

  it("n'alerte plus une aile vendue fermée, et plus rien si les deux le sont", () => {
    expect(autoAlerts([condor("k", strikes, { put: true })], margins, new Map())[0].thresholds).toEqual([{ price: 784, direction: "above" }]);
    expect(autoAlerts([condor("k", strikes, { put: true, call: true })], margins, new Map())).toEqual([]);
  });

  it("une alerte par composite ouvert", () => {
    expect(autoAlerts([condor("k1", strikes), condor("k2", strikes)], margins, new Map()).map((a) => a.id)).toEqual(["condor:k1", "condor:k2"]);
  });

  it("ignore un composite fermé", () => {
    const closed = { ...condor("k", strikes), endWhen: "2026-09-20T15:00:00.000Z" };
    expect(autoAlerts([closed], margins, new Map())).toEqual([]);
  });
});
