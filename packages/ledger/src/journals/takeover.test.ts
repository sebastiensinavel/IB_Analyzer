import { beforeEach, describe, expect, it } from "vitest";
import { deliver, option, resetIds, stock } from "./fixtures.ts";
import { buildJournals } from "./replay.ts";
import type { JournalRow, JournalsReport } from "./types.ts";
import type { Transaction } from "../types.ts";

beforeEach(resetIds);

const BUY = "2026-03-02T14:30:00.000Z";
const SELL_CALL = "2026-08-03T14:30:00.000Z";
const CALL = { right: "C" as const, strike: 20, expiry: "2026-09-18" };

/** `report.rows` is newest first; every assertion below reads a takeover as a story, so oldest first. */
function oldestFirst(rows: readonly JournalRow[]): JournalRow[] {
  return [...rows].sort((a, b) => (a.startWhen === b.startWhen ? (a.id < b.id ? -1 : 1) : a.startWhen < b.startWhen ? -1 : 1));
}

function story(report: JournalsReport): string[] {
  return oldestFirst(report.rows).map((r) => `${r.strategy} ${r.kind} ${r.quantity} open=${r.openPrice} close=${r.closePrice} pnl=${r.pnl} ${r.event ?? "-"}`);
}

function shares(report: JournalsReport, strategy: string): JournalRow[] {
  return oldestFirst(report.rows.filter((r) => r.kind === "shares" && r.strategy === strategy));
}

function integrated(report: JournalsReport): JournalRow[] {
  return oldestFirst(report.rows.filter((r) => r.event === "integrated"));
}

/**
 * The takeover cuts a lot into two synthetic legs — the strategy handing the
 * shares over closes, the Wheel lot that receives them opens — that must
 * cancel to the cent, or the journals' total P/L would drift from the cash
 * the real transactions actually moved. Sums every row's openNet + closeNet
 * and every transaction's amount + commission, and asserts they match.
 */
function conserves(transactions: readonly Transaction[]): void {
  // A `null` amount is a figure the source never gave, not a zero: it makes
  // the transactions' total undefined, so skip the assertion rather than
  // fail on data the scenario never claimed to have.
  if (transactions.some((t) => t.amount === null)) return;
  const report = buildJournals(transactions);
  const fromRows = report.rows.reduce((sum, row) => sum + (row.openNet ?? 0) + (row.closeNet ?? 0), 0);
  const fromTransactions = transactions.reduce((sum, t) => sum + (t.amount as number) + (t.commission ?? 0), 0);
  expect(fromRows).toBeCloseTo(fromTransactions, 6);
}

describe("takeOverShares — une reprise simple", () => {
  /** 100 shares bought at 10, one call sold at strike 20 five months later. */
  const ledger = () => [
    stock({ quantity: 100, price: 10, when: BUY }),
    option({ ...CALL, quantity: -1, price: 0.5, when: SELL_CALL }),
  ];

  it("closes the bought lot in Others at the strike and reopens it in Wheel at the strike", () => {
    const report = buildJournals(ledger());
    expect(story(report)).toEqual([
      "others shares 100 open=10 close=20 pnl=999 integrated",
      "wheel shares 100 open=20 close=null pnl=null -",
      "wheel short_call -1 open=0.5 close=null pnl=null -",
    ]);
    conserves(ledger());
  });

  it("invents no money: the two legs of the takeover cancel out", () => {
    const report = buildJournals(ledger());
    const handed = shares(report, "others")[0];
    const taken = shares(report, "wheel")[0];
    expect(handed.closeTotal).toBe(2000);
    expect(handed.closeCommission).toBe(0);
    expect(taken.openTotal).toBe(-2000);
    expect(taken.openCommission).toBe(0);
    expect((handed.closeTotal ?? 0) + (taken.openTotal ?? 0)).toBe(0);
    conserves(ledger());
  });

  it("dates the Wheel lot at the call, keeps the commission of the purchase on the Others side", () => {
    const report = buildJournals(ledger());
    expect(shares(report, "wheel")[0]).toMatchObject({ startWhen: SELL_CALL, assigned: false, openCommission: 0 });
    expect(shares(report, "others")[0]).toMatchObject({ startWhen: BUY, openCommission: -1, endWhen: SELL_CALL });
    conserves(ledger());
  });

  it("names the call in both notes", () => {
    const report = buildJournals(ledger());
    expect(shares(report, "wheel")[0].note).toEqual({ code: "takenOverAtStrike", contract: "MQZA Sep18'26 20 Call" });
    expect(shares(report, "others")[0].note).toEqual({ code: "handedToWheel", contract: "MQZA Sep18'26 20 Call" });
    conserves(ledger());
  });

  it("counts the resale from the strike, never from the purchase price", () => {
    const transactions = [...ledger(), stock({ quantity: -100, price: 25, when: "2026-09-01T14:30:00.000Z", commission: -1 })];
    const report = buildJournals(transactions);
    expect(shares(report, "wheel")[0]).toMatchObject({ closePrice: 25, pnl: 2500 - 2000 - 1, event: "sold" });
    conserves(transactions);
  });
});

