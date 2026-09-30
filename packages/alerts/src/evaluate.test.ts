import { describe, expect, it } from "vitest";
import { acknowledge, alertStatus, evaluateAlerts, isCrossed, reactivate, staleStateIds, stateOf, type AlertPatch } from "./evaluate.ts";
import { manualAlerts } from "./manual.ts";
import { INITIAL_STATE, type Alert, type AlertState, type CondorAlert } from "./types.ts";

const manual = manualAlerts([{ id: "manual:1", ticker: "AAPL", price: 250, direction: "above", note: null, createdAt: "t" }])[0];
const condor: CondorAlert = {
  id: "condor:k", kind: "condor", ticker: "XSP", currency: "USD", strikes: [740, 750, 790, 800], expiry: null, quantity: -1, margin: 0.15, offset: 6,
  thresholds: [{ price: 756, direction: "below" }, { price: 784, direction: "above" }],
};
const at = (price: number) => () => ({ price, realtime: true });
const apply = (states: Map<string, AlertState>, patches: AlertPatch[]) => {
  for (const { alertId, patch } of patches) states.set(alertId, { ...stateOf(states, alertId), ...patch });
};

describe("évaluation", () => {
  it("isCrossed lit above en >= et below en <=", () => {
    expect(isCrossed([{ price: 10, direction: "above" }], 10)).toBe(true);
    expect(isCrossed([{ price: 10, direction: "above" }], 9.99)).toBe(false);
    expect(isCrossed([{ price: 10, direction: "below" }], 10)).toBe(true);
    expect(isCrossed([{ price: 10, direction: "below" }], 10.01)).toBe(false);
  });

  it("déclenche une manuelle franchie, une seule fois, et ne la réarme pas au retour du cours", () => {
    const states = new Map<string, AlertState>();
    const first = evaluateAlerts([manual], states, at(251), "now");
    expect(first).toEqual([{ alertId: "manual:1", patch: { triggeredAt: "now" } }]);
    apply(states, first);
    expect(evaluateAlerts([manual], states, at(251), "later")).toEqual([]);
    expect(evaluateAlerts([manual], states, at(240), "later")).toEqual([]);
    expect(alertStatus(manual, stateOf(states, manual.id))).toBe("triggered");
  });

  it("n'évalue ni sans prix ni sans seuil", () => {
    expect(evaluateAlerts([manual], new Map(), () => null, "now")).toEqual([]);
    expect(evaluateAlerts([{ ...condor, thresholds: null }], new Map(), at(0), "now")).toEqual([]);
  });

  it("une manuelle acquittée reste éteinte, une réactivation la rearme", () => {
    const states = new Map<string, AlertState>();
    apply(states, [{ alertId: "manual:1", patch: { triggeredAt: "t0" } }, acknowledge(manual, "t1")]);
    expect(alertStatus(manual, stateOf(states, "manual:1"))).toBe("disabled");
    expect(evaluateAlerts([manual], states, at(300), "t2")).toEqual([]);
    apply(states, [reactivate("manual:1")]);
    expect(alertStatus(manual, stateOf(states, "manual:1"))).toBe("active");
    expect(evaluateAlerts([manual], states, at(300), "t3")).toHaveLength(1);
  });

  it("automatique : déclenchée par <= sur un seuil below, vue, muette au-delà, réarmée au retour, redéclenchée", () => {
    const states = new Map<string, AlertState>();
    apply(states, evaluateAlerts([condor], states, at(755), "t0"));
    expect(alertStatus(condor, stateOf(states, condor.id))).toBe("triggered");
    apply(states, [acknowledge(condor, "t1")]);
    expect(alertStatus(condor, stateOf(states, condor.id))).toBe("active");
    expect(evaluateAlerts([condor], states, at(755), "t2")).toEqual([]);
    const back = evaluateAlerts([condor], states, at(770), "t3");
    expect(back).toEqual([{ alertId: "condor:k", patch: { armed: true, triggeredAt: null, acknowledgedAt: null } }]);
    apply(states, back);
    expect(evaluateAlerts([condor], states, at(770), "t4")).toEqual([]);
    expect(evaluateAlerts([condor], states, at(790), "t5")).toEqual([{ alertId: "condor:k", patch: { triggeredAt: "t5" } }]);
  });

  it("est idempotente : appliquer les patches puis réévaluer rend []", () => {
    for (const price of [240, 251, 755, 770, 790]) {
      const states = new Map<string, AlertState>();
      apply(states, evaluateAlerts([manual, condor], states, at(price), "now"));
      expect(evaluateAlerts([manual, condor], states, at(price), "now")).toEqual([]);
    }
  });

  it("staleStateIds ne rend que des états automatiques sans alerte", () => {
    const state = (alertId: string): AlertState => ({ alertId, ...INITIAL_STATE });
    const alerts: Alert[] = [condor];
    expect(staleStateIds(alerts, [state("condor:k"), state("condor:gone"), state("wheel:x"), state("manual:9")])).toEqual(["condor:gone", "wheel:x"]);
  });
});
