import { beforeEach, describe, expect, it } from "vitest";
import { tx } from "../fixtures.ts";
import type { Transaction } from "../types.ts";
import { deliver, expire, option, resetIds, settlement, stock } from "./fixtures.ts";
import { pairCorporateActions } from "./corporate.ts";
import { buildIdentities, NO_IDENTITIES } from "./identities.ts";
import { buildJournals, deliverySign, sortRows } from "./replay.ts";
import type { JournalRow, JournalsReport } from "./types.ts";

beforeEach(resetIds);

function row(report: JournalsReport, id: string): JournalRow {
  const found = report.rows.find((r) => r.id === id);
  if (!found) throw new Error(`no row ${id} among ${report.rows.map((r) => r.id).join(", ")}`);
  return found;
}

const D1 = "2026-08-01T14:30:00.000Z";
const D2 = "2026-08-10T15:00:00.000Z";
const PUT = { right: "P" as const, strike: 17, expiry: "2026-10-02" };

describe("deliverySign", () => {
  it("buys on a short put or a long call, sells on a short call or a long put", () => {
    expect(deliverySign("P", -1)).toBe(1);
    expect(deliverySign("C", -1)).toBe(-1);
    expect(deliverySign("C", 1)).toBe(1);
    expect(deliverySign("P", 1)).toBe(-1);
  });
});

describe("buildJournals — lots and buybacks", () => {
  it("splits a lot bought back in part: one closed row, one open row, pro rata", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -4, price: 0.21, when: D1 }),
      option({ ...PUT, quantity: 2, price: 0.05, when: D2 }),
    ]);
    expect(report.rows.map((r) => r.id)).toEqual(["flex:trade:1#1", "flex:trade:1#2"]);
    expect(row(report, "flex:trade:1#1")).toMatchObject({
      kind: "short_put", quantity: -2, openPrice: 0.21, openTotal: 42, openCommission: -0.5, openNet: 41.5,
      endWhen: D2, closePrice: 0.05, closeTotal: -10, closeCommission: -1, closeNet: -11, pnl: 30.5,
      event: "buyback", ongoing: false, closeIds: ["flex:trade:2"],
    });
    expect(row(report, "flex:trade:1#2")).toMatchObject({ quantity: -2, openTotal: 42, endWhen: null, pnl: null, ongoing: true, event: null });
  });

  it("closes the oldest lot first and prorates one closing trade over the lots it touches", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -2, price: 0.2, when: D1 }),
      option({ ...PUT, quantity: -2, price: 0.3, when: "2026-08-05T14:30:00.000Z" }),
      option({ ...PUT, quantity: 4, price: 0.1, when: D2, commission: -2 }),
    ]);
    expect(row(report, "flex:trade:1#1")).toMatchObject({ closeTotal: -20, closeCommission: -1, pnl: 40 - 1 - 21 });
    expect(row(report, "flex:trade:2#1")).toMatchObject({ closeTotal: -20, closeCommission: -1, pnl: 60 - 1 - 21 });
  });

  it("opens the excess of a closing trade as a new lot on the other side", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -1, price: 0.2, when: D1 }),
      option({ ...PUT, quantity: 3, price: 0.1, when: D2 }),
    ]);
    // `-3 * 0.1 * 100` is not exact in binary floating point (-30.000000000000004): the
    // pro-rata openTotal inherits that noise, so it is compared with closeTo like openCommission.
    expect(row(report, "flex:trade:2#1")).toMatchObject({ kind: "long_put", quantity: 2, openTotal: expect.closeTo(-20), openCommission: expect.closeTo(-2 / 3), ongoing: true, orphan: false });
  });

  it("sells a long lot: event sold", () => {
    const report = buildJournals([
      option({ right: "C", strike: 20, expiry: "2027-01-15", quantity: 1, price: 3, when: D1 }),
      option({ right: "C", strike: 20, expiry: "2027-01-15", quantity: -1, price: 4, when: D2 }),
    ]);
    expect(row(report, "flex:trade:1#1")).toMatchObject({ kind: "long_call", quantity: 1, openTotal: -300, closeTotal: 400, pnl: 98, event: "sold" });
  });
});

describe("buildJournals — sliced orders", () => {
  const T0 = "2026-06-16T10:16:51.000Z";
  const at = (seconds: number) => new Date(Date.parse(T0) + seconds * 1000).toISOString();

  it("shows one line for a sale filled in two slices a second apart, at the averaged price", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -1, price: 0.2, when: T0 }),
      option({ ...PUT, quantity: -1, price: 0.21, when: at(1) }),
    ]);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      kind: "short_put",
      startWhen: T0,
      quantity: -2,
      openPrice: expect.closeTo(0.205),
      openTotal: expect.closeTo(41),
      openCommission: -2,
      ongoing: true,
      openIds: ["flex:trade:1", "flex:trade:2"],
    });
  });

  it("closes a lot in one row when its buyback is reported over three lines", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -3, price: 0.2, when: D1 }),
      option({ ...PUT, quantity: 1, price: 0.05, when: D2 }),
      option({ ...PUT, quantity: 1, price: 0.06, when: `${D2.slice(0, 19)}.500Z` }),
      option({ ...PUT, quantity: 1, price: 0.07, when: "2026-08-10T15:00:01.000Z" }),
    ]);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      quantity: -3,
      endWhen: D2,
      closePrice: expect.closeTo(0.06),
      closeTotal: expect.closeTo(-18),
      closeCommission: -3,
      event: "buyback",
      ongoing: false,
      closeIds: ["flex:trade:2", "flex:trade:3", "flex:trade:4"],
    });
  });

  it("still sees a condor when one of its legs was filled in two slices", () => {
    const SPY = { ticker: "SPY", expiry: "2026-08-29" };
    const report = buildJournals([
      option({ ...SPY, right: "P", strike: 620, quantity: 2, price: 0.3, when: T0 }),
      option({ ...SPY, right: "P", strike: 625, quantity: -2, price: 0.6, when: T0 }),
      option({ ...SPY, right: "C", strike: 660, quantity: -2, price: 0.5, when: T0 }),
      option({ ...SPY, right: "C", strike: 665, quantity: 1, price: 0.4, when: T0 }),
      option({ ...SPY, right: "C", strike: 665, quantity: 1, price: 0.2, when: at(1) }),
    ]);
    expect(report.rows.map((r) => r.strategy)).toEqual(["condors"]);
    expect(report.rows[0]).toMatchObject({ label: "SPY Aug29'26 IC 620/625/660/665", quantity: -2 });
  });
});

