import { sharesPerContract, type Lot } from "./book.ts";
import { EXIT_EPSILON as EPSILON, type Strategy } from "./types.ts";

/** One step of an exit plan: close `quantity` shares (unsigned) of `lot`. */
export interface PlanItem {
  lot: Lot;
  quantity: number;
}

/** Shares of each Wheel lot that back an open covered call (spec 33 §2). */
export type Coverage = ReadonlyMap<Lot, number>;

/** An open covered call of the Wheel, as the attribution sees it. */
export interface OpenCall {
  strike: number;
  /** Unsigned. */
  contracts: number;
}

/** R3: free shares leave Others first, then LEAPS, then the Wheel (spec 33 §3). */
export const SALE_STRATEGY_ORDER: readonly Strategy[] = ["others", "leaps", "wheel"];

const priceOf = (lot: Lot): number => lot.openPrice ?? Number.POSITIVE_INFINITY;

/** Cheapest first, a lot without a price last, stable: equal prices keep book order. */
function byPrice(a: Lot, b: Lot): number {
  const pa = priceOf(a);
  const pb = priceOf(b);
  return pa === pb ? 0 : pa < pb ? -1 : 1;
}

function add(plan: PlanItem[], lot: Lot, quantity: number): void {
  const item = plan.find((p) => p.lot === lot);
  if (item) item.quantity += quantity;
  else plan.push({ lot, quantity });
}

/**
 * R1 (spec 33 §3): the shares a call of `strike` hands over, up to `contracts`
 * contracts — each lot counted with `sharesPerContract` — and `maxShares`
 * shares. The dearest lot at or below the strike, otherwise the cheapest; the
 * next lot by the same rule when one is not enough. `reserved` shares are not
 * available.
 */
export function strikePlan(lots: readonly Lot[], strike: number, contracts: number, reserved: Coverage = new Map(), maxShares = Number.POSITIVE_INFINITY): PlanItem[] {
  const plan: PlanItem[] = [];
  const used = new Map<Lot, number>();
  const available = (lot: Lot) => lot.remaining - (reserved.get(lot) ?? 0) - (used.get(lot) ?? 0);
  let budget = contracts;
  let shares = maxShares;
  while (budget > EPSILON && shares > EPSILON) {
    const candidates = lots.filter((lot) => available(lot) > EPSILON);
    if (candidates.length === 0) break;
    const below = candidates.filter((lot) => lot.openPrice !== null && lot.openPrice <= strike);
    const lot = below.length > 0
      ? below.reduce((best, l) => (priceOf(l) > priceOf(best) ? l : best))
      : candidates.reduce((best, l) => (byPrice(l, best) < 0 ? l : best));
    const per = sharesPerContract(lot);
    const take = Math.min(available(lot), shares, budget * per);
    if (take <= EPSILON) break;
    used.set(lot, (used.get(lot) ?? 0) + take);
    budget -= take / per;
    shares -= take;
    add(plan, lot, take);
  }
  return plan;
}

/**
 * Which Wheel shares back the open covered calls (spec 33 §2): the calls by
 * rising strike — the most constrained first —, each given its shares by R1
 * among those not yet given. Never stored: recomputed at each exit.
 */
export function coverAttribution(wheelLots: readonly Lot[], calls: readonly OpenCall[]): Map<Lot, number> {
  const covered = new Map<Lot, number>();
  const ordered = [...calls].sort((a, b) => a.strike - b.strike);
  for (const call of ordered) {
    for (const { lot, quantity } of strikePlan(wheelLots, call.strike, call.contracts, covered)) {
      covered.set(lot, (covered.get(lot) ?? 0) + quantity);
    }
  }
  return covered;
}

/**
 * R3 (spec 33 §3): free shares first, strategy by strategy in
 * `SALE_STRATEGY_ORDER`, cheapest first within each; covered shares last,
 * cheapest first. A lot reached by both passes is one item. Less than
 * `shares` when the lots run out: the caller opens the rest.
 */
export function salePlan(lots: readonly Lot[], covered: Coverage, shares: number): PlanItem[] {
  const plan: PlanItem[] = [];
  let left = shares;
  const strategies = [...SALE_STRATEGY_ORDER, ...new Set(lots.map((lot) => lot.strategy).filter((s) => !SALE_STRATEGY_ORDER.includes(s)))];
  for (const strategy of strategies) {
    for (const lot of lots.filter((l) => l.strategy === strategy).sort(byPrice)) {
      if (left <= EPSILON) return plan;
      const take = Math.min(lot.remaining - (covered.get(lot) ?? 0), left);
      if (take <= EPSILON) continue;
      add(plan, lot, take);
      left -= take;
    }
  }
  for (const lot of lots.filter((l) => (covered.get(l) ?? 0) > 0).sort(byPrice)) {
    if (left <= EPSILON) return plan;
    const take = Math.min(covered.get(lot) ?? 0, left);
    if (take <= EPSILON) continue;
    add(plan, lot, take);
    left -= take;
  }
  return plan;
}
