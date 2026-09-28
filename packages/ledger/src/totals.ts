/** A sum of one currency's values: `total` over the known ones, `null` when none is known. */
export interface CurrencyTotal {
  currency: string;
  total: number | null;
  /** Lines whose value was `null`: left out of `total`, never counted as 0. */
  missing: number;
  count: number;
}

/** The one order of every list of totals: by currency code. */
export function compareCurrencyTotals(a: CurrencyTotal, b: CurrencyTotal): number {
  return a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0;
}

/**
 * One column summed by currency (spec of sub-project 36, §2.1): the known values added, the
 * `null` ones counted apart, never converted from one currency into another.
 */
export function sumByCurrency<Row>(rows: readonly Row[], currencyOf: (row: Row) => string, pick: (row: Row) => number | null): CurrencyTotal[] {
  return addTotals(
    rows.map((row) => {
      const value = pick(row);
      return { currency: currencyOf(row), total: value, missing: value === null ? 1 : 0, count: 1 };
    }),
  );
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
  return [...byCurrency.values()].sort(compareCurrencyTotals);
}