describe("buildJournals — expiry, assignment, exercise", () => {
  it("reads an expiry from a price-0 uncharged close with no delivery", () => {
    const report = buildJournals([option({ ...PUT, quantity: -1, price: 0.3, when: D1 }), expire({ ...PUT, quantity: 1 })]);
    expect(row(report, "flex:trade:1#1")).toMatchObject({
      endWhen: "2026-10-02T20:00:00.000Z", closePrice: 0, closeTotal: 0, closeCommission: null, closeNet: 0, pnl: 29, event: "expired", assigned: false, ongoing: false,
    });
  });

  it("reads an assignment from the share delivery at the strike, and keeps the put ongoing until the shares are sold", () => {
    const report = buildJournals([option({ ...PUT, quantity: -2, price: 0.21, when: D1 }), ...deliver({ ...PUT, quantity: 2 })]);
    expect(row(report, "flex:trade:1#1")).toMatchObject({ event: "assigned", assigned: true, closePrice: 0, closeTotal: 0, pnl: 41, ongoing: true, closeIds: ["flex:trade:2"] });
    expect(row(report, "flex:trade:3#1")).toEqual({
      id: "flex:trade:3#1",
      strategy: "wheel",
      kind: "shares",
      ticker: "MQZA",
      label: "MQZA",
      currency: "USD",
      contract: { ticker: "MQZA", secType: "STK", right: "", strike: null, expiry: null, currency: "USD" },
      startWhen: "2026-10-02T20:00:00.000Z",
      quantity: 200,
      strike: null,
      openPrice: 17,
      openTotal: -3400,
      openCommission: 0,
      openNet: -3400,
      assigned: true,
      endWhen: null,
      closePrice: null,
      closeTotal: null,
      closeCommission: null,
      closeNet: null,
      pnl: null,
      ongoing: true,
      event: null,
      orphan: false,
      note: null,
      openIds: ["flex:trade:3"],
      closeIds: [],
    });
  });

  it("closes the put's ongoing flag once the delivered shares are sold, with the shares' own pnl", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -2, price: 0.21, when: D1 }),
      ...deliver({ ...PUT, quantity: 2 }),
      stock({ quantity: -200, price: 18, when: "2026-10-10T15:00:00.000Z" }),
    ]);
    expect(row(report, "flex:trade:1#1").ongoing).toBe(false);
    expect(row(report, "flex:trade:3#1")).toMatchObject({ endWhen: "2026-10-10T15:00:00.000Z", closePrice: 18, closeTotal: 3600, closeCommission: -1, pnl: 199, event: "sold", ongoing: false });
  });

  it("is called away: the short call is assigned and the delivered shares are sold at the strike", () => {
    const CALL = { right: "C" as const, strike: 20, expiry: "2026-11-20" };
    const report = buildJournals([
      option({ ...PUT, quantity: -1, price: 0.21, when: D1 }),
      ...deliver({ ...PUT, quantity: 1 }),
      option({ ...CALL, quantity: -1, price: 0.5, when: "2026-10-05T14:30:00.000Z" }),
      ...deliver({ ...CALL, quantity: 1 }),
    ]);
    expect(row(report, "flex:trade:4#1")).toMatchObject({ kind: "short_call", event: "assigned", assigned: true, pnl: 49, ongoing: false });
    expect(row(report, "flex:trade:3#1")).toMatchObject({ kind: "shares", closePrice: 20, closeTotal: 2000, closeCommission: 0, pnl: 300, event: "sold", ongoing: false });
    expect(row(report, "flex:trade:1#1").ongoing).toBe(false);
  });

  it("reads an exercise on a long call: shares bought at the strike", () => {
    const CALL = { right: "C" as const, strike: 20, expiry: "2027-01-15" };
    const report = buildJournals([option({ ...CALL, quantity: 1, price: 3, when: D1 }), ...deliver({ ...CALL, quantity: -1 })]);
    expect(row(report, "flex:trade:1#1")).toMatchObject({ event: "exercised", assigned: true, pnl: -301, ongoing: true });
    expect(row(report, "flex:trade:3#1")).toMatchObject({ strategy: "leaps", kind: "shares", quantity: 100, openPrice: 20, openTotal: -2000, assigned: true });
  });

  it("delivers beyond the shares held: the excess is a short share lot in Others", () => {
    const CALL = { right: "C" as const, strike: 20, expiry: "2026-11-20" };
    const report = buildJournals([
      stock({ quantity: 100, price: 15, when: D1 }),
      option({ ...CALL, quantity: -2, price: 0.5, when: D2 }),
      ...deliver({ ...CALL, quantity: 2 }),
    ]);
    // The single contract the shares can back is taken over into the Wheel at the
    // call's sale, so this lot is closed by the takeover, not by the delivery.
    expect(row(report, "flex:trade:1#1")).toMatchObject({ kind: "shares", assigned: false, closePrice: 20, closeTotal: 2000, event: "integrated" });
    // The lot the takeover reopened in the Wheel is what the delivery actually
    // sells: taken over and sold at the same strike, no money made or lost.
    expect(row(report, "flex:trade:1.2#1")).toMatchObject({
      strategy: "wheel",
      kind: "shares",
      quantity: 100,
      closePrice: 20,
      pnl: 0,
      event: "sold",
      ongoing: false,
    });
    expect(row(report, "flex:trade:4#1")).toMatchObject({ kind: "short_shares", strategy: "others", quantity: -100, openPrice: 20, assigned: true, ongoing: true });
  });

  it("serves one delivery to two lots of the same contract, FIFO", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -2, price: 0.2, when: D1 }),
      option({ ...PUT, quantity: -2, price: 0.3, when: D2 }),
      ...deliver({ ...PUT, quantity: 4 }),
    ]);
    expect(row(report, "flex:trade:1#1")).toMatchObject({ event: "assigned", quantity: -2 });
    expect(row(report, "flex:trade:2#1")).toMatchObject({ event: "assigned", quantity: -2 });
    expect(row(report, "flex:trade:4#1")).toMatchObject({ kind: "shares", quantity: 200, openTotal: -3400 });
    expect(row(report, "flex:trade:4.2#1")).toMatchObject({ kind: "shares", quantity: 200, openTotal: -3400 });
  });

  it("treats a stock trade at the strike but at another instant as an ordinary purchase", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -1, price: 0.3, when: D1 }),
      expire({ ...PUT, quantity: 1 }),
      stock({ quantity: 100, price: 17, when: "2026-10-03T14:30:00.000Z" }),
    ]);
    expect(row(report, "flex:trade:1#1").event).toBe("expired");
    expect(row(report, "flex:trade:3#1")).toMatchObject({ kind: "shares", assigned: false, orphan: false });
  });

  it("does not split one delivery between two contracts colliding on the same pool key: the short-closing claim is served, the long-closing one finds nothing and expires", () => {
    // A short put and a long call at the same ticker, strike and expiry-instant share one
    // poolKey (ticker|currency|strike|sign): only the put's assignment actually delivers
    // shares, so the call must be read as an ordinary worthless expiry, not a fabricated
    // 50/50 split of the put's delivery.
    const CALL = { right: "C" as const, strike: 17, expiry: "2026-10-02" };
    const report = buildJournals([
      option({ ...PUT, quantity: -1, price: 0.21, when: D1 }),
      option({ ...CALL, quantity: 1, price: 0.5, when: D1 }),
      ...deliver({ ...PUT, quantity: 1 }),
      expire({ ...CALL, quantity: -1 }),
    ]);
    expect(row(report, "flex:trade:1#1")).toMatchObject({ kind: "short_put", event: "assigned", assigned: true });
    expect(row(report, "flex:trade:4#1")).toMatchObject({ kind: "shares", quantity: 100, assigned: true, openIds: ["flex:trade:4"] });
    expect(row(report, "flex:trade:2#1")).toMatchObject({ kind: "long_call", event: "expired", assigned: false });
  });

  it("does not let a commissioned market purchase join the delivery pool: it keeps its own row and commission, and the delivered lot's ratio is not corrupted", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -1, price: 0.21, when: D1 }),
      ...deliver({ ...PUT, quantity: 1 }),
      stock({ quantity: 100, price: 17, when: "2026-10-02T20:00:00.000Z", commission: -1 }),
    ]);
    expect(row(report, "flex:trade:3#1")).toMatchObject({
      kind: "shares", quantity: 100, openTotal: -1700, openCommission: 0, assigned: true, openIds: ["flex:trade:3"],
    });
    expect(row(report, "flex:trade:4#1")).toMatchObject({
      kind: "shares", quantity: 100, openTotal: -1700, openCommission: -1, assigned: false, orphan: false, openIds: ["flex:trade:4"],
    });
  });
});

