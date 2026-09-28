import type { Position } from "@ib/ledger";
import { chartProxyOf } from "@/lib/chartProxies";
import { underlyingDayChangeOf, type QuoteMap } from "@/agent/quotes";

/**
 * How "Var. jour action" resolved for one ticker (task addendum to sub-project 35): a live
 * `dayChange` from the account's own snapshot when it holds the underlying as stock, the
 * delayed `/quotes` value otherwise. `value` is what the cell and the sort both read; `delayed`
 * and `proxy` say what tooltip, if any, the cell shows.
 */
export interface UnderlyingDayChangeResolution {
  value: number | null;
  /** True only for a value read from the quotes store: it lags the market by up to 15 minutes. */
  delayed: boolean;
  /** Set only alongside `delayed`, when the ticker is quoted under a substitute (XSP -> SPY). */
  proxy: string | null;
}

/**
 * The account's own held stocks, ticker (upper-cased) -> live `dayChange`: only `STK`, `USD`,
 * a non-null `dayChange` — an option's `symbol` is its underlying, but only a stock position
 * counts here, and a snapshot without an agent (Flex, a statement) never has a `dayChange` to
 * offer. Pure, built once per snapshot.
 */
export function buildHeldDayChange(positions: readonly Position[]): ReadonlyMap<string, number> {
  const held = new Map<string, number>();
  for (const position of positions) {
    if (position.secType !== "STK" || position.currency !== "USD" || position.dayChange === null) continue;
    held.set(position.symbol.toUpperCase(), position.dayChange);
  }
  return held;
}

/**
 * The value "Var. jour action" shows for `ticker`, and why: the account's own live `dayChange`
 * first (no tooltip — it is TWS's real-time `reqPnLSingle`, not a lagged quote), the `/quotes`
 * store otherwise (delayed 15 minutes, said in a tooltip; XSP's tooltip also names SPY). Neither
 * source: `null`, no tooltip.
 */
export function resolveUnderlyingDayChange(
  ticker: string,
  held: ReadonlyMap<string, number>,
  quotes: QuoteMap,
): UnderlyingDayChangeResolution {
  const upper = ticker.toUpperCase();
  const heldValue = held.get(upper);
  if (heldValue !== undefined) return { value: heldValue, delayed: false, proxy: null };
  const value = underlyingDayChangeOf(quotes, upper);
  if (value === null) return { value: null, delayed: false, proxy: null };
  return { value, delayed: true, proxy: chartProxyOf(upper) };
}
