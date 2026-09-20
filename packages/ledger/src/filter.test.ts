import { describe, expect, it } from "vitest";
import { dayOf, marketDayOf } from "./filter.ts";

describe("dayOf", () => {
  it("keeps the UTC calendar day of an ISO timestamp", () => {
    expect(dayOf("2026-08-14T16:20:00.000Z")).toBe("2026-08-14");
  });
});

describe("marketDayOf", () => {
  it("keeps an ordinary session hour on its own day", () => {
    expect(marketDayOf("2026-09-22T10:00:00.000Z")).toBe("2026-09-22");
  });

  it("hands the small hours to the day before: IB books an assignment in the night that follows it", () => {
    expect(marketDayOf("2026-09-22T01:00:00.000Z")).toBe("2026-09-21");
    expect(marketDayOf("2026-09-22T03:59:59.999Z")).toBe("2026-09-21");
    expect(marketDayOf("2026-09-22T04:00:00.000Z")).toBe("2026-09-22");
  });

  it("walks a weekend back to the Friday, whatever the hour", () => {
    expect(marketDayOf("2026-09-19T01:02:45.000Z")).toBe("2026-09-18");
    expect(marketDayOf("2026-09-19T10:00:00.000Z")).toBe("2026-09-18");
    expect(marketDayOf("2026-09-20T18:00:00.000Z")).toBe("2026-09-18");
  });

  it("crosses the weekend from a Monday's small hours", () => {
    expect(marketDayOf("2026-09-21T01:00:00.000Z")).toBe("2026-09-18");
  });

  it("crosses a month and a year boundary", () => {
    expect(marketDayOf("2026-10-01T02:00:00.000Z")).toBe("2026-09-30");
    expect(marketDayOf("2026-01-01T02:00:00.000Z")).toBe("2025-12-31");
  });
});
