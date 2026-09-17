import { describe, expect, it } from "vitest";
import { newLot, type Lot } from "./book.ts";
import { buildRow, net, share } from "./rows.ts";
import type { RowNote } from "./types.ts";

const PUT_LOT = (): Lot =>
  newLot({
    id: "flex:trade:1",
    contract: { ticker: "MQZA", secType: "OPT", right: "P", strike: 17, expiry: "2026-10-02", currency: "USD" },
    strategy: "wheel",
    kind: "short_put",
    openWhen: "2026-08-01T14:30:00.000Z",
    openPrice: 0.21,
    openAmount: 84,
    openCommission: -2,
    quantity: -4,
    openIds: ["flex:trade:1"],
  });

describe("share / net", () => {
  it("takes the portion pro rata, keeps an unknown unknown, and never rounds a whole", () => {
    expect(share(84, 2, 4)).toBe(42);
    expect(share(null, 2, 4)).toBeNull();
    expect(share(0.1 + 0.2, 3, 3)).toBe(0.1 + 0.2);
  });

  it("nets a missing commission as nothing to add", () => {
    expect(net(84, -2)).toBe(82);
    expect(net(84, null)).toBe(84);
    expect(net(null, -2)).toBeNull();
  });
});

describe("buildRow", () => {
  it("prorates the opening over the portion closed and nets the exit", () => {
    const lot = PUT_LOT();
    const row = buildRow(lot, 2, {
      when: "2026-08-10T15:00:00.000Z",
      price: 0.05,
      amount: -10,
      commission: -1,
      event: "buyback",
      closeIds: ["flex:trade:2"],
    });
    expect(row).toEqual({
      id: "flex:trade:1#1",
      strategy: "wheel",
      kind: "short_put",
      ticker: "MQZA",
      label: "MQZA Oct02'26 17 Put",
      currency: "USD",
      contract: { ticker: "MQZA", secType: "OPT", right: "P", strike: 17, expiry: "2026-10-02", currency: "USD" },
      startWhen: "2026-08-01T14:30:00.000Z",
      quantity: -2,
      strike: 17,
      openPrice: 0.21,
      openTotal: 42,
      openCommission: -1,
      openNet: 41,
      assigned: false,
      endWhen: "2026-08-10T15:00:00.000Z",
      closePrice: 0.05,
      closeTotal: -10,
      closeCommission: -1,
      closeNet: -11,
      pnl: 30,
      ongoing: false,
      event: "buyback",
      orphan: false,
      note: null,
      openIds: ["flex:trade:1"],
      closeIds: ["flex:trade:2"],
    });
    expect(lot.exits).toBe(1);
  });

  it("numbers successive rows of one lot and leaves an open row without an end", () => {
    const lot = PUT_LOT();
    buildRow(lot, 2, { when: "2026-08-10T15:00:00.000Z", price: 0.05, amount: -10, commission: -1, event: "buyback", closeIds: [] });
    const open = buildRow(lot, 2, null);
    expect(open.id).toBe("flex:trade:1#2");
    expect(open).toMatchObject({ endWhen: null, closePrice: null, closeTotal: null, closeCommission: null, closeNet: null, pnl: null, ongoing: true, event: null, closeIds: [] });
  });

  it("marks an assigned exit and computes the premium anyway", () => {
    const row = buildRow(PUT_LOT(), 4, { when: "2026-10-02T20:00:00.000Z", price: 0, amount: 0, commission: null, event: "assigned", closeIds: ["flex:trade:3"] });
    expect(row).toMatchObject({ assigned: true, closePrice: 0, closeTotal: 0, closeNet: 0, pnl: 82, event: "assigned", ongoing: false });
  });

  it("leaves pnl unknown when an amount is unknown", () => {
    const lot = PUT_LOT();
    lot.openAmount = null;
    const row = buildRow(lot, 4, { when: "2026-10-02T20:00:00.000Z", price: 0.05, amount: -20, commission: -1, event: "buyback", closeIds: [] });
    expect(row).toMatchObject({ openTotal: null, openNet: null, closeNet: -21, pnl: null });
  });

  it("uses the lot's own label when it has one", () => {
    const lot = PUT_LOT();
    lot.label = "SPY Aug29'26 IC 620/625/660/665";
    expect(buildRow(lot, 4, null).label).toBe("SPY Aug29'26 IC 620/625/660/665");
  });
});

