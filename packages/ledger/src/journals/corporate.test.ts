import { describe, expect, it } from "vitest";
import type { Transaction } from "../types.ts";
import { LotBook, newLot } from "./book.ts";
import { sharesContract } from "./contract.ts";
import { newContext } from "./context.ts";
import { applyConversion, applyMixedMerger, pairCorporateActions, withoutOldSuffix } from "./corporate.ts";

const CONVERSION = "TESTV(US9228000000) CUSIP/ISIN Change to (US7411000000)";
const MERGER = "TESTH(CA4083000000) Cash and Stock Merger (Acquisition) CA2257000000 534 FOR 1000 AND USD 11.75236923";

function ca(symbol: string, quantity: number, description: string, extra: Partial<Transaction> = {}): Transaction {
  return {
    accountId: "test",
    externalId: `html:${symbol}${quantity}`,
    source: "statement_html",
    kind: "corporate_action",
    symbol,
    secType: "STK",
    right: "",
    strike: null,
    expiry: null,
    quantity,
    price: null,
    amount: 0,
    commission: null,
    currency: "USD",
    when: "2025-09-21T20:25:00.000Z",
    description,
    ...extra,
  };
}

describe("pairCorporateActions on rows imported before the leg ticker was parsed", () => {
  // Those rows carry the event *prefix* on both legs, never the leg's own
  // ticker: reading `tx.symbol` alone would pair TESTV with TESTV and scale a
  // position that never existed.
  it("reads each leg's ticker from the description triple, not from the stale symbol", () => {
    const { events, issues } = pairCorporateActions([
      ca("TESTV", 680.265, `${CONVERSION} (TESTP, TEST P INC, US7411000000)`),
      ca("TESTV", -450, `${CONVERSION} (TESTV.OLD, TEST V CORP, US9228000000)`),
    ]);
    expect(issues).toEqual([]);
    expect(events[0].from).toEqual({ ticker: "TESTV.OLD", isin: "US9228000000", quantity: -450 });
    expect(events[0].to).toEqual({ ticker: "TESTP", isin: "US7411000000", quantity: 680.265 });
  });

  it("refuses a legacy pair no triple can tell apart rather than inflating the position", () => {
    const noTriple = "TESTV(US9228000000) Merged(Acquisition) 15117 FOR 10000";
    const { events, issues } = pairCorporateActions([
      ca("TESTV", 680.265, noTriple),
      ca("TESTV", -450, noTriple),
    ]);
    expect(events).toEqual([]);
    expect(issues).toEqual([
      { ticker: "TESTV", code: "action-unpaired", detail: expect.stringContaining("re-import") },
    ]);
  });

  it("still replays a legacy pair whose ratio is 1: the conversion is a no-op either way", () => {
    const noTriple = "TESTV(US9228000000) CUSIP/ISIN Change to (US7411000000) ";
    const { events, issues } = pairCorporateActions([
      ca("TESTV", 114, noTriple),
      ca("TESTV", -114, noTriple),
    ]);
    expect(issues).toEqual([]);
    expect(events[0].from.ticker).toBe("TESTV");
    expect(events[0].to.ticker).toBe("TESTV");
  });

  it("leaves the leg's ISIN empty when there is no triple to read it from", () => {
    const noTriple = "TESTV(US9228000000) CUSIP/ISIN Change to (US7411000000) ";
    const { events } = pairCorporateActions([ca("TESTV", 114, noTriple), ca("TESTV", -114, noTriple)]);
    expect(events[0].from.isin).toBe("");
    expect(events[0].to.isin).toBe("");
  });
});

