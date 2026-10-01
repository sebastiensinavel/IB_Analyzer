import type { PriceQuote } from "@ib/alerts";
import { lastPriceOf, type QuoteMap } from "@/agent/quotes";
import type { SnapshotRecord } from "@/db/schema";

/**
 * Le cours d'évaluation d'un ticker (spec §5) : l'action détenue dans le snapshot `agent` du
 * compte, temps réel ; sinon le `last` différé de `/quotes` ; sinon `null`. Un snapshot Flex ou
 * d'un relevé ne sert jamais : son prix est celui d'une clôture passée.
 */
export function alertPriceOf(snapshot: SnapshotRecord | null, quotes: QuoteMap): (ticker: string) => PriceQuote | null {
  const held = new Map<string, number>();
  if (snapshot?.source === "agent") {
    for (const position of snapshot.positions) {
      if (position.secType === "STK" && position.marketPrice !== null) held.set(position.symbol.toUpperCase(), position.marketPrice);
    }
  }
  return (ticker) => {
    const live = held.get(ticker.toUpperCase());
    if (live !== undefined) return { price: live, realtime: true };
    const last = lastPriceOf(quotes, ticker);
    return last === null ? null : { price: last, realtime: false };
  };
}
