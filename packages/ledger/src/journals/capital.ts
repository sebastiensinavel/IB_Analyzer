import { DEFAULT_MULTIPLIER } from "../constants.ts";
import type { CapitalMeasure, CapitalMonth, Exposure, JournalRow, StatsStrategy, Strategy, StrategyCapital, StrategyStats } from "./types.ts";

/** "2026-08" -> "2026-09-01": a line still open at this instant was open when August ended. */
export function nextMonthStart(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, "0")}-01`;
}

const MEASURES = ["assigned", "putCash", "leaps", "condors"] as const satisfies readonly CapitalMeasure[];

function noMoney(): Record<CapitalMeasure, number> {
  return { assigned: 0, putCash: 0, leaps: 0, condors: 0 };
}

interface TiedUp {
  row: JournalRow;
  measure: CapitalMeasure;
  /** `null` when a strike, a price, a quantity or a leg is missing. */
  amount: number | null;
}

function scaled(perUnit: number | null, multiplier: number, quantity: number | null): number | null {
  return perUnit === null || quantity === null ? null : perUnit * multiplier * Math.abs(quantity);
}

/**
 * The worst wing of a condor, gross: the rule of `structureAssignmentCash` in
 * `packages/coverage/src/report.ts`, which applies it to structures paired from positions where
 * this reads the journal's own legs — put bought, put sold, call sold, call bought. The credit is
 * already in the account's cash, so it is never deducted.
 */
function worstWing(row: JournalRow): number | null {
  const strikes = row.legs?.map((leg) => leg.strike) ?? [];
  if (strikes.length !== 4) return null;
  const [longPut, shortPut, shortCall, longCall] = strikes;
  if (longPut === null || shortPut === null || shortCall === null || longCall === null) return null;
  return Math.max(shortPut - longPut, longCall - shortCall);
}

/**
 * What one line ties up, at the price it entered its strategy at, never its market value: a Wheel
 * put the cash its strike calls for, Wheel shares the strike that delivered or took them over, a
 * LEAPS its purchase price and the shares it delivered their strike, a condor its worst wing. A
 * call sold ties nothing up: shares or a LEAPS cover it.
 */
function tiedUp(row: JournalRow): TiedUp | null {
  if (row.strategy === "wheel" && row.kind === "short_put") return { row, measure: "putCash", amount: scaled(row.strike, DEFAULT_MULTIPLIER, row.quantity) };
  if (row.strategy === "wheel" && row.kind === "shares") return { row, measure: "assigned", amount: scaled(row.openPrice, 1, row.quantity) };
  if (row.strategy === "leaps" && row.kind === "long_call") return { row, measure: "leaps", amount: scaled(row.openPrice, DEFAULT_MULTIPLIER, row.quantity) };
  if (row.strategy === "leaps" && row.kind === "shares") return { row, measure: "leaps", amount: scaled(row.openPrice, 1, row.quantity) };
  if (row.strategy === "condors" && row.kind === "condor") return { row, measure: "condors", amount: scaled(worstWing(row), DEFAULT_MULTIPLIER, row.quantity) };
  return null;
}

/**
 * Read off `endWhen`, never `ongoing`: an assigned put stays ongoing until its shares are sold,
 * and reading it open would count the same money twice, as the put and as the shares.
 */
function openAt(row: JournalRow, instant: string): boolean {
  return row.startWhen < instant && (row.endWhen === null || row.endWhen >= instant);
}

/** Holding at `instant`: a line hands over to the next at the very instant it ends, so an assigned put and its shares never count together. */
function holdingAt(row: JournalRow, instant: string): boolean {
  return row.startWhen <= instant && (row.endWhen === null || row.endWhen > instant);
}

/**
 * The most money `lines` tied up at once during `month`, what its return is measured on: a line
 * closed before the month ends still took its money, and a month end with nothing open would
 * otherwise leave that month's P/L, a loss as well as a gain, without a return. The sum only
 * rises when a line opens, so the peak is at the month's first instant or at one of those.
 */
function peakDuring(lines: readonly (TiedUp & { amount: number })[], month: string): number {
  const first = `${month}-01`;
  const end = nextMonthStart(month);
  const during = lines.filter((line) => line.row.startWhen < end && (line.row.endWhen === null || line.row.endWhen > first));
  const instants = [first, ...during.map((line) => line.row.startWhen).filter((when) => when > first && when < end)];
  return Math.max(...instants.map((instant) => during.reduce((n, line) => (holdingAt(line.row, instant) ? n + line.amount : n), 0)));
}

/**
 * A scope's money month by month, on the months of its statistics, and what it ties up now per
 * ticker. `stats` is `computeStats` over the same `strategies`: its months and pnl drive the
 * series, so the monthly bars and these lines share one axis — and over the three strategies the
 * return is their summed P/L on their summed money, with no sum written anywhere.
 */
export function computeCapital(rows: readonly JournalRow[], strategies: readonly StatsStrategy[], stats: readonly StrategyStats[]): StrategyCapital[] {
  const scope = new Set<Strategy>(strategies);
  return stats.map(({ currency, months }) => {
    const lines = rows
      .filter((row) => row.currency === currency && scope.has(row.strategy))
      .map(tiedUp)
      .filter((line): line is TiedUp => line !== null);
    const counted = lines.filter((line): line is TiedUp & { amount: number } => line.amount !== null);

    let cumulativePnl = 0;
    const measured = months.map(({ month, pnl }): CapitalMonth => {
      const instant = nextMonthStart(month);
      const totals = noMoney();
      for (const line of counted) if (openAt(line.row, instant)) totals[line.measure] += line.amount;
      cumulativePnl += pnl;
      const allocated = MEASURES.reduce((n, measure) => n + totals[measure], 0);
      const peak = peakDuring(counted, month);
      return { month, cumulativePnl, ...totals, allocated, invested: allocated - cumulativePnl, returnRate: peak === 0 ? null : pnl / peak };
    });

    const byTicker = new Map<string, Exposure>();
    for (const line of counted) {
      if (line.row.endWhen !== null) continue;
      const exposure = byTicker.get(line.row.ticker) ?? { ticker: line.row.ticker, ...noMoney() };
      exposure[line.measure] += line.amount;
      byTicker.set(line.row.ticker, exposure);
    }
    const exposure = [...byTicker.values()]
      .filter((e) => MEASURES.reduce((n, measure) => n + e[measure], 0) !== 0)
      .sort((a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0));

    return { currency, months: measured, exposure, incomplete: lines.length - counted.length };
  });
}
