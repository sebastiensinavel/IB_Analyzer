import { contractId, type ContractKey } from "./contract.ts";
import type { CloseEvent, RowKind, RowNote, Strategy } from "./types.ts";
import { DEFAULT_MULTIPLIER } from "../constants.ts";

/** One exit of a lot, already pro rata for the portion it closes. */
export interface Exit {
  when: string;
  price: number | null;
  amount: number | null;
  commission: number | null;
  event: CloseEvent;
  closeIds: string[];
  /** Set when the exit itself is what needs explaining, like a Wheel takeover. */
  note?: RowNote;
}

export interface LegExit {
  quantity: number;
  exit: Exit;
}

/**
 * One opening transaction, or one part of it when a call sale is split
 * between strategies. Closed FIFO; a partial close leaves the remainder here.
 */
export interface Lot {
  id: string;
  contract: ContractKey;
  strategy: Strategy;
  kind: RowKind;
  openWhen: string;
  /**
   * Where the lot stands in purchase order. Its own opening for an ordinary lot;
   * for the two lots a Wheel takeover cuts out of a lot, the rank of that lot —
   * the taken part opens the day of the call, and ranking it there would send
   * it behind its own remainder at the next corporate action (spec 17, §5).
   */
  rankWhen: string;
  openPrice: number | null;
  /** Cash effect and commission of the whole lot; rows take their share pro rata. */
  openAmount: number | null;
  openCommission: number | null;
  /** Signed quantity opened. */
  quantity: number;
  /** Signed quantity still open. */
  remaining: number;
  openIds: string[];
  /** Shares delivered by an option rather than bought on the market. */
  assigned: boolean;
  /** Opened by a price-0 close or a delivery that found no lot: the history is truncated. */
  orphan: boolean;
  /** Delivered shares: shares per contract, as observed on the delivery. */
  ratio: number | null;
  /** Short call: what covers it, for the Wheel and LEAPS capacities. */
  cover: "shares" | "leaps" | null;
  /** Delivered shares: the option lot that delivered them, kept "ongoing" until they are sold. */
  deliveredBy: Lot | null;
  /** Condor composite: its four legs; a leg points back with `parent`. */
  legs: Lot[] | null;
  parent: Lot | null;
  /** Overrides the contract label (condor). */
  label: string | null;
  /** Why the lot is in its strategy; `null` when nothing needs saying. */
  note: RowNote | null;
  /** Rows emitted from this lot so far, to number the next one. */
  exits: number;
  /** Condor legs only: their closes, folded into the composite's rows at the end. */
  exitLog: LegExit[];
}

export type LotInit = Pick<Lot, "id" | "contract" | "strategy" | "kind" | "openWhen" | "openPrice" | "openAmount" | "openCommission" | "quantity" | "openIds"> &
  Partial<Pick<Lot, "rankWhen" | "assigned" | "orphan" | "ratio" | "cover" | "deliveredBy" | "legs" | "parent" | "label" | "note">>;

export function newLot(init: LotInit): Lot {
  return {
    rankWhen: init.openWhen,
    assigned: false,
    orphan: false,
    ratio: null,
    cover: null,
    deliveredBy: null,
    legs: null,
    parent: null,
    label: null,
    note: null,
    ...init,
    remaining: init.quantity,
    exits: 0,
    exitLog: [],
  };
}

/** Shares per contract for a lot: what its delivery showed, or the standard contract. */
export function sharesPerContract(lot: Lot): number {
  return lot.ratio !== null && lot.ratio > 0 ? lot.ratio : DEFAULT_MULTIPLIER;
}

export interface ClosedPortion {
  lot: Lot;
  /** Unsigned. */
  quantity: number;
}

export interface OpenPosition {
  contract: ContractKey;
  quantity: number;
}

/** What `LotBook.closePreferring` closed, and how many contracts its first pass used. */
export interface PreferredClose {
  closed: ClosedPortion[];
  preferredContracts: number;
}

/** Long shares held by the Wheel: what a Wheel covered call makes leave first (spec 17, §4). */
export function isWheelShares(lot: Lot): boolean {
  return lot.strategy === "wheel" && lot.kind === "shares";
}

/** A short call of the Wheel covered by shares: the call whose buyback or assignment makes Wheel shares leave first (spec 17, §4). */
export function isWheelCoveredCall(lot: Lot): boolean {
  return lot.kind === "short_call" && lot.strategy === "wheel" && lot.cover === "shares";
}

export class LotBook {
  private readonly lots = new Map<string, Lot[]>();

  open(lot: Lot): void {
    const id = contractId(lot.contract);
    const list = this.lots.get(id);
    if (list) list.push(lot);
    else this.lots.set(id, [lot]);
  }

  /** Lots still open on the contract, oldest first. */
  openLots(contract: ContractKey): Lot[] {
    return (this.lots.get(contractId(contract)) ?? []).filter((lot) => lot.remaining !== 0);
  }

  /** Signed quantity open on the contract. */
  position(contract: ContractKey): number {
    return this.openLots(contract).reduce((sum, lot) => sum + lot.remaining, 0);
  }

