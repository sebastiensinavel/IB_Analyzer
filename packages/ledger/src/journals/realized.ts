import { dayOf } from "../filter.ts";
import { sumByCurrency, type CurrencyTotal } from "../totals.ts";
import type { JournalRow } from "./types.ts";

/**
 * What the lines closed on a day realized, by currency (spec of sub-project 36, §2.2):
 * every strategy, Others included, whatever closed them — a buyback, a sale, an assignment, an
 * expiry. An opening realizes nothing. A condor has one line, its composite — its legs have none —
 * so it counts once, on the day its last leg closes.
 *
 * The calendar day in New York, never `marketDayOf`: TWS's daily P&L, shown beside it, has
 * already turned over at midnight, and a 04:00 boundary would show yesterday's realized next
 * to today's P&L until then. An assignment the agent books after midnight counts on that night's
 * day, until Flex redates it to the expiry.
 */
export function realizedOnDay(rows: readonly JournalRow[], day: string): CurrencyTotal[] {
  const closed = rows.filter((row) => row.endWhen !== null && dayOf(row.endWhen) === day);
  return sumByCurrency(closed, (row) => row.currency, (row) => row.pnl);
}
