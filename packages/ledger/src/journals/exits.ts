import { isWheelCoveredCall, isWheelShares, sharesPerContract, type ClosedPortion, type Lot } from "./book.ts";
import type { Transaction } from "../types.ts";
import { contractOf, type ContractKey } from "./contract.ts";
import type { ReplayContext } from "./context.ts";
import { coverAttribution, salePlan, strikePlan, type OpenCall } from "./exitOrder.ts";
import { EXIT_EPSILON } from "./types.ts";

/** Long share lots still open on `shares`, in book order. */
export function longLots(ctx: ReplayContext, shares: ContractKey): Lot[] {
  return ctx.book.openLots(shares).filter((lot) => lot.remaining > 0);
}

/** The Wheel shares backing the covered calls open on this underlying right now (spec 33 §2). */
export function coverageOf(ctx: ReplayContext, shares: ContractKey): Map<Lot, number> {
  const calls: OpenCall[] = ctx.book
    .allOpen()
    .filter((lot) => isWheelCoveredCall(lot) && lot.contract.ticker === shares.ticker && lot.contract.currency === shares.currency && lot.contract.strike !== null)
    .map((lot) => ({ strike: lot.contract.strike as number, contracts: Math.abs(lot.remaining) }));
  return coverAttribution(longLots(ctx, shares).filter(isWheelShares), calls);
}

/** R1 on the Wheel's shares: what a call of `strike` hands over (spec 33 §3). */
export function sellAtStrike(ctx: ReplayContext, shares: ContractKey, strike: number, contracts: number, maxShares: number): ClosedPortion[] {
  return ctx.book.closeOrdered(strikePlan(longLots(ctx, shares).filter(isWheelShares), strike, contracts, new Map(), maxShares));
}

/** R3: free shares Others → LEAPS → Wheel, cheapest first, covered ones last (spec 33 §3). */
export function sellFree(ctx: ReplayContext, shares: ContractKey, quantity: number): ClosedPortion[] {
  return ctx.book.closeOrdered(salePlan(longLots(ctx, shares), coverageOf(ctx, shares), quantity));
}

/** One portion per lot, in first-seen order: a lot reached by two passes makes one row. */
export function mergePortions(...lists: ClosedPortion[][]): ClosedPortion[] {
  const merged = new Map<Lot, number>();
  for (const list of lists) for (const { lot, quantity } of list) merged.set(lot, (merged.get(lot) ?? 0) + quantity);
  return [...merged].map(([lot, quantity]) => ({ lot, quantity }));
}

export function sharesOf(portions: ClosedPortion[]): number {
  return portions.reduce((n, p) => n + p.quantity, 0);
}

export function contractsOf(portions: ClosedPortion[]): number {
  return portions.reduce((n, p) => n + p.quantity / sharesPerContract(p.lot), 0);
}

/**
 * The Wheel covered contracts a buyback not yet replayed will close: its FIFO
 * close walked ahead of time, as `LotBook.close` will walk it. An older lot
 * of the same contract — a naked call of Others — is closed first and gives
 * R2 nothing.
 */
function wheelContractsClosedBy(ctx: ReplayContext, buyback: Transaction): number {
  const quantity = buyback.quantity ?? 0;
  let left = Math.abs(quantity);
  let wheel = 0;
  for (const lot of ctx.book.openLots(contractOf(buyback))) {
    if (left <= EXIT_EPSILON) break;
    if (Math.sign(lot.remaining) === Math.sign(quantity)) continue;
    const take = Math.min(Math.abs(lot.remaining), left);
    left -= take;
    if (isWheelCoveredCall(lot)) wheel += take;
  }
  return wheel;
}

/** Contracts a buyback may still hand to R2: set at its first use (spec 33 §5.3). */
function budgetOf(ctx: ReplayContext, buyback: Transaction): number {
  const known = ctx.buybackBudget.get(buyback);
  if (known !== undefined) return known;
  const budget = ctx.buybackClosed.get(buyback) ?? wheelContractsClosedBy(ctx, buyback);
  ctx.buybackBudget.set(buyback, budget);
  return budget;
}

/** A long-share sale: R2 against its paired buybacks, nearest first, then R3 (spec 33 §3). */
export function sellShares(ctx: ReplayContext, sale: Transaction, shares: ContractKey, quantity: number): ClosedPortion[] {
  let left = quantity;
  const parts: ClosedPortion[][] = [];
  for (const buyback of ctx.buybacks.get(sale) ?? []) {
    if (left <= EXIT_EPSILON) break;
    const budget = budgetOf(ctx, buyback);
    if (budget <= EXIT_EPSILON || buyback.strike === null) continue;
    const part = sellAtStrike(ctx, shares, buyback.strike, budget, left);
    ctx.buybackBudget.set(buyback, budget - contractsOf(part));
    left -= sharesOf(part);
    parts.push(part);
  }
  if (left > EXIT_EPSILON) parts.push(sellFree(ctx, shares, left));
  return mergePortions(...parts);
}
