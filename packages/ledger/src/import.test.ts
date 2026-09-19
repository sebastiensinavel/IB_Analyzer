import { describe, expect, it } from "vitest";
import { planImport, UnsupportedSourceError } from "./import.ts";
import { tx } from "./fixtures.ts";
import type { Transaction, TransactionSource } from "./types.ts";

const flex = (id: string, when: string, extra: Partial<Transaction> = {}) =>
  tx({ source: "flex", externalId: `flex:trade:${id}`, when, ...extra });
const html = (id: string, when: string, extra: Partial<Transaction> = {}) =>
  tx({ source: "statement_html", externalId: `html:${id}`, when, ...extra });
const agent = (id: string, when: string, extra: Partial<Transaction> = {}) =>
  tx({ source: "agent", externalId: `agent:${id}`, when, ...extra });

describe("planImport from Flex", () => {
  const incoming = [flex("1", "2026-01-10T10:00:00.000Z"), flex("2", "2026-03-05T15:00:00.000Z")];

  it("upserts every incoming row", () => {
    const plan = planImport([], { source: "flex", transactions: incoming, period: null });
    expect(plan.upsert).toEqual(incoming);
    expect(plan.delete).toEqual([]);
    expect(plan.skipped).toBe(0);
  });

  it("deletes rows of other sources over its whole days, bounds included", () => {
    const existing = [
      html("before", "2026-01-09T23:59:59.000Z"),
      html("at-min", "2026-01-10T10:00:00.000Z"),
      html("inside", "2026-02-01T00:00:00.000Z"),
      html("at-max", "2026-03-05T15:00:00.000Z"),
      html("later-that-day", "2026-03-05T22:13:46.000Z"),
      html("next-day", "2026-03-06T00:00:00.000Z"),
    ];
    const plan = planImport(existing, { source: "flex", transactions: incoming, period: null });
    expect(plan.delete).toEqual(["html:at-min", "html:inside", "html:at-max", "html:later-that-day"]);
  });

  it("never deletes its own older rows: a row out of the 365-day window is kept for good", () => {
    const old = flex("old", "2024-06-01T00:00:00.000Z");
    const plan = planImport([old], { source: "flex", transactions: incoming, period: null });
    expect(plan.delete).toEqual([]);
    expect(plan.upsert).not.toContain(old);
  });

  it("counts what it dropped by kind, so the app can warn about unchecked sections", () => {
    const existing = [
      html("d1", "2026-02-01T00:00:00.000Z", { kind: "transfer" }),
      html("d2", "2026-02-02T00:00:00.000Z", { kind: "transfer" }),
      html("t1", "2026-02-03T00:00:00.000Z", { kind: "trade" }),
    ];
    const plan = planImport(existing, { source: "flex", transactions: incoming, period: null });
    expect(plan.dropped).toEqual([
      { kind: "trade", count: 1 },
      { kind: "transfer", count: 2 },
    ]);
  });

  it("drops a foreign row earlier the same day as its oldest row, whole day: Flex covered that day entirely", () => {
    const existing = [
      html("previous-day", "2026-01-09T23:59:59.000Z"),
      html("same-day-earlier", "2026-01-10T04:00:00.000Z"),
    ];
    const plan = planImport(existing, { source: "flex", transactions: incoming, period: null });
    expect(plan.delete).toEqual(["html:same-day-earlier"]);
  });

  it("never owns a day before the window it declares: a late cash adjustment keeps its original date", () => {
    // IB books an adjustment (a withholding tax reversal, a re-reported dividend) with the
    // date of the transaction it corrects, months before the query's own window. The rows
    // that day would then be Flex's to delete, with nothing in the response to replace them.
    const incoming = [
      flex("tax", "2025-02-21T00:00:00.000Z", { kind: "tax" }),
      flex("t1", "2025-09-10T10:00:00.000Z"),
      flex("t2", "2026-03-05T15:00:00.000Z"),
    ];
    const existing = [
      html("before-the-window", "2025-03-01T00:00:00.000Z"),
      html("in-the-window", "2025-10-01T00:00:00.000Z"),
    ];
    const plan = planImport(existing, {
      source: "flex",
      transactions: incoming,
      period: { start: "2025-09-09", end: "2026-09-08" },
    });
    expect(plan.delete).toEqual(["html:in-the-window"]);
  });

  // Guards the other plausible fix: flooring the range at `period.start` itself, which would
  // hand Flex the months between the window's start and its first actual row.
  it("still owns only what it reports when its oldest row is well inside the declared window", () => {
    const plan = planImport([html("quiet", "2026-01-09T23:59:59.000Z")], {
      source: "flex",
      transactions: incoming,
      period: { start: "2025-09-09", end: "2026-09-08" },
    });
    expect(plan.delete).toEqual([]);
  });

  it("leaves out a row dated before the window it declares: that day is the statements' to write", () => {
    const late = flex("tax", "2025-02-21T00:00:00.000Z", { kind: "tax" });
    const inside = flex("t1", "2025-09-10T10:00:00.000Z");
    const plan = planImport([], {
      source: "flex",
      transactions: [late, inside],
      period: { start: "2025-09-09", end: "2026-09-08" },
    });
    expect(plan.upsert).toEqual([inside]);
    expect(plan.skipped).toBe(1);
  });

  it("does not let a late adjustment become the day the statements stop writing", () => {
    const flexPlan = planImport([], {
      source: "flex",
      transactions: [flex("tax", "2025-02-21T00:00:00.000Z", { kind: "tax" }), flex("t1", "2025-09-10T10:00:00.000Z")],
      period: { start: "2025-09-09", end: "2026-09-08" },
    });
    const statement = html("march", "2025-03-01T00:00:00.000Z");
    const plan = planImport(flexPlan.upsert, {
      source: "statement_html",
      transactions: [statement],
      period: { start: "2025-01-01", end: "2025-12-31" },
    });
    expect(plan.upsert).toEqual([statement]);
    expect(plan.skipped).toBe(0);
  });

  it("deletes nothing on an empty batch: a query that stops reporting must not wipe the ledger", () => {
    const plan = planImport([html("x", "2026-02-01T00:00:00.000Z")], {
      source: "flex",
      transactions: [],
      period: null,
    });
    expect(plan).toEqual({ delete: [], upsert: [], dropped: [], skipped: 0 });
  });
});

