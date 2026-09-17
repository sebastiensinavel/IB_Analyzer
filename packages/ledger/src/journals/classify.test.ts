import { beforeEach, describe, expect, it } from "vitest";
import { splitShortCall } from "./classify.ts";
import { deliver, option, resetIds, stock } from "./fixtures.ts";
import { buildJournals } from "./replay.ts";
import type { JournalsReport } from "./types.ts";

beforeEach(resetIds);

const D1 = "2026-08-01T14:30:00.000Z";
const D2 = "2026-08-10T15:00:00.000Z";
const D3 = "2026-08-20T15:00:00.000Z";
const PUT = { right: "P" as const, strike: 17, expiry: "2026-10-02" };
const CALL = { right: "C" as const, strike: 20, expiry: "2026-11-20" };
const LEAPS = { right: "C" as const, strike: 15, expiry: "2027-06-18" };

/** id -> strategy, for the rows opened by the transaction `externalId`. */
function placed(report: JournalsReport, externalId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of report.rows) if (row.openIds[0] === externalId) out[row.id] = `${row.strategy}:${row.quantity}`;
  return out;
}

describe("splitShortCall", () => {
  it("is naked without any cover", () => {
    expect(splitShortCall(2, 0, 0, 20, null)).toEqual([{ strategy: "others", cover: null, quantity: 2 }]);
  });

  it("fills both covers and leaves the excess naked when the sale exceeds them", () => {
    expect(splitShortCall(4, 2, 1, 20, 17)).toEqual([
      { strategy: "wheel", cover: "shares", quantity: 2 },
      { strategy: "leaps", cover: "leaps", quantity: 1 },
      { strategy: "others", cover: null, quantity: 1 },
    ]);
    expect(splitShortCall(3, 2, 1, 20, 17)).toEqual([
      { strategy: "wheel", cover: "shares", quantity: 2 },
      { strategy: "leaps", cover: "leaps", quantity: 1 },
    ]);
  });

  it("goes whole to the cover whose capacity it matches exactly", () => {
    expect(splitShortCall(2, 2, 3, 20, 17)).toEqual([{ strategy: "wheel", cover: "shares", quantity: 2 }]);
    expect(splitShortCall(3, 2, 3, 20, 17)).toEqual([{ strategy: "leaps", cover: "leaps", quantity: 3 }]);
  });

  it("otherwise goes Wheel first when the strike is on or above the average share price, LEAPS first below", () => {
    expect(splitShortCall(2, 3, 3, 17, 17)).toEqual([{ strategy: "wheel", cover: "shares", quantity: 2 }]);
    expect(splitShortCall(2, 3, 3, 16, 17)).toEqual([{ strategy: "leaps", cover: "leaps", quantity: 2 }]);
    expect(splitShortCall(2, 3, 1, 16, 17)).toEqual([
      { strategy: "leaps", cover: "leaps", quantity: 1 },
      { strategy: "wheel", cover: "shares", quantity: 1 },
    ]);
  });

  it("goes to the only cover there is when nothing was ever assigned", () => {
    expect(splitShortCall(1, 0, 3, 16, null)).toEqual([{ strategy: "leaps", cover: "leaps", quantity: 1 }]);
    expect(splitShortCall(1, 3, 0, 16, 17)).toEqual([{ strategy: "wheel", cover: "shares", quantity: 1 }]);
  });
});