describe("pairCorporateActions", () => {
  it("pairs two legs that share an instant and an event description", () => {
    const { events, issues } = pairCorporateActions([
      ca("TESTP", 114, `${CONVERSION} (TESTP, TEST P INC, US7411000000)`),
      ca("TESTV.OLD", -114, `${CONVERSION} (TESTV.OLD, TEST V CORP, US9228000000)`),
    ]);
    expect(issues).toEqual([]);
    expect(events).toEqual([
      {
        when: "2025-09-21T20:25:00.000Z",
        from: { ticker: "TESTV.OLD", isin: "US9228000000", quantity: -114 },
        to: { ticker: "TESTP", isin: "US7411000000", quantity: 114 },
        cash: null,
        ids: ["html:TESTV.OLD-114", "html:TESTP114"],
      },
    ]);
  });

  it("reads the cash leg of a mixed merger, and only of a mixed merger", () => {
    const { events } = pairCorporateActions([
      ca("TESTC", 64.08, `${MERGER} (TESTC, TEST C CORP, CA2257000000)`, { amount: 0, realizedPnl: 0 }),
      ca("TESTH", -120, `${MERGER} (TESTH, TEST H INC, CA4083000000)`, { amount: 1290.40, realizedPnl: 180.40 }),
    ]);
    expect(events[0].cash).toEqual({ amount: 1290.40, realizedPnl: 180.40 });
  });

  it("does not pair two events of the same instant with different descriptions", () => {
    const { events } = pairCorporateActions([
      ca("TESTP", 114, `${CONVERSION} (TESTP, TEST P INC, US7411000000)`),
      ca("TESTV.OLD", -114, `${CONVERSION} (TESTV.OLD, TEST V CORP, US9228000000)`),
      ca("TESTC", 64.08, `${MERGER} (TESTC, TEST C CORP, CA2257000000)`),
      ca("TESTH", -120, `${MERGER} (TESTH, TEST H INC, CA4083000000)`, { amount: 1290.40, realizedPnl: 180.40 }),
    ]);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.to.ticker).sort()).toEqual(["TESTC", "TESTP"]);
  });

  it("reports a lone leg instead of guessing its partner", () => {
    const { events, issues } = pairCorporateActions([ca("TESTX", 100, "TESTX(US0000000000) Split 2 for 1")]);
    expect(events).toEqual([]);
    expect(issues).toEqual([
      { ticker: "TESTX", code: "action-unpaired", detail: 'TESTX(US0000000000) Split 2 for 1 at 2025-09-21T20:25:00.000Z has 1 leg, expected 2' },
    ]);
  });

  it("reports two legs of the same sign instead of inventing a direction", () => {
    const { events, issues } = pairCorporateActions([
      ca("TESTP", 114, `${CONVERSION} (TESTP, TEST P INC, US7411000000)`),
      ca("TESTV.OLD", 114, `${CONVERSION} (TESTV.OLD, TEST V CORP, US9228000000)`),
    ]);
    expect(events).toEqual([]);
    expect(issues[0].code).toBe("action-unpaired");
  });

  it("ignores every transaction that is not a corporate action", () => {
    const trade = { ...ca("TESTP", 114, "whatever"), kind: "trade" as const };
    expect(pairCorporateActions([trade]).events).toEqual([]);
    expect(pairCorporateActions([trade]).issues).toEqual([]);
  });
});

