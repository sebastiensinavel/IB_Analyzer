import { describe, expect, it } from "vitest";
import type { JournalRow } from "@ib/ledger";
import { JOURNAL_COLUMNS, journalColumnSpecs } from "@/lib/journalColumns";

function row(overrides: Partial<JournalRow> = {}): JournalRow {
  return {
    id: "x#1", strategy: "wheel", kind: "short_put", ticker: "MQZA", label: "MQZA Oct02'26 17 Put", currency: "USD",
    contract: { ticker: "MQZA", secType: "OPT", right: "P", strike: 17, expiry: "2026-10-02", currency: "USD" },
    startWhen: "2026-06-01T14:30:00.000Z", quantity: -2, strike: 17, openPrice: 0.21, openTotal: 42, openCommission: -1,
    openNet: 41, assigned: true, endWhen: null, closePrice: null, closeTotal: null, closeCommission: null, closeNet: null,
    pnl: null, ongoing: true, event: null, orphan: false, note: null, openIds: [], closeIds: [], ...overrides,
  };
}

const t = (key: string, options?: Record<string, unknown>) => `${key}:${options?.contract ?? ""}`;

describe("journalColumnSpecs", () => {
  it("types the seventeen columns, in their order", () => {
    const specs = journalColumnSpecs(t);
    expect(specs.map((spec) => spec.key)).toEqual(JOURNAL_COLUMNS.map((column) => column.key));
    expect(specs.every((spec) => spec.sortable)).toBe(true);
    expect(specs.filter((spec) => spec.type === "date").map((spec) => spec.key)).toEqual(["startWhen", "endWhen"]);
    expect(specs.filter((spec) => spec.type === "enum").map((spec) => spec.key)).toEqual(["assigned", "ongoing"]);
  });

  it("compares what each cell shows: the dated instants, the flags as 1 and 0, the translated note", () => {
    const specs = Object.fromEntries(journalColumnSpecs(t).map((spec) => [spec.key, spec]));
    expect(specs.startWhen.value(row())).toBe("2026-06-01 14:30:00");
    expect(specs.assigned.value(row())).toBe("1");
    expect(specs.ongoing.value(row({ ongoing: false }))).toBe("0");
    expect(specs.note.value(row({ note: { code: "nakedCall" } }))).toBe("journal.notes.nakedCall:");
    expect(specs.note.value(row())).toBeNull();
  });

  it("leaves an open line's end date absent, so it sorts last and only a dash matches it", () => {
    const specs = Object.fromEntries(journalColumnSpecs(t).map((spec) => [spec.key, spec]));
    expect(specs.endWhen.value(row())).toBeNull();
    expect(specs.endWhen.value(row({ endWhen: "2026-07-17T20:00:00.000Z" }))).toBe("2026-07-17 20:00:00");
    expect(specs.pnl.value(row())).toBeNull();
  });
});
