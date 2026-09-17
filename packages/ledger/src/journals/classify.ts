import { dayOf } from "../filter.ts";
import type { Transaction } from "../types.ts";
import { newLot, sharesPerContract, type Lot, type LotBook } from "./book.ts";
import { contractId, contractOf, isAtLeastMonthsAway, sharesContract, type ContractKey } from "./contract.ts";
import { idsOf, kindOf, uniqueId, type ReplayContext } from "./context.ts";
import { detectCondor, openCondor } from "./condor.ts";
import { share } from "./rows.ts";
import { coverableLots, takeOverShares } from "./takeover.ts";
import { LEAPS_MIN_MONTHS, type Strategy } from "./types.ts";

export interface Opening {
  tx: Transaction;
  /** Signed part of the transaction left to open once the closes are done. */
  quantity: number;
  /** A price-0 close that found nothing to close: the history is truncated. */
  orphan: boolean;
}

/** Opens `quantity` (signed, defaults to the whole opening) of `opening` as one lot. */
export function openLot(ctx: ReplayContext, opening: Opening, strategy: Strategy, cover: Lot["cover"], quantity = opening.quantity): Lot {
  const { tx } = opening;
  const whole = Math.abs(tx.quantity ?? 0);
  const lot = newLot({
    id: uniqueId(ctx, tx.externalId),
    contract: contractOf(tx),
    strategy: opening.orphan ? "others" : strategy,
    kind: kindOf(tx.secType, tx.right, quantity),
    openWhen: tx.when,
    openPrice: tx.price,
    openAmount: share(tx.amount, Math.abs(quantity), whole),
    openCommission: share(tx.commission, Math.abs(quantity), whole),
    quantity,
    openIds: idsOf(ctx, tx),
    orphan: opening.orphan,
    cover,
  });
  ctx.book.open(lot);
  return lot;
}

/** What one underlying can cover right now, read from the open lots (spec §3.4). */
export class StrategyState {
  private readonly book: LotBook;

  constructor(book: LotBook) {
    this.book = book;
  }

  private lotsOf(contract: ContractKey): Lot[] {
    return this.book.allOpen().filter((lot) => lot.contract.ticker === contract.ticker && lot.contract.currency === contract.currency);
  }

  /** The long share lots this underlying's calls can be written on. */
  private coverable(contract: ContractKey): Lot[] {
    return coverableLots(this.book, sharesContract(contract.ticker, contract.currency));
  }

  /** Contracts already backed by these shares through the covered calls still open. */
  coveredCalls(contract: ContractKey): number {
    return this.lotsOf(contract)
      .filter((lot) => lot.kind === "short_call" && lot.cover === "shares")
      .reduce((n, lot) => n + Math.abs(lot.remaining), 0);
  }

  /** Shares held in contract-equivalents, whole contracts only, minus the short calls they already cover. */
  wheelCapacity(contract: ContractKey): number {
    const shares = this.coverable(contract).reduce((n, lot) => n + lot.remaining / sharesPerContract(lot), 0);
    return Math.max(0, Math.floor(shares) - this.coveredCalls(contract));
  }

  leapsCapacity(contract: ContractKey): number {
    const lots = this.lotsOf(contract);
    const leaps = lots.filter((lot) => lot.kind === "long_call" && lot.strategy === "leaps").reduce((n, lot) => n + lot.remaining, 0);
    const covered = lots.filter((lot) => lot.kind === "short_call" && lot.cover === "leaps").reduce((n, lot) => n + Math.abs(lot.remaining), 0);
    return Math.max(0, leaps - covered);
  }

  /**
   * Weighted by what is still held, each lot at its current basis: the strike
   * for shares the Wheel has already taken over, the purchase price for shares
   * it has not. `null` when nothing is held.
   */
  averageSharePrice(contract: ContractKey): number | null {
    const lots = this.coverable(contract).filter((lot) => lot.openPrice !== null);
    const quantity = lots.reduce((n, lot) => n + lot.remaining, 0);
    if (quantity === 0) return null;
    return lots.reduce((n, lot) => n + (lot.openPrice ?? 0) * lot.remaining, 0) / quantity;
  }
}

export interface CallPart {
  strategy: Strategy;
  cover: Lot["cover"];
  /** Unsigned. */
  quantity: number;
}

