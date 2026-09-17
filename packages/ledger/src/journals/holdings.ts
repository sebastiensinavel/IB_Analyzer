import { DEFAULT_MULTIPLIER } from "../constants.ts";
import type { JournalRow } from "./types.ts";

/** What the Wheel holds of one ticker now: its open shares and the calls sold on them (spec of sub-project 16, §2.2). */
export interface WheelHolding {
  ticker: string;
  currency: string;
  /** Shares of the open Wheel lots, never the whole IB position; a lot with an unknown quantity is skipped. */
  quantity: number;
  /** Σ openPrice × quantity ÷ quantity; `null` when a lot has no price. */
  averageAssignmentPrice: number | null;
  /** Σ openPrice × quantity: the Wheel's `assigned` capital for this ticker. */
  assignedTotal: number | null;
  /** Contracts of the Wheel calls still open on the ticker. */
  openCallContracts: number;
  /** Σ strike × contracts ÷ contracts; `null` without an open call. */
  averageCallStrike: number | null;
  /** min(quantity, openCallContracts × DEFAULT_MULTIPLIER). */
  coveredShares: number;
}

interface Group {
  ticker: string;
  currency: string;
  shares: JournalRow[];
  calls: JournalRow[];
}

/**
 * The open Wheel lines per ticker and currency, read off `endWhen`, never `ongoing`: an assigned put
 * stays ongoing until its shares are sold. A share line's `openPrice` is the strike of the put that
 * delivered it or of the call that took it over; both average together. A row whose `quantity` is
 * `null` enters no table (spec §3.2): it is skipped entirely, shares and calls alike, rather than
 * counted as zero — which would understate `quantity`/`openCallContracts` while also nulling the
 * averages of the rows that do have a quantity.
 */
export function wheelHoldings(rows: readonly JournalRow[]): WheelHolding[] {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    if (row.strategy !== "wheel" || row.endWhen !== null || row.quantity === null) continue;
    if (row.kind !== "shares" && row.kind !== "short_call") continue;
    const key = `${row.ticker}|${row.currency}`;
    const group = groups.get(key) ?? { ticker: row.ticker, currency: row.currency, shares: [], calls: [] };
    (row.kind === "shares" ? group.shares : group.calls).push(row);
    groups.set(key, group);
  }

  const holdings: WheelHolding[] = [];
  for (const { ticker, currency, shares, calls } of groups.values()) {
    const quantity = shares.reduce((n, row) => n + (row.quantity as number), 0);
    if (quantity <= 0) continue;
    // Every row here has a quantity (rows without one were skipped above): only a missing price nulls the average.
    const unpriced = shares.some((row) => row.openPrice === null);
    const assignedTotal = unpriced ? null : shares.reduce((n, row) => n + (row.openPrice as number) * (row.quantity as number), 0);
    const openCallContracts = calls.reduce((n, row) => n + Math.abs(row.quantity as number), 0);
    const unstruck = calls.some((row) => row.strike === null);
    const averageCallStrike =
      openCallContracts === 0 || unstruck
        ? null
        : calls.reduce((n, row) => n + (row.strike as number) * Math.abs(row.quantity as number), 0) / openCallContracts;
    holdings.push({
      ticker,
      currency,
      quantity,
      averageAssignmentPrice: assignedTotal === null ? null : assignedTotal / quantity,
      assignedTotal,
      openCallContracts,
      averageCallStrike,
      coveredShares: Math.min(quantity, openCallContracts * DEFAULT_MULTIPLIER),
    });
  }
  return holdings.sort((a, b) => (a.ticker === b.ticker ? compare(a.currency, b.currency) : compare(a.ticker, b.ticker)));
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
