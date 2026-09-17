import { tickerOf } from "@ib/ledger";
import { MAX_SUGGESTION_TICKER_SHARE, MAX_SUGGESTIONS, MIN_SUGGESTION_SCORE } from "./constants.ts";
import { riskValue } from "./report.ts";
import type { RiskReport } from "./types.ts";

/** One row of the sector table, nothing of Dexie. */
export interface SectorEntry {
  ticker: string;
  category: string;
  score: number | null;
  status: string;
}

export interface PositionSuggestion {
  /** 1 for the first row. */
  rank: number;
  ticker: string;
  sector: string;
  score: number;
  /** Risk value of the sector ÷ total risk value; 0 when the total is 0. */
  sectorShare: number;
  /** Risk value of the ticker ÷ total risk value; 0 when the total is 0. */
  tickerShare: number;
}

interface Candidate {
  ticker: string;
  sector: string;
  score: number;
  sectorExposure: number;
  tickerExposure: number;
}

function tickerKey(text: string): string {
  return text.trim().toUpperCase();
}

/**
 * Where to open a position without concentrating the account, as `select_put_sell_candidates` of the
 * former Python report ranked it (spec of sub-project 16, §4): the least exposed sectors first, the
 * best score next, the ticker least held last, every exposure in risk value — a sold put weighs its
 * assignment amount, not the premium its market value shows.
 */
export function positionSuggestions(entries: readonly SectorEntry[], report: RiskReport | null): PositionSuggestion[] {
  const sectorOf = new Map<string, string>();
  for (const entry of entries) {
    const sector = entry.category.trim();
    if (sector) sectorOf.set(tickerKey(entry.ticker), sector);
  }

  const byTicker = new Map<string, number>();
  const bySector = new Map<string, number>();
  let total = 0;
  for (const position of report?.positions ?? []) {
    // An unknown market value weighs nothing: the Python never had one.
    const value = riskValue(position) ?? 0;
    const ticker = tickerKey(tickerOf(position.symbol));
    byTicker.set(ticker, (byTicker.get(ticker) ?? 0) + value);
    // A position without a sector counts in the total only: no candidate can carry an unclassified sector.
    const sector = sectorOf.get(ticker);
    if (sector !== undefined) bySector.set(sector, (bySector.get(sector) ?? 0) + value);
    total += value;
  }
  const share = (value: number) => (total > 0 ? value / total : 0);

  const candidates: Candidate[] = [];
  for (const entry of entries) {
    const ticker = tickerKey(entry.ticker);
    const sector = entry.category.trim();
    const { score } = entry;
    if (entry.status.trim().toLowerCase() !== "on" || !sector || score === null || score < MIN_SUGGESTION_SCORE) continue;
    const tickerExposure = byTicker.get(ticker) ?? 0;
    if (share(tickerExposure) >= MAX_SUGGESTION_TICKER_SHARE) continue;
    candidates.push({ ticker, sector, score, sectorExposure: bySector.get(sector) ?? 0, tickerExposure });
  }

  candidates.sort(
    (a, b) =>
      a.sectorExposure - b.sectorExposure ||
      b.score - a.score ||
      a.tickerExposure - b.tickerExposure ||
      (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0),
  );
  return candidates.slice(0, MAX_SUGGESTIONS).map((c, i) => ({
    rank: i + 1,
    ticker: c.ticker,
    sector: c.sector,
    score: c.score,
    sectorShare: share(c.sectorExposure),
    tickerShare: share(c.tickerExposure),
  }));
}
