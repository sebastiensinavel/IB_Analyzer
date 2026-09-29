import { expect, it } from "vitest";
import { addDays, calendarDaysBetween, fridayOnOrAfter, marketDaysBefore, nyDay, referenceDay } from "@/demo/calendar";

it("reads the New York calendar day, not the machine's", () => {
  expect(nyDay(new Date("2026-09-26T02:00:00Z"))).toBe("2026-09-25"); // 22:00 in New York
});

it("rolls a weekend back to Friday", () => {
  expect(referenceDay(new Date("2026-09-26T15:00:00Z"))).toBe("2026-09-25");
  expect(referenceDay(new Date("2026-09-27T15:00:00Z"))).toBe("2026-09-25");
  expect(referenceDay(new Date("2026-09-28T15:00:00Z"))).toBe("2026-09-28");
});

it("counts market days back, weekends skipped", () => {
  expect(marketDaysBefore("2026-09-28", 0)).toBe("2026-09-28");
  expect(marketDaysBefore("2026-09-28", 1)).toBe("2026-09-25");
  expect(marketDaysBefore("2026-09-28", 5)).toBe("2026-09-21");
});

it("finds the Friday on or after a day", () => {
  expect(fridayOnOrAfter("2026-09-25")).toBe("2026-09-25");
  expect(fridayOnOrAfter("2026-09-26")).toBe("2026-10-02");
  expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  expect(calendarDaysBetween("2026-09-25", "2026-10-02")).toBe(7);
});
