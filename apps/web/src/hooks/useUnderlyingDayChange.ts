import { useCallback, useMemo } from "react";
import { useUnderlyingQuotesMap } from "@/agent/quotes";
import { useAccountRiskReport } from "@/db/AccountDataProvider";
import { buildHeldDayChange, resolveUnderlyingDayChange, type UnderlyingDayChangeResolution } from "@/lib/underlyingDayChange";

/**
 * "Var. jour action" for the account on screen (task addendum to sub-project 35): the account's
 * own live `dayChange` for a held stock, the delayed `/quotes` value otherwise. Built from
 * `AccountDataProvider`'s snapshot and the quotes store, so the cell and every column spec that
 * feeds it resolve the same value.
 */
export function useUnderlyingDayChange(): (ticker: string) => UnderlyingDayChangeResolution {
  const { snapshot } = useAccountRiskReport();
  const quotes = useUnderlyingQuotesMap();
  const held = useMemo(() => buildHeldDayChange(snapshot?.positions ?? []), [snapshot]);
  return useCallback((ticker: string) => resolveUnderlyingDayChange(ticker, held, quotes), [held, quotes]);
}