describe("buildJournals — cash settlement", () => {
  const XSP = { ticker: "XSP", right: "P" as const, strike: 640, expiry: "2026-09-18" };

  it("takes the settlement's cash as the final total of the price-0 close of the same day", () => {
    const report = buildJournals([
      option({ ...XSP, quantity: -1, price: 2, when: D1 }),
      expire({ ...XSP, quantity: 1, when: "2026-09-18T20:00:00.000Z" }),
      settlement({ ...XSP, amount: -150, when: "2026-09-18T00:00:00.000Z" }),
    ]);
    expect(row(report, "flex:trade:1#1")).toMatchObject({ event: "assigned", closeTotal: -150, closeCommission: null, pnl: 199 - 150, closeIds: ["flex:trade:2", "html:3"], ongoing: false });
    expect(report.rows).toHaveLength(1);
  });

  it("keeps an unclaimed settlement as a bare Others row", () => {
    const report = buildJournals([settlement({ ...XSP, amount: -150, when: "2026-09-18T00:00:00.000Z" })]);
    expect(report.rows).toEqual([
      expect.objectContaining({ id: "html:1", strategy: "others", kind: "settlement", label: "XSP Sep18'26 640 Put", quantity: null, strike: 640, openTotal: -150, pnl: -150, orphan: true, ongoing: false, note: { code: "truncatedHistory" } }),
    ]);
  });
});

describe("buildJournals — orphans and scope", () => {
  it("flags a price-0 close that finds no lot as an orphan opening in Others", () => {
    const report = buildJournals([expire({ ...PUT, quantity: 1 })]);
    expect(row(report, "flex:trade:1#1")).toMatchObject({ strategy: "others", kind: "long_put", quantity: 1, orphan: true, ongoing: true });
    expect(report.reconciliation.orphans.map((r) => r.id)).toEqual(["flex:trade:1#1"]);
  });

  it("flags a delivery no settlement claimed: the option's own close found no lot either", () => {
    const report = buildJournals([expire({ ...PUT, quantity: 1 }), stock({ quantity: 100, price: 17, when: "2026-10-02T20:00:00.000Z", commission: 0 })]);
    expect(row(report, "flex:trade:1#1")).toMatchObject({ kind: "long_put", orphan: true });
    expect(row(report, "flex:trade:2#1")).toMatchObject({ kind: "shares", quantity: 100, assigned: false, orphan: true });
    expect(report.reconciliation.orphans).toHaveLength(2);
  });

  it("ignores everything that is not a share or option trade", () => {
    const report = buildJournals([
      tx({ externalId: "flex:cash:1", kind: "dividend", symbol: "MQZA", secType: "STK", quantity: null, amount: 12 }),
      tx({ externalId: "flex:trade:9", symbol: "EUR.USD", secType: "CASH", quantity: 1000, price: 1.08, amount: -1080 }),
      tx({ externalId: "flex:trade:10", symbol: "WRT", secType: "WAR", quantity: 10, price: 1, amount: -10 }),
    ]);
    expect(report.rows).toEqual([]);
  });

  it("orders rows by opening instant descending, then id — two lots of the same day by their hour", () => {
    const rows = sortRows([
      { id: "b#1", startWhen: "2026-08-01T14:30:00.000Z" } as JournalRow,
      { id: "a#1", startWhen: "2026-08-01T14:30:00.000Z" } as JournalRow,
      { id: "d#1", startWhen: "2026-08-01T19:00:00.000Z" } as JournalRow,
      { id: "c#1", startWhen: "2026-09-01T14:30:00.000Z" } as JournalRow,
    ]);
    expect(rows.map((r) => r.id)).toEqual(["c#1", "d#1", "a#1", "b#1"]);
  });
});

