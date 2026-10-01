import type { AlertDirection, ManualAlert, ManualAlertDef } from "./types.ts";

/** Les alertes posées à la main : toujours en USD, ticker en majuscules, un seul seuil. */
export function manualAlerts(defs: readonly ManualAlertDef[]): ManualAlert[] {
  return defs.map((d) => ({
    id: d.id, kind: "manual", ticker: d.ticker.toUpperCase(), currency: "USD",
    thresholds: [{ price: d.price, direction: d.direction }], note: d.note, createdAt: d.createdAt,
  }));
}

export function roundToCent(price: number): number {
  return Math.round((price + Number.EPSILON) * 100) / 100;
}

/** Au-dessus du cours du moment : on attend la hausse ; en dessous : la baisse. */
export function directionFor(price: number, current: number): AlertDirection {
  return price >= current ? "above" : "below";
}
