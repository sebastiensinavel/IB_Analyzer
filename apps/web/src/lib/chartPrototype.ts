/**
 * Prototype (branche `prototype-graphes`) : everything hard-coded here is what the real
 * feature will read from the journals - the underlying of the clicked line, its entry levels,
 * the dates of its events. Nothing outside this file knows these values.
 */
import type { PriceBar } from "@/agent/client";

export const PROTOTYPE_SYMBOL = "BTDR";
/** The green horizontal level asked for: a strike, later read from the journal row. */
export const PROTOTYPE_LEVEL = 17.5;
/** The vertical mark asked for: an event date, later the sale or the assignment. */
export const PROTOTYPE_EVENT_DATE = "2026-05-29";

/**
 * A stand-in series, drawn only when TWS is out of reach, and always shown as such: a chart
 * that looks real while carrying invented prices would be worse than an empty box.
 */
export function demoBars(days = 500, seed = 20260529): PriceBar[] {
  const bars: PriceBar[] = [];
  let value = 12;
  let state = seed;
  const day = new Date(Date.UTC(2024, 8, 2));
  while (bars.length < days) {
    day.setUTCDate(day.getUTCDate() + 1);
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    state = (state * 1103515245 + 12345) % 2147483648;
    const move = (state / 2147483648 - 0.48) * 0.9;
    const open = value;
    value = Math.max(2, value + move);
    const high = Math.max(open, value) + Math.abs(move) * 0.6;
    const low = Math.min(open, value) - Math.abs(move) * 0.6;
    bars.push({
      date: day.toISOString().slice(0, 10),
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(value),
      volume: 100_000 + (state % 900_000),
    });
  }
  return bars;
}

const round = (value: number) => Math.round(value * 100) / 100;