describe("applyConversion", () => {
  function bookWith(ticker: string, quantity: number, openPrice: number, openAmount: number) {
    const book = new LotBook();
    book.open(newLot({
      id: "l1",
      contract: sharesContract(ticker, "USD"),
      strategy: "others",
      kind: "shares",
      openWhen: "2022-09-06T13:30:00.000Z",
      openPrice,
      openAmount,
      openCommission: -1.02,
      quantity,
      openIds: ["x1"],
    }));
    return book;
  }

  it("carries the basis over untouched and scales quantity by the ratio", () => {
    // ZXAD: 600 shares at 1.10345, 1 for 10.
    const book = bookWith("ZXAD", 600, 1.10345, -662.07);
    applyConversion(book, { when: "2023-09-04T20:25:00.000Z", from: { ticker: "ZXAD", isin: "", quantity: -600 }, to: { ticker: "ZXAD", isin: "", quantity: 60 }, cash: null, ids: [] }, "USD");
    const [lot] = book.openLots(sharesContract("ZXAD", "USD"));
    expect(lot.remaining).toBe(60);
    expect(lot.quantity).toBe(60);
    expect(lot.openAmount).toBe(-662.07);
    expect(lot.openCommission).toBe(-1.02);
    expect(lot.openPrice).toBeCloseTo(11.0345, 10);
  });

  it("keeps the lot's age: a conversion is not a purchase", () => {
    const book = bookWith("TESTV", 114, 9.85, -1122.90);
    applyConversion(book, { when: "2022-09-21T20:25:00.000Z", from: { ticker: "TESTV", isin: "", quantity: -114 }, to: { ticker: "TESTP", isin: "", quantity: 114 }, cash: null, ids: [] }, "USD");
    const [lot] = book.openLots(sharesContract("TESTP", "USD"));
    expect(lot.openWhen).toBe("2022-09-06T13:30:00.000Z");
    expect(lot.openIds).toEqual(["x1"]);
  });

  it("merges into a lot already held on the new ticker", () => {
    const book = bookWith("TESTV", 114, 9.85, -1122.90);
    book.open(newLot({
      id: "l2",
      contract: sharesContract("TESTP", "USD"),
      strategy: "others",
      kind: "shares",
      openWhen: "2022-10-18T13:30:00.000Z",
      openPrice: 2.04,
      openAmount: -408,
      openCommission: -1,
      quantity: 200,
      openIds: ["x2"],
    }));
    applyConversion(book, { when: "2022-09-21T20:25:00.000Z", from: { ticker: "TESTV", isin: "", quantity: -114 }, to: { ticker: "TESTP", isin: "", quantity: 114 }, cash: null, ids: [] }, "USD");
    expect(book.position(sharesContract("TESTP", "USD"))).toBe(314);
  });

  it("leaves a null openPrice null", () => {
    const book = bookWith("TESTV", 114, 9.85, -1122.90);
    book.openLots(sharesContract("TESTV", "USD"))[0].openPrice = null;
    applyConversion(book, { when: "2022-09-21T20:25:00.000Z", from: { ticker: "TESTV", isin: "", quantity: -114 }, to: { ticker: "TESTP", isin: "", quantity: 114 }, cash: null, ids: [] }, "USD");
    expect(book.openLots(sharesContract("TESTP", "USD"))[0].openPrice).toBeNull();
  });

  it("does nothing when the ledger never held the old contract", () => {
    const book = new LotBook();
    applyConversion(book, { when: "2022-09-21T20:25:00.000Z", from: { ticker: "TESTV", isin: "", quantity: -114 }, to: { ticker: "TESTP", isin: "", quantity: 114 }, cash: null, ids: [] }, "USD");
    expect(book.allOpen()).toEqual([]);
  });

  // ZXAC: 1600 shares split 1 for 30 into 53.3333. The ratio 53.3333/1600 is
  // not representable, so scaling alone leaves 53.33330000000001 — and the
  // sale of the fractional 0.3333 that follows turns it into
  // 53.00000000000001, which no longer equals the snapshot's 53.
  it("lands on exactly what the event brings in when it takes out the whole position", () => {
    const book = bookWith("ZXAC", 1600, 0.6125, -980.00);
    applyConversion(book, { when: "2023-12-26T20:25:00.000Z", from: { ticker: "ZXAC.OLD", isin: "", quantity: -1600 }, to: { ticker: "ZXAC", isin: "", quantity: 53.3333 }, cash: null, ids: [] }, "USD");
    expect(book.position(sharesContract("ZXAC", "USD"))).toBe(53.3333);
  });

  it("keeps the total exact when several lots convert at once", () => {
    const book = bookWith("ZXAC", 1000, 0.66, -660);
    book.open(newLot({
      id: "l2",
      contract: sharesContract("ZXAC", "USD"),
      strategy: "others",
      kind: "shares",
      openWhen: "2022-10-18T13:30:00.000Z",
      openPrice: 0.67,
      openAmount: -402,
      openCommission: -1,
      quantity: 600,
      openIds: ["x2"],
    }));
    applyConversion(book, { when: "2023-12-26T20:25:00.000Z", from: { ticker: "ZXAC.OLD", isin: "", quantity: -1600 }, to: { ticker: "ZXAC", isin: "", quantity: 53.3333 }, cash: null, ids: [] }, "USD");
    expect(book.position(sharesContract("ZXAC", "USD"))).toBe(53.3333);
  });

  it("never turns a lot short by placing the residue on it", () => {
    // A partial close whose two sides were nearly equal can leave a lot open on
    // a few 1e-15 of dust. Putting a residue of -7.1e-15 on *that* lot would
    // flip it short: the position would still add up, but the book would carry
    // a phantom short lot, and the journals a phantom ongoing row.
    const book = bookWith("ZXAC", 1600, 0.6125, -980.00);
    book.open(newLot({
      id: "dust",
      contract: sharesContract("ZXAC", "USD"),
      strategy: "others",
      kind: "shares",
      openWhen: "2023-06-01T13:30:00.000Z",
      openPrice: 0.66,
      openAmount: 0,
      openCommission: 0,
      quantity: 1e-14,
      openIds: ["x2"],
    }));
    applyConversion(book, { when: "2023-12-26T20:25:00.000Z", from: { ticker: "ZXAC.OLD", isin: "", quantity: -1600 }, to: { ticker: "ZXAC", isin: "", quantity: 53.3333 }, cash: null, ids: [] }, "USD");
    const lots = book.openLots(sharesContract("ZXAC", "USD"));
    expect(lots.map((lot) => Math.sign(lot.remaining))).toEqual([1, 1]);
    expect(book.position(sharesContract("ZXAC", "USD"))).toBe(53.3333);
  });

  it("only scales when the book holds less than the event takes out: the history is truncated", () => {
    // Half the position was bought before the ledger starts. Handing this book
    // the event's whole 53.3333 would invent 26.67 shares out of nothing.
    const book = bookWith("ZXAC", 800, 0.6125, -490.00);
    applyConversion(book, { when: "2023-12-26T20:25:00.000Z", from: { ticker: "ZXAC.OLD", isin: "", quantity: -1600 }, to: { ticker: "ZXAC", isin: "", quantity: 53.3333 }, cash: null, ids: [] }, "USD");
    expect(book.position(sharesContract("ZXAC", "USD"))).toBeCloseTo(26.66665, 10);
  });
});

