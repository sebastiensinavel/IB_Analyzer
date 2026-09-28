import { describe, expect, it } from "vitest";
import { newLot, type Lot } from "./book.ts";
import { sharesContract } from "./contract.ts";
import { coverAttribution, salePlan, strikePlan } from "./exitOrder.ts";
import type { Strategy } from "./types.ts";

const SHARES = sharesContract("AISP", "USD");

function shares(id: string, strategy: Strategy, price: number | null, quantity = 100, ratio: number | null = null): Lot {
  return newLot({
    id,
    contract: SHARES,
    strategy,
    kind: "shares",
    openWhen: "2026-01-01T15:00:00.000Z",
    openPrice: price,
    openAmount: price === null ? null : -price * quantity,
    openCommission: 0,
    quantity,
    openIds: [id],
    ratio,
  });
}

const ids = (plan: { lot: Lot; quantity: number }[]) => plan.map((p) => [p.lot.id, p.quantity]);

describe("strikePlan (R1)", () => {
  it("delivers the dearest lot at or below the strike, not the oldest", () => {
    const six = shares("six", "wheel", 6);
    const five = shares("five", "wheel", 5);
    expect(ids(strikePlan([six, five], 5, 1))).toEqual([["five", 100]]);
  });

  it("takes the dearest of several lots below the strike", () => {
    expect(ids(strikePlan([shares("four", "wheel", 4), shares("six", "wheel", 6), shares("five", "wheel", 5)], 7, 1))).toEqual([["six", 100]]);
  });

  it("falls back on the cheapest lot when none is at or below the strike", () => {
    expect(ids(strikePlan([shares("seven", "wheel", 7), shares("six", "wheel", 6)], 5, 1))).toEqual([["six", 100]]);
  });

  it("keeps book order between equal prices", () => {
    expect(ids(strikePlan([shares("a", "wheel", 5), shares("b", "wheel", 5)], 5, 1))).toEqual([["a", 100]]);
  });

  it("ranks a lot without a price after every priced lot", () => {
    expect(ids(strikePlan([shares("none", "wheel", null), shares("seven", "wheel", 7)], 5, 1))).toEqual([["seven", 100]]);
  });

  it("chains lots when one is not enough, each chosen by the same rule", () => {
    expect(ids(strikePlan([shares("four", "wheel", 4), shares("five", "wheel", 5), shares("eight", "wheel", 8)], 5, 3))).toEqual([
      ["five", 100],
      ["four", 100],
      ["eight", 100],
    ]);
  });

  it("leaves out what `reserved` holds and stops at `maxShares`", () => {
    const five = shares("five", "wheel", 5, 200);
    const four = shares("four", "wheel", 4);
    expect(ids(strikePlan([five, four], 5, 2, new Map([[five, 100]])))).toEqual([
      ["five", 100],
      ["four", 100],
    ]);
    expect(ids(strikePlan([five, four], 5, 2, new Map(), 150))).toEqual([["five", 150]]);
  });

  it("counts a contract with the lot's own ratio", () => {
    expect(ids(strikePlan([shares("adj", "wheel", 5, 300, 150)], 5, 1))).toEqual([["adj", 150]]);
  });

  it("returns nothing, without looping, when there is nothing to take", () => {
    expect(strikePlan([], 5, 1)).toEqual([]);
    expect(strikePlan([shares("a", "wheel", 5)], 5, 1e-12)).toEqual([]);
  });
});

describe("coverAttribution (spec 33 §2)", () => {
  it("serves the calls by rising strike, each by R1", () => {
    const five = shares("five", "wheel", 5);
    const six = shares("six", "wheel", 6);
    const covered = coverAttribution([six, five], [
      { strike: 7, contracts: 1 },
      { strike: 5, contracts: 1 },
    ]);
    expect(covered.get(five)).toBe(100);
    expect(covered.get(six)).toBe(100);
  });

  it("covers part of a lot, and never more than the lots hold", () => {
    const five = shares("five", "wheel", 5, 200);
    expect(coverAttribution([five], [{ strike: 6, contracts: 1 }]).get(five)).toBe(100);
    expect(coverAttribution([five], [{ strike: 6, contracts: 5 }]).get(five)).toBe(200);
  });
});

describe("salePlan (R3)", () => {
  it("sells free shares Others first, then LEAPS, then the Wheel, whatever the price", () => {
    const wheel = shares("wheel", "wheel", 5);
    const leaps = shares("leaps", "leaps", 2);
    const others = shares("others", "others", 9);
    expect(ids(salePlan([wheel, leaps, others], new Map(), 300))).toEqual([
      ["others", 100],
      ["leaps", 100],
      ["wheel", 100],
    ]);
  });

  it("sells the cheapest lot first within a strategy", () => {
    expect(ids(salePlan([shares("eight", "others", 8), shares("four", "others", 4)], new Map(), 100))).toEqual([["four", 100]]);
  });

  it("touches covered shares only once every free share is gone", () => {
    const three = shares("three", "wheel", 3);
    const eight = shares("eight", "others", 8);
    const covered = new Map([[three, 100]]);
    expect(ids(salePlan([three, eight], covered, 100))).toEqual([["eight", 100]]);
    expect(ids(salePlan([three, eight], covered, 200))).toEqual([
      ["eight", 100],
      ["three", 100],
    ]);
  });

  it("returns a half-covered lot as one item when both passes reach it", () => {
    const five = shares("five", "wheel", 5, 200);
    expect(ids(salePlan([five], new Map([[five, 100]]), 200))).toEqual([["five", 200]]);
  });

  it("sells covered shares cheapest first", () => {
    const four = shares("four", "wheel", 4);
    const five = shares("five", "wheel", 5);
    expect(ids(salePlan([five, four], new Map([[four, 100], [five, 100]]), 100))).toEqual([["four", 100]]);
  });

  it("stops when the lots run out: the caller opens the rest", () => {
    expect(ids(salePlan([shares("a", "others", 4)], new Map(), 250))).toEqual([["a", 100]]);
  });
});
