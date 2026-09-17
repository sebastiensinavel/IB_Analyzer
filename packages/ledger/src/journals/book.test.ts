import { describe, expect, it } from "vitest";
import { sharesContract, type ContractKey } from "./contract.ts";
import { isWheelShares, LotBook, newLot, type Lot } from "./book.ts";

const PUT: ContractKey = { ticker: "MQZA", secType: "OPT", right: "P", strike: 17, expiry: "2026-10-02", currency: "USD" };

function lot(id: string, quantity: number, contract = PUT): Lot {
  return newLot({
    id,
    contract,
    strategy: "wheel",
    kind: quantity < 0 ? "short_put" : "long_put",
    openWhen: "2026-08-01T14:30:00.000Z",
    openPrice: 0.21,
    openAmount: -quantity * 21,
    openCommission: -1,
    quantity,
    openIds: [id],
  });
}

describe("newLot", () => {
  it("starts fully open, with the optional flags at their defaults", () => {
    const l = lot("a", -4);
    expect(l.remaining).toBe(-4);
    expect(l).toMatchObject({ assigned: false, orphan: false, ratio: null, cover: null, deliveredBy: null, legs: null, parent: null, label: null, exits: 0, exitLog: [] });
  });

  it("ranks a lot at its own opening unless told otherwise", () => {
    expect(lot("a", -1).rankWhen).toBe("2026-08-01T14:30:00.000Z");
    expect(newLot({ ...lot("b", -1), rankWhen: "2024-01-02T14:30:00.000Z" }).rankWhen).toBe("2024-01-02T14:30:00.000Z");
  });
});

describe("LotBook", () => {
  it("closes the oldest lot first and splits the last one touched", () => {
    const book = new LotBook();
    const a = lot("a", -2);
    const b = lot("b", -3);
    book.open(a);
    book.open(b);
    expect(book.close(PUT, 4)).toEqual([
      { lot: a, quantity: 2 },
      { lot: b, quantity: 2 },
    ]);
    expect(a.remaining).toBe(0);
    expect(b.remaining).toBe(-1);
    expect(book.position(PUT)).toBe(-1);
    expect(book.openLots(PUT)).toEqual([b]);
  });

  it("closes nothing on the same side and reports what it could not close", () => {
    const book = new LotBook();
    book.open(lot("a", -2));
    expect(book.close(PUT, -1)).toEqual([]);
    expect(book.close(PUT, 5).map((c) => c.quantity)).toEqual([2]);
  });

  it("keeps contracts apart", () => {
    const book = new LotBook();
    const shares = lot("s", 200, sharesContract("MQZA", "USD"));
    book.open(lot("a", -2));
    book.open(shares);
    expect(book.close(sharesContract("MQZA", "USD"), -50)).toEqual([{ lot: shares, quantity: 50 }]);
    expect(book.position(PUT)).toBe(-2);
  });

  it("aggregates the open quantity per contract", () => {
    const book = new LotBook();
    book.open(lot("a", -2));
    book.open(lot("b", -3));
    book.open(lot("s", 200, sharesContract("MQZA", "USD")));
    book.close(PUT, 5);
    expect([...book.positions().values()]).toEqual([{ contract: sharesContract("MQZA", "USD"), quantity: 200 }]);
    expect(book.allOpen().map((l) => l.id)).toEqual(["s"]);
  });
});

describe("LotBook.move", () => {
  const from = sharesContract("TESTV", "USD");
  const to = sharesContract("TESTP", "USD");

  function lotOf(quantity: number) {
    return newLot({
      id: `l${quantity}`,
      contract: from,
      strategy: "others",
      kind: "shares",
      openWhen: "2025-01-02T09:30:00.000Z",
      openPrice: 10,
      openAmount: -100 * quantity,
      openCommission: -1,
      quantity,
      openIds: [`x${quantity}`],
    });
  }

  it("moves every open lot onto the new contract and applies the transform", () => {
    const book = new LotBook();
    book.open(lotOf(10));
    book.move(from, to, (lot) => {
      lot.quantity *= 2;
      lot.remaining *= 2;
    });
    expect(book.openLots(from)).toEqual([]);
    expect(book.openLots(to).map((l) => l.remaining)).toEqual([20]);
    expect(book.openLots(to)[0].contract).toEqual(to);
  });

  it("joins lots already open on the destination, oldest first", () => {
    const book = new LotBook();
    // The destination lot is *newer* than the lot being moved: insertion order
    // and `openWhen` order disagree, which is the only shape that proves FIFO
    // rather than merely repeating the order the lots happened to arrive in.
    const newer = newLot({ ...lotOf(5), contract: to, openWhen: "2025-06-02T09:30:00.000Z", rankWhen: "2025-06-02T09:30:00.000Z" });
    book.open(newer);
    book.open(lotOf(10));
    book.move(from, to, () => {});
    expect(book.openLots(to).map((l) => l.openWhen)).toEqual(["2025-01-02T09:30:00.000Z", "2025-06-02T09:30:00.000Z"]);
    expect(book.openLots(to).map((l) => l.remaining)).toEqual([10, 5]);
  });

  it("ranks the moved lots by rankWhen, not by openWhen", () => {
    const book = new LotBook();
    // A lot the Wheel took over: opened the day of the call, ranked at the purchase it was cut from.
    const destination = newLot({ ...lotOf(5), contract: to, openWhen: "2025-03-02T09:30:00.000Z", rankWhen: "2025-03-02T09:30:00.000Z" });
    book.open(destination);
    book.open(newLot({ ...lotOf(10), openWhen: "2025-06-02T09:30:00.000Z", rankWhen: "2025-01-02T09:30:00.000Z" }));
    book.move(from, to, () => {});
    expect(book.openLots(to).map((l) => l.remaining)).toEqual([10, 5]);
  });

  it("keeps two lots of the same instant in the order they arrived", () => {
    const book = new LotBook();
    const sameInstant = newLot({ ...lotOf(5), contract: to });
    book.open(sameInstant);
    book.open(lotOf(10));
    book.move(from, to, () => {});
    expect(book.openLots(to).map((l) => l.remaining)).toEqual([5, 10]);
  });

  it("leaves closed lots of the old contract where they are: they are history", () => {
    const book = new LotBook();
    const spent = lotOf(10);
    spent.remaining = 0;
    book.open(spent);
    book.open(lotOf(4));
    book.move(from, to, () => {});
    expect(book.openLots(to).map((l) => l.remaining)).toEqual([4]);
    expect(book.allOpen()).toHaveLength(1);
    expect(spent.contract).toEqual(from);
  });

  it("does nothing at all when the old contract holds nothing open", () => {
    const book = new LotBook();
    expect(book.move(from, to, () => {})).toEqual([]);
    expect(book.allOpen()).toEqual([]);
  });
});

