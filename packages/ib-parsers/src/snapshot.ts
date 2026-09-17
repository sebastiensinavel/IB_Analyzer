import type { Position } from "@ib/ledger";

/** A currency line of a Cash Report, never its base-currency summary. */
export const CURRENCY_CODE_RE = /^[A-Z]{3}$/;

/** Positions and USD cash of one file, as of the close of `asOf`. */
export interface FileSnapshot {
  /** YYYY-MM-DD */
  asOf: string;
  positions: Position[];
  /** USD Ending Cash of the same file: TWS's TotalCashBalance at the close; `null` when absent. */
  cashAvailable: number | null;
}

export interface CashPointValues {
  /** YYYY-MM-DD */
  asOf: string;
  /** Per three-letter currency code; a currency the report does not list is absent, never 0. */
  balances: Record<string, number>;
}

/** Starting Cash at the start of the file's period, Ending Cash at its end. */
export interface CashReport {
  start: CashPointValues;
  end: CashPointValues;
}
