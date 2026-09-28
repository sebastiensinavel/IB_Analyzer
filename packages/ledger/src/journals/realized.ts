import { marketDayOf } from "../filter.ts";
import type { JournalRow } from "./types.ts";

/** A sum of one currency's values: `total` over the known ones, `null` when none is known. */
export interface CurrencyTotal {
  currency: string;
  total: number | null;
  /** Lines whose value was `null`: left out of `total`, never counted as 0. */
  missing: number;
  count: number;
}

/**
 * What the lines closed on a market day realized, by currency (spec of sub-project 36, §2.2):
 * every strategy, Others included, whatever closed them — a buyback, a sale, an assignment, an
 * expiry. An opening realizes nothing. A condor has one line, its composite — its legs have none —
 * so it counts once, on the day its last leg closes.
 */
export function realizedOnDay(rows: readonly JournalRow[], day: string): CurrencyTotal[] {
  const byCurrency = new Map<string, CurrencyTotal>();
  for (const row of rows) {
    if (row.endWhen === null || marketDayOf(row.endWhen) !== day) continue;
    const bucket = byCurrency.get(row.currency) ?? { currency: row.currency, total: null, missing: 0, count: 0 };
    byCurrency.set(row.currency, bucket);
    bucket.count += 1;
    if (row.pnl === null) bucket.missing += 1;
    else bucket.total = (bucket.total ?? 0) + row.pnl;
  }
  return [...byCurrency.values()].sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}
