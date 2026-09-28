import { isWheelCoveredCall, isWheelShares, sharesPerContract, type ClosedPortion, type Lot } from "./book.ts";
import type { ContractKey } from "./contract.ts";
import type { ReplayContext } from "./context.ts";
import { coverAttribution, salePlan, strikePlan, type OpenCall } from "./exitOrder.ts";

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