describe("planImport from an HTML statement", () => {
  const period = { start: "2025-01-01", end: "2025-12-31" };

  it("takes everything when Flex owns nothing yet", () => {
    const incoming = [html("a", "2025-03-01T00:00:00.000Z"), html("b", "2025-12-31T00:00:00.000Z")];
    const plan = planImport([], { source: "statement_html", transactions: incoming, period });
    expect(plan.upsert).toEqual(incoming);
    expect(plan.skipped).toBe(0);
  });

  it("writes only before the first Flex day, whole days: Flex covered that day entirely", () => {
    const existing = [flex("f", "2025-09-03T14:30:00.000Z")];
    const incoming = [
      html("kept", "2025-09-02T23:59:59.000Z"),
      html("same-day-earlier", "2025-09-03T09:15:00.000Z"),
      html("later", "2025-10-01T00:00:00.000Z"),
    ];
    const plan = planImport(existing, { source: "statement_html", transactions: incoming, period });
    expect(plan.upsert.map((t) => t.externalId)).toEqual(["html:kept"]);
    expect(plan.skipped).toBe(2);
  });

  it("uses the oldest Flex row as the cutoff, not the newest", () => {
    const existing = [flex("new", "2026-01-01T00:00:00.000Z"), flex("old", "2025-06-01T00:00:00.000Z")];
    const incoming = [html("x", "2025-07-01T00:00:00.000Z")];
    const plan = planImport(existing, { source: "statement_html", transactions: incoming, period });
    expect(plan.upsert).toEqual([]);
    expect(plan.skipped).toBe(1);
  });

  it("replaces its own rows over its declared period, so a re-import is idempotent", () => {
    const existing = [
      html("stale", "2025-05-05T00:00:00.000Z"),
      html("outside", "2024-12-31T00:00:00.000Z"),
      html("same", "2025-06-06T00:00:00.000Z"),
    ];
    const incoming = [html("same", "2025-06-06T00:00:00.000Z"), html("fresh", "2025-07-07T00:00:00.000Z")];
    const plan = planImport(existing, { source: "statement_html", transactions: incoming, period });
    expect(plan.delete).toEqual(["html:stale"]);
    expect(plan.upsert.map((t) => t.externalId)).toEqual(["html:same", "html:fresh"]);
  });

  it("never deletes a row it is not allowed to rewrite: the window stops at the Flex cutoff", () => {
    // Flex arrived after a first statement import and owns from 2025-09-03 on,
    // but its newest row is older than the statement's end, so later statement
    // rows survived. Re-importing that statement may not write them back, so
    // deleting them would punch a hole in the ledger.
    const existing = [
      flex("f", "2025-09-03T14:30:00.000Z"),
      html("old", "2025-06-01T00:00:00.000Z"),
      html("survivor", "2026-08-25T00:00:00.000Z"),
    ];
    const incoming = [
      html("old", "2025-06-01T00:00:00.000Z"),
      html("survivor", "2026-08-25T00:00:00.000Z"),
    ];
    const plan = planImport(existing, {
      source: "statement_html",
      transactions: incoming,
      period: { start: "2025-01-01", end: "2026-09-03" },
    });
    expect(plan.delete).toEqual([]);
    expect(plan.upsert.map((t) => t.externalId)).toEqual(["html:old"]);
    expect(plan.skipped).toBe(1);
  });

  it("leaves Flex rows inside the period alone", () => {
    const existing = [flex("f", "2025-06-01T00:00:00.000Z")];
    const incoming = [html("x", "2025-03-01T00:00:00.000Z")];
    const plan = planImport(existing, { source: "statement_html", transactions: incoming, period });
    expect(plan.delete).toEqual([]);
  });

  it("refuses a statement batch without its period", () => {
    expect(() =>
      planImport([], { source: "statement_html", transactions: [], period: null }),
    ).toThrow(/period/);
  });
});

