import { beforeEach, describe, expect, it } from "vitest";
import { tx } from "../fixtures.ts";
import { sortTransactions } from "../order.ts";
import { deliver, expire, option, resetIds, stock } from "./fixtures.ts";
import { mergeFills } from "./fills.ts";

beforeEach(resetIds);

const T0 = "2026-06-16T10:16:51.000Z";
const at = (seconds: number) => new Date(Date.parse(T0) + seconds * 1000).toISOString();
const PUT = { right: "P" as const, strike: 2, expiry: "2026-07-17", ticker: "TQZA" };

function merge(transactions: ReturnType<typeof tx>[]) {
  return mergeFills(sortTransactions(transactions));
}

describe("mergeFills", () => {
  it("folds two fills of one sale into one line: oldest instant, summed quantity, averaged price", () => {
    const { transactions } = merge([
      option({ ...PUT, quantity: -1, price: 0.2, when: T0 }),
      option({ ...PUT, quantity: -1, price: 0.21, when: at(1) }),
    ]);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      externalId: "flex:trade:1",
      when: T0,
      quantity: -2,
      price: expect.closeTo(0.205),
      amount: expect.closeTo(41),
      commission: -2,
    });
  });

  it("weights the average price by the quantity of each fill", () => {
    const { transactions } = merge([
      option({ ...PUT, quantity: -3, price: 0.2, when: T0 }),
      option({ ...PUT, quantity: -1, price: 0.4, when: at(1) }),
    ]);
    expect(transactions[0]).toMatchObject({ quantity: -4, price: expect.closeTo(0.25) });
  });

  it("keeps every original id, in order, for the row's provenance", () => {
    const { transactions, ids } = merge([
      option({ ...PUT, quantity: -1, price: 0.2, when: T0 }),
      option({ ...PUT, quantity: -1, price: 0.21, when: at(1) }),
    ]);
    expect(ids.get(transactions[0])).toEqual(["flex:trade:1", "flex:trade:2"]);
  });

  it("leaves a lone fill untouched, with no entry in the id map", () => {
    const only = option({ ...PUT, quantity: -1, price: 0.2, when: T0 });
    const { transactions, ids } = merge([only]);
    expect(transactions).toEqual([only]);
    expect(ids.size).toBe(0);
  });

  it("chains on the gap between neighbours, so a sliced order folds whole", () => {
    const { transactions } = merge([
      option({ ...PUT, quantity: -1, price: 0.2, when: T0 }),
      option({ ...PUT, quantity: -1, price: 0.2, when: at(1.5) }),
      option({ ...PUT, quantity: -1, price: 0.2, when: at(3) }),
    ]);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ quantity: -3, when: T0 });
  });

  it("starts a new line once the gap exceeds the window", () => {
    const { transactions } = merge([
      option({ ...PUT, quantity: -1, price: 0.2, when: T0 }),
      option({ ...PUT, quantity: -1, price: 0.2, when: at(2.001) }),
    ]);
    expect(transactions.map((t) => t.quantity)).toEqual([-1, -1]);
  });

  it("never folds the two directions of one contract together", () => {
    const { transactions } = merge([
      option({ ...PUT, quantity: -1, price: 0.2, when: T0 }),
      option({ ...PUT, quantity: 1, price: 0.2, when: at(1) }),
    ]);
    expect(transactions.map((t) => t.quantity)).toEqual([-1, 1]);
  });

  it("never folds two contracts of the same underlying together", () => {
    const { transactions } = merge([
      option({ ...PUT, quantity: -1, price: 0.2, when: T0 }),
      option({ ...PUT, strike: 3, quantity: -1, price: 0.2, when: at(1) }),
    ]);
    expect(transactions).toHaveLength(2);
  });

  it("never folds two sources together: their ranges do not overlap, twins are legitimate", () => {
    const flex = option({ ...PUT, quantity: -1, price: 0.2, when: T0 });
    const html = tx({ ...option({ ...PUT, quantity: -1, price: 0.2, when: at(1) }), source: "statement_html", externalId: "html:abc" });
    const { transactions } = merge([flex, html]);
    expect(transactions).toHaveLength(2);
  });

  it("folds a buyback split over three lines, summing what was paid", () => {
    const { transactions } = merge([
      option({ ...PUT, quantity: 1, price: 0.05, when: T0 }),
      option({ ...PUT, quantity: 1, price: 0.06, when: at(0.5) }),
      option({ ...PUT, quantity: 1, price: 0.07, when: at(1) }),
    ]);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ quantity: 3, price: expect.closeTo(0.06), amount: expect.closeTo(-18), commission: -3 });
  });

  it("folds share fills too", () => {
    const { transactions } = merge([
      stock({ quantity: -100, price: 20, when: T0 }),
      stock({ quantity: -50, price: 21, when: at(1) }),
    ]);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ quantity: -150, price: expect.closeTo(20 + 1 / 3) });
  });

  it("leaves an expiry alone: an uncharged row is a settlement leg, paired elsewhere", () => {
    const { transactions } = merge([
      expire({ ...PUT, quantity: 1, when: T0 }),
      expire({ ...PUT, quantity: 1, when: at(1) }),
    ]);
    expect(transactions).toHaveLength(2);
  });

  it("leaves the two legs of a delivery alone, so the pool still pairs them", () => {
    const [leg, shares] = deliver({ ...PUT, quantity: 1 });
    const { transactions } = merge([leg, shares]);
    expect(transactions).toEqual([leg, shares]);
  });

  it("keeps an unknown unknown rather than summing it away", () => {
    const { transactions } = merge([
      option({ ...PUT, quantity: -1, price: 0.2, when: T0 }),
      tx({ ...option({ ...PUT, quantity: -1, price: 0.21, when: at(1) }), amount: null }),
    ]);
    expect(transactions[0]).toMatchObject({ quantity: -2, amount: null, commission: -2 });
  });
});