describe("buildJournals — snapshot boundary", () => {
  const snapshot = (asOf: string) => ({
    asOf,
    positions: [
      { symbol: "MQZA", secType: "OPT", right: "P" as const, strike: 17, expiry: "2026-10-02", multiplier: 100, quantity: -1, avgPrice: 0.3, marketPrice: 0.1, marketValue: -10, unrealizedPnl: 20, currency: "USD", conid: "", description: "" },
    ],
  });
  const ledger = () => [
    option({ ...PUT, quantity: -1, price: 0.3, when: D1 }),
    option({ ...PUT, quantity: 1, price: 0.1, when: "2026-09-03T14:30:00.000Z" }),
  ];

  it("compares the lots open at the end of the snapshot's day: the next day's buyback is not counted", () => {
    const report = buildJournals(ledger(), snapshot("2026-09-02"));
    expect(report.reconciliation).toEqual({ asOf: "2026-09-02", differences: [], orphans: [] });
    // The journals themselves replay everything: the put is closed.
    expect(row(report, "flex:trade:1#1").ongoing).toBe(false);
  });

  it("compares at the instant of an agent snapshot", () => {
    expect(buildJournals(ledger(), snapshot("2026-09-03T14:00:00.000Z")).reconciliation.differences).toEqual([]);
    expect(buildJournals(ledger(), snapshot("2026-09-03T15:00:00.000Z")).reconciliation.differences).toEqual([
      expect.objectContaining({ label: "MQZA Oct02'26 17 Put", ledgerQty: 0, snapshotQty: -1 }),
    ]);
  });

  it("has no asOf and no difference without a snapshot, but still lists the orphans", () => {
    const report = buildJournals([expire({ ...PUT, quantity: 1 })]);
    expect(report.reconciliation.asOf).toBeNull();
    expect(report.reconciliation.orphans).toHaveLength(1);
  });
});

