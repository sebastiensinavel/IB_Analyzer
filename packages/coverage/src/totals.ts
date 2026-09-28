import type { CurrencyTotal, Position } from "@ib/ledger";

/**
 * One column summed by currency (spec of sub-project 36, §2.1): the known values added, the
 * `null` ones counted apart, never converted from one currency into another.
 */
export function sumByCurrency<Row>(rows: readonly Row[], currencyOf: (row: Row) => string, pick: (row: Row) => number | null): CurrencyTotal[] {
  const byCurrency = new Map<string, CurrencyTotal>();
  for (const row of rows) {
    const currency = currencyOf(row);
    const bucket = byCurrency.get(currency) ?? { currency, total: null, missing: 0, count: 0 };
    byCurrency.set(currency, bucket);
    bucket.count += 1;
    const value = pick(row);
    if (value === null) bucket.missing += 1;
    else bucket.total = (bucket.total ?? 0) + value;
  }
  return [...byCurrency.values()].sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}

/** Several sums added by currency: a page's header over its tables' headers. */
export function addTotals(...lists: readonly (readonly CurrencyTotal[])[]): CurrencyTotal[] {
  const byCurrency = new Map<string, CurrencyTotal>();
  for (const entry of lists.flat()) {
    const bucket = byCurrency.get(entry.currency) ?? { currency: entry.currency, total: null, missing: 0, count: 0 };
    byCurrency.set(entry.currency, bucket);
    bucket.missing += entry.missing;
    bucket.count += entry.count;
    if (entry.total !== null) bucket.total = (bucket.total ?? 0) + entry.total;
  }
  return [...byCurrency.values()].sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}

/** What the account is worth, by currency: the snapshot's market values plus the current cash (§2.4). */
export function liquidationValue(positions: readonly Position[], cash: Readonly<Record<string, number | null>>): CurrencyTotal[] {
  type Part = { currency: string; value: number | null };
  const parts: Part[] = [
    ...positions.map((p) => ({ currency: p.currency, value: p.marketValue })),
    ...Object.entries(cash).map(([currency, value]) => ({ currency, value })),
  ];
  return sumByCurrency(parts, (p) => p.currency, (p) => p.value);
}