describe("planImport from the agent", () => {
  const flexMax = "2026-09-08T20:00:00.000Z";
  const existing = [flex("1", "2026-01-10T10:00:00.000Z"), flex("2", flexMax)];

  it("writes only the market days after Flex's last day: Flex reports that day in full", () => {
    const atBound = agent("at-bound", flexMax);
    const laterThatDay = agent("later-that-day", "2026-09-08T23:59:59.999Z");
    const overnight = agent("overnight", "2026-09-09T01:02:45.000Z");
    const nextDay = agent("next-day", "2026-09-09T09:30:00.000Z");
    const before = agent("before", "2026-09-08T19:59:59.000Z");
    const plan = planImport(existing, { source: "agent", transactions: [atBound, laterThatDay, overnight, nextDay, before], period: null });
    expect(plan.upsert).toEqual([nextDay]);
    expect(plan.skipped).toBe(4);
  });

  it("leaves out an assignment Flex already dated at 16:20 that TWS reports in the evening", () => {
    const flexAssignment = [flex("put", "2026-09-15T16:20:00.000Z"), flex("stk", "2026-09-15T16:20:00.000Z")];
    const evening = [agent("put", "2026-09-15T22:13:46.000Z"), agent("stk", "2026-09-15T22:13:46.000Z")];
    const plan = planImport(flexAssignment, { source: "agent", transactions: evening, period: null });
    expect(plan.upsert).toEqual([]);
    expect(plan.skipped).toBe(2);
  });

  it("leaves out an assignment IB only booked after midnight: that night is Friday's business", () => {
    const flexAssignment = [flex("put", "2026-09-18T16:20:00.000Z"), flex("stk", "2026-09-18T16:20:00.000Z")];
    const overnight = [agent("put", "2026-09-19T01:02:45.000Z"), agent("stk", "2026-09-19T01:02:45.000Z")];
    const plan = planImport(flexAssignment, { source: "agent", transactions: overnight, period: null });
    expect(plan.upsert).toEqual([]);
    expect(plan.skipped).toBe(2);
  });

  it("still writes the next real market day: Monday after a Friday expiry", () => {
    const flexAssignment = [flex("put", "2026-09-18T16:20:00.000Z")];
    const monday = agent("mon", "2026-09-21T09:35:00.000Z");
    const plan = planImport(flexAssignment, { source: "agent", transactions: [monday], period: null });
    expect(plan.upsert).toEqual([monday]);
    expect(plan.skipped).toBe(0);
  });

  it("writes everything when there is no Flex row at all", () => {
    const rows = [agent("a", "2026-09-09T14:00:00.000Z"), agent("b", "2026-01-01T00:00:00.000Z")];
    const plan = planImport([html("h", "2026-02-01T00:00:00.000Z")], { source: "agent", transactions: rows, period: null });
    expect(plan.upsert).toEqual(rows);
    expect(plan.skipped).toBe(0);
  });

  it("never deletes anything, not even its own rows missing from the batch", () => {
    const stale = agent("gone", "2026-09-09T09:00:00.000Z");
    const plan = planImport([...existing, stale], { source: "agent", transactions: [agent("new", "2026-09-09T15:00:00.000Z")], period: null });
    expect(plan.delete).toEqual([]);
    expect(plan.dropped).toEqual([]);
  });

  it("is idempotent: the same batch twice plans the same writes", () => {
    const batch = { source: "agent" as const, transactions: [agent("x", "2026-09-09T15:00:00.000Z")], period: null };
    const first = planImport(existing, batch);
    const second = planImport([...existing, ...first.upsert], batch);
    expect(second.upsert).toEqual(first.upsert);
    expect(second.delete).toEqual([]);
  });

  it("returns a fresh array, never the caller's own", () => {
    const rows = [agent("x", "2026-09-09T15:00:00.000Z")];
    const plan = planImport([], { source: "agent", transactions: rows, period: null });
    expect(plan.upsert).not.toBe(rows);
  });
});

