/**
 * The history table's timeline: the months its rows fall in, where each starts, and every jump
 * the timeline bar makes through them. Pure: row indexes in, row indexes out. The bar and the
 * table share a single coordinate, a row index over the row count.
 */

export interface TimelineMonth {
  /** "YYYY-MM", cut from the instant as `dayOf` cuts a day: UTC, no conversion. */
  month: string;
  /** Index, among the rows on screen, of the month's first row. */
  start: number;
  count: number;
}

export type TimelineStep = "nextMonth" | "previousMonth" | "nextYear" | "previousYear" | "first" | "last";

export interface YearMark {
  year: string;
  start: number;
}

/**
 * The months of the rows, in the table's own order (newest first). A month is a run of adjacent
 * rows sharing a key: the timeline describes what the table shows, without assuming a sort.
 */
export function buildTimeline(whens: readonly string[]): TimelineMonth[] {
  const months: TimelineMonth[] = [];
  whens.forEach((when, index) => {
    const month = when.slice(0, 7);
    const last = months.at(-1);
    if (last?.month === month) last.count += 1;
    else months.push({ month, start: index, count: 1 });
  });
  return months;
}

/** Index in `timeline` of the month holding row `rowIndex`; -1 when there is no month at all. */
export function monthIndexAt(timeline: readonly TimelineMonth[], rowIndex: number): number {
  let low = 0;
  let high = timeline.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (timeline[middle].start <= rowIndex) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/** "2025-01" moved by -1 is "2024-12". */
export function shiftMonth(month: string, delta: number): string {
  const [year, index] = month.split("-").map(Number);
  const serial = year * 12 + (index - 1) + delta;
  return `${Math.floor(serial / 12)}-${String((serial % 12) + 1).padStart(2, "0")}`;
}

/**
 * The row a keyboard step lands on, from the first row in view. "next" goes down the table,
 * towards older rows. Keys compare as strings: "YYYY-MM" sorts as it reads.
 */
export function stepTarget(
  timeline: readonly TimelineMonth[],
  total: number,
  firstVisible: number,
  step: TimelineStep,
): number {
  const current = monthIndexAt(timeline, firstVisible);
  if (current < 0) return 0;
  const month = timeline[current];
  switch (step) {
    case "first":
      return 0;
    case "last":
      return Math.max(0, total - 1);
    case "nextMonth":
      return current + 1 < timeline.length ? timeline[current + 1].start : firstVisible;
    case "previousMonth":
      if (firstVisible > month.start) return month.start;
      return current > 0 ? timeline[current - 1].start : 0;
    case "nextYear": {
      const target = shiftMonth(month.month, -12);
      const older = timeline.slice(current + 1).find((candidate) => candidate.month <= target);
      return (older ?? timeline[timeline.length - 1]).start;
    }
    case "previousYear": {
      const target = shiftMonth(month.month, 12);
      const newer = timeline.slice(0, current).findLast((candidate) => candidate.month >= target);
      return newer?.start ?? 0;
    }
  }
}

/** The row at `fraction` of the table's height, kept within the rows. */
export function rowAtFraction(total: number, fraction: number): number {
  return Math.max(0, Math.min(total - 1, Math.floor(fraction * total)));
}

/**
 * The year labels of a `height` px track: each year at its first month, left out when it would
 * sit less than `minGap` px under the label above it.
 */
export function yearMarks(timeline: readonly TimelineMonth[], total: number, height: number, minGap: number): YearMark[] {
  const marks: YearMark[] = [];
  let previousYear: string | null = null;
  let lastTop = Number.NEGATIVE_INFINITY;
  for (const month of timeline) {
    const year = month.month.slice(0, 4);
    if (year === previousYear) continue;
    previousYear = year;
    const top = (month.start / Math.max(1, total)) * height;
    if (top - lastTop < minGap) continue;
    marks.push({ year, start: month.start });
    lastTop = top;
  }
  return marks;
}
