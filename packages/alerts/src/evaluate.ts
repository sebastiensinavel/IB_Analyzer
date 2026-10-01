import { INITIAL_STATE, type Alert, type AlertState, type AlertStatus, type AlertThreshold } from "./types.ts";

export interface PriceQuote { price: number; realtime: boolean }
export type AlertPatch = { alertId: string; patch: Partial<Omit<AlertState, "alertId">> };

export function stateOf(states: ReadonlyMap<string, AlertState>, alertId: string): AlertState {
  return states.get(alertId) ?? { alertId, ...INITIAL_STATE };
}

export function alertStatus(alert: Alert, state: AlertState): AlertStatus {
  if (state.triggeredAt !== null && state.acknowledgedAt === null) return "triggered";
  if (alert.kind === "manual" && state.disabled) return "disabled";
  return "active";
}

/** Un seuil `above` est franchi à `price >= seuil`, un `below` à `price <= seuil`. */
export function isCrossed(thresholds: readonly AlertThreshold[], price: number): boolean {
  return thresholds.some((t) => (t.direction === "above" ? price >= t.price : price <= t.price));
}

/** Les transitions dues à ce cours ; réévaluer après les avoir appliquées rend `[]`. */
export function evaluateAlerts(
  alerts: readonly Alert[],
  states: ReadonlyMap<string, AlertState>,
  priceOf: (ticker: string) => PriceQuote | null,
  now: string,
): AlertPatch[] {
  const patches: AlertPatch[] = [];
  for (const alert of alerts) {
    if (alert.thresholds === null) continue;
    const quote = priceOf(alert.ticker);
    if (quote === null) continue;
    const state = stateOf(states, alert.id);
    const crossed = isCrossed(alert.thresholds, quote.price);
    if (alert.kind === "manual") {
      if (!state.disabled && state.triggeredAt === null && crossed) patches.push({ alertId: alert.id, patch: { triggeredAt: now } });
    } else if (state.armed) {
      if (state.triggeredAt === null && crossed) patches.push({ alertId: alert.id, patch: { triggeredAt: now } });
    } else if (!crossed) {
      patches.push({ alertId: alert.id, patch: { armed: true, triggeredAt: null, acknowledgedAt: null } });
    }
  }
  return patches;
}

/** « Vu » : une manuelle s'éteint, une automatique se désarme jusqu'au retour du cours. */
export function acknowledge(alert: Alert, now: string): AlertPatch {
  return alert.kind === "manual"
    ? { alertId: alert.id, patch: { acknowledgedAt: now, disabled: true } }
    : { alertId: alert.id, patch: { acknowledgedAt: now, armed: false } };
}

export function reactivate(alertId: string): AlertPatch {
  return { alertId, patch: { triggeredAt: null, acknowledgedAt: null, disabled: false, armed: true } };
}

/** Les états d'alertes automatiques disparues ; jamais ceux d'une manuelle. */
export function staleStateIds(alerts: readonly Alert[], states: Iterable<AlertState>): string[] {
  const live = new Set(alerts.map((a) => a.id));
  return [...states]
    .filter((s) => (s.alertId.startsWith("wheel:") || s.alertId.startsWith("condor:")) && !live.has(s.alertId))
    .map((s) => s.alertId);
}
