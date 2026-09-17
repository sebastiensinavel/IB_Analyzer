import { describe, expect, it } from "vitest";
import { buildTimeline, monthIndexAt, rowAtFraction, shiftMonth, stepTarget, yearMarks } from "@/lib/historyTimeline";

// Newest first, as the history table shows its rows.
const WHENS = [
  "2026-03-31T23:30:00.000Z", // 0 — late on the 31st in UTC: still March, as dayOf cuts it
  "2026-03-02T10:00:00.000Z", // 1
  "2026-02-15T10:00:00.000Z", // 2
  "2025-11-20T10:00:00.000Z", // 3
  "2025-11-03T10:00:00.000Z", // 4
  "2025-02-10T10:00:00.000Z", // 5
  "2024-12-01T10:00:00.000Z", // 6
];
const TIMELINE = buildTimeline(WHENS);
const TOTAL = WHENS.length;

describe("buildTimeline", () => {
  it("cuts the rows into months, newest first, with each month's first row and size", () => {
    expect(TIMELINE).toEqual([
      { month: "2026-03", start: 0, count: 2 },
      { month: "2026-02", start: 2, count: 1 },
      { month: "2025-11", start: 3, count: 2 },
      { month: "2025-02", start: 5, count: 1 },
      { month: "2024-12", start: 6, count: 1 },
    ]);
  });

  it("counts every row exactly once", () => {
    expect(TIMELINE.reduce((sum, month) => sum + month.count, 0)).toBe(TOTAL);
  });

  it("describes the rows as they come, without sorting them", () => {
    expect(buildTimeline(["2026-03-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z", "2026-03-05T00:00:00.000Z"])).toEqual([
      { month: "2026-03", start: 0, count: 1 },
      { month: "2026-02", start: 1, count: 1 },
      { month: "2026-03", start: 2, count: 1 },
    ]);
  });

  it("has no month without rows", () => {
    expect(buildTimeline([])).toEqual([]);
  });
});

describe("monthIndexAt", () => {
  it("finds the month holding a row, at both ends of a month", () => {
    expect(monthIndexAt(TIMELINE, 0)).toBe(0);
    expect(monthIndexAt(TIMELINE, 1)).toBe(0);
    expect(monthIndexAt(TIMELINE, 2)).toBe(1);
    expect(monthIndexAt(TIMELINE, 3)).toBe(2);
    expect(monthIndexAt(TIMELINE, 4)).toBe(2);
    expect(monthIndexAt(TIMELINE, 6)).toBe(4);
  });

  it("answers -1 on an empty timeline", () => {
    expect(monthIndexAt([], 0)).toBe(-1);
  });
});

describe("shiftMonth", () => {
  it("moves a month key across years, both ways", () => {
    expect(shiftMonth("2026-03", -12)).toBe("2025-03");
    expect(shiftMonth("2025-11", 12)).toBe("2026-11");
    expect(shiftMonth("2025-01", -1)).toBe("2024-12");
    expect(shiftMonth("2024-12", 1)).toBe("2025-01");
  });
});

describe("stepTarget", () => {
  it("goes down one month to the start of the next, older month", () => {
    expect(stepTarget(TIMELINE, TOTAL, 1, "nextMonth")).toBe(2);
    expect(stepTarget(TIMELINE, TOTAL, 3, "nextMonth")).toBe(5);
  });

  it("stays put going down from the oldest month", () => {
    expect(stepTarget(TIMELINE, TOTAL, 6, "nextMonth")).toBe(6);
  });

  it("goes up to the start of the current month first, then to the month before", () => {
    expect(stepTarget(TIMELINE, TOTAL, 4, "previousMonth")).toBe(3);
    expect(stepTarget(TIMELINE, TOTAL, 3, "previousMonth")).toBe(2);
    expect(stepTarget(TIMELINE, TOTAL, 0, "previousMonth")).toBe(0);
  });

  it("goes down a year to the most recent month at least twelve months older", () => {
    // From 2026-03: 2025-11 is only four months older; 2025-02 is the first at or before 2025-03.
    expect(stepTarget(TIMELINE, TOTAL, 0, "nextYear")).toBe(5);
  });

  it("goes down a year to the oldest month when none is twelve months older", () => {
    // From 2025-11: neither 2025-02 nor 2024-12 is at or before 2024-11.
    expect(stepTarget(TIMELINE, TOTAL, 3, "nextYear")).toBe(6);
  });

  it("goes up a year to the oldest month at least twelve months more recent", () => {
    // From 2025-02: 2025-11 is too close; 2026-02 is the first at or after 2026-02.
    expect(stepTarget(TIMELINE, TOTAL, 5, "previousYear")).toBe(2);
  });

  it("goes up a year to the first row when no month is twelve months more recent", () => {
    expect(stepTarget(TIMELINE, TOTAL, 3, "previousYear")).toBe(0);
  });

  it("jumps to the first and the last row", () => {
    expect(stepTarget(TIMELINE, TOTAL, 3, "first")).toBe(0);
    expect(stepTarget(TIMELINE, TOTAL, 3, "last")).toBe(6);
  });
});

describe("rowAtFraction", () => {
  it("maps a height on the track to the row at that share of the table", () => {
    expect(rowAtFraction(7, 0)).toBe(0);
    expect(rowAtFraction(7, 0.75)).toBe(5);
  });

  it("stays within the rows", () => {
    expect(rowAtFraction(7, 1)).toBe(6);
    expect(rowAtFraction(7, 1.4)).toBe(6);
    expect(rowAtFraction(7, -0.2)).toBe(0);
  });
});

describe("yearMarks", () => {
  it("writes each year at its first month", () => {
    expect(yearMarks(TIMELINE, TOTAL, 700, 16)).toEqual([
      { year: "2026", start: 0 },
      { year: "2025", start: 3 },
      { year: "2024", start: 6 },
    ]);
  });

  it("leaves out a year that would overlap the label above it", () => {
    // On a 35 px track, 2025 lands 15 px under 2026, 2024 lands 30 px under it.
    expect(yearMarks(TIMELINE, TOTAL, 35, 16)).toEqual([
      { year: "2026", start: 0 },
      { year: "2024", start: 6 },
    ]);
  });
});
