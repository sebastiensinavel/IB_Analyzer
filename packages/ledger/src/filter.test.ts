import { describe, expect, it } from "vitest";
import { dayOf, filterTransactions, matchesFilter } from "./filter.ts";
import { tx } from "./fixtures.ts";

describe("dayOf", () => {
  it("keeps the UTC calendar day of an ISO timestamp", () => {
    expect(dayOf("2026-08-14T16:20:00.000Z")).toBe("2026-08-14");
  });
});

describe("matchesFilter", () => {
  const aapl = tx({ symbol: "AAPL", kind: "trade", when: "2026-02-10T12:00:00.000Z" });

  it("matches everything with an empty filter", () => {
    expect(matchesFilter(aapl, {})).toBe(true);
  });

  it("matches the symbol as a case-insensitive substring", () => {
    expect(matchesFilter(aapl, { symbol: "aap" })).toBe(true);
    expect(matchesFilter(aapl, { symbol: "MSFT" })).toBe(false);
  });

  it("matches the kind exactly and ignores a null kind", () => {
    expect(matchesFilter(aapl, { kind: "trade" })).toBe(true);
    expect(matchesFilter(aapl, { kind: "dividend" })).toBe(false);
    expect(matchesFilter(aapl, { kind: null })).toBe(true);
  });

  it("bounds by whole days, inclusive on both ends", () => {
    expect(matchesFilter(aapl, { from: "2026-02-10", to: "2026-02-10" })).toBe(true);
    expect(matchesFilter(aapl, { from: "2026-02-11" })).toBe(false);
    expect(matchesFilter(aapl, { to: "2026-02-09" })).toBe(false);
  });
});

describe("filterTransactions", () => {
  it("keeps only the matching rows", () => {
    const rows = [tx({ symbol: "AAPL" }), tx({ symbol: "MSFT", externalId: "2" })];
    expect(filterTransactions(rows, { symbol: "MS" }).map((t) => t.symbol)).toEqual(["MSFT"]);
  });
});