describe("buildJournals and corporate actions", () => {
  const CONVERSION = "TESTV(US9228000000) CUSIP/ISIN Change to (US7411000000)";

  function caLeg(symbol: string, quantity: number, when: string): Transaction {
    return {
      accountId: "test", externalId: `html:${symbol}${quantity}`, source: "statement_html",
      kind: "corporate_action", symbol, secType: "STK", right: "", strike: null, expiry: null,
      quantity, price: null, amount: 0, commission: null, currency: "USD", when,
      description: `${CONVERSION} (${symbol}, NAME, US0000000000)`,
    };
  }

  it("converts the position instead of leaving it stranded", () => {
    const report = buildJournals([
      stock({ ticker: "TESTV", quantity: 114, price: 9.85, when: "2022-09-06T13:30:00.000Z" }),
      caLeg("TESTP", 114, "2022-09-21T20:25:00.000Z"),
      caLeg("TESTV.OLD", -114, "2022-09-21T20:25:00.000Z"),
      stock({ ticker: "TESTP", quantity: -114, price: 0.004, when: "2024-10-08T15:42:52.000Z" }),
    ]);
    // One line, opened as TESTV, closed as TESTP. No ghost short.
    expect(report.rows.filter((r) => r.ongoing)).toEqual([]);
    expect(report.rows.map((r) => r.label)).toEqual(["TESTP"]);
  });

  it("applies the action before the trades of its own instant", () => {
    // A 1-for-30 split leaves 0.3333 of a share, sold as an ordinary trade at
    // the very instant of the split. Applied the other way round, that sale
    // would open a short.
    const report = buildJournals([
      stock({ ticker: "ZXAC", quantity: 1600, price: 0.661, when: "2023-08-02T13:30:04.000Z" }),
      { ...caLeg("ZXAC", 53.3333, "2023-12-26T20:25:00.000Z"), description: "ZXAC(US0000000000) Split 1 for 30 (ZXAC, NAME, US1111111111)" },
      { ...caLeg("ZXAC.OLD", -1600, "2023-12-26T20:25:00.000Z"), description: "ZXAC(US0000000000) Split 1 for 30 (ZXAC.OLD, NAME, US0000000000)" },
      stock({ ticker: "ZXAC", quantity: -0.3333, price: 2.22, when: "2023-12-26T20:25:00.000Z" }),
    ]);
    const [ongoing] = report.rows.filter((r) => r.ongoing);
    expect(ongoing.quantity).toBeCloseTo(53, 4);
    expect(report.rows.every((r) => r.kind !== "short_shares")).toBe(true);
  });

  it("captures the snapshot boundary before events past it are applied", () => {
    // The purchase and the snapshot both come well before the split; a trade
    // long after the split must not let the split leak into what the
    // snapshot's own instant saw.
    const report = buildJournals(
      [
        stock({ ticker: "TESTV", quantity: 114, price: 9.85, when: "2022-09-06T13:30:00.000Z" }),
        caLeg("TESTP", 114, "2022-09-21T20:25:00.000Z"),
        caLeg("TESTV.OLD", -114, "2022-09-21T20:25:00.000Z"),
        stock({ ticker: "TESTP", quantity: -114, price: 0.004, when: "2024-10-08T15:42:52.000Z" }),
      ],
      {
        asOf: "2022-09-10",
        positions: [
          { symbol: "TESTV", secType: "STK", right: "", strike: null, expiry: null, multiplier: null, quantity: 114, avgPrice: 9.85, marketPrice: null, marketValue: null, unrealizedPnl: null, currency: "USD", conid: "", description: "" },
        ],
      },
    );
    expect(report.reconciliation.differences).toEqual([]);
  });

  it("puts a converted lot back in FIFO order, so the next sale realizes the right P/L", () => {
    // AAA bought first at 1, BBB bought later at 5, then AAA converts 1:1 into
    // BBB. The converted lot is the older of the two and FIFO must consume it
    // first; appending it behind the market lot sells the wrong shares and
    // prints the wrong P/L.
    const report = buildJournals([
      stock({ ticker: "AAA", quantity: 100, price: 1, when: "2023-01-02T13:30:00.000Z" }),
      stock({ ticker: "BBB", quantity: 100, price: 5, when: "2023-03-02T13:30:00.000Z" }),
      caLeg("AAA", -100, "2023-06-01T20:25:00.000Z"),
      caLeg("BBB", 100, "2023-06-01T20:25:00.000Z"),
      stock({ ticker: "BBB", quantity: -100, price: 7, when: "2023-09-01T13:30:00.000Z" }),
    ]);
    const closed = report.rows.filter((r) => !r.ongoing);
    expect(closed.map((r) => [r.openPrice, r.startWhen, r.pnl])).toEqual([[1, "2023-01-02T13:30:00.000Z", 598]]);
  });

  it("resolves the leg an action takes out of the book under its pre-event name", () => {
    // "TTT" names conid 1 before the event and conid 2 after it, and rule 4
    // hands the *after* name to the event's own instant, bounds included.
    // That is right for the incoming leg and wrong for the outgoing one,
    // whose lots sit under the before-name: resolving it at `when` would
    // convert a contract nobody holds and reopen the ghost short.
    const legs = [
      caLeg("TTT", -100, "2023-06-01T20:25:00.000Z"),
      caLeg("UUU", 100, "2023-06-01T20:25:00.000Z"),
    ];
    const identities = buildIdentities(
      [
        { conid: "1", secType: "STK", isin: "", aliases: [{ ticker: "TTT", firstSeen: "2022-01-01", lastSeen: "2022-12-31" }] },
        { conid: "2", secType: "STK", isin: "", aliases: [
          { ticker: "TTT", firstSeen: "2023-01-01", lastSeen: "2023-12-31" },
          { ticker: "UUU", firstSeen: "2024-01-01", lastSeen: "2024-12-31" },
        ] },
      ],
      pairCorporateActions(legs).events,
    );
    const report = buildJournals(
      [stock({ ticker: "TTT", quantity: 100, price: 1, when: "2022-06-01T13:30:00.000Z" }), ...legs],
      undefined,
      identities,
    );
    expect(identities.issues).toEqual([]);
    expect(report.rows.map((r) => [r.label, r.kind, r.quantity, r.ongoing])).toEqual([["UUU", "shares", 100, true]]);
  });

  it("renames a ticker the identities table says is the same contract", () => {
    const identities = buildIdentities([
      { conid: "1", secType: "STK", isin: "", aliases: [
        { ticker: "ZXAB", firstSeen: "2022-01-01", lastSeen: "2022-12-31" },
        { ticker: "ZXABQ", firstSeen: "2023-01-01", lastSeen: "2023-12-31" },
      ] },
    ]);
    const report = buildJournals([
      stock({ ticker: "ZXAB", quantity: 220, price: 1.51, when: "2022-10-20T13:30:00.000Z" }),
      stock({ ticker: "ZXABQ", quantity: -220, price: 0.029, when: "2023-05-26T15:50:21.000Z" }),
    ], undefined, identities);
    expect(report.rows.filter((r) => r.ongoing)).toEqual([]);
    expect(report.rows.map((r) => r.label)).toEqual(["ZXABQ"]);
  });

  it("renames an option contract IB respelled without changing its conid", () => {
    // ZXAG became ZXAF on 2026-04-03 without IB ever touching the option:
    // conid 900000109 kept its lots and merely changed spelling, so there is
    // no corporate action to replay — only one contract wearing two names.
    const identities = buildIdentities([
      { conid: "900000109", secType: "OPT", isin: "", aliases: [
        { ticker: "ZXAG  270115C00002500", firstSeen: "2025-09-09", lastSeen: "2026-09-09" },
        { ticker: "ZXAF  270115C00002500", firstSeen: "2025-09-09", lastSeen: "2026-09-09" },
      ] },
    ]);
    const call = { right: "C" as const, strike: 2.5, expiry: "2027-01-15" };
    const report = buildJournals([
      option({ ...call, ticker: "ZXAG  270115C00002500", quantity: 14, price: 0.5, when: "2026-03-04T13:06:53.000Z" }),
      option({ ...call, ticker: "ZXAF  270115C00002500", quantity: -14, price: 0.9, when: "2026-05-21T12:07:48.000Z" }),
    ], undefined, identities);
    expect(report.rows.filter((r) => r.ongoing)).toEqual([]);
    expect(report.rows.map((r) => r.label)).toEqual(["ZXAF Jan15'27 2.5 Call"]);
  });

  it("leaves an option named by its underlying alone, even when that stock is renamed", () => {
    // The agent names an option "ZXAB", the stock's own ticker. Renaming the
    // option because the *stock* was renamed is a different rule than this
    // one, with no real data behind it yet: only a spelling of the option
    // itself moves an option.
    const identities = buildIdentities([
      { conid: "1", secType: "STK", isin: "", aliases: [
        { ticker: "ZXAB", firstSeen: "2022-01-01", lastSeen: "2022-12-31" },
        { ticker: "ZXABQ", firstSeen: "2023-01-01", lastSeen: "2023-12-31" },
      ] },
    ]);
    const report = buildJournals([
      option({ right: "C", strike: 1, expiry: "2023-06-16", ticker: "ZXAB", quantity: -2, price: 0.3, when: "2022-10-20T13:30:00.000Z" }),
    ], undefined, identities);
    expect(report.rows.map((r) => r.label)).toEqual(["ZXAB Jun16'23 1 Call"]);
  });

  it("without identities, behaves exactly as it did: two contracts, two rows", () => {
    const transactions = [
      stock({ ticker: "ZXAB", quantity: 220, price: 1.51, when: "2022-10-20T13:30:00.000Z" }),
      stock({ ticker: "ZXABQ", quantity: -220, price: 0.029, when: "2023-05-26T15:50:21.000Z" }),
    ];
    expect(buildJournals(transactions)).toEqual(buildJournals(transactions, undefined, NO_IDENTITIES));
    expect(buildJournals(transactions).rows.filter((r) => r.ongoing)).toHaveLength(2);
  });

  it("replays a cash and stock merger end to end", () => {
    const MERGER = "TESTH(CA4083000000) Cash and Stock Merger (Acquisition) CA2257000000 534 FOR 1000 AND USD 11.75236923";
    const leg = (symbol: string, quantity: number, amount: number, realizedPnl: number | null): Transaction => ({
      accountId: "test", externalId: `html:${symbol}`, source: "statement_html", kind: "corporate_action",
      symbol, secType: "STK", right: "", strike: null, expiry: null, quantity, price: null, amount,
      commission: null, currency: "USD", when: "2023-12-28T20:25:00.000Z",
      description: `${MERGER} (${symbol}, NAME, CA0000000000)`, realizedPnl,
    });
    const report = buildJournals([
      stock({ ticker: "TESTH", quantity: 120, price: 12.500, when: "2023-11-03T14:40:39.000Z" }),
      leg("TESTC", 64.08, 0, 0),
      leg("TESTH", -120, 1290.40, 180.40),
      stock({ ticker: "TESTC", quantity: -64.08, price: 7.06, when: "2024-01-02T17:57:48.000Z" }),
    ]);
    expect(report.rows.filter((r) => r.ongoing)).toEqual([]);
    const merger = report.rows.find((r) => r.event === "corporate_action")!;
    expect(merger.pnl).toBeCloseTo(180.40, 6);
  });

  it("keeps the Wheel part of a cut ahead of its remainder through a conversion", () => {
    // 400 of 500 shares taken over by 4 calls, the calls bought back, then a 1-for-1
    // CUSIP change. The taken part opens the day of the call, the remainder keeps the
    // purchase date: sorted by openWhen, the remainder would jump ahead and the plain
    // sale that follows would sell it instead of the Wheel shares ranked before it.
    const CALL = { ticker: "TESTV", right: "C" as const, strike: 20, expiry: "2025-03-21" };
    const report = buildJournals([
      stock({ ticker: "TESTV", quantity: 500, price: 10, when: "2025-01-02T14:30:00.000Z" }),
      option({ ...CALL, quantity: -4, price: 0.5, when: "2025-02-03T14:30:00.000Z" }),
      option({ ...CALL, quantity: 4, price: 0.1, when: "2025-02-10T14:30:00.000Z" }),
      caLeg("TESTP", 500, "2025-02-20T20:25:00.000Z"),
      caLeg("TESTV.OLD", -500, "2025-02-20T20:25:00.000Z"),
      stock({ ticker: "TESTP", quantity: -100, price: 12, when: "2025-03-03T14:30:00.000Z" }),
    ]);
    const open = (strategy: string) =>
      report.rows.filter((r) => r.kind === "shares" && r.strategy === strategy && r.endWhen === null).reduce((n, r) => n + (r.quantity ?? 0), 0);
    expect(open("wheel")).toBe(300);
    expect(open("others")).toBe(100);
  });

  const openSharesOf = (report: JournalsReport, strategy: string) =>
    report.rows.filter((r) => r.kind === "shares" && r.strategy === strategy && r.endWhen === null).reduce((n, r) => n + (r.quantity ?? 0), 0);

  it("replays the chronology of spec 17 §2.1: 500 in the Wheel, 5 in Others", () => {
    const t = "ABC";
    const put = (strike: number, expiry: string) => ({ ticker: t, right: "P" as const, strike, expiry });
    const call = { ticker: t, right: "C" as const, strike: 13.5, expiry: "2025-10-31" };
    const exit = "2025-10-01T14:19:06.000Z";
    const report = buildJournals([
      stock({ ticker: t, quantity: 140, price: 10.9, when: "2023-12-14T18:25:27.000Z" }),
      stock({ ticker: t, quantity: -35, price: 17.5, when: "2024-02-16T14:30:03.000Z" }),
      option({ ...put(10, "2025-03-21"), quantity: -2, price: 0.83, when: "2025-02-11T15:36:51.000Z" }),
      stock({ ticker: t, quantity: 100, price: 10.77, when: "2025-02-11T15:46:32.000Z" }),
      ...deliver({ ...put(10, "2025-03-21"), quantity: 2 }),
      stock({ ticker: t, quantity: -200, price: 10.58, when: "2025-06-25T17:52:10.000Z" }),
      option({ ...put(12, "2025-08-15"), quantity: -3, price: 0.97, when: "2025-07-14T16:09:24.000Z" }),
      option({ ...put(12, "2025-08-29"), quantity: -3, price: 1.02, when: "2025-07-24T13:41:43.000Z" }),
      ...deliver({ ...put(12, "2025-08-15"), quantity: 3 }),
      ...deliver({ ...put(12, "2025-08-29"), quantity: 2, when: "2025-08-27T20:20:00.000Z" }),
      ...deliver({ ...put(12, "2025-08-29"), quantity: 1 }),
      option({ ...call, quantity: -6, price: 0.87, when: "2025-09-18T13:52:44.000Z" }),
      option({ ...call, quantity: 6, price: 2.63, when: exit }),
      stock({ ticker: t, quantity: -600, price: 15.28, when: exit }),
      option({ ...put(19, "2025-11-28"), quantity: -3, price: 2.34, when: "2025-10-16T15:37:13.000Z" }),
      ...deliver({ ...put(19, "2025-11-28"), quantity: 3, when: "2025-11-21T21:20:00.000Z" }),
    ]);
    expect(report.rows.filter((r) => r.event === "integrated")).toEqual([]);
    expect(openSharesOf(report, "wheel")).toBe(500);
    expect(openSharesOf(report, "others")).toBe(5);
  });

  it("replays the chronology of spec 17 §2.2: nothing in the Wheel, 75 in Others", () => {
    const call = (ticker: string, expiry: string) => ({ ticker, right: "C" as const, strike: 3, expiry });
    const report = buildJournals([
      stock({ ticker: "TESTV", quantity: 800, price: 0.7, when: "2023-01-09T16:27:00.000Z" }),
      stock({ ticker: "TESTV", quantity: 500, price: 1.2, when: "2023-11-10T18:30:00.000Z" }),
      stock({ ticker: "TESTV", quantity: -325, price: 1.5, when: "2023-12-05T15:49:00.000Z" }),
      option({ ...call("TESTV", "2026-04-17"), quantity: -9, price: 0.13, when: "2026-03-04T18:08:00.000Z" }),
      option({ ...call("TESTV", "2026-04-17"), quantity: 9, price: 0.05, when: "2026-03-26T15:32:00.000Z" }),
      caLeg("TESTP", 975, "2026-04-03T20:25:00.000Z"),
      caLeg("TESTV.OLD", -975, "2026-04-03T20:25:00.000Z"),
      option({ ...call("TESTP", "2026-05-15"), quantity: -9, price: 0.27, when: "2026-04-14T14:31:01.000Z" }),
      option({ ...call("TESTP", "2026-05-15"), quantity: 7, price: 0.98, when: "2026-05-06T16:00:21.000Z" }),
      stock({ ticker: "TESTP", quantity: -700, price: 3.93, when: "2026-05-06T16:00:21.000Z" }),
      option({ ...call("TESTP", "2026-05-15"), quantity: 2, price: 0.99, when: "2026-05-06T16:01:57.000Z" }),
      stock({ ticker: "TESTP", quantity: -200, price: 3.93, when: "2026-05-06T16:01:57.000Z" }),
    ]);
    // Only the takeover of 2026-03-04, of exactly 900 shares.
    expect(report.rows.filter((r) => r.event === "integrated").reduce((n, r) => n + (r.quantity ?? 0), 0)).toBe(900);
    expect(openSharesOf(report, "wheel")).toBe(0);
    expect(openSharesOf(report, "others")).toBe(75);
  });
});