describe("classifyOpenings — singles", () => {
  it("puts a put sold alone in Wheel and a put bought alone in Others", () => {
    const report = buildJournals([option({ ...PUT, quantity: -1, price: 0.2, when: D1 }), option({ ...PUT, strike: 15, quantity: 1, price: 0.1, when: D2 })]);
    expect(placed(report, "flex:trade:1")).toEqual({ "flex:trade:1#1": "wheel:-1" });
    expect(placed(report, "flex:trade:2")).toEqual({ "flex:trade:2#1": "others:1" });
  });

  it("puts a call bought three calendar months or more ahead in LEAPS, closer in Others", () => {
    const report = buildJournals([
      option({ right: "C", strike: 15, expiry: "2026-11-01", quantity: 1, price: 2, when: D1 }),
      option({ right: "C", strike: 15, expiry: "2026-10-31", quantity: 1, price: 2, when: D1 }),
    ]);
    expect(placed(report, "flex:trade:1")).toEqual({ "flex:trade:1#1": "leaps:1" });
    expect(placed(report, "flex:trade:2")).toEqual({ "flex:trade:2#1": "others:1" });
  });

  it("puts a naked call in Others, but a call sold on shares bought on the market in Wheel", () => {
    const report = buildJournals([
      option({ ...CALL, quantity: -1, price: 0.5, when: D1 }),
      stock({ ticker: "ZZZ", quantity: 100, price: 10, when: D1 }),
      option({ ...CALL, ticker: "ZZZ", quantity: -1, price: 0.5, when: D2 }),
    ]);
    expect(placed(report, "flex:trade:1")).toEqual({ "flex:trade:1#1": "others:-1" });
    expect(placed(report, "flex:trade:3")).toEqual({ "flex:trade:3#1": "wheel:-1" });
  });

  it("counts only whole contracts, and never counts short shares as a cover", () => {
    const short = buildJournals([
      stock({ ticker: "ZZZ", quantity: -100, price: 10, when: D1 }),
      option({ ...CALL, ticker: "ZZZ", quantity: -1, price: 0.5, when: D2 }),
    ]);
    expect(placed(short, "flex:trade:2")).toEqual({ "flex:trade:2#1": "others:-1" });
    resetIds();
    const odd = buildJournals([
      stock({ ticker: "ZZZ", quantity: 99, price: 10, when: D1 }),
      option({ ...CALL, ticker: "ZZZ", quantity: -1, price: 0.5, when: D2 }),
    ]);
    expect(placed(odd, "flex:trade:2")).toEqual({ "flex:trade:2#1": "others:-1" });
  });

  it("keeps the shares a put delivers in Wheel, and those a LEAPS delivers in LEAPS", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -1, price: 0.2, when: D1 }),
      ...deliver({ ...PUT, quantity: 1 }),
      option({ ...LEAPS, ticker: "ZZZ", quantity: 1, price: 3, when: D1 }),
      ...deliver({ ...LEAPS, ticker: "ZZZ", quantity: -1, when: "2027-06-18T20:00:00.000Z" }),
    ]);
    expect(placed(report, "flex:trade:3")).toEqual({ "flex:trade:3#1": "wheel:100" });
    expect(placed(report, "flex:trade:6")).toEqual({ "flex:trade:6#1": "leaps:100" });
  });
});

