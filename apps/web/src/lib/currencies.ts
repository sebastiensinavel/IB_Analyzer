/**
 * The currencies the History keeps a running balance for, and the Consistency page checks
 * against the Cash Reports; the ledger itself is currency-agnostic.
 */
export const BALANCE_CURRENCIES = ["USD", "EUR"] as const;
