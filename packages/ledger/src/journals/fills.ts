import type { Transaction } from "../types.ts";
import { contractId, contractOf } from "./contract.ts";
import { FILL_MERGE_WINDOW_MS } from "./types.ts";

export interface MergedFills {
  /** The ledger with each burst of fills folded into one line, still in `when` order. */
  transactions: Transaction[];
  /** Original `externalId`s of a folded line, oldest first; a line left alone is absent. */
  ids: Map<Transaction, string[]>;
}

/**
 * A row IB charged nothing for is a settlement leg (expiry, assignment) or the
 * share delivery of one: `resolveDeliveries` pairs those by strike and instant,
 * so folding them would take the pairing apart. Only market fills merge.
 */
function isFill(tx: Transaction): boolean {
  return !!tx.commission && tx.quantity !== null && tx.quantity !== 0;
}

/** One order: one contract, one direction, one source — sources own disjoint ranges, so twins across them are two real trades. */
function fillKey(tx: Transaction): string {
  return `${contractId(contractOf(tx))}|${Math.sign(tx.quantity ?? 0)}|${tx.source}`;
}

function sum(values: (number | null)[]): number | null {
  let total = 0;
  for (const value of values) {
    if (value === null) return null;
    total += value;
  }
  return total;
}

/** The oldest instant and id, the summed money, the price averaged over the quantities. */
function fold(group: Transaction[]): Transaction {
  const weight = group.reduce((n, tx) => n + Math.abs(tx.quantity ?? 0), 0);
  const weighted = sum(group.map((tx) => (tx.price === null ? null : tx.price * Math.abs(tx.quantity ?? 0))));
  return {
    ...group[0],
    quantity: group.reduce((n, tx) => n + (tx.quantity ?? 0), 0),
    price: weighted === null ? null : weighted / weight,
    amount: sum(group.map((tx) => tx.amount)),
    commission: sum(group.map((tx) => tx.commission)),
  };
}

/**
 * Folds the slices of one order into one line. A market order rarely fills in
 * one go: the broker reports each slice, and the journals would show three
 * lines where the user made one trade. Fills chain on the gap to their
 * neighbour, not to the first of the burst, so an order sliced over five
 * seconds still folds whole.
 *
 * `sorted` must be in `sortTransactions` order; the result keeps it, each
 * folded line taking the place of its oldest slice.
 */
export function mergeFills(sorted: readonly Transaction[]): MergedFills {
  const groups: Transaction[][] = [];
  const open = new Map<string, Transaction[]>();
  for (const tx of sorted) {
    if (!isFill(tx)) {
      groups.push([tx]);
      continue;
    }
    const key = fillKey(tx);
    const chain = open.get(key);
    if (chain && Date.parse(tx.when) - Date.parse(chain[chain.length - 1].when) <= FILL_MERGE_WINDOW_MS) {
      chain.push(tx);
      continue;
    }
    const started = [tx];
    open.set(key, started);
    groups.push(started);
  }
  const ids = new Map<Transaction, string[]>();
  const transactions = groups.map((group) => {
    if (group.length === 1) return group[0];
    const merged = fold(group);
    ids.set(
      merged,
      group.map((tx) => tx.externalId),
    );
    return merged;
  });
  return { transactions, ids };
}
