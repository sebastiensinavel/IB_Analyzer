import { contractId, wheelHoldings, type JournalRow } from "@ib/ledger";
import type { AlertMargins, AlertState, AutoAlert, CondorAlert, WheelAlert } from "./types.ts";

const cents = (value: number) => Math.round(value * 100) / 100;

/** Les alertes que les journaux ouverts font naître : calls Wheel sous assignation et ailes vendues des condors. */
export function autoAlerts(rows: readonly JournalRow[], margins: AlertMargins, states: ReadonlyMap<string, AlertState>): AutoAlert[] {
  return [...wheelAlerts(rows, margins, states), ...condorAlerts(rows, margins, states)];
}

function wheelAlerts(rows: readonly JournalRow[], margins: AlertMargins, states: ReadonlyMap<string, AlertState>): WheelAlert[] {
  const assignment = new Map(wheelHoldings(rows).map((h) => [`${h.ticker}|${h.currency}`, h.averageAssignmentPrice]));
  const byContract = new Map<string, JournalRow[]>();
  for (const row of rows) {
    if (row.strategy !== "wheel" || row.kind !== "short_call" || row.endWhen !== null) continue;
    if (row.strike === null || row.quantity === null) continue;
    const average = assignment.get(`${row.ticker}|${row.currency}`) ?? null;
    if (average === null || row.strike >= average) continue;
    const key = contractId(row.contract);
    byContract.set(key, [...(byContract.get(key) ?? []), row]);
  }
  return [...byContract].map(([key, group]) => {
    const first = group.reduce((a, b) => (a.startWhen <= b.startWhen ? a : b));
    const id = `wheel:${key}`;
    const state = states.get(id);
    const fraction = state?.override ?? margins.wheel;
    const anchor = state?.anchor ?? null;
    const strike = first.strike as number;
    return {
      id, kind: "wheel", ticker: first.ticker, currency: first.currency, contract: first.contract,
      strike, expiry: first.contract.expiry, quantity: group.reduce((sum, r) => sum + (r.quantity as number), 0),
      averageAssignmentPrice: assignment.get(`${first.ticker}|${first.currency}`) as number,
      saleWhen: first.startWhen, fraction, anchor,
      thresholds: anchor === null ? null : [{ price: cents(anchor.price + (strike - anchor.price) * fraction), direction: "above" }],
    };
  });
}

function condorAlerts(rows: readonly JournalRow[], margins: AlertMargins, states: ReadonlyMap<string, AlertState>): CondorAlert[] {
  const alerts: CondorAlert[] = [];
  for (const row of rows) {
    if (row.strategy !== "condors" || row.kind !== "condor" || row.endWhen !== null || row.legs?.length !== 4) continue;
    const [longPut, shortPut, shortCall, longCall] = row.legs;
    const strikes = [longPut.strike, shortPut.strike, shortCall.strike, longCall.strike];
    if (strikes.some((s) => s === null)) continue;
    const id = `condor:${row.id}`;
    const margin = states.get(id)?.override ?? margins.condor;
    const offset = cents(((shortCall.strike as number) - (shortPut.strike as number)) * margin);
    const thresholds = [
      ...(shortPut.endWhen === null ? [{ price: cents((shortPut.strike as number) + offset), direction: "below" as const }] : []),
      ...(shortCall.endWhen === null ? [{ price: cents((shortCall.strike as number) - offset), direction: "above" as const }] : []),
    ];
    if (thresholds.length === 0) continue;
    alerts.push({
      id, kind: "condor", ticker: row.ticker, currency: row.currency, strikes: strikes as [number, number, number, number],
      expiry: row.contract.expiry, quantity: row.quantity ?? 0, margin, offset, thresholds,
      legs: row.legs.map((leg) => leg.contract),
    });
  }
  return alerts;
}
