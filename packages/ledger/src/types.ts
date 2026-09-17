export const TRANSACTION_KINDS = [
  "trade",
  "dividend",
  "interest",
  "fee",
  "tax",
  "corporate_action",
  "transfer",
] as const;

export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export const TRANSACTION_SOURCES = ["flex", "statement_html", "agent"] as const;

export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];

/**
 * One economic event of one account, whatever the source that reported it.
 * Money fields are `null` when the source did not provide them: unknown is
 * never zero.
 */
export interface Transaction {
  /** Slug of the owning account; every IndexedDB key and every route carries it. */
  accountId: string;
  /**
   * Dedup key inside one account:
   * `flex:trade:{tradeID}`, `flex:cash:{transactionID}`, `flex:ca:{transactionID}`,
   * `html:{sha256}` optionally suffixed `#2`, `#3`… for twin rows of one file.
   */
  externalId: string;
  source: TransactionSource;
  kind: TransactionKind;
  symbol: string;
  /** "STK", "OPT", "CASH", "WAR"… or "" when the row has no security. */
  secType: string;
  right: "C" | "P" | "";
  strike: number | null;
  /** YYYY-MM-DD */
  expiry: string | null;
  /** Signed: a sale is negative. */
  quantity: number | null;
  price: number | null;
  /** Gross cash effect of the row, in `currency`. */
  amount: number | null;
  commission: number | null;
  currency: string;
  /** New York's wall clock stamped UTC (see ib-parsers' common.ts), e.g. "2026-08-14T16:20:00.000Z". */
  when: string;
  description: string;
  /**
   * Realized P/L as the source reports it; only corporate actions write it
   * today, and a mixed cash-and-stock merger cannot be replayed without it
   * (the basis split comes from a market price we never see).
   *
   * Optional, not merely nullable: a row stored before version 4 of the
   * schema has no such key at all and reads back `undefined`, never `null`.
   */
  realizedPnl?: number | null;
}

/**
 * One holding of one account at a point in time, whatever the source
 * (Flex Open Positions today, the local agent later). Money fields are
 * `null` when the source did not provide them: unknown is never zero.
 */
export interface Position {
  /** Underlying for an option, the security's own symbol otherwise. */
  symbol: string;
  /** "STK", "OPT", "FOP", "WAR"… as the source reports it. */
  secType: string;
  right: "C" | "P" | "";
  strike: number | null;
  /** YYYY-MM-DD */
  expiry: string | null;
  multiplier: number | null;
  /** Signed: a short position is negative. */
  quantity: number;
  /** Per unit: per share, or per unit of underlying for an option. Never per contract. */
  avgPrice: number | null;
  marketPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  currency: string;
  /** IB contract id; "" when the source does not give one. */
  conid: string;
  description: string;
}