describe("buildJournals — statistics", () => {
  it("runs every strategy's months on to the ledger's last transaction, whatever its strategy", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -1, price: 0.25, when: D1 }),
      stock({ ticker: "AAPL", quantity: 1, price: 180, when: "2026-10-05T14:30:00.000Z" }),
    ]);
    expect(report.stats.wheel[0].months.map((m) => m.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
  });

  it("gives the portfolio the statistics of the three strategies at once, never Others", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -1, price: 0.25, when: D1 }),
      option({ ticker: "ZZZ", right: "C", strike: 15, expiry: "2027-06-18", quantity: 1, price: 3, when: "2026-08-04T14:30:00.000Z" }),
      option({ ticker: "ZZZ", right: "C", strike: 20, expiry: "2026-09-18", quantity: -1, price: 0.5, when: "2026-09-05T14:30:00.000Z" }),
      option({ ticker: "AAPL", right: "C", strike: 200, expiry: "2026-09-18", quantity: -1, price: 1, when: D2 }),
    ]);
    // The MQZA put nets 24 in August, the call sold on the ZZZ LEAPS 49 in September; the naked AAPL call is Others.
    expect(report.stats.portfolio).toEqual([
      { currency: "USD", total: 73, months: [{ month: "2026-08", pnl: 24 }, { month: "2026-09", pnl: 49 }], incomplete: 0 },
    ]);
    expect(report.stats.condors).toEqual([]);
    expect(report.stats.portfolio[0].total).toBe(report.stats.wheel[0].total + report.stats.leaps[0].total);
  });
});

