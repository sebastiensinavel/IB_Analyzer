import { describe, expect, it } from "vitest";
import { byteLength, formatAmount, formatBytes, formatClockTime, formatDateTime, formatMoney, formatMonth, formatPercent, formatPrice, formatRate, formatSnapshotDate } from "@/lib/format";

describe("formatMoney", () => {
  it("formats a positive USD amount with no decimals lost", () => {
    expect(formatMoney(36000)).toBe("$36,000.00");
  });

  it("formats zero", () => {
    expect(formatMoney(0)).toBe("$0.00");
  });

  it("formats a negative amount with a leading minus", () => {
    expect(formatMoney(-125.5)).toBe("-$125.50");
  });
});

describe("formatMoney / formatPrice", () => {
  it("formats an unknown money or price as a dash, never as zero", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatPrice(null)).toBe("—");
  });
});

describe("formatPercent", () => {
  it("rounds a ratio to the nearest whole percent", () => {
    expect(formatPercent(0.857)).toBe("86%");
  });

  it("formats 0 and 1", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(1)).toBe("100%");
  });
});

describe("formatRate", () => {
  it("keeps one decimal of a percent, sign included", () => {
    expect(formatRate(0.01206)).toBe("1.2%");
    expect(formatRate(-0.004)).toBe("-0.4%");
    expect(formatRate(0)).toBe("0.0%");
  });
});

describe("formatPrice", () => {
  it("keeps up to 4 decimal places", () => {
    expect(formatPrice(4.2374)).toBe("4.2374");
  });

  it("pads to at least 2 decimal places", () => {
    expect(formatPrice(6.2)).toBe("6.20");
  });
});

describe("formatDateTime", () => {
  it("formats an ISO timestamp as `YYYY-MM-DD HH:mm:ss` in UTC, independent of the host timezone", () => {
    expect(formatDateTime("2026-08-24T15:55:58Z")).toBe("2026-08-24 15:55:58");
    expect(formatDateTime("2026-08-27T12:00:00Z")).toBe("2026-08-27 12:00:00");
  });

  it("keeps the seconds and pads every field to two digits", () => {
    expect(formatDateTime("2026-01-02T03:04:05.678Z")).toBe("2026-01-02 03:04:05");
  });

  it("shows a dash rather than `Invalid Date` for an unparsable timestamp", () => {
    expect(formatDateTime("not a date")).toBe("—");
  });
});

describe("formatAmount", () => {
  // The history table has its own currency column, so its money cells must
  // not carry a hardcoded "$" - a EUR deposit next to a "EUR" cell would
  // otherwise read as dollars.
  it("formats an amount without any currency symbol", () => {
    expect(formatAmount(36000)).toBe("36,000.00");
  });

  it("keeps exactly two decimals", () => {
    expect(formatAmount(48.2)).toBe("48.20");
    expect(formatAmount(-1806.5)).toBe("-1,806.50");
  });

  it("formats zero", () => {
    expect(formatAmount(0)).toBe("0.00");
  });
});

describe("formatClockTime", () => {
  it("shows the wall-clock time of the viewer, on 24 hours, two digits each", () => {
    const iso = "2026-09-06T13:02:00.000Z";
    const local = new Date(iso);
    const expected = `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`;
    expect(formatClockTime(iso)).toBe(expected);
    expect(formatClockTime("2026-09-06T00:05:00.000Z")).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe("byteLength", () => {
  it("counts UTF-8 bytes, not characters: a statement full of accents weighs more than it is long", () => {
    expect(byteLength("a".repeat(500))).toBe(500);
    expect(byteLength("é".repeat(1024))).toBe(2048);
  });
});

describe("formatBytes", () => {
  it("reads in bytes, kilobytes then megabytes", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2 kB");
    expect(formatBytes(204_800)).toBe("200 kB");
    expect(formatBytes(3_500_000)).toBe("3.3 MB");
  });
});

describe("formatSnapshotDate", () => {
  it("keeps a file's day as is", () => {
    expect(formatSnapshotDate("2026-09-02")).toBe("2026-09-02");
  });

  it("dates an agent's instant to the second", () => {
    expect(formatSnapshotDate("2026-09-06T13:02:00.000Z")).toBe("2026-09-06 13:02:00");
  });
});

describe("formatMonth", () => {
  it("spells a month key in the reader's language", () => {
    expect(formatMonth("2024-03", "fr")).toBe("mars 2024");
    expect(formatMonth("2024-03", "en")).toBe("March 2024");
  });
});
