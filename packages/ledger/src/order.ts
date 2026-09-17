import type { Transaction } from "./types.ts";

/**
 * Reference order of the ledger: `when` first, then `externalId`. HTML
 * statements stamp cash rows at midnight, so ties on `when` are common and
 * the running balances would be unstable without the second key.
 */
export function compareTransactions(a: Transaction, b: Transaction): number {
  if (a.when < b.when) return -1;
  if (a.when > b.when) return 1;
  if (a.externalId < b.externalId) return -1;
  if (a.externalId > b.externalId) return 1;
  return 0;
}

export function sortTransactions(transactions: readonly Transaction[]): Transaction[] {
  return [...transactions].sort(compareTransactions);
}