describe("buildJournals — capital", () => {
  it("measures the Wheel's money at each month end, from the put sold to the shares still held", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -2, price: 0.25, when: "2026-08-03T14:30:00.000Z" }),
      ...deliver({ ...PUT, quantity: 2, when: "2026-09-15T20:00:00.000Z" }),
      stock({ ticker: "AAPL", quantity: 1, price: 180, when: "2026-10-05T14:30:00.000Z" }),
    ]);
    expect(report.capital.wheel).toEqual([
      {
        currency: "USD",
        months: [
          { month: "2026-08", cumulativePnl: 49, assigned: 0, putCash: 3400, leaps: 0, condors: 0, allocated: 3400, invested: 3351, returnRate: 49 / 3400 },
          { month: "2026-09", cumulativePnl: 49, assigned: 3400, putCash: 0, leaps: 0, condors: 0, allocated: 3400, invested: 3351, returnRate: 0 },
          { month: "2026-10", cumulativePnl: 49, assigned: 3400, putCash: 0, leaps: 0, condors: 0, allocated: 3400, invested: 3351, returnRate: 0 },
        ],
        exposure: [{ ticker: "MQZA", assigned: 3400, putCash: 0, leaps: 0, condors: 0 }],
        incomplete: 0,
      },
    ]);
  });

  it("measures every scope, the portfolio returning the strategies' summed P/L on their summed money", () => {
    const SPY = { ticker: "SPY", expiry: "2026-09-18" };
    const T = "2026-08-06T14:30:00.000Z";
    const report = buildJournals([
      // Wheel: a MQZA 17 put, 1,700 of cash, 24 of premium.
      option({ ...PUT, quantity: -1, price: 0.25, when: "2026-08-03T14:30:00.000Z" }),
      // LEAPS: a ZZZ call bought at 3, 300, and a call sold against it, 49 of premium.
      option({ ticker: "ZZZ", right: "C", strike: 15, expiry: "2027-06-18", quantity: 1, price: 3, when: "2026-08-04T14:30:00.000Z" }),
      option({ ticker: "ZZZ", right: "C", strike: 20, expiry: "2026-09-18", quantity: -1, price: 0.5, when: "2026-08-05T14:30:00.000Z" }),
      // Condors: wings of 5 and 10, 1,000; a credit of 75 less four commissions, 71.
      option({ ...SPY, right: "P", strike: 620, quantity: 1, price: 0.25, when: T }),
      option({ ...SPY, right: "P", strike: 625, quantity: -1, price: 0.75, when: T }),
      option({ ...SPY, right: "C", strike: 660, quantity: -1, price: 0.5, when: T }),
      option({ ...SPY, right: "C", strike: 670, quantity: 1, price: 0.25, when: T }),
      // Others: counted nowhere.
      stock({ ticker: "AAPL", quantity: 1, price: 180, when: "2026-08-07T14:30:00.000Z" }),
    ]);
    const [wheel] = report.capital.wheel[0].months;
    const [leapsMonth] = report.capital.leaps[0].months;
    const [condors] = report.capital.condors[0].months;
    expect([wheel.allocated, leapsMonth.allocated, condors.allocated]).toEqual([1700, 300, 1000]);
    expect(report.capital.portfolio).toEqual([
      {
        currency: "USD",
        months: [{ month: "2026-08", cumulativePnl: 144, assigned: 0, putCash: 1700, leaps: 300, condors: 1000, allocated: 3000, invested: 2856, returnRate: 144 / 3000 }],
        exposure: [
          { ticker: "MQZA", assigned: 0, putCash: 1700, leaps: 0, condors: 0 },
          { ticker: "SPY", assigned: 0, putCash: 0, leaps: 0, condors: 1000 },
          { ticker: "ZZZ", assigned: 0, putCash: 0, leaps: 300, condors: 0 },
        ],
        incomplete: 0,
      },
    ]);
    const summedPnl = wheel.cumulativePnl + leapsMonth.cumulativePnl + condors.cumulativePnl;
    expect(report.capital.portfolio[0].months[0].returnRate).toBe(summedPnl / (wheel.allocated + leapsMonth.allocated + condors.allocated));
  });
});

