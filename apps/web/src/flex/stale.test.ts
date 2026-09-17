import { describe, expect, it } from "vitest";
import { FLEX_SYNC_STALE_MS, isFlexSyncStale } from "./stale";

const NOW = Date.parse("2026-09-04T12:00:00.000Z");

describe("isFlexSyncStale", () => {
  it("is twelve hours", () => {
    expect(FLEX_SYNC_STALE_MS).toBe(12 * 60 * 60 * 1000);
  });

  it("is stale when there has never been a sync", () => {
    expect(isFlexSyncStale(undefined, NOW)).toBe(true);
  });

  it("is fresh one millisecond before the threshold", () => {
    expect(isFlexSyncStale(new Date(NOW - FLEX_SYNC_STALE_MS + 1).toISOString(), NOW)).toBe(false);
  });

  it("is stale exactly at the threshold", () => {
    expect(isFlexSyncStale(new Date(NOW - FLEX_SYNC_STALE_MS).toISOString(), NOW)).toBe(true);
  });

  it("treats an unparsable timestamp as stale rather than trusting it", () => {
    expect(isFlexSyncStale("not a date", NOW)).toBe(true);
  });
});
