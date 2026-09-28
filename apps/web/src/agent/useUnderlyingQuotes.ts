import { useEffect, useMemo } from "react";
import { positionSuggestions, type RiskReport } from "@ib/coverage";
import { tickerOf } from "@ib/ledger";
import { useAccount, useSectors } from "@/db/hooks";
import type { SectorRecord } from "@/db/schema";
import { quotedTicker, refreshQuotes } from "./quotes";
import { useAgentPresence } from "./useAgentSync";

/** The underlyings of the account's positions and of its suggestions, as the agent is asked for them. */
export function quoteTickers(report: RiskReport | null, sectors: readonly SectorRecord[]): string[] {
  const tickers = new Set<string>();
  for (const position of report?.positions ?? []) tickers.add(quotedTicker(tickerOf(position.symbol)));
  for (const suggestion of positionSuggestions(sectors, report)) tickers.add(quotedTicker(suggestion.ticker));
  return [...tickers].sort();
}

/**
 * Mounted once, by AccountDataProvider (spec of sub-project 35, §4): quotes the account's
 * underlyings when the agent turns present, after every agent pass (`lastAgentSyncAt` only moves
 * on a success) and when the list of tickers changes. Nothing without an agent or a TWS port.
 */
export function useUnderlyingQuotes(accountId: string, report: RiskReport | null): void {
  const account = useAccount(accountId);
  const presence = useAgentPresence().status;
  const sectors = useSectors();
  const key = useMemo(() => quoteTickers(report, sectors ? [...sectors.values()] : []).join(","), [report, sectors]);
  const port = account?.twsPort;
  const syncedAt = account?.lastAgentSyncAt;

  useEffect(() => {
    if (presence !== "present" || port === undefined || key === "") return;
    void refreshQuotes(port, key.split(","));
    // `syncedAt` is a real dependency, not exhaustive-deps noise: a pass that moved
    // `lastAgentSyncAt` re-quotes, on purpose.
  }, [presence, port, syncedAt, key]);
}
