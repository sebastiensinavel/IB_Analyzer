import type { JournalRow } from "@ib/ledger";
import { alertStatus, stateOf } from "./evaluate.ts";
import type { Alert, AlertState } from "./types.ts";

export interface AlertBadgeCounts { all: number; wheel: number; leaps: number; condors: number; others: number }

/** Les alertes déclenchées, au total et par stratégie (une manuelle compte dans chaque stratégie qui tient son ticker). */
export function alertBadgeCounts(alerts: readonly Alert[], states: ReadonlyMap<string, AlertState>, rows: readonly JournalRow[]): AlertBadgeCounts {
  const counts: AlertBadgeCounts = { all: 0, wheel: 0, leaps: 0, condors: 0, others: 0 };
  for (const alert of alerts) {
    if (alertStatus(alert, stateOf(states, alert.id)) !== "triggered") continue;
    counts.all += 1;
    if (alert.kind === "wheel") counts.wheel += 1;
    else if (alert.kind === "condor") counts.condors += 1;
    else {
      const held = new Set(rows.filter((r) => r.endWhen === null && r.ticker.toUpperCase() === alert.ticker).map((r) => r.strategy));
      for (const strategy of held) counts[strategy] += 1;
    }
  }
  return counts;
}
