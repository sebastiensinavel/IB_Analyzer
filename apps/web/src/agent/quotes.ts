import { useSyncExternalStore } from "react";
import { NormalizationError, parseAgentQuotes, type AgentQuote } from "@ib/ib-parsers";
import { indexExchangeOf } from "@/lib/marketIndices";
import { fetchQuotes, QUOTES_MAX_SYMBOLS } from "./client";

/**
 * The underlyings' day moves, as the last /quotes pass left them (spec of sub-project 35, §4):
 * module state, shared by every account and every page of the tab, never written to IndexedDB nor
 * to localStorage — a reload empties it. This is only the fallback source of "Var. jour action"
 * (task addendum to sub-project 35, `apps/web/src/lib/underlyingDayChange.ts`): a ticker held as
 * stock, with a live `dayChange` on its snapshot, still shows that value after a reload with no
 * agent, or before the first `/quotes` pass — "—" is only for a ticker neither held nor quoted.
 */
export type QuoteMap = ReadonlyMap<string, AgentQuote>;

let quotes: QuoteMap = new Map();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getQuotesSnapshot(): QuoteMap {
  return quotes;
}

/** The ticker the agent is asked for: itself, upper-cased — XSP is quoted as an index (marketIndices.ts), no longer as SPY. */
export function quotedTicker(ticker: string): string {
  return ticker.toUpperCase();
}

export function underlyingDayChangeOf(table: QuoteMap, ticker: string): number | null {
  return table.get(quotedTicker(ticker))?.change ?? null;
}

/** The last price of `ticker` as the last /quotes pass left it, `null` when never quoted or unknown. */
export function lastPriceOf(table: QuoteMap, ticker: string): number | null {
  return table.get(quotedTicker(ticker))?.last ?? null;
}

export function useUnderlyingQuotesMap(): QuoteMap {
  return useSyncExternalStore(subscribe, getQuotesSnapshot);
}

export function mergeQuotes(entries: ReadonlyMap<string, AgentQuote>): void {
  if (entries.size === 0) return;
  quotes = new Map([...quotes, ...entries]);
  for (const listener of listeners) listener();
}

/** Test seam: forget every quote between tests. */
export function resetQuotes(): void {
  quotes = new Map();
  for (const listener of listeners) listener();
}

/**
 * Asks the agent for `tickers` — indices (`XSP:CBOE`) apart from stocks — in batches of
 * QUOTES_MAX_SYMBOLS over the total, one after the other. A batch that
 * fails or answers garbage writes nothing: what is already shown stays.
 */
export async function refreshQuotes(port: number, tickers: readonly string[]): Promise<void> {
  const wanted = [...new Set(tickers.map(quotedTicker))];
  for (let start = 0; start < wanted.length; start += QUOTES_MAX_SYMBOLS) {
    const batch = wanted.slice(start, start + QUOTES_MAX_SYMBOLS);
    const indices = batch.filter((t) => indexExchangeOf(t) !== null).map((t) => `${t}:${indexExchangeOf(t)}`);
    const symbols = batch.filter((t) => indexExchangeOf(t) === null);
    const result = await fetchQuotes(port, symbols, indices);
    if (!result.ok) continue;
    try {
      mergeQuotes(parseAgentQuotes(result.payload));
    } catch (error) {
      if (!(error instanceof NormalizationError)) throw error;
    }
  }
}
