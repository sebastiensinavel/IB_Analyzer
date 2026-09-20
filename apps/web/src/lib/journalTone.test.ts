import { describe, expect, it } from "vitest";
import type { JournalRow } from "@ib/ledger";
import { seriesColor } from "@/lib/capitalCharts";
import { CHART_COLORS } from "@/lib/chartColors";
import { LABEL_TONE_CLASS, labelTone } from "@/lib/journalTone";

function row(overrides: Partial<JournalRow>): JournalRow {
  return {
    id: "x", strategy: "wheel", kind: "short_put", ticker: "MQZA", label: "MQZA", currency: "USD",
    contract: { ticker: "MQZA", secType: "OPT", right: "P", strike: null, expiry: null, currency: "USD" },
    startWhen: "2026-08-01T14:30:00.000Z", quantity: -1,
    strike: null,
    openPrice: null, openTotal: null, openCommission: null, openNet: null, assigned: false, endWhen: null, closePrice: null, closeTotal: null,
    closeCommission: null, closeNet: null, pnl: null, ongoing: true, event: null, orphan: false, note: null, openIds: [], closeIds: [], ...overrides,
  };
}

describe("labelTone", () => {
  it("is blue for delivered shares still held, orange for a short call open, green for a put still live, a long call or a condor open, nothing for a put already assigned", () => {
    expect(labelTone(row({ kind: "shares", assigned: true }))).toBe("shares");
    expect(labelTone(row({ kind: "short_call" }))).toBe("shortCall");
    expect(labelTone(row({ kind: "short_put" }))).toBe("open");
    expect(labelTone(row({ kind: "short_put", assigned: true }))).toBeNull();
    expect(labelTone(row({ kind: "long_call" }))).toBe("open");
    expect(labelTone(row({ kind: "condor" }))).toBe("open");
  });

  it("is nothing once closed, for shares bought on the market, and for the other kinds", () => {
    expect(labelTone(row({ kind: "short_put", ongoing: false }))).toBeNull();
    // An assigned put stays `ongoing` while its shares are held; the shares line carries the tone.
    expect(labelTone(row({ kind: "short_put", assigned: true, ongoing: true }))).toBeNull();
    expect(labelTone(row({ kind: "shares", strategy: "others", assigned: false }))).toBeNull();
    expect(labelTone(row({ kind: "long_put" }))).toBeNull();
    expect(labelTone(row({ kind: "short_shares", assigned: true }))).toBeNull();
    expect(labelTone(row({ kind: "settlement", ongoing: false }))).toBeNull();
  });

  it("tints shares the Wheel took over like the shares an option delivered", () => {
    expect(labelTone(row({ kind: "shares", strategy: "wheel", assigned: false, ongoing: true }))).toBe("shares");
    expect(labelTone(row({ kind: "shares", strategy: "others", assigned: false, ongoing: true }))).toBeNull();
    // `assigned` says how the line arrived, `strategy` says where it is: the
    // tone needs both, so exercise `assigned` alone, away from wheel.
    expect(labelTone(row({ kind: "shares", strategy: "leaps", assigned: true, ongoing: true }))).toBe("shares");
    expect(labelTone(row({ kind: "shares", strategy: "others", assigned: true, ongoing: true }))).toBe("shares");
  });
});

describe("LABEL_TONE_CLASS", () => {
  // The theme tokens barely show on the dark card: there, a tone takes the hue of a capital line.
  const darkHue = (className: string) => className.match(/dark:bg-\[(#[0-9a-f]{6})\]/)?.[1];

  it("borrows the dark capital chart's hues: orange Assigned for a short call, blue Cumulative P/L for shares, green Allocated for an open put", () => {
    expect(darkHue(LABEL_TONE_CLASS.shortCall)).toBe(seriesColor("assigned", CHART_COLORS.dark));
    expect(darkHue(LABEL_TONE_CLASS.shares)).toBe(seriesColor("cumulativePnl", CHART_COLORS.dark));
    expect(darkHue(LABEL_TONE_CLASS.open)).toBe(seriesColor("allocated", CHART_COLORS.dark));
  });

  it("keeps the light theme's tokens", () => {
    expect(LABEL_TONE_CLASS.shares).toContain("bg-primary/15");
    expect(LABEL_TONE_CLASS.shortCall).toContain("bg-warning/25");
    expect(LABEL_TONE_CLASS.open).toContain("bg-success/15");
  });
});
