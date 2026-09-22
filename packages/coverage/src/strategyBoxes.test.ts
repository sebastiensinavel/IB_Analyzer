import { describe, expect, it } from "vitest";
import type { ContractKey } from "@ib/ledger";
import type { StrategyLine, StrategyPositions, WheelShareLine } from "./strategy.ts";
import { splitLeaps, splitWheelShares, strategyBoxContents } from "./strategyBoxes.ts";
import { DETAIL_GROUPS, KIND_LABELS, type DetailGroupId, type PositionKind } from "./constants.ts";

function share(overrides: Partial<WheelShareLine> = {}): WheelShareLine {
  return {
    ticker: "XYZ", currency: "USD", quantity: 200, averageAssignmentPrice: 17, assignedTotal: 3400,
    openCallContracts: 1, averageCallStrike: 15, coveredShares: 100, lastPrice: 18, unrealizedPnl: 200,
    dailyPnl: 40, dayChange: 0.01, callStrikeBelowAssignment: true, ...overrides,
  };
}

const opt = (right: "C" | "P", strike: number, expiry: string): ContractKey => ({ ticker: "XYZ", secType: "OPT", right, strike, expiry, currency: "USD" });

function strategyLine(kind: PositionKind, overrides: Partial<StrategyLine> = {}): StrategyLine {
  return {
    contract: opt(kind === "short_put" ? "P" : "C", 15, "2027-06-18"), kind, label: KIND_LABELS[kind], quantity: 2, avgPrice: 3,
    lastPrice: 4, marketValue: 800, unrealizedPnl: 200, dailyPnl: 20, dayChange: 0.05, decision: null, position: null,
    coverage: [], used: 1, ...overrides,
  };
}

function positions(shares: WheelShareLine[], groups: Partial<Record<DetailGroupId, StrategyLine[]>>): StrategyPositions {
  const empty = Object.fromEntries(DETAIL_GROUPS.map((group) => [group.id, [] as StrategyLine[]])) as Record<DetailGroupId, StrategyLine[]>;
  return { shares, groups: { ...empty, ...groups } };
}

describe("splitWheelShares", () => {
  it("cuts 200 shares under one call into 100 free and 100 covered, prorating the amounts", () => {
    const { uncovered, covered } = splitWheelShares(share());
    expect(uncovered).toEqual(share({
      quantity: 100, assignedTotal: 1700, openCallContracts: 0, averageCallStrike: null, coveredShares: 0,
      unrealizedPnl: 100, dailyPnl: 20, callStrikeBelowAssignment: false,
    }));
    expect(covered).toEqual(share({ quantity: 100, assignedTotal: 1700, coveredShares: 100, unrealizedPnl: 100, dailyPnl: 20 }));
  });

  it("keeps a null amount null in both parts", () => {
    const { uncovered, covered } = splitWheelShares(share({ assignedTotal: null, averageAssignmentPrice: null, unrealizedPnl: null, dailyPnl: null, dayChange: null }));
    expect(uncovered).toMatchObject({ assignedTotal: null, unrealizedPnl: null, dailyPnl: null });
    expect(covered).toMatchObject({ assignedTotal: null, unrealizedPnl: null, dailyPnl: null });
  });

  it("has no free part when everything is covered, and no covered part without a call", () => {
    expect(splitWheelShares(share({ quantity: 100, coveredShares: 100 })).uncovered).toBeNull();
    expect(splitWheelShares(share({ openCallContracts: 0, averageCallStrike: null, coveredShares: 0, callStrikeBelowAssignment: false })).covered).toBeNull();
  });
});

describe("splitLeaps", () => {
  it("cuts 2 LEAPS with 1 used into 1 free and 1 covered, prorating the amounts", () => {
    const { uncovered, covered } = splitLeaps(strategyLine("long_call"));
    expect(uncovered).toEqual(strategyLine("long_call", { quantity: 1, marketValue: 400, unrealizedPnl: 100, dailyPnl: 10, used: 0 }));
    expect(covered).toEqual(strategyLine("long_call", { quantity: 1, marketValue: 400, unrealizedPnl: 100, dailyPnl: 10, used: 1 }));
  });

  it("leaves a LEAPS the snapshot does not hold whole in the free part, without a used count", () => {
    const line = strategyLine("long_call", { used: null, lastPrice: null, marketValue: null, unrealizedPnl: null, dailyPnl: null, dayChange: null });
    expect(splitLeaps(line)).toEqual({ uncovered: line, covered: null });
  });

  it("has no free part when every LEAPS is used", () => {
    expect(splitLeaps(strategyLine("long_call", { used: 2 })).uncovered).toBeNull();
  });
});

describe("strategyBoxContents — Wheel", () => {
  it("routes the free part, then the covered part by the call against the assignment price", () => {
    const below = share({ ticker: "BLW" });
    const above = share({ ticker: "ABV", averageCallStrike: 20, callStrikeBelowAssignment: false });
    const equal = share({ ticker: "EQL", averageCallStrike: 17, callStrikeBelowAssignment: false });
    const unknown = share({ ticker: "UNK", averageAssignmentPrice: null, assignedTotal: null, callStrikeBelowAssignment: false });
    const boxes = strategyBoxContents(positions([above, below, equal, unknown], {}), "wheel");
    expect(boxes.shares.sharesUncovered.map((line) => line.ticker)).toEqual(["ABV", "BLW", "EQL", "UNK"]);
    expect(boxes.shares.sharesCallAbove.map((line) => line.ticker)).toEqual(["ABV", "EQL"]);
    expect(boxes.shares.sharesCallBelow.map((line) => [line.ticker, line.callStrikeBelowAssignment])).toEqual([["BLW", true], ["UNK", false]]);
  });

  it("splits the option sales into calls and puts", () => {
    const call = strategyLine("short_call", { quantity: -1, used: null });
    const put = strategyLine("short_put", { quantity: -1, used: null });
    const boxes = strategyBoxContents(positions([], { optionSells: [call, put] }), "wheel");
    expect(boxes.lines.callSells).toEqual([call]);
    expect(boxes.lines.putSells).toEqual([put]);
  });
});

describe("strategyBoxContents — LEAPS", () => {
  it("splits the LEAPS bought into free and covered, keeps the call sales, and never loses a put sale", () => {
    const leaps = strategyLine("long_call");
    const call = strategyLine("short_call", { quantity: -1, used: null });
    const put = strategyLine("short_put", { quantity: -1, used: null });
    const boxes = strategyBoxContents(positions([], { optionBuys: [leaps], optionSells: [call, put] }), "leaps");
    expect(boxes.lines.leapsUncovered.map((line) => line.quantity)).toEqual([1]);
    expect(boxes.lines.leapsCovered.map((line) => line.quantity)).toEqual([1]);
    expect(boxes.lines.callSells).toEqual([call]);
    expect(boxes.lines.other).toEqual([put]);
  });
});

describe("strategyBoxContents — Condors and Others", () => {
  it("passes the Positions groups through untouched", () => {
    const wing = strategyLine("long_put", { used: 1 });
    const boxes = strategyBoxContents(positions([], { optionBuys: [wing] }), "condors");
    expect(boxes.lines.optionBuys).toEqual([wing]);
    expect(boxes.lines.leapsUncovered).toEqual([]);
    expect(boxes.shares.sharesUncovered).toEqual([]);
  });
});
