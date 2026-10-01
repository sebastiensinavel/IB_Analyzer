import { describe, expect, it } from "vitest";
import { alertBadgeCounts } from "./badges.ts";
import { condor as condorRow, row, shares } from "./fixtures.ts";
import { manualAlerts } from "./manual.ts";
import { INITIAL_STATE, type AlertState, type CondorAlert } from "./types.ts";

const manual = manualAlerts([{ id: "manual:1", ticker: "abc", price: 50, direction: "above", note: null, createdAt: "t" }])[0];
const condor: CondorAlert = {
  id: "condor:k", kind: "condor", ticker: "XSP", currency: "USD", strikes: [740, 750, 790, 800], expiry: null, quantity: -1, margin: 0.15, offset: 6, legs: [],
  thresholds: [{ price: 784, direction: "above" }],
};
const triggered = (alertId: string): [string, AlertState] => [alertId, { alertId, ...INITIAL_STATE, triggeredAt: "t" }];
const rows = [shares("ABC", 40), row({ id: "o", strategy: "others", kind: "shares", ticker: "ABC" }), condorRow("k", [740, 750, 790, 800])];

describe("alertBadgeCounts", () => {
  it("compte une manuelle dans chaque stratégie qui tient son ticker", () => {
    expect(alertBadgeCounts([manual], new Map([triggered("manual:1")]), rows)).toEqual({ all: 1, wheel: 1, leaps: 0, condors: 0, others: 1 });
  });
  it("compte une automatique selon son genre", () => {
    expect(alertBadgeCounts([condor], new Map([triggered("condor:k")]), rows)).toEqual({ all: 1, wheel: 0, leaps: 0, condors: 1, others: 0 });
  });
  it("ne compte pas une alerte active ni, pour une manuelle, une ligne fermée", () => {
    expect(alertBadgeCounts([manual, condor], new Map(), rows)).toEqual({ all: 0, wheel: 0, leaps: 0, condors: 0, others: 0 });
    const closed = [{ ...shares("ABC", 40), endWhen: "2026-09-02T00:00:00.000Z" }];
    expect(alertBadgeCounts([manual], new Map([triggered("manual:1")]), closed)).toEqual({ all: 1, wheel: 0, leaps: 0, condors: 0, others: 0 });
  });
});