describe("takeOverShares — le strike sous le prix d'achat", () => {
  it("leaves the loss in Others and starts the Wheel at the strike", () => {
    const transactions = [
      stock({ quantity: 100, price: 30, when: BUY }),
      option({ ...CALL, quantity: -1, price: 0.5, when: SELL_CALL }),
    ];
    const report = buildJournals(transactions);
    expect(shares(report, "others")[0]).toMatchObject({ closePrice: 20, pnl: 2000 - 3000 - 1 });
    expect(shares(report, "wheel")[0]).toMatchObject({ openPrice: 20, openTotal: -2000 });
    conserves(transactions);
  });
});

describe("takeOverShares — couverture partielle", () => {
  it("cuts the lot and leaves the rest in Others, pro rata", () => {
    const transactions = [
      stock({ quantity: 300, price: 10, when: BUY, commission: -3 }),
      option({ ...CALL, quantity: -1, price: 0.5, when: SELL_CALL }),
    ];
    const report = buildJournals(transactions);
    const others = shares(report, "others");
    expect(others.map((r) => [r.quantity, r.openCommission, r.event])).toEqual([
      [100, -1, "integrated"],
      [200, -2, null],
    ]);
    expect(shares(report, "wheel").map((r) => r.quantity)).toEqual([100]);
    conserves(transactions);
  });

  it("floors the capacity of a fractional lot and cuts it without losing a share", () => {
    // 226.49 shares is a real shape: a merger's residue, or a fractional dividend.
    const transactions = [
      stock({ quantity: 226.49, price: 10, when: BUY }),
      option({ ...CALL, quantity: -2, price: 0.5, when: SELL_CALL }),
    ];
    const report = buildJournals(transactions);
    expect(shares(report, "wheel").map((r) => r.quantity)).toEqual([200]);
    const others = shares(report, "others");
    expect(others.map((r) => r.event)).toEqual(["integrated", null]);
    expect(others[0].quantity).toBe(200);
    expect(others[1].quantity).toBeCloseTo(26.49, 10);
    // Nothing evaporates in the cut.
    expect((others[0].quantity ?? 0) + (others[1].quantity ?? 0)).toBeCloseTo(226.49, 10);
    conserves(transactions);
  });

  it("delivers the shares the call covers, not the untouched remainder", () => {
    const transactions = [
      stock({ quantity: 300, price: 10, when: BUY, commission: -3 }),
      option({ ...CALL, quantity: -1, price: 0.5, when: SELL_CALL }),
      ...deliver({ ...CALL, quantity: 1 }),
    ];
    const report = buildJournals(transactions);
    // The Wheel lot is the one the assignment closes: the Others remainder stays open.
    expect(shares(report, "wheel")[0]).toMatchObject({ quantity: 100, closePrice: 20, event: "sold", ongoing: false });
    expect(shares(report, "others").find((r) => r.event === null)).toMatchObject({ quantity: 200, ongoing: true });
    conserves(transactions);
  });
});