describe("planImport from Flex, over agent rows", () => {
  it("retires agent rows over its whole last market day: Flex replaces the day the agent wrote", () => {
    const existing = [
      agent("morning", "2026-09-08T14:00:00.000Z"),
      agent("after", "2026-09-08T20:00:00.001Z"),
      agent("overnight", "2026-09-09T01:02:45.000Z"),
      agent("next-day", "2026-09-09T09:30:00.000Z"),
    ];
    const incoming = [flex("1", "2026-09-01T10:00:00.000Z"), flex("2", "2026-09-08T20:00:00.000Z")];
    const plan = planImport(existing, { source: "flex", transactions: incoming, period: null });
    expect(plan.delete).toEqual(["agent:morning", "agent:after", "agent:overnight"]);
    expect(plan.dropped).toEqual([{ kind: "trade", count: 3 }]);
  });

  it("retires the evening assignment the agent wrote before Flex dated it at 16:20", () => {
    const existing = [agent("put", "2026-09-15T22:13:46.000Z"), agent("stk", "2026-09-15T22:13:46.000Z")];
    const incoming = [flex("open", "2026-09-01T10:00:00.000Z"), flex("put", "2026-09-15T16:20:00.000Z"), flex("stk", "2026-09-15T16:20:00.000Z")];
    const plan = planImport(existing, { source: "flex", transactions: incoming, period: null });
    expect(plan.delete).toEqual(["agent:put", "agent:stk"]);
  });

  it("retires the assignment IB booked after midnight, which Flex dates 16:20 the day before", () => {
    const existing = [agent("put", "2026-09-19T01:02:45.000Z"), agent("stk", "2026-09-19T01:02:45.000Z")];
    const incoming = [
      flex("open", "2026-09-01T10:00:00.000Z"),
      flex("put", "2026-09-18T16:20:00.000Z"),
      flex("stk", "2026-09-18T16:20:00.000Z"),
    ];
    const plan = planImport(existing, { source: "flex", transactions: incoming, period: null });
    expect(plan.delete).toEqual(["agent:put", "agent:stk"]);
  });

  it("never shifts a row of another source: only TWS stamps the hour IB booked something", () => {
    const existing = [agent("overnight", "2026-09-19T01:02:45.000Z"), html("cash", "2026-09-19T00:00:00.000Z")];
    const incoming = [flex("open", "2026-09-01T10:00:00.000Z"), flex("last", "2026-09-18T16:20:00.000Z")];
    const plan = planImport(existing, { source: "flex", transactions: incoming, period: null });
    expect(plan.delete).toEqual(["agent:overnight"]);
  });
});

describe("planImport error handling", () => {
  it("still refuses a source it does not know", () => {
    expect(() =>
      planImport([], { source: "csv" as unknown as TransactionSource, transactions: [], period: null }),
    ).toThrow(UnsupportedSourceError);
  });
});
