import type { Transaction } from "../types.ts";
import { contractOf } from "./contract.ts";
import { WHEEL_BUYBACK_WINDOW_MS } from "./types.ts";

const isSale = (tx: Transaction) => tx.secType === "STK" && (tx.quantity ?? 0) < 0 && !!tx.commission;
const isCallBuyback = (tx: Transaction) => tx.secType === "OPT" && tx.right === "C" && (tx.quantity ?? 0) > 0 && !!tx.commission;
const underlying = (tx: Transaction) => {
  const c = contractOf(tx);
  return `${c.ticker}|${c.currency}`;
};

/**
 * For each share sale, the call buybacks of its underlying within
 * `WHEEL_BUYBACK_WINDOW_MS`, before or after, nearest first (spec 33 §3, R2).
 * Whether a buyback closes a Wheel covered call is only known during the
 * replay: this pairs by shape alone.
 */
export function pairBuybacks(sorted: readonly Transaction[]): Map<Transaction, Transaction[]> {
  const buybacks = sorted.filter(isCallBuyback);
  const pairs = new Map<Transaction, Transaction[]>();
  for (const sale of sorted.filter(isSale)) {
    const at = Date.parse(sale.when);
    const key = underlying(sale);
    const near = buybacks
      .map((tx) => ({ tx, gap: Math.abs(Date.parse(tx.when) - at) }))
      .filter(({ tx, gap }) => gap <= WHEEL_BUYBACK_WINDOW_MS && underlying(tx) === key)
      .sort((a, b) => a.gap - b.gap || (a.tx.externalId < b.tx.externalId ? -1 : a.tx.externalId > b.tx.externalId ? 1 : 0))
      .map(({ tx }) => tx);
    if (near.length > 0) pairs.set(sale, near);
  }
  return pairs;
}