describe("takeOverShares — ce qui ne doit rien reprendre", () => {
  it("takes nothing over when the shares were assigned: they are already Wheel", () => {
    const transactions = [
      option({ right: "P", strike: 17, expiry: "2026-07-17", quantity: -1, price: 0.2, when: BUY }),
      ...deliver({ right: "P", strike: 17, expiry: "2026-07-17", quantity: 1 }),
      option({ ...CALL, quantity: -1, price: 0.5, when: SELL_CALL }),
    ];
    const report = buildJournals(transactions);
    expect(integrated(report)).toEqual([]);
    expect(shares(report, "wheel").map((r) => r.openPrice)).toEqual([17]);
    conserves(transactions);
  });

  it("does not take the same lot over twice when a second and a third call are sold", () => {
    // Three successive calls, each cutting the remainder the previous one left
    // behind: the lot cut out of an already-cut lot is where a stale `uniqueId`
    // base used to hand back an id already in use (see the id-uniqueness
    // assertion below).
    const transactions = [
      stock({ quantity: 300, price: 10, when: BUY }),
      option({ ...CALL, quantity: -1, price: 0.5, when: SELL_CALL }),
      option({ ...CALL, strike: 25, quantity: -1, price: 0.4, when: "2026-08-04T14:30:00.000Z" }),
      option({ ...CALL, strike: 30, quantity: -1, price: 0.3, when: "2026-08-05T14:30:00.000Z" }),
    ];
    const report = buildJournals(transactions);
    expect(integrated(report).map((r) => r.closePrice)).toEqual([20, 25, 30]);
    expect(shares(report, "wheel").map((r) => [r.quantity, r.openPrice])).toEqual([
      [100, 20],
      [100, 25],
      [100, 30],
    ]);
    // Every row is a distinct entity, however many times a lot was cut out of
    // a lot that was itself already cut: `JournalRow.id` is a rendering key.
    const ids = report.rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    conserves(transactions);
  });

  it("takes nothing over a second time when the call is bought back and sold again", () => {
    const transactions = [
      stock({ quantity: 100, price: 10, when: BUY }),
      option({ ...CALL, quantity: -1, price: 0.5, when: SELL_CALL }),
      option({ ...CALL, quantity: 1, price: 0.2, when: "2026-08-05T14:30:00.000Z" }),
      option({ ...CALL, strike: 25, quantity: -1, price: 0.4, when: "2026-08-06T14:30:00.000Z" }),
    ];
    const report = buildJournals(transactions);
    expect(integrated(report)).toHaveLength(1);
    expect(shares(report, "wheel").map((r) => r.openPrice)).toEqual([20]);
    conserves(transactions);
  });
});

describe("takeOverShares — le seul lot livré qu'une reprise peut couper", () => {
  /**
   * A put's delivered shares are already Wheel, so `takeOverShares` steps
   * over them untouched: `ctx.delivered` never sees a cut there. The only
   * lot it *can* see cut is shares delivered by a long call's exercise —
   * LEAPS or Others — which land in whatever strategy the call itself was
   * in, and so are still eligible when a call is later sold on top of them.
   */
  it("keeps the LEAPS exercise row ongoing once the shares it delivered are taken over", () => {
    const LEAPS_CALL = { right: "C" as const, strike: 15, expiry: "2027-06-18" };
    const EXERCISE = "2026-05-01T20:00:00.000Z";
    const transactions = [
      option({ ...LEAPS_CALL, quantity: 1, price: 3, when: BUY }),
      ...deliver({ ...LEAPS_CALL, quantity: -1, when: EXERCISE }),
      option({ ...CALL, quantity: -1, price: 0.5, when: SELL_CALL }),
    ];
    const report = buildJournals(transactions);
    const exercised = report.rows.find((r) => r.event === "exercised");
    expect(exercised).toMatchObject({ ongoing: true });
    expect(integrated(report)[0]).toMatchObject({ strategy: "leaps", closePrice: 20 });
    expect(shares(report, "wheel")[0]).toMatchObject({ openPrice: 20, quantity: 100 });
    conserves(transactions);
  });
});

