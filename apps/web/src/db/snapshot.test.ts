import { describe, expect, it } from "vitest";
import type { SnapshotRecord } from "./schema";
import { shouldReplaceSnapshot } from "./snapshot";

const flex = (asOf: string): SnapshotRecord => ({ accountId: "a", source: "flex", asOf, importedAt: "", positions: [], cashAvailable: null });
const agent = (asOf: string): SnapshotRecord => ({ accountId: "a", source: "agent", asOf, importedAt: "", positions: [], cashAvailable: null });

describe("shouldReplaceSnapshot", () => {
  it("writes when there is nothing yet", () => {
    expect(shouldReplaceSnapshot(undefined, { source: "flex", asOf: "2026-09-05" })).toBe(true);
  });

  it("lets an agent snapshot replace anything: it is live by definition", () => {
    expect(shouldReplaceSnapshot(flex("2026-09-06"), { source: "agent", asOf: "2026-09-06T13:02:00.000Z" })).toBe(true);
    expect(shouldReplaceSnapshot(agent("2026-09-06T15:00:00.000Z"), { source: "agent", asOf: "2026-09-06T13:02:00.000Z" })).toBe(true);
    // "Anything" includes an incoming agent pass from an EARLIER day than current: only the
    // source check can pass this, since the day comparison alone would say no.
    expect(shouldReplaceSnapshot(agent("2026-09-06T08:00:00.000Z"), { source: "agent", asOf: "2026-09-05T23:00:00.000Z" })).toBe(true);
  });

  it("lets the morning Flex sync (yesterday's close) replace yesterday's agent snapshot", () => {
    expect(shouldReplaceSnapshot(agent("2026-09-05T15:00:00.000Z"), { source: "flex", asOf: "2026-09-05" })).toBe(true);
  });

  it("never lets an older file replace today's agent snapshot", () => {
    expect(shouldReplaceSnapshot(agent("2026-09-06T15:00:00.000Z"), { source: "flex", asOf: "2026-09-05" })).toBe(false);
  });

  it("keeps the file-vs-file rule: same or newer day replaces, older does not", () => {
    expect(shouldReplaceSnapshot(flex("2026-09-05"), { source: "flex", asOf: "2026-09-05" })).toBe(true);
    expect(shouldReplaceSnapshot(flex("2026-09-05"), { source: "flex", asOf: "2026-09-04" })).toBe(false);
  });
});
