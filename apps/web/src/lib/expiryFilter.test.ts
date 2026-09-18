import { describe, expect, it } from "vitest";
import { expiryChoices, MAX_EXPIRY_BUTTONS, reportToday } from "@/lib/expiryFilter";

function opt(expiry: string | null) {
  return { expiry };
}

describe("reportToday", () => {
  it("is the New York day, not the browser's: an IB expiry belongs to the market's calendar", () => {
    // 02:00 UTC on the 18th is still the evening of the 17th in New York.
    expect(reportToday(new Date("2026-09-18T02:00:00.000Z"))).toBe("2026-09-17");
    expect(reportToday(new Date("2026-09-18T16:00:00.000Z"))).toBe("2026-09-18");
  });
});

describe("expiryChoices", () => {
  it("lists the distinct option expiries, nearest first", () => {
    const choices = expiryChoices([opt("2026-12-18"), opt("2026-10-16"), opt("2026-10-16"), opt("2026-11-20")], "2026-09-18");
    expect(choices.map((choice) => choice.expiry)).toEqual(["2026-10-16", "2026-11-20", "2026-12-18"]);
  });

  it("labels an expiry the way the Position column spells it", () => {
    expect(expiryChoices([opt("2026-10-16")], "2026-09-18")[0].label).toBe("Oct16'26");
  });

  it("keeps today's expiry and drops the ones already gone", () => {
    const choices = expiryChoices([opt("2026-09-17"), opt("2026-09-18"), opt("2026-09-19")], "2026-09-18");
    expect(choices.map((choice) => choice.expiry)).toEqual(["2026-09-18", "2026-09-19"]);
  });

  it("ignores what has no expiry: shares never get a button", () => {
    expect(expiryChoices([opt(null), opt(null)], "2026-09-18")).toEqual([]);
  });

  it("keeps only the nearest expiries, so the row stays on one line", () => {
    const many = Array.from({ length: MAX_EXPIRY_BUTTONS + 3 }, (_, index) => opt(`2026-10-${String(index + 1).padStart(2, "0")}`));
    const choices = expiryChoices(many, "2026-09-18");
    expect(choices).toHaveLength(MAX_EXPIRY_BUTTONS);
    expect(choices[choices.length - 1].expiry).toBe(`2026-10-${String(MAX_EXPIRY_BUTTONS).padStart(2, "0")}`);
  });
});