describe("takeOverShares — la Wheel couvre d'abord", () => {
  const PUT = { right: "P" as const, strike: 12, expiry: "2026-06-19" };
  const PUT_SALE = "2026-05-04T14:30:00.000Z";

  it("takes nothing over when the Wheel already holds enough free shares, even behind an older Others lot", () => {
    // 5 shares bought on the market, then 800 delivered by puts: the 5 come first in the book.
    const transactions = [
      stock({ quantity: 5, price: 10, when: BUY }),
      option({ ...PUT, quantity: -8, price: 1, when: PUT_SALE }),
      ...deliver({ ...PUT, quantity: 8 }),
      option({ ...CALL, quantity: -6, price: 0.5, when: SELL_CALL }),
    ];
    const report = buildJournals(transactions);
    expect(integrated(report)).toEqual([]);
    expect(shares(report, "others").map((r) => [r.quantity, r.endWhen])).toEqual([[5, null]]);
    conserves(transactions);
  });

  it("takes nothing from Others when the Wheel alone covers the call", () => {
    const transactions = [
      stock({ quantity: 134, price: 10, when: BUY }),
      option({ ...PUT, quantity: -1, price: 1, when: PUT_SALE }),
      ...deliver({ ...PUT, quantity: 1 }),
      option({ ...CALL, quantity: -1, price: 0.5, when: SELL_CALL }),
    ];
    const report = buildJournals(transactions);
    expect(integrated(report)).toEqual([]);
    expect(shares(report, "others").map((r) => r.quantity)).toEqual([134]);
    conserves(transactions);
  });

  it("takes over only the half contract a partly sold Wheel lot leaves missing", () => {
    // Spec 17 §7: 50 free Wheel shares and 134 Others shares, one call → 50 taken over.
    // The Wheel lot is older than the Others lot, so the plain sale of 50 comes out of it.
    const transactions = [
      option({ ...PUT, quantity: -1, price: 1, when: PUT_SALE }),
      ...deliver({ ...PUT, quantity: 1 }),
      stock({ quantity: -50, price: 13, when: "2026-06-22T14:30:00.000Z" }),
      stock({ quantity: 134, price: 10, when: "2026-07-01T14:30:00.000Z" }),
      option({ ...CALL, quantity: -1, price: 0.5, when: SELL_CALL }),
    ];
    const report = buildJournals(transactions);
    expect(integrated(report).map((r) => r.quantity)).toEqual([50]);
    expect(shares(report, "wheel").filter((r) => r.endWhen === null).reduce((n, r) => n + (r.quantity ?? 0), 0)).toBe(100);
    expect(shares(report, "others").filter((r) => r.endWhen === null).map((r) => r.quantity)).toEqual([84]);
    conserves(transactions);
  });

  it("takes over only what an open covered call leaves missing", () => {
    // The first call is covered by the 100 Wheel shares; the second finds none free and takes 100 of the 134.
    const transactions = [
      stock({ quantity: 134, price: 10, when: BUY }),
      option({ ...PUT, quantity: -1, price: 1, when: PUT_SALE }),
      ...deliver({ ...PUT, quantity: 1 }),
      option({ ...CALL, quantity: -1, price: 0.5, when: SELL_CALL }),
      option({ ...CALL, strike: 25, quantity: -1, price: 0.4, when: "2026-08-04T14:30:00.000Z" }),
    ];
    const report = buildJournals(transactions);
    expect(integrated(report).map((r) => [r.quantity, r.closePrice])).toEqual([[100, 25]]);
    expect(shares(report, "others").filter((r) => r.endWhen === null).map((r) => r.quantity)).toEqual([34]);
    conserves(transactions);
  });

  it("takes 100 of 134 shares for one call", () => {
    // Guard: already true before sub-project 17.
    const transactions = [stock({ quantity: 134, price: 10, when: BUY }), option({ ...CALL, quantity: -1, price: 0.5, when: SELL_CALL })];
    const report = buildJournals(transactions);
    expect(integrated(report).map((r) => r.quantity)).toEqual([100]);
    expect(shares(report, "wheel").map((r) => r.quantity)).toEqual([100]);
    expect(shares(report, "others").filter((r) => r.endWhen === null).map((r) => r.quantity)).toEqual([34]);
    conserves(transactions);
  });
});

