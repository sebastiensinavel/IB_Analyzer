import type { Position } from "../types.ts";
import type { ContractKey } from "./contract.ts";

export const STRATEGIES = ["wheel", "leaps", "condors", "others"] as const;
export type Strategy = (typeof STRATEGIES)[number];
/** Others has no statistics: it is where what fits nowhere else goes. */
export type StatsStrategy = "wheel" | "leaps" | "condors";

/** A statistics page, or the three strategies at once for the dashboard. */
export type CapitalScope = StatsStrategy | "portfolio";
/**
 * The strategies whose lines a scope reads. The dashboard's figures are the same computation over
 * more lines, never a sum of the strategies' results (spec of sub-project 14, §3).
 */
export const SCOPE_STRATEGIES: Record<CapitalScope, readonly StatsStrategy[]> = {
  wheel: ["wheel"],
  leaps: ["leaps"],
  condors: ["condors"],
  portfolio: ["wheel", "leaps", "condors"],
};

export type RowKind =
  | "short_put"
  | "short_call"
  | "long_call"
  | "long_put"
  | "shares"
  | "short_shares"
  | "condor"
  /** An OptionCashSettlement no price-0 close claimed. */
  | "settlement";

export type CloseEvent = "buyback" | "sold" | "expired" | "assigned" | "exercised" | "corporate_action" | "integrated";

export const ROW_NOTE_CODES = ["takenOverAtStrike", "handedToWheel", "nakedCall", "truncatedHistory"] as const;
export type RowNoteCode = (typeof ROW_NOTE_CODES)[number];

/**
 * Why a line sits in the journal it sits in. The engine never writes prose: the
 * application translates `code` and interpolates `contract`, which is already
 * language-neutral (`formatContractLabel` writes English in both languages).
 */
export interface RowNote {
  code: RowNoteCode;
  /** Label of the contract the note names, when it names one. */
  contract?: string;
}

/** A bought call is a LEAPS when its expiry is at least this many calendar months after the purchase day. */
export const LEAPS_MIN_MONTHS = 3;

/**
 * Two trades of one contract in one direction closer than this are slices of
 * a single order: the journals fold them into one line (`journals/fills.ts`).
 */
export const FILL_MERGE_WINDOW_MS = 2000;

/**
 * One line of a journal: one lot and one exit event (spec §3.6). Money fields
 * are in `currency`, signed as the broker signs them (a premium received is
 * positive), and `null` when the source did not give them: unknown is never 0.
 */
export interface JournalRow {
  /** Stable: the opening transaction's externalId plus the exit's rank. */
  id: string;
  strategy: Strategy;
  kind: RowKind;
  ticker: string;
  /** "MQZA Oct02'26 17 Call", "MQZA", "SPY Aug29'26 IC 620/625/660/665". */
  label: string;
  currency: string;
  /** The line's contract, its ticker canonical like `ticker`; a condor composite has no right nor strike. */
  contract: ContractKey;
  /** The opening transaction's instant, ISO, like `Transaction.when`. */
  startWhen: string;
  /** Signed: -4 for four puts sold, +200 for shares held; `null` for a bare settlement. */
  quantity: number | null;
  /** Option: the contract's strike; `null` for shares and for a condor composite. */
  strike: number | null;
  openPrice: number | null;
  openTotal: number | null;
  openCommission: number | null;
  /** openTotal + openCommission */
  openNet: number | null;
  /** Option: assigned or exercised. Shares: delivered by an option rather than bought. */
  assigned: boolean;
  /** The exit's instant, ISO; `null` while the line is open. */
  endWhen: string | null;
  closePrice: number | null;
  closeTotal: number | null;
  closeCommission: number | null;
  closeNet: number | null;
  /** openNet + closeNet; `null` while the line is open or a figure is missing. */
  pnl: number | null;
  /** Still open — a put stays ongoing after assignment until its shares are sold. */
  ongoing: boolean;
  event: CloseEvent | null;
  /** Opened by a price-0 close or a delivery that found no lot: the history is truncated. */
  orphan: boolean;
  /** Why this line is in this journal; `null` when the line speaks for itself. */
  note: RowNote | null;
  openIds: string[];
  closeIds: string[];
  /** Condor only: the four legs. */
  legs?: JournalRow[];
}

export interface JournalSnapshot {
  /** YYYY-MM-DD (Flex) or an ISO instant (agent), like SnapshotRecord.asOf. */
  asOf: string;
  positions: readonly Position[];
}

export interface ReconciliationDifference {
  contract: ContractKey;
  label: string;
  ledgerQty: number;
  snapshotQty: number;
}

export interface Reconciliation {
  /** `null` without a snapshot. */
  asOf: string | null;
  differences: ReconciliationDifference[];
  orphans: JournalRow[];
}

export interface MonthPnl {
  /** YYYY-MM */
  month: string;
  pnl: number;
}

export interface StrategyStats {
  currency: string;
  total: number;
  /** Consecutive months from the first flow to the later of the last flow and the ledger's last transaction, zeros included. */
  months: MonthPnl[];
  /** Contributions skipped for want of an amount. */
  incomplete: number;
}

/** What a line ties up is filed under one of these (spec of sub-project 14, §2). */
export type CapitalMeasure = "assigned" | "putCash" | "leaps" | "condors";

/** One month of a scope's money, measured at the month's end. */
export interface CapitalMonth {
  /** YYYY-MM, the same months as the scope's StrategyStats, index for index. */
  month: string;
  cumulativePnl: number;
  /** Wheel shares held, at the price they entered the Wheel at. */
  assigned: number;
  /** Wheel puts open, at strike × multiplier × contracts. */
  putCash: number;
  /** LEAPS open at their purchase price, and shares a LEAPS delivered at its strike. */
  leaps: number;
  /** Condors open, at their worst wing × multiplier × contracts. */
  condors: number;
  /** assigned + putCash + leaps + condors */
  allocated: number;
  /** allocated − cumulativePnl */
  invested: number;
  /** This month's pnl / the most money tied up at once during it; `null` when nothing was. */
  returnRate: number | null;
}

export interface Exposure {
  ticker: string;
  assigned: number;
  putCash: number;
  leaps: number;
  condors: number;
}

export interface StrategyCapital {
  currency: string;
  months: CapitalMonth[];
  /** Lines still open (`endWhen === null`), summed per ticker; only non-zero tickers, sorted by ticker. */
  exposure: Exposure[];
  /** Lines left out for want of a strike, a price, a quantity or a leg. */
  incomplete: number;
}

export interface JournalsReport {
  /** Every strategy, sorted by startWhen descending then id. */
  rows: JournalRow[];
  reconciliation: Reconciliation;
  stats: Record<CapitalScope, StrategyStats[]>;
  /** One entry per entry of `stats[scope]`, in the same order. */
  capital: Record<CapitalScope, StrategyCapital[]>;
}
