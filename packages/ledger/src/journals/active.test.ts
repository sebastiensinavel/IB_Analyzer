import { beforeEach, describe, expect, it } from "vitest";
import { deliver, option, resetIds, stock } from "./fixtures.ts";
import { buildJournals } from "./replay.ts";
import { ACTIVABLE_STRATEGIES, scopeStrategies, type JournalsReport } from "./types.ts";

beforeEach(resetIds);

const D1 = "2026-08-01T14:30:00.000Z";
const D2 = "2026-08-10T15:00:00.000Z";
const D3 = "2026-08-20T15:00:00.000Z";
const PUT = { right: "P" as const, strike: 17, expiry: "2026-10-02" };
const CALL = { right: "C" as const, strike: 20, expiry: "2026-11-20" };
const LEAPS = { right: "C" as const, strike: 15, expiry: "2027-06-18" };
const SPY = { ticker: "SPY", expiry: "2026-08-29" };

/** id -> "strategy:quantity", for the rows opened by the transaction `externalId`. */
function placed(report: JournalsReport, externalId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of report.rows) if (row.openIds[0] === externalId) out[row.id] = `${row.strategy}:${row.quantity}`;
  return out;
}

function condor() {
  return [
    option({ ...SPY, right: "P", strike: 620, quantity: 1, price: 0.3, when: D1 }),
    option({ ...SPY, right: "P", strike: 625, quantity: -1, price: 0.6, when: D1 }),
    option({ ...SPY, right: "C", strike: 660, quantity: -1, price: 0.5, when: D1 }),
    option({ ...SPY, right: "C", strike: 665, quantity: 1, price: 0.3, when: D1 }),
  ];
}

describe("buildJournals — active strategies", () => {
  it("keeps every strategy when no list is given", () => {
    const explicit = buildJournals([option({ ...PUT, quantity: -1, price: 0.2, when: D1 })], undefined, undefined, ACTIVABLE_STRATEGIES);
    resetIds();
    const implicit = buildJournals([option({ ...PUT, quantity: -1, price: 0.2, when: D1 })]);
    expect(implicit).toEqual(explicit);
  });

  it("files a sold put in Others without the Wheel", () => {
    const report = buildJournals([option({ ...PUT, quantity: -1, price: 0.2, when: D1 })], undefined, undefined, ["leaps", "condors"]);
    expect(placed(report, "flex:trade:1")).toEqual({ "flex:trade:1#1": "others:-1" });
  });

  it("keeps the shares an Others put delivers in Others", () => {
    const report = buildJournals(
      [option({ ...PUT, quantity: -1, price: 0.2, when: D1 }), ...deliver({ ...PUT, quantity: 1 })],
      undefined,
      undefined,
      [],
    );
    expect(placed(report, "flex:trade:3")).toEqual({ "flex:trade:3#1": "others:100" });
  });

  it("never takes shares over without the Wheel: a call sold on held shares goes to Others, no integrated exit", () => {
    const report = buildJournals(
      [stock({ ticker: "ZZZ", quantity: 100, price: 10, when: D1 }), option({ ...CALL, ticker: "ZZZ", quantity: -1, price: 0.5, when: D2 })],
      undefined,
      undefined,
      ["leaps", "condors"],
    );
    expect(placed(report, "flex:trade:2")).toEqual({ "flex:trade:2#1": "others:-1" });
    expect(report.rows.some((row) => row.event === "integrated")).toBe(false);
    expect(report.rows.every((row) => row.strategy === "others")).toBe(true);
  });

  it("still gives a call sold against a LEAPS to the LEAPS without the Wheel", () => {
    const report = buildJournals(
      [option({ ...LEAPS, quantity: 1, price: 3, when: D1 }), option({ ...CALL, quantity: -1, price: 0.5, when: D2 })],
      undefined,
      undefined,
      ["leaps"],
    );
    expect(placed(report, "flex:trade:2")).toEqual({ "flex:trade:2#1": "leaps:-1" });
  });

  it("files a long call and the call sold against it in Others without the LEAPS", () => {
    const report = buildJournals(
      [option({ ...LEAPS, quantity: 1, price: 3, when: D1 }), option({ ...CALL, quantity: -1, price: 0.5, when: D2 })],
      undefined,
      undefined,
      ["wheel"],
    );
    expect(placed(report, "flex:trade:1")).toEqual({ "flex:trade:1#1": "others:1" });
    expect(placed(report, "flex:trade:2")).toEqual({ "flex:trade:2#1": "others:-1" });
  });

  it("files a condor's four legs whole in Others without the Condors, none in the Wheel", () => {
    const report = buildJournals(condor(), undefined, undefined, ["wheel"]);
    expect(report.rows).toHaveLength(4);
    expect(report.rows.map((row) => row.strategy)).toEqual(["others", "others", "others", "others"]);
  });

  it("files everything in Others with no strategy active, and leaves every scope empty", () => {
    const report = buildJournals(
      [option({ ...PUT, quantity: -1, price: 0.2, when: D1 }), option({ ...LEAPS, ticker: "ZZZ", quantity: 1, price: 3, when: D2 }), ...condor()],
      undefined,
      undefined,
      [],
    );
    expect(report.rows.every((row) => row.strategy === "others")).toBe(true);
    expect(report.stats).toEqual({ wheel: [], leaps: [], condors: [], portfolio: [] });
    expect(report.capital).toEqual({ wheel: [], leaps: [], condors: [], portfolio: [] });
  });

  it("gives the portfolio the active strategies only, and an inactive strategy nothing", () => {
    const ledger = [
      option({ ...PUT, quantity: -1, price: 0.2, when: D1 }),
      option({ ...LEAPS, ticker: "ZZZ", quantity: 1, price: 3, when: D2 }),
      option({ ...LEAPS, ticker: "ZZZ", quantity: -1, price: 4, when: D3 }),
    ];
    const all = buildJournals(ledger);
    resetIds();
    const wheelOnly = buildJournals(ledger, undefined, undefined, ["wheel"]);
    expect(wheelOnly.stats.leaps).toEqual([]);
    expect(wheelOnly.capital.leaps).toEqual([]);
    expect(wheelOnly.stats.wheel).toEqual(all.stats.wheel);
    expect(wheelOnly.stats.portfolio).toEqual(all.stats.wheel);
    expect(all.stats.portfolio[0].total).toBe(all.stats.wheel[0].total + all.stats.leaps[0].total);
  });
});

describe("scopeStrategies", () => {
  it("reads a strategy only while it is active, and the portfolio as the active list", () => {
    expect(scopeStrategies("leaps", ["wheel", "leaps"])).toEqual(["leaps"]);
    expect(scopeStrategies("condors", ["wheel", "leaps"])).toEqual([]);
    expect(scopeStrategies("portfolio", ["wheel", "condors"])).toEqual(["wheel", "condors"]);
    expect(scopeStrategies("portfolio", [])).toEqual([]);
  });
});