describe("LotBook.insertAfter", () => {
  const SHARES = sharesContract("MQZA", "USD");

  function shareLot(id: string, quantity: number) {
    return newLot({
      id, contract: SHARES, strategy: "others", kind: "shares", openWhen: "2024-01-02T14:30:00.000Z",
      openPrice: 10, openAmount: -10 * quantity, openCommission: -1, quantity, openIds: [id],
    });
  }

  it("puts the new lots at the rank of the lot they were cut from, not at the end", () => {
    const book = new LotBook();
    const older = shareLot("older", 100);
    const newer = shareLot("newer", 300);
    book.open(older);
    book.open(newer);
    const taken = newLot({ ...shareLot("taken", 100), strategy: "wheel" });
    older.remaining = 0;
    book.insertAfter(older, [taken]);
    // FIFO must reach the taken-over shares before the untouched lot that follows.
    expect(book.openLots(SHARES).map((l) => l.id)).toEqual(["taken", "newer"]);
    expect(book.close(SHARES, -100)).toEqual([{ lot: taken, quantity: 100 }]);
  });

  it("keeps the order of the lots it is given", () => {
    const book = new LotBook();
    const source = shareLot("source", 300);
    book.open(source);
    const taken = newLot({ ...shareLot("taken", 100), strategy: "wheel" });
    const rest = shareLot("rest", 200);
    source.remaining = 0;
    book.insertAfter(source, [taken, rest]);
    expect(book.openLots(SHARES).map((l) => l.id)).toEqual(["taken", "rest"]);
  });

  it("refuses a lot the book never held", () => {
    const book = new LotBook();
    expect(() => book.insertAfter(shareLot("ghost", 100), [])).toThrow(/ghost/);
  });
});

describe("LotBook.closePreferring", () => {
  const SHARES = sharesContract("MQZA", "USD");

  function shareLot(id: string, quantity: number, strategy: "wheel" | "others") {
    return newLot({
      id, contract: SHARES, strategy, kind: "shares", openWhen: "2024-01-02T14:30:00.000Z",
      openPrice: 10, openAmount: -10 * quantity, openCommission: -1, quantity, openIds: [id],
    });
  }

  it("serves the preferred lots first, within the contracts given, then FIFO", () => {
    const book = new LotBook();
    const others = shareLot("others", 300, "others");
    const wheel = shareLot("wheel", 600, "wheel");
    book.open(others);
    book.open(wheel);
    const { closed, preferredContracts } = book.closePreferring(SHARES, -800, isWheelShares, 6);
    expect(closed).toEqual([
      { lot: wheel, quantity: 600 },
      { lot: others, quantity: 200 },
    ]);
    expect(preferredContracts).toBe(6);
  });

  it("folds a lot reached by both passes into one portion", () => {
    const book = new LotBook();
    const wheel = shareLot("wheel", 300, "wheel");
    book.open(wheel);
    const { closed, preferredContracts } = book.closePreferring(SHARES, -250, isWheelShares, 1);
    expect(closed).toEqual([{ lot: wheel, quantity: 250 }]);
    expect(preferredContracts).toBe(1);
    expect(wheel.remaining).toBe(50);
  });

  it("closes like close when no contract is given", () => {
    const book = new LotBook();
    const others = shareLot("others", 5, "others");
    const wheel = shareLot("wheel", 600, "wheel");
    book.open(others);
    book.open(wheel);
    expect(book.closePreferring(SHARES, -600, isWheelShares, 0).closed).toEqual([
      { lot: others, quantity: 5 },
      { lot: wheel, quantity: 595 },
    ]);
  });
});