const CALL = { ticker: "NVDA", secType: "OPT", right: "C" as const, strike: 150, expiry: "2026-08-21", currency: "USD" };
const CONTRACT = "NVDA Aug21'26 150 Call";

describe("buildRow — la note", () => {
  it("reads a naked short call off the line itself", () => {
    const naked = newLot({
      id: "n", contract: CALL, strategy: "others", kind: "short_call", openWhen: "2026-08-01T14:30:00.000Z",
      openPrice: 0.5, openAmount: 50, openCommission: -1, quantity: -1, openIds: ["n"],
    });
    expect(buildRow(naked, 1, null).note).toEqual({ code: "nakedCall" });
  });

  it("says truncated history on an orphan, even when the line is also a naked call", () => {
    const orphan = newLot({
      id: "o", contract: CALL, strategy: "others", kind: "short_call", openWhen: "2026-08-01T14:30:00.000Z",
      openPrice: 0, openAmount: 0, openCommission: null, quantity: -1, openIds: ["o"], orphan: true,
    });
    expect(buildRow(orphan, 1, null).note).toEqual({ code: "truncatedHistory" });
  });

  it("leaves a covered call and an ordinary lot without a note", () => {
    const covered = newLot({
      id: "c", contract: CALL, strategy: "wheel", kind: "short_call", openWhen: "2026-08-01T14:30:00.000Z",
      openPrice: 0.5, openAmount: 50, openCommission: -1, quantity: -1, openIds: ["c"], cover: "shares",
    });
    expect(buildRow(covered, 1, null).note).toBeNull();
    expect(buildRow(PUT_LOT(), 4, null).note).toBeNull();
  });

  it("prefers the exit's note, then the lot's, over anything it could deduce", () => {
    // Also a naked call and an orphan: a deduction alone would answer truncatedHistory
    // (orphan is checked before nakedCall). The explicit lot note has to win over that
    // for this test to actually prove the note is read before either deduced branch —
    // a lot that could never deduce anything would pass even if the read moved after them.
    const lotNote: RowNote = { code: "takenOverAtStrike", contract: CONTRACT };
    const held = newLot({
      id: "h", contract: CALL, strategy: "others", kind: "short_call", openWhen: "2026-08-01T14:30:00.000Z",
      openPrice: 0.5, openAmount: 50, openCommission: -1, quantity: -1, openIds: ["h"],
      cover: null, orphan: true, note: lotNote,
    });
    expect(buildRow(held, 1, null).note).toEqual(lotNote);
    const exitNote: RowNote = { code: "handedToWheel", contract: CONTRACT };
    expect(
      buildRow(held, 1, {
        when: "2026-08-21T20:00:00.000Z", price: 0, amount: 0, commission: null,
        event: "integrated", closeIds: ["x"], note: exitNote,
      }).note,
    ).toEqual(exitNote);
  });

  it("never annotates a condor leg, even when it would otherwise read as a naked call", () => {
    const parent = newLot({
      id: "p", contract: CALL, strategy: "condors", kind: "condor", openWhen: "2026-08-01T14:30:00.000Z",
      openPrice: null, openAmount: null, openCommission: null, quantity: -1, openIds: ["p"],
    });
    const leg = newLot({
      id: "l", contract: CALL, strategy: "others", kind: "short_call", openWhen: "2026-08-01T14:30:00.000Z",
      openPrice: 0.5, openAmount: 50, openCommission: -1, quantity: -1, openIds: ["l"],
      cover: null, parent,
    });
    expect(buildRow(leg, 1, null).note).toBeNull();
  });
});
