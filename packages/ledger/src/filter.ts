import type { Transaction, TransactionKind } from "./types.ts";

/** IB day (New York) of a `when` stamped UTC (see ib-parsers' common.ts). */
export function dayOf(when: string): string {
  return when.slice(0, 10);
}

export interface TransactionFilter {
  /** Case-insensitive substring of the symbol. */
  symbol?: string;
  /** Exact kind; `null` or `undefined` means every kind. */
  kind?: TransactionKind | null;
  /** YYYY-MM-DD, inclusive. */
  from?: string;
  /** YYYY-MM-DD, inclusive. */
  to?: string;
}

export function matchesFilter(tx: Transaction, filter: TransactionFilter): boolean {
  if (filter.symbol && !tx.symbol.toLowerCase().includes(filter.symbol.toLowerCase())) {
    return false;
  }
  if (filter.kind && tx.kind !== filter.kind) return false;
  const day = dayOf(tx.when);
  if (filter.from && day < filter.from) return false;
  if (filter.to && day > filter.to) return false;
  return true;
}

export function filterTransactions(
  transactions: readonly Transaction[],
  filter: TransactionFilter,
): Transaction[] {
  return transactions.filter((tx) => matchesFilter(tx, filter));
}