/** Spec §3.4, rule 5: how `n` calls sold split between the Wheel cover `aw`, the LEAPS cover `lw` and nothing. */
export function splitShortCall(n: number, aw: number, lw: number, strike: number | null, averageSharePrice: number | null): CallPart[] {
  const wheel = (quantity: number): CallPart => ({ strategy: "wheel", cover: "shares", quantity });
  const leaps = (quantity: number): CallPart => ({ strategy: "leaps", cover: "leaps", quantity });
  const naked = (quantity: number): CallPart => ({ strategy: "others", cover: null, quantity });
  const nonEmpty = (parts: CallPart[]) => parts.filter((part) => part.quantity > 0);
  if (aw <= 0 && lw <= 0) return [naked(n)];
  if (n >= aw + lw) return nonEmpty([wheel(aw), leaps(lw), naked(n - aw - lw)]);
  if (n === aw) return [wheel(n)];
  if (n === lw) return [leaps(n)];
  const wheelFirst = averageSharePrice !== null && strike !== null && strike >= averageSharePrice;
  if (wheelFirst) {
    const first = Math.min(n, aw);
    return nonEmpty([wheel(first), leaps(n - first)]);
  }
  const first = Math.min(n, lw);
  return nonEmpty([leaps(first), wheel(n - first)]);
}

function openSingle(ctx: ReplayContext, opening: Opening, state: StrategyState): void {
  const { tx } = opening;
  const contract = contractOf(tx);
  if (opening.orphan) {
    openLot(ctx, opening, "others", null);
    return;
  }
  if (tx.right === "P") {
    openLot(ctx, opening, opening.quantity < 0 ? "wheel" : "others", null);
    return;
  }
  if (opening.quantity > 0) {
    const leaps = contract.expiry !== null && isAtLeastMonthsAway(dayOf(tx.when), contract.expiry, LEAPS_MIN_MONTHS);
    openLot(ctx, opening, leaps ? "leaps" : "others", null);
    return;
  }
  const covered = state.coveredCalls(contract);
  const parts = splitShortCall(
    Math.abs(opening.quantity),
    state.wheelCapacity(contract),
    state.leapsCapacity(contract),
    contract.strike,
    state.averageSharePrice(contract),
  );
  let backed = covered;
  for (const part of parts) {
    // Before the call's own lot is opened, so `backed` counts only the calls
    // that were already there — and after it for the next opening of the group,
    // which reads the book again.
    if (part.strategy === "wheel" && part.cover === "shares") {
      takeOverShares(ctx, {
        shares: sharesContract(contract.ticker, contract.currency),
        call: contract,
        when: tx.when,
        callIds: idsOf(ctx, tx),
        contracts: part.quantity,
        alreadyCovered: backed,
      });
      backed += part.quantity;
    }
    openLot(ctx, opening, part.strategy, part.cover, -part.quantity);
  }
}

/**
 * A group that only buys calls creates LEAPS capacity and consumes none. A
 * LEAPS bought and a short call sold at the very same second is a routine
 * roll, and the transaction order inside an instant is the broker's
 * `externalId`, not ours: without this, the same pair lands in LEAPS or in
 * Others depending on which id happened to be lower.
 */
function opensCoverOnly(group: Opening[]): boolean {
  const isLongCall = (opening: Opening) => !opening.orphan && opening.tx.right === "C" && opening.quantity > 0;
  return group.some(isLongCall) && group.every(isLongCall);
}

/**
 * Classifies the option openings of one instant (spec §3.4). Legs of one
 * underlying and one expiry opened together are a combination — a condor, or
 * Others — unless they are fills of one and the same contract.
 */
export function classifyOpenings(openings: Opening[], ctx: ReplayContext): void {
  const groups = new Map<string, Opening[]>();
  for (const opening of openings) {
    const contract = contractOf(opening.tx);
    const key = `${contract.ticker}|${contract.currency}|${contract.expiry ?? ""}`;
    const group = groups.get(key);
    if (group) group.push(opening);
    else groups.set(key, [opening]);
  }
  const state = new StrategyState(ctx.book);
  const all = [...groups.values()];
  for (const group of [...all.filter(opensCoverOnly), ...all.filter((group) => !opensCoverOnly(group))]) {
    const contracts = new Set(group.map((opening) => contractId(contractOf(opening.tx))));
    if (contracts.size >= 2) {
      const condor = detectCondor(group);
      if (condor) openCondor(ctx, condor);
      else for (const opening of group) openLot(ctx, opening, "others", null);
      continue;
    }
    for (const opening of group) openSingle(ctx, opening, state);
  }
}