describe("classifyOpenings — covered calls", () => {
  /** 200 MQZA shares assigned at 17 (two contracts) and one MQZA LEAPS: Aw = 2, Lw = 1. */
  function covers() {
    return [
      option({ ...PUT, quantity: -2, price: 0.2, when: D1 }),
      ...deliver({ ...PUT, quantity: 2, when: D2 }),
      option({ ...LEAPS, quantity: 1, price: 3, when: D2 }),
    ];
  }

  it("splits a sale over both covers and the excess, one lot per part", () => {
    const report = buildJournals([...covers(), option({ ...CALL, quantity: -4, price: 0.5, when: D3 })]);
    expect(placed(report, "flex:trade:5")).toEqual({
      "flex:trade:5#1": "wheel:-2",
      "flex:trade:5.2#1": "leaps:-1",
      "flex:trade:5.3#1": "others:-1",
    });
    const wheel = report.rows.find((r) => r.id === "flex:trade:5#1");
    expect(wheel).toMatchObject({ openTotal: 100, openCommission: -0.5 });
  });

  it("consumes the capacity: a second sale finds the covers taken, a buyback frees them", () => {
    const report = buildJournals([
      ...covers(),
      option({ ...CALL, quantity: -3, price: 0.5, when: D3 }),
      option({ ...CALL, quantity: -1, price: 0.5, when: "2026-08-21T15:00:00.000Z" }),
      option({ ...CALL, quantity: 1, price: 0.4, when: "2026-08-22T15:00:00.000Z" }),
      option({ ...CALL, strike: 21, quantity: -1, price: 0.3, when: "2026-08-23T15:00:00.000Z" }),
    ]);
    expect(placed(report, "flex:trade:6")).toEqual({ "flex:trade:6#1": "others:-1" });
    // The buyback closes the oldest lot: the Wheel part of the 3-lot sale. One Wheel slot is free again.
    expect(placed(report, "flex:trade:8")).toEqual({ "flex:trade:8#1": "wheel:-1" });
  });

  it("arbitrates by the average share price when the quantity matches neither cover", () => {
    const above = buildJournals([...covers(), option({ ...PUT, quantity: -1, price: 0.2, when: D2 }), ...deliver({ ...PUT, quantity: 1, when: D3 }), option({ ...CALL, strike: 17, quantity: -2, price: 0.5, when: "2026-08-21T15:00:00.000Z" })]);
    // Aw = 3, Lw = 1, N = 2, strike 17 >= 17: Wheel first.
    expect(placed(above, "flex:trade:8")).toEqual({ "flex:trade:8#1": "wheel:-2" });
    resetIds();
    const below = buildJournals([...covers(), option({ ...PUT, quantity: -1, price: 0.2, when: D2 }), ...deliver({ ...PUT, quantity: 1, when: D3 }), option({ ...CALL, strike: 16, quantity: -2, price: 0.5, when: "2026-08-21T15:00:00.000Z" })]);
    // strike 16 < 17: LEAPS first, the rest to Wheel.
    expect(placed(below, "flex:trade:8")).toEqual({ "flex:trade:8#1": "leaps:-1", "flex:trade:8.2#1": "wheel:-1" });
  });

  it("arbitrates on a mixed basis: shares bought on the market pull the average price down", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -1, price: 0.2, when: D1 }),
      ...deliver({ ...PUT, quantity: 1, when: D2 }),
      stock({ quantity: 100, price: 5, when: D2 }),
      option({ ...LEAPS, quantity: 2, price: 3, when: D2 }),
      option({ ...CALL, strike: 14, quantity: -3, price: 0.5, when: D3 }),
    ]);
    // Aw = 2, Lw = 2, N = 3. Average share price = (100*17 + 100*5) / 200 = 11, strike 14 >= 11:
    // Wheel first. With only the assigned 100 shares (base 17) it would have been 14 < 17, LEAPS first.
    expect(placed(report, "flex:trade:6")).toEqual({ "flex:trade:6#1": "wheel:-2", "flex:trade:6.2#1": "leaps:-1" });
  });

  it("loses the Wheel cover when the delivered shares are sold, but never reclasses the call", () => {
    const report = buildJournals([
      ...covers(),
      option({ ...CALL, quantity: -2, price: 0.5, when: D3 }),
      stock({ quantity: -200, price: 18, when: "2026-08-21T15:00:00.000Z" }),
      option({ ...CALL, strike: 21, quantity: -1, price: 0.3, when: "2026-08-22T15:00:00.000Z" }),
    ]);
    expect(placed(report, "flex:trade:5")).toEqual({ "flex:trade:5#1": "wheel:-2" });
    // Aw = 0 now, Lw = 1: the new sale is a LEAPS call.
    expect(placed(report, "flex:trade:7")).toEqual({ "flex:trade:7#1": "leaps:-1" });
  });
});

describe("classifyOpenings — same-instant legs", () => {
  it("sends the legs of a two-leg spread to Others, one row each", () => {
    const report = buildJournals([option({ ...PUT, quantity: -1, price: 0.3, when: D1 }), option({ ...PUT, strike: 15, quantity: 1, price: 0.1, when: D1 })]);
    expect(placed(report, "flex:trade:1")).toEqual({ "flex:trade:1#1": "others:-1" });
    expect(placed(report, "flex:trade:2")).toEqual({ "flex:trade:2#1": "others:1" });
  });

  it("does not take two fills of the same contract for a spread: they are one Wheel line", () => {
    const report = buildJournals([option({ ...PUT, quantity: -1, price: 0.3, when: D1 }), option({ ...PUT, quantity: -1, price: 0.3, when: D1 })]);
    expect(placed(report, "flex:trade:1")).toEqual({ "flex:trade:1#1": "wheel:-2" });
    expect(placed(report, "flex:trade:2")).toEqual({});
  });

  it("does not take a LEAPS and a call sold the same day on another expiry for a spread", () => {
    const report = buildJournals([option({ ...LEAPS, quantity: 1, price: 3, when: D1 }), option({ ...CALL, quantity: -1, price: 0.5, when: D1 })]);
    expect(placed(report, "flex:trade:1")).toEqual({ "flex:trade:1#1": "leaps:1" });
    expect(placed(report, "flex:trade:2")).toEqual({ "flex:trade:2#1": "leaps:-1" });
  });

  it("covers a call sold with the LEAPS of the same instant even when the sale is the first transaction", () => {
    const report = buildJournals([option({ ...CALL, id: "flex:trade:1", quantity: -1, price: 0.5, when: D1 }), option({ ...LEAPS, id: "flex:trade:2", quantity: 1, price: 3, when: D1 })]);
    expect(placed(report, "flex:trade:2")).toEqual({ "flex:trade:2#1": "leaps:1" });
    expect(placed(report, "flex:trade:1")).toEqual({ "flex:trade:1#1": "leaps:-1" });
  });
});
