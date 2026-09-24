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
  // primary et success sont tous deux teal (sous-projet 31) : une étiquette ne peut plus
  // s'appuyer sur eux, elle prend la teinte de la série de son rôle, dans les deux thèmes.
  const hue = (className: string, dark: boolean) =>
    className.match(dark ? /dark:bg-\[(#[0-9a-f]{6})\]/ : /(?:^|\s)bg-\[(#[0-9a-f]{6})\]/)?.[1];

  it.each([
    [false, CHART_COLORS.light],
    [true, CHART_COLORS.dark],
  ] as const)("takes the hue of its capital line (dark: %s)", (dark, colors) => {
    expect(hue(LABEL_TONE_CLASS.shortCall, dark)).toBe(seriesColor("assigned", colors));
    expect(hue(LABEL_TONE_CLASS.shares, dark)).toBe(seriesColor("cumulativePnl", colors));
    expect(hue(LABEL_TONE_CLASS.open, dark)).toBe(seriesColor("allocated", colors));
  });

  it("keeps the three tones apart", () => {
    for (const dark of [false, true]) {
      const hues = Object.values(LABEL_TONE_CLASS).map((c) => hue(c, dark));
      expect(new Set(hues).size).toBe(3);
    }
  });

  it("never leans on the primary or success tokens, both teal now", () => {
    for (const c of Object.values(LABEL_TONE_CLASS)) expect(c).not.toMatch(/bg-(primary|success)/);
  });

  it("stays light enough under the dark theme's text: /45, not /70", () => {
    for (const c of Object.values(LABEL_TONE_CLASS)) expect(c).toMatch(/dark:bg-\[#[0-9a-f]{6}\]\/45/);
  });
});
