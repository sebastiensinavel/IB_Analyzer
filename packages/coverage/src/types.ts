import type { CoverSource, PositionKind, StructureKind } from "./constants.ts";

/** One slice of coverage attributed to a short option leg. */
export interface CoverageAllocation {
  source: CoverSource;
  /** Number of short contracts covered by this slice. */
  quantity: number;
  /** Human-readable origin of the coverage. */
  detail: string;
}

export interface AnalyzedPosition {
  description: string;
  kind: PositionKind;
  label: string;
  marketValue: number | null;
  /** Signed. */
  quantity: number;
  /** Per unit. */
  avgPrice: number | null;
  lastPrice: number | null;
  unrealizedPnl: number | null;
  /** Today's P&L IB computes for the whole position; `null` outside an agent snapshot. */
  dailyPnl: number | null;
  /** Today's move of the mark price, as a fraction; `null` for a contract traded today. */
  dayChange: number | null;
  action: "to evaluate" | "ignore";
  decision: "buy back" | "keep" | null;
  symbol: string;
  secType: string;
  currency: string;
  /** "C", "P" or "". */
  right: string;
  /** 0 when the contract has none. */
  strike: number;
  /** YYYY-MM-DD, "" when the contract has none. */
  expiry: string;
  multiplier: number;
  // Filled in by the coverage engine.
  allocations: CoverageAllocation[];
  uncoveredQuantity: number;
  usedQuantity: number;
  requiredCash: number;
  riskNotes: string[];
}

/** A same-expiry defined-risk structure with a capped maximum loss. */
export interface Structure {
  symbol: string;
  /** YYYY-MM-DD */
  expiry: string;
  kind: StructureKind;
  /** Number of short contracts inside the structure. */
  contracts: number;
  callRisk: number;
  putRisk: number;
  /** Net premium collected when the structure was opened. */
  credit: number;
}

export interface RiskReport {
  /** USD; `null` when the source gave no cash figure. */
  cashAvailable: number | null;
  positions: AnalyzedPosition[];
  structures: Structure[];
}
