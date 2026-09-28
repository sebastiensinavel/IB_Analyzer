import { contractId, contractOf, type Position } from "@ib/ledger";
import { evaluateBuyback, type BuybackTiming, type SaleTiming } from "./buyback.ts";
import { DEFAULT_MULTIPLIER, EVALUATE_KINDS, KIND_LABELS, type PositionKind } from "./constants.ts";
import { fmtNum } from "./format.ts";
import type { AnalyzedPosition } from "./types.ts";

function isOption(pos: Position): boolean {
  return pos.secType === "OPT" || pos.secType === "FOP";
}

/** IB's sign convention: quantity > 0 is long (bought), < 0 is short (sold). */
export function classify(pos: Position): PositionKind {
  if (isOption(pos)) {
    const right = pos.right.toUpperCase();
    if (right.startsWith("C")) return pos.quantity < 0 ? "short_call" : "long_call";
    if (right.startsWith("P")) return pos.quantity < 0 ? "short_put" : "long_put";
    return "other";
  }
  if (pos.quantity > 0) return "long_stock";
  if (pos.quantity < 0) return "short_stock";
  return "other";
}

/** The contract multiplier (100 for standard equity options). */
export function contractMultiplier(pos: Position): number {
  return pos.multiplier !== null && pos.multiplier > 0 ? pos.multiplier : DEFAULT_MULTIPLIER;
}

/** "AAPL 2026-01-16 C 150" for an option, "AAPL (STK)" otherwise. */
export function describeContract(pos: Position): string {
  if (isOption(pos)) {
    const right = pos.right.toUpperCase().slice(0, 1);
    return `${pos.symbol} ${pos.expiry ?? ""} ${right} ${fmtNum(pos.strike)}`;
  }
  return `${pos.symbol} (${pos.secType})`;
}

/** The time a short option has run, from the sale table; `null` when anything is missing. */
function timingOf(pos: Position, sales: SaleTiming | null): BuybackTiming | null {
  if (!sales || !pos.expiry) return null;
  const soldAt = sales.soldAt.get(contractId(contractOf(pos)));
  return soldAt ? { soldAt, expiry: pos.expiry, asOf: sales.asOf } : null;
}

/** Turn a raw position into an AnalyzedPosition, coverage not yet computed. */
export function analyze(pos: Position, sales: SaleTiming | null = null): AnalyzedPosition {
  const kind = classify(pos);
  const multiplier = contractMultiplier(pos);
  const action = EVALUATE_KINDS.has(kind) ? "to evaluate" : "ignore";
  // An unknown sale price counts as 0 for the rule only: sale 0 -> "keep".
  // An unknown current price makes the decision itself unknown: never fabricate
  // a "buy back" from a missing markPrice.
  const buyback =
    action === "to evaluate" && pos.marketPrice !== null ? evaluateBuyback(pos.avgPrice ?? 0, pos.marketPrice, timingOf(pos, sales)) : null;
  return {
    description: describeContract(pos),
    kind,
    label: KIND_LABELS[kind],
    marketValue: pos.marketValue,
    quantity: pos.quantity,
    avgPrice: pos.avgPrice,
    lastPrice: pos.marketPrice,
    unrealizedPnl: pos.unrealizedPnl,
    dailyPnl: pos.dailyPnl,
    dayChange: pos.dayChange,
    action,
    decision: buyback?.decision ?? null,
    buyback,
    symbol: pos.symbol,
    secType: pos.secType,
    currency: pos.currency,
    right: pos.right.toUpperCase().slice(0, 1),
    strike: pos.strike ?? 0,
    expiry: pos.expiry ?? "",
    multiplier,
    allocations: [],
    uncoveredQuantity: 0,
    usedQuantity: 0,
    requiredCash: 0,
    riskNotes: [],
  };
}
