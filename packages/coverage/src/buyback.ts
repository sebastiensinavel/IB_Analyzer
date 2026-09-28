import { contractId, type JournalRow } from "@ib/ledger";
import { BUYBACK_RATIO } from "./constants.ts";

/** What the Décision column says of a sold option, and why (spec of sub-project 38, §3). */
export interface BuybackAdvice {
  decision: "buy back" | "keep";
  /** Per-unit buyback price at or under which buying back pays: S × min(½, r/T), or S / 2 without the time. */
  threshold: number;
  /** Days left and total life, fractional; `null` when the time rule could not apply. */
  remainingDays: number | null;
  totalDays: number | null;
}

/** New York wall clock stamped UTC, like every IB time (IB_REPORT_TIME_ZONE). */
export interface BuybackTiming {
  /** The quantity-weighted average sale instant. */
  soldAt: string;
  /** YYYY-MM-DD; the option expires at 16:00 that day. */
  expiry: string;
  /** The instant the current price was read: the snapshot's asOf, an instant or a day (its 16:00 close). */
  asOf: string;
}

/** The snapshot's instant and the average sale instant of each contract, keyed by `contractId`. */
export interface SaleTiming {
  asOf: string;
  soldAt: ReadonlyMap<string, string>;
}

const DAY_MS = 86_400_000;
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** An expiry, or a day-only asOf, counts at the 16:00 New York close. */
const CLOSE = "T16:00:00.000Z";

const instantOf = (value: string): number => Date.parse(DAY_ONLY.test(value) ? `${value}${CLOSE}` : value);

function lifeOf({ soldAt, expiry, asOf }: BuybackTiming): { remaining: number; total: number } | null {
  const sold = instantOf(soldAt);
  const end = instantOf(expiry);
  const now = instantOf(asOf);
  if (Number.isNaN(sold) || Number.isNaN(end) || Number.isNaN(now)) return null;
  // A sale at or after expiry, or a price read before the sale: incoherent, the time says nothing.
  if (end <= sold || now < sold) return null;
  return { remaining: Math.max(0, (end - now) / DAY_MS), total: (end - sold) / DAY_MS };
}

/**
 * "buy back" when C <= S × min(½, r/T) (spec of sub-project 38, §1): the premium captured runs
 * ahead of the time elapsed — equivalently, what is left earns less per day than the sale did.
 * Without the time, the 50% rule alone. An option expired at the price's instant is kept: there
 * is nothing left to buy back.
 */
export function evaluateBuyback(salePrice: number, currentPrice: number, timing: BuybackTiming | null): BuybackAdvice {
  const sale = Math.abs(salePrice);
  const current = Math.abs(currentPrice);
  if (sale <= 0) return { decision: "keep", threshold: 0, remainingDays: null, totalDays: null };
  const half = sale / BUYBACK_RATIO;
  const life = timing ? lifeOf(timing) : null;
  if (!life) return { decision: current <= half ? "buy back" : "keep", threshold: half, remainingDays: null, totalDays: null };
  if (life.remaining <= 0) return { decision: "keep", threshold: 0, remainingDays: 0, totalDays: life.total };
  const threshold = Math.min(half, (sale * life.remaining) / life.total);
  return { decision: current <= threshold ? "buy back" : "keep", threshold, remainingDays: life.remaining, totalDays: life.total };
}

/** Σ instant × |quantity| ÷ Σ |quantity|, ISO; `null` when nothing weighs. */
export function averageSaleInstant(parts: readonly { when: string; quantity: number }[]): string | null {
  let weight = 0;
  let total = 0;
  for (const part of parts) {
    const w = Math.abs(part.quantity);
    if (w === 0) continue;
    weight += w;
    total += Date.parse(part.when) * w;
  }
  return weight === 0 ? null : new Date(Math.round(total / weight)).toISOString();
}

const SOLD_OPTION_KINDS = new Set(["short_put", "short_call"]);

/**
 * The average sale instant of every contract still sold open in the journals, every strategy
 * together, Others included: what the Positions page dates its IB positions with. A condor is
 * read on its legs, never on its composite, which has neither right nor strike.
 */
export function saleInstants(rows: readonly JournalRow[]): Map<string, string> {
  const byContract = new Map<string, { when: string; quantity: number }[]>();
  for (const row of rows.flatMap((r) => r.legs ?? [r])) {
    if (row.endWhen !== null || row.quantity === null || row.quantity >= 0 || !SOLD_OPTION_KINDS.has(row.kind)) continue;
    const id = contractId(row.contract);
    byContract.set(id, [...(byContract.get(id) ?? []), { when: row.startWhen, quantity: row.quantity }]);
  }
  const instants = new Map<string, string>();
  for (const [id, parts] of byContract) {
    const at = averageSaleInstant(parts);
    if (at !== null) instants.set(id, at);
  }
  return instants;
}
