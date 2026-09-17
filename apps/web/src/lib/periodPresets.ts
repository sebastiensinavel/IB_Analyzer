/**
 * The period presets of the history page: a click fills both date fields. Days are UTC days,
 * like `dayOf`; `today` comes from the caller, so the module never reads the clock.
 */

export type PeriodPresetId = "all" | "last30Days" | "last12Months" | `year:${number}`;

export interface PeriodPreset {
  id: PeriodPresetId;
  /** "YYYY-MM-DD", or "" for no bound. */
  from: string;
  to: string;
}

/** The years of these instants, newest first. */
export function yearsOf(whens: readonly string[]): number[] {
  return [...new Set(whens.map((when) => Number(when.slice(0, 4))))].sort((a, b) => b - a);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** All, the last 30 days, the last 12 months, then one preset per year. */
export function periodPresets(years: readonly number[], today: string): PeriodPreset[] {
  const [year, month, day] = today.split("-").map(Number);
  // Day 0 of the next month is the last day of this one: a year back from February 29 is the 28th.
  const lastDayAYearBack = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
  const aYearBack = isoDay(new Date(Date.UTC(year - 1, month - 1, Math.min(day, lastDayAYearBack))));
  const thirtyDaysBack = isoDay(new Date(Date.UTC(year, month - 1, day - 30)));
  return [
    { id: "all", from: "", to: "" },
    { id: "last30Days", from: thirtyDaysBack, to: today },
    { id: "last12Months", from: aYearBack, to: today },
    ...years.map((y): PeriodPreset => ({ id: `year:${y}`, from: `${y}-01-01`, to: `${y}-12-31` })),
  ];
}

/** The preset whose two dates are exactly those of the fields, if any. */
export function activePreset(presets: readonly PeriodPreset[], from: string, to: string): PeriodPresetId | null {
  return presets.find((preset) => preset.from === from && preset.to === to)?.id ?? null;
}
