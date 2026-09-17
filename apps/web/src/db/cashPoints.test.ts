import { describe, expect, it } from "vitest";
import type { CashReport } from "@ib/ib-parsers";
import { mergeCashPoints } from "./cashPoints";
import type { CashPointRecord } from "./schema";

const report = (startAsOf: string, endAsOf: string, balances: Record<string, [number, number]>): CashReport => ({
  start: { asOf: startAsOf, balances: Object.fromEntries(Object.entries(balances).map(([c, [s]]) => [c, s])) },
  end: { asOf: endAsOf, balances: Object.fromEntries(Object.entries(balances).map(([c, [, e]]) => [c, e])) },
});

const point = (currency: string, kind: "start" | "end", asOf: string, amount: number, source: CashPointRecord["source"] = "flex"): CashPointRecord => ({
  accountId: "test", currency, kind, asOf, amount, source, importedAt: "before",
});

describe("mergeCashPoints", () => {
  it("writes both points of every currency on an empty table, with the source and the instant", () => {
    const written = mergeCashPoints("test", [], report("2025-01-01", "2025-12-31", { USD: [1000, 2803.63], EUR: [0, 7597.7] }), "statement_html", "now");
    expect(written).toEqual([
      { accountId: "test", currency: "USD", kind: "start", asOf: "2025-01-01", amount: 1000, source: "statement_html", importedAt: "now" },
      { accountId: "test", currency: "EUR", kind: "start", asOf: "2025-01-01", amount: 0, source: "statement_html", importedAt: "now" },
      { accountId: "test", currency: "USD", kind: "end", asOf: "2025-12-31", amount: 2803.63, source: "statement_html", importedAt: "now" },
      { accountId: "test", currency: "EUR", kind: "end", asOf: "2025-12-31", amount: 7597.7, source: "statement_html", importedAt: "now" },
    ]);
  });

  it("moves the end point to a later or same-day file, never to an earlier one", () => {
    const current = [point("USD", "end", "2026-09-02", 5)];
    const later = mergeCashPoints("test", current, report("2026-01-01", "2026-09-09", { USD: [1, 6] }), "statement_html", "now");
    expect(later.filter((p) => p.kind === "end")).toEqual([expect.objectContaining({ asOf: "2026-09-09", amount: 6 })]);
    const sameDay = mergeCashPoints("test", current, report("2026-01-01", "2026-09-02", { USD: [1, 7] }), "statement_html", "now");
    expect(sameDay.filter((p) => p.kind === "end")).toEqual([expect.objectContaining({ asOf: "2026-09-02", amount: 7 })]);
    const earlier = mergeCashPoints("test", current, report("2025-01-01", "2025-12-31", { USD: [1, 8] }), "statement_html", "now");
    expect(earlier.filter((p) => p.kind === "end")).toEqual([]);
  });

  it("moves the start point to an earlier or same-day file, never to a later one", () => {
    const current = [point("USD", "start", "2025-09-03", 5)];
    const earlier = mergeCashPoints("test", current, report("2025-01-01", "2025-12-31", { USD: [1, 6] }), "statement_html", "now");
    expect(earlier.filter((p) => p.kind === "start")).toEqual([expect.objectContaining({ asOf: "2025-01-01", amount: 1 })]);
    const sameDay = mergeCashPoints("test", current, report("2025-09-03", "2026-09-02", { USD: [2, 6] }), "flex", "now");
    expect(sameDay.filter((p) => p.kind === "start")).toEqual([expect.objectContaining({ asOf: "2025-09-03", amount: 2, source: "flex" })]);
    const later = mergeCashPoints("test", current, report("2025-09-04", "2026-09-03", { USD: [3, 6] }), "flex", "now");
    expect(later.filter((p) => p.kind === "start")).toEqual([]);
  });

  it("writes nothing for a currency the report does not list: an older point stays true at its date", () => {
    const current = [point("EUR", "start", "2025-01-01", 0), point("EUR", "end", "2025-12-31", 7597.7)];
    const written = mergeCashPoints("test", current, report("2025-09-03", "2026-09-02", { USD: [0, 1] }), "flex", "now");
    expect(written.map((p) => p.currency)).toEqual(["USD", "USD"]);
  });
});
