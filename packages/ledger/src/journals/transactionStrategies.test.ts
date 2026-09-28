import { beforeEach, describe, expect, it } from "vitest";
import { tx } from "../fixtures.ts";
import { option, resetIds, stock } from "./fixtures.ts";
import { buildJournals } from "./replay.ts";
import { transactionStrategies } from "./transactionStrategies.ts";

beforeEach(resetIds);

const BUY = "2026-03-02T14:30:00.000Z";
const SELL_CALL = "2026-08-03T14:30:00.000Z";
const LATER = "2026-08-10T14:30:00.000Z";
const CALL = { right: "C" as const, strike: 20, expiry: "2026-09-18" };
const SPY = { ticker: "SPY", expiry: "2026-08-29" };

function ironCondor(when = "2026-08-01T14:30:00.000Z") {
  return [
    option({ ...SPY, id: "leg1", right: "P", strike: 620, quantity: 1, price: 0.3, when }),
    option({ ...SPY, id: "leg2", right: "P", strike: 625, quantity: -1, price: 0.6, when }),
    option({ ...SPY, id: "leg3", right: "C", strike: 660, quantity: -1, price: 0.5, when }),
    option({ ...SPY, id: "leg4", right: "C", strike: 665, quantity: 1, price: 0.3, when }),
  ];
}

describe("transactionStrategies", () => {
  it("gives a takeover's original purchase both strategies, Wheel first, and the call Wheel alone", () => {
    const report = buildJournals([
      stock({ id: "buy", quantity: 100, price: 10, when: BUY }),
      option({ ...CALL, id: "call", quantity: -1, price: 0.5, when: SELL_CALL }),
    ]);
    const map = transactionStrategies(report.rows);
    expect(map.get("buy")).toEqual(["wheel", "others"]);
    // The integrated close of the Others lot names the call: it must not bring Others in.
    expect(map.get("call")).toEqual(["wheel"]);
  });

  it("gives a share sale cut between Others and the Wheel both strategies", () => {
    const report = buildJournals([
      stock({ id: "buy", quantity: 300, price: 10, when: BUY }),
      option({ ...CALL, id: "call", quantity: -1, price: 0.5, when: SELL_CALL }),
      stock({ id: "sell", quantity: -300, price: 12, when: LATER }),
    ]);
    expect(transactionStrategies(report.rows).get("sell")).toEqual(["wheel", "others"]);
  });

  it("gives every leg of a condor Condors", () => {
    const map = transactionStrategies(buildJournals(ironCondor()).rows);
    for (const id of ["leg1", "leg2", "leg3", "leg4"]) expect(map.get(id)).toEqual(["condors"]);
  });

  it("gives a wing bought back while the condor stays open Condors", () => {
    const WING = "2026-08-10T15:00:00.000Z";
    const map = transactionStrategies(
      buildJournals([
        ...ironCondor(),
        option({ ...SPY, id: "bb3", right: "C", strike: 660, quantity: 1, price: 1.5, when: WING }),
        option({ ...SPY, id: "bb4", right: "C", strike: 665, quantity: -1, price: 0.9, when: WING }),
      ]).rows,
    );
    expect(map.get("bb3")).toEqual(["condors"]);
    expect(map.get("bb4")).toEqual(["condors"]);
  });

  it("gives a long call three months or more from expiry LEAPS", () => {
    const map = transactionStrategies(
      buildJournals([option({ ticker: "AAPL", id: "leaps", right: "C", strike: 200, expiry: "2027-06-17", quantity: 1, price: 30, when: BUY })]).rows,
    );
    expect(map.get("leaps")).toEqual(["leaps"]);
  });

  it("never names an inactive strategy: without Condors the legs are Others", () => {
    const map = transactionStrategies(buildJournals(ironCondor(), undefined, undefined, ["wheel"]).rows);
    for (const id of ["leg1", "leg2", "leg3", "leg4"]) expect(map.get(id)).toEqual(["others"]);
  });

  it("gives every slice of a folded order the strategy of its line", () => {
    const map = transactionStrategies(
      buildJournals([
        stock({ id: "slice1", quantity: 50, price: 10, when: "2026-03-02T14:30:00.000Z" }),
        stock({ id: "slice2", quantity: 50, price: 10, when: "2026-03-02T14:30:01.000Z" }),
      ]).rows,
    );
    expect(map.get("slice1")).toEqual(["others"]);
    expect(map.get("slice2")).toEqual(["others"]);
  });

  it("leaves a deposit out of the map", () => {
    const deposit = tx({ externalId: "dep", kind: "transfer", symbol: "", secType: "", quantity: null, price: null, amount: 1000, commission: null, when: BUY });
    const report = buildJournals([deposit, stock({ id: "buy", quantity: 100, price: 10, when: LATER })]);
    const map = transactionStrategies(report.rows);
    expect(map.has("dep")).toBe(false);
    expect(map.get("buy")).toEqual(["others"]);
  });
});
