import { useCallback } from "react";
import { useUnderlyingQuotesMap } from "@/agent/quotes";
import { useAccountHeldDayChange } from "@/db/AccountDataProvider";
import { resolveUnderlyingDayChange, type UnderlyingDayChangeResolution } from "@/lib/underlyingDayChange";

/**
 * "Var. jour action" for the account on screen (task addendum to sub-project 35): the account's
 * own live `dayChange` for a held stock, the delayed `/quotes` value otherwise. The held map
 * comes from `AccountDataProvider`, built once per snapshot for every row on the page — not
 * rebuilt here per cell — and combined with the quotes store, so the cell and every column spec
 * that feeds it resolve the same value.
 */
export function useUnderlyingDayChange(): (ticker: string) => UnderlyingDayChangeResolution {
  const held = useAccountHeldDayChange();
  const quotes = useUnderlyingQuotesMap();
  return useCallback((ticker: string) => resolveUnderlyingDayChange(ticker, held, quotes), [held, quotes]);
}
