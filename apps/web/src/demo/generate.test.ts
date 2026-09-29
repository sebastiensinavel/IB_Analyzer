import { describe, expect, it } from "vitest";
import { ACTIVABLE_STRATEGIES, anchoredBalances, buildJournals } from "@ib/ledger";
import { buildRiskReport, saleInstants } from "@ib/coverage";
import { DEMO_CURRENCIES, generateDemo } from "@/demo/generate";

// A Monday before the open, a Friday evening, a Saturday, a Wednesday afternoon, a Tuesday and a
// Thursday: every weekday the reference day can fall on.
const VISITS = [
  "2026-09-28T12:00:00Z",
  "2026-09-25T23:30:00Z",
  "2026-09-26T15:00:00Z",
  "2026-11-18T19:00:00Z",
  "2026-09-29T15:00:00Z",
  "2026-10-01T18:00:00Z",
];

describe.each(VISITS)("the demo seen on %s", (visit) => {
  const world = generateDemo(new Date(visit));
  const snapshot = { asOf: world.reference, positions: world.positions };
  const journals = buildJournals(world.transactions, snapshot, undefined, ACTIVABLE_STRATEGIES);

  it("rebuilds its own portfolio without a gap", () => {
    expect(journals.reconciliation.asOf).not.toBeNull();
    expect(journals.reconciliation.differences).toEqual([]);
    expect(journals.reconciliation.orphans).toEqual([]);
  });

  it("anchors its cash without a gap", () => {
    const { checks } = anchoredBalances(world.transactions, DEMO_CURRENCIES, world.cashPoints);
    expect(checks).toHaveLength(DEMO_CURRENCIES.length);
    expect(checks.every((c) => c.start !== null && c.start.gap === 0)).toBe(true);
  });

  it("tells a full story in every strategy", () => {
    for (const strategy of ["wheel", "leaps", "condors"] as const) {
      const rows = journals.rows.filter((r) => r.strategy === strategy);
      expect(rows.some((r) => r.endWhen === null), `${strategy} open`).toBe(true);
      expect(rows.some((r) => r.endWhen !== null), `${strategy} closed`).toBe(true);
    }
    expect(journals.rows.some((r) => r.strategy === "others")).toBe(true);
  });

  it("has a buy-back decision, an uncovered sale and an open complete condor", () => {
    const soldAt = saleInstants(journals.rows);
    const report = buildRiskReport(world.positions, world.cashAvailable, { asOf: world.reference, soldAt });
    expect(report.positions.some((p) => p.decision === "buy back")).toBe(true);
    expect(report.positions.some((p) => p.uncoveredQuantity > 0)).toBe(true);
    expect(report.structures.some((s) => s.symbol === "XSP")).toBe(true);
  });

  it("leaves no open option expired at the reference day", () => {
    const options = world.positions.filter((p) => p.secType === "OPT");
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((p) => p.expiry !== null && p.expiry > world.reference)).toBe(true);
  });

  it("never writes -0, which the History would print \"-$0.00\"", () => {
    const negativeZeros = world.transactions.flatMap((t) =>
      Object.entries(t)
        .filter(([, value]) => Object.is(value, -0))
        .map(([field]) => `${t.externalId}.${field}`),
    );
    expect(negativeZeros).toEqual([]);
  });

  it("dates every transaction before the reference day", () => {
    expect(world.transactions.every((t) => t.when.slice(0, 10) < world.reference)).toBe(true);
  });
});

it("generates the same world twice for the same visit", () => {
  expect(generateDemo(new Date(VISITS[0]))).toEqual(generateDemo(new Date(VISITS[0])));
});

it("generates the same world for two instants of the same New York day", () => {
  expect(generateDemo(new Date("2026-09-29T14:00:00Z"))).toEqual(generateDemo(new Date("2026-09-29T23:00:00Z")));
});