  /**
   * Closes up to |quantity| on the opposite side, FIFO. The portions add up to
   * less than |quantity| when the book runs out: the caller opens the rest.
   */
  close(contract: ContractKey, quantity: number): ClosedPortion[] {
    const closed: ClosedPortion[] = [];
    let left = Math.abs(quantity);
    for (const lot of this.openLots(contract)) {
      if (left === 0) break;
      if (Math.sign(lot.remaining) === Math.sign(quantity)) continue;
      const take = Math.min(Math.abs(lot.remaining), left);
      lot.remaining -= Math.sign(lot.remaining) * take;
      left -= take;
      closed.push({ lot, quantity: take });
    }
    return closed;
  }

  /**
   * Like `close`, but first serves, in book order, the lots `preferred` accepts,
   * up to `contracts` contracts of them — each lot counted with
   * `sharesPerContract` —, then closes what is left FIFO. A lot reached by both
   * passes comes back as one portion, so it makes one row. `preferredContracts`
   * is what the first pass used, for a caller whose limit spans several closes.
   */
  closePreferring(contract: ContractKey, quantity: number, preferred: (lot: Lot) => boolean, contracts: number): PreferredClose {
    const portions = new Map<Lot, number>();
    let left = Math.abs(quantity);
    let budget = contracts;
    for (const lot of this.openLots(contract)) {
      if (left === 0 || budget <= 0) break;
      if (Math.sign(lot.remaining) === Math.sign(quantity) || !preferred(lot)) continue;
      const per = sharesPerContract(lot);
      const take = Math.min(Math.abs(lot.remaining), left, budget * per);
      if (take <= 0) continue;
      lot.remaining -= Math.sign(lot.remaining) * take;
      left -= take;
      budget -= take / per;
      portions.set(lot, take);
    }
    const rest = left === 0 ? [] : this.close(contract, Math.sign(quantity) * left);
    for (const portion of rest) portions.set(portion.lot, (portions.get(portion.lot) ?? 0) + portion.quantity);
    return {
      closed: [...portions].map(([lot, closed]) => ({ lot, quantity: closed })),
      preferredContracts: contracts - budget,
    };
  }

  /**
   * Slots a lot among the destination's open lots by `rankWhen` instead of
   * appending it. Insertion order is FIFO order everywhere else in the engine
   * because lots arrive in time order; a conversion breaks that, since the
   * lot it moves may be older than lots the destination already held. The
   * rank, not `openWhen`: a Wheel takeover's taken part opens the day of the
   * call but ranks where the lot it was cut from ranked. Ties go after their
   * equals, so two lots of the same rank keep the order they arrived in — the
   * taken part ahead of its remainder. Closed lots are never stepped over:
   * they keep their place in the history of the contract.
   */
  private insertByRank(lot: Lot): void {
    const id = contractId(lot.contract);
    const list = this.lots.get(id);
    if (!list) {
      this.lots.set(id, [lot]);
      return;
    }
    const at = list.findIndex((other) => other.remaining !== 0 && other.rankWhen > lot.rankWhen);
    if (at < 0) list.push(lot);
    else list.splice(at, 0, lot);
  }

  /**
   * Puts `lots` immediately after `lot` in its contract's list. That list *is*
   * FIFO order — `close` walks it from the front — so a lot cut out of another
   * must take that other's rank rather than the end of the queue: the shares a
   * covered call took over have to be reached before the untouched remainder
   * they were cut from, or an assignment would deliver the wrong ones and the
   * Wheel cycle would never close.
   *
   * Unlike `insertByRank`, which sorts on `rankWhen`, this one places by
   * rank: the lots it inserts carry the instant of the takeover, which is
   * *later* than the lot they follow, and sorting would send them to the back.
   */
  insertAfter(lot: Lot, lots: readonly Lot[]): void {
    const list = this.lots.get(contractId(lot.contract));
    const at = list ? list.indexOf(lot) : -1;
    if (!list || at < 0) throw new Error(`insertAfter: lot ${lot.id} is not in the book`);
    list.splice(at + 1, 0, ...lots);
  }

  /**
   * Moves every lot still open on `from` onto `to`, applying `mutate` on the
   * way. Closed lots stay where they are: they are the history of a contract
   * that really existed, and rewriting them would rewrite journal rows
   * already emitted. Moved lots join whatever `to` already held, each at its
   * own `rankWhen` rank (spec §5.3): the converted lot is often the older of
   * the two, and appending it would sell the wrong shares next.
   */
  move(from: ContractKey, to: ContractKey, mutate: (lot: Lot) => void): Lot[] {
    const fromId = contractId(from);
    const all = this.lots.get(fromId) ?? [];
    const moved = all.filter((lot) => lot.remaining !== 0);
    if (moved.length === 0) return [];
    const stayed = all.filter((lot) => lot.remaining === 0);
    if (stayed.length === 0) this.lots.delete(fromId);
    else this.lots.set(fromId, stayed);
    for (const lot of moved) {
      lot.contract = to;
      mutate(lot);
      this.insertByRank(lot);
    }
    return moved;
  }

  allOpen(): Lot[] {
    return [...this.lots.values()].flat().filter((lot) => lot.remaining !== 0);
  }

  /** Open quantity per contract, keyed by contractId. */
  positions(): Map<string, OpenPosition> {
    const out = new Map<string, OpenPosition>();
    for (const lot of this.allOpen()) {
      const id = contractId(lot.contract);
      const current = out.get(id);
      if (current) current.quantity += lot.remaining;
      else out.set(id, { contract: lot.contract, quantity: lot.remaining });
    }
    return out;
  }
}
