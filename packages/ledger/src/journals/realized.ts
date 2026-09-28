import { marketDayOf } from "../filter.ts";
import { sumByCurrency, type CurrencyTotal } from "../totals.ts";
import type { JournalRow } from "./types.ts";

/**
 * What the lines closed on a market day realized, by currency (spec of sub-project 36, §2.2):
 * every strategy, Others included, whatever closed them — a buyback, a sale, an assignment, an
 * expiry. An opening realizes nothing. A condor has one line, its composite — its legs have none —
 * so it counts once, on the day its last leg closes.
 */
export function realizedOnDay(rows: readonly JournalRow[], day: string): CurrencyTotal[] {
  const closed = rows.filter((row) => row.endWhen !== null && marketDayOf(row.endWhen) === day);
  return sumByCurrency(closed, (row) => row.currency, (row) => row.pnl);
}
