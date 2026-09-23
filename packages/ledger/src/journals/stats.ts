import type { JournalRow, StatsStrategy, Strategy, StrategyStats } from "./types.ts";

/** "2026-08-14" or "2026-08-14T15:55:58.000Z" -> "2026-08" */
export function monthOf(when: string): string {
  return when.slice(0, 7);
}

export function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let [year, month] = first.split("-").map(Number);
  for (;;) {
    const current = `${year}-${String(month).padStart(2, "0")}`;
    out.push(current);
    if (current >= last) return out;
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
}

interface Contribution {
  month: string;
  amount: number | null;
}

/**
 * Cash-flow attribution (spec §5): an option's opening and closing nets in
 * their own months; shares, whether an option delivered them or the Wheel
 * took them over, and bought calls only at their sale, as a whole pnl. An
 * open option already counts its premium; open shares count nothing.
 */
function contributions(row: JournalRow): Contribution[] {
  if (row.kind === "shares" || row.kind === "short_shares") {
    if (row.endWhen === null) return [];
    return [{ month: monthOf(row.endWhen), amount: row.pnl }];
  }
  if (row.kind === "long_call" || row.kind === "long_put") {
    if (row.endWhen === null) return [];
    return [{ month: monthOf(row.endWhen), amount: row.pnl }];
  }
  const out: Contribution[] = [{ month: monthOf(row.startWhen), amount: row.openNet }];
  if (row.endWhen !== null) out.push({ month: monthOf(row.endWhen), amount: row.closeNet });
  return out;
}

/**
 * `lastWhen` is the ledger's last transaction, whatever its strategy: the months run on to it,
 * so a position still open shows the months it has been open, not only the months money moved.
 * `strategies` is one strategy for its page, the active ones for the dashboard: the same flows, summed.
 */
export function computeStats(rows: readonly JournalRow[], strategies: readonly StatsStrategy[], lastWhen: string | null): StrategyStats[] {
  const scope = new Set<Strategy>(strategies);
  const byCurrency = new Map<string, { total: number; months: Map<string, number>; incomplete: number }>();
  for (const row of rows) {
    if (!scope.has(row.strategy)) continue;
    const bucket = byCurrency.get(row.currency) ?? { total: 0, months: new Map(), incomplete: 0 };
    byCurrency.set(row.currency, bucket);
    for (const { month, amount } of contributions(row)) {
      if (amount === null) {
        bucket.incomplete += 1;
        continue;
      }
      bucket.total += amount;
      bucket.months.set(month, (bucket.months.get(month) ?? 0) + amount);
    }
  }
  const lastMonth = lastWhen === null ? null : monthOf(lastWhen);
  return [...byCurrency.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, bucket]) => {
      const keys = [...bucket.months.keys()].sort();
      if (keys.length === 0) return { currency, total: bucket.total, months: [], incomplete: bucket.incomplete };
      const lastFlow = keys[keys.length - 1];
      const last = lastMonth !== null && lastMonth > lastFlow ? lastMonth : lastFlow;
      const months = monthsBetween(keys[0], last).map((month) => ({ month, pnl: bucket.months.get(month) ?? 0 }));
      return { currency, total: bucket.total, months, incomplete: bucket.incomplete };
    });
}
