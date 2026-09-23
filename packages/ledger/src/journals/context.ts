import type { Transaction } from "../types.ts";
import { LotBook, type Exit, type Lot } from "./book.ts";
import { buildRow } from "./rows.ts";
import type { ActivableStrategy, JournalRow, RowKind } from "./types.ts";
import { ACTIVABLE_STRATEGIES } from "./types.ts";

export interface ReplayContext {
  book: LotBook;
  rows: JournalRow[];
  /** Condor composites, whose rows are folded from their legs at the end. */
  composites: Lot[];
  /** Option rows closed by a delivery, with the share lots they opened: `ongoing` is settled at the end. */
  delivered: Map<JournalRow, Lot[]>;
  /** OptionCashSettlement rows waiting for their price-0 close, keyed `contractId@day`. */
  settlements: Map<string, Transaction[]>;
  /** Original ids of the lines `mergeFills` folded, by folded transaction. */
  fills: Map<Transaction, string[]>;
  ids: Map<string, number>;
  /** The strategies an opening may be offered to (spec of sub-project 30, §3). */
  active: ReadonlySet<ActivableStrategy>;
}

export function newContext(fills: Map<Transaction, string[]> = new Map(), active: readonly ActivableStrategy[] = ACTIVABLE_STRATEGIES): ReplayContext {
  return { book: new LotBook(), rows: [], composites: [], delivered: new Map(), settlements: new Map(), fills, ids: new Map(), active: new Set(active) };
}

/** Every id behind a transaction: the slices it folds, or its own. */
export function idsOf(ctx: ReplayContext, tx: Transaction): string[] {
  return [...(ctx.fills.get(tx) ?? [tx.externalId])];
}

/**
 * `base`, then `base.2`, `base.3`… when one transaction opens several lots.
 * Self-registering: the id it hands out — `base` itself on the first call —
 * is marked served, so a later call on that very id (a lot cut out of a lot
 * that was itself already split, whose id is already `base.n`) finds it
 * taken and extends it, rather than handing back the id it derives from.
 */
export function uniqueId(ctx: ReplayContext, base: string): string {
  const n = (ctx.ids.get(base) ?? 0) + 1;
  ctx.ids.set(base, n);
  const id = n === 1 ? base : `${base}.${n}`;
  if (id !== base && !ctx.ids.has(id)) ctx.ids.set(id, 1);
  return id;
}

export function kindOf(secType: string, right: string, quantity: number): RowKind {
  if (secType === "STK") return quantity > 0 ? "shares" : "short_shares";
  if (right === "P") return quantity > 0 ? "long_put" : "short_put";
  return quantity > 0 ? "long_call" : "short_call";
}

/** Emits the row of a close — or logs it on a condor leg, whose rows are folded at the end. */
export function closeLot(ctx: ReplayContext, lot: Lot, quantity: number, exit: Exit): JournalRow | null {
  if (lot.parent) {
    lot.exitLog.push({ quantity, exit });
    return null;
  }
  const row = buildRow(lot, quantity, exit);
  ctx.rows.push(row);
  return row;
}