describe("rachat de calls Wheel et vente d'actions au même instant", () => {
  const PUT = { right: "P" as const, strike: 12, expiry: "2026-06-19" };
  const PUT_SALE = "2026-05-04T14:30:00.000Z";
  const EXIT = "2026-08-20T14:19:06.000Z";

  /** `others` shares bought first, 600 delivered by puts, 6 covered calls sold. */
  const covered = (others: number) => [
    stock({ quantity: others, price: 10, when: BUY }),
    option({ ...PUT, quantity: -6, price: 1, when: PUT_SALE }),
    ...deliver({ ...PUT, quantity: 6 }),
    option({ ...CALL, quantity: -6, price: 0.5, when: SELL_CALL }),
  ];
  const openShares = (report: JournalsReport, strategy: string) =>
    shares(report, strategy).filter((r) => r.endWhen === null).reduce((n, r) => n + (r.quantity ?? 0), 0);

  it("sells the Wheel shares the bought-back calls covered, not the older Others lot", () => {
    const transactions = [
      ...covered(5),
      option({ ...CALL, quantity: 6, price: 2.6, when: EXIT }),
      stock({ quantity: -600, price: 15, when: EXIT }),
    ];
    const report = buildJournals(transactions);
    expect(openShares(report, "wheel")).toBe(0);
    expect(openShares(report, "others")).toBe(5);
    conserves(transactions);
  });

  it("sells from the Wheel only as many shares as calls were bought back, the rest in book order", () => {
    const transactions = [
      ...covered(300),
      option({ ...CALL, quantity: 6, price: 2.6, when: EXIT }),
      stock({ quantity: -800, price: 15, when: EXIT }),
    ];
    const report = buildJournals(transactions);
    expect(openShares(report, "wheel")).toBe(0);
    expect(openShares(report, "others")).toBe(100);
    conserves(transactions);
  });

  it("keeps book order for a sale with no call bought back at that instant", () => {
    // Guard: already true before sub-project 17.
    const transactions = [...covered(5), stock({ quantity: -600, price: 15, when: EXIT })];
    const report = buildJournals(transactions);
    expect(openShares(report, "others")).toBe(0);
    expect(openShares(report, "wheel")).toBe(5);
    conserves(transactions);
  });

  it("keeps book order when the call bought back at that instant is a LEAPS one", () => {
    // Guard: the priority belongs to Wheel calls only. 505 shares and 6 LEAPS: the
    // 6 calls match the LEAPS capacity exactly, so splitShortCall puts them in LEAPS.
    const LEAPS = { right: "C" as const, strike: 5, expiry: "2028-01-21" };
    const transactions = [
      stock({ quantity: 5, price: 10, when: BUY }),
      option({ ...PUT, quantity: -5, price: 1, when: PUT_SALE }),
      ...deliver({ ...PUT, quantity: 5 }),
      option({ ...LEAPS, quantity: 6, price: 7, when: "2026-07-01T14:30:00.000Z" }),
      option({ ...CALL, quantity: -6, price: 0.5, when: SELL_CALL }),
      option({ ...CALL, quantity: 6, price: 2.6, when: EXIT }),
      stock({ quantity: -500, price: 15, when: EXIT }),
    ];
    const report = buildJournals(transactions);
    expect(report.rows.filter((r) => r.kind === "short_call").map((r) => r.strategy)).toEqual(["leaps"]);
    expect(openShares(report, "others")).toBe(0);
    expect(openShares(report, "wheel")).toBe(5);
    conserves(transactions);
  });
});

describe("assignation d'un call Wheel", () => {
  it("delivers Wheel shares, not the older Others lot ahead of them", () => {
    const PUT = { right: "P" as const, strike: 12, expiry: "2026-06-19" };
    const transactions = [
      stock({ quantity: 5, price: 10, when: BUY }),
      option({ ...PUT, quantity: -1, price: 1, when: "2026-05-04T14:30:00.000Z" }),
      ...deliver({ ...PUT, quantity: 1 }),
      option({ ...CALL, quantity: -1, price: 0.5, when: SELL_CALL }),
      ...deliver({ ...CALL, quantity: 1 }),
    ];
    const report = buildJournals(transactions);
    expect(integrated(report)).toEqual([]);
    expect(shares(report, "wheel").map((r) => [r.quantity, r.closePrice, r.event])).toEqual([[100, 20, "sold"]]);
    expect(shares(report, "others").map((r) => [r.quantity, r.endWhen])).toEqual([[5, null]]);
    conserves(transactions);
  });
});