describe("buildJournals — the contract of each line", () => {
  it("carries the contract of an option, of delivered shares, of a condor composite and of a settlement", () => {
    const options = buildJournals([option({ ...PUT, quantity: -2, price: 0.21, when: D1 }), ...deliver({ ...PUT, quantity: 2 })]);
    expect(row(options, "flex:trade:1#1").contract).toEqual({ ticker: "MQZA", secType: "OPT", right: "P", strike: 17, expiry: "2026-10-02", currency: "USD" });
    expect(row(options, "flex:trade:3#1").contract).toEqual({ ticker: "MQZA", secType: "STK", right: "", strike: null, expiry: null, currency: "USD" });

    const when = "2026-08-03T14:30:00.000Z";
    const leg = (right: "C" | "P", strike: number, quantity: number) =>
      option({ ticker: "SPY", right, strike, expiry: "2026-08-29", quantity, price: 0.5, when });
    const condor = buildJournals([leg("P", 620, 1), leg("P", 625, -1), leg("C", 660, -1), leg("C", 665, 1)]);
    expect(condor.rows.find((r) => r.kind === "condor")?.contract).toEqual({
      ticker: "SPY", secType: "OPT", right: "", strike: null, expiry: "2026-08-29", currency: "USD",
    });

    const cash = buildJournals([settlement({ ticker: "SPX", right: "C", strike: 5000, expiry: "2026-08-21", amount: 150, when: "2026-08-21T00:00:00.000Z" })]);
    expect(cash.rows.find((r) => r.kind === "settlement")?.contract).toEqual({
      ticker: "SPX", secType: "OPT", right: "C", strike: 5000, expiry: "2026-08-21", currency: "USD",
    });
  });
});

describe("canonicalize on an option named by its underlying", () => {
  // A statement names an option by its underlying and puts the terms in their
  // own columns; the packed spelling below is what the same contract wears in
  // Contract Information, under one conid and two names.
  const option_tx = (symbol: string, when: string, quantity: number, price: number): Transaction => ({
    accountId: "test",
    externalId: `html:${symbol}${when}`,
    source: "statement_html",
    kind: "trade",
    symbol,
    secType: "OPT",
    right: "C",
    strike: 12.5,
    expiry: "2026-01-16",
    quantity,
    price,
    amount: -quantity * price * 100,
    commission: -1.06,
    currency: "USD",
    when,
    description: `${symbol} 16JAN26 12.5 C`,
  });

  const transactions = [
    option_tx("TSTA", "2025-03-10T10:00:00.000Z", 3, 7.33),
    option_tx("TSTA1", "2025-11-20T10:00:00.000Z", -3, 4),
  ];

  const identitiesOf = (aliases: string[]) =>
    buildIdentities([
      {
        conid: "700000010",
        secType: "OPT",
        isin: "",
        aliases: aliases.map((ticker) => ({ ticker, firstSeen: "2025-01-01", lastSeen: "2025-12-31" })),
      },
    ]);

  it("files both spellings on one contract, the canonical one", () => {
    const report = buildJournals(transactions, undefined, identitiesOf(["TSTA  260116C00012500", "TSTA1 260116C00012500"]));
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].ongoing).toBe(false);
    expect(report.rows[0].contract.ticker).toBe("TSTA1");
  });

  it("leaves both alone when no table knows them", () => {
    const report = buildJournals(transactions);
    expect(report.rows.map((row) => row.contract.ticker).sort()).toEqual(["TSTA", "TSTA1"]);
  });

  it("refuses a canonical whose terms are not the transaction's own", () => {
    // A class that spells two different contracts would move the lot onto
    // terms nobody traded: the engine keeps the name the source wrote.
    const report = buildJournals(transactions, undefined, identitiesOf(["TSTA  260116C00012500", "TSTA1 270115C00002500"]));
    expect(report.rows.map((row) => row.contract.ticker).sort()).toEqual(["TSTA", "TSTA1"]);
  });
});