describe("applyMixedMerger", () => {
  const ZXAE = sharesContract("TESTH", "USD");
  const ZQB = sharesContract("TESTC", "USD");

  function context() {
    const ctx = newContext();
    ctx.book.open(newLot({
      id: "l1",
      contract: ZXAE,
      strategy: "others",
      kind: "shares",
      openWhen: "2023-11-03T14:40:39.000Z",
      openPrice: 12.500,
      openAmount: -1500,
      openCommission: -1,
      quantity: 120,
      openIds: ["buy"],
    }));
    return ctx;
  }

  const EVENT = {
    when: "2023-12-28T20:25:00.000Z",
    from: { ticker: "TESTH", isin: "", quantity: -120 },
    to: { ticker: "TESTC", isin: "", quantity: 64.08 },
    cash: { amount: 1290.40, realizedPnl: 180.40 },
    ids: ["out", "in"],
  };

  it("reproduces IB's basis split to the cent", () => {
    const ctx = context();
    applyMixedMerger(ctx, EVENT, "USD");
    const [lot] = ctx.book.openLots(ZQB);
    expect(lot.remaining).toBe(64.08);
    expect(lot.openAmount).toBeCloseTo(-391, 6);
    expect(lot.openPrice).toBeCloseTo(6.1017, 3);
  });

  it("emits a closing row whose P/L is the one IB printed", () => {
    const ctx = context();
    applyMixedMerger(ctx, EVENT, "USD");
    expect(ctx.rows).toHaveLength(1);
    expect(ctx.rows[0].pnl).toBeCloseTo(180.40, 6);
    expect(ctx.rows[0].event).toBe("corporate_action");
    expect(ctx.rows[0].closeIds).toEqual(["out", "in"]);
    expect(ctx.rows[0].quantity).toBe(120);
  });

  it("closes the old contract entirely", () => {
    const ctx = context();
    applyMixedMerger(ctx, EVENT, "USD");
    expect(ctx.book.position(ZXAE)).toBe(0);
  });

  it("keeps the strategy and kind of the lots it converts", () => {
    const ctx = context();
    ctx.book.openLots(ZXAE)[0].strategy = "wheel";
    applyMixedMerger(ctx, EVENT, "USD");
    expect(ctx.book.openLots(ZQB)[0].strategy).toBe("wheel");
  });

  it("converts nothing and touches nothing without a realized P/L", () => {
    const ctx = context();
    applyMixedMerger(ctx, { ...EVENT, cash: { amount: 1290.40, realizedPnl: null } }, "USD");
    expect(ctx.book.position(ZXAE)).toBe(120);
    expect(ctx.book.openLots(ZQB)).toEqual([]);
    expect(ctx.rows).toEqual([]);
  });

  it("converts nothing when the ledger never held the old contract", () => {
    const ctx = newContext();
    applyMixedMerger(ctx, EVENT, "USD");
    expect(ctx.book.allOpen()).toEqual([]);
    expect(ctx.rows).toEqual([]);
  });
});

describe("withoutOldSuffix", () => {
  it("strips IB's own '.OLD' relabelling of the outgoing leg", () => {
    expect(withoutOldSuffix("TESTV.OLD")).toBe("TESTV");
  });

  it("leaves a plain ticker alone", () => {
    expect(withoutOldSuffix("TESTV")).toBe("TESTV");
  });
});
