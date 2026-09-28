import { describe, expect, it } from "vitest";
import type { ContractKey, JournalRow, Position } from "@ib/ledger";
import { condorPositions } from "./condors.ts";
import { option } from "./fixtures.ts";
import { buildRiskReport } from "./report.ts";
import type { PricedSnapshot } from "./strategy.ts";

const EXPIRY = "2026-08-29";
const SPY = (right: "C" | "P", strike: number): ContractKey => ({ ticker: "SPY", secType: "OPT", right, strike, expiry: EXPIRY, currency: "USD" });
const COMPOSITE: ContractKey = { ticker: "SPY", secType: "OPT", right: "", strike: null, expiry: EXPIRY, currency: "USD" };

function row(overrides: Partial<JournalRow> & Pick<JournalRow, "contract">): JournalRow {
  const { contract } = overrides;
  return {
    id: "x#1", strategy: "condors", kind: "short_put", ticker: contract.ticker, label: "", currency: contract.currency,
    startWhen: "2026-08-03T14:30:00.000Z", quantity: -1, strike: contract.strike, openPrice: 1, openTotal: 100, openCommission: -1, openNet: 99,
    assigned: false, endWhen: null, closePrice: null, closeTotal: null, closeCommission: null, closeNet: null, pnl: null,
    ongoing: true, event: null, orphan: false, note: null, openIds: [], closeIds: [], ...overrides,
  };
}

const kindOf = (contract: ContractKey, quantity: number): JournalRow["kind"] =>
  quantity < 0 ? (contract.right === "P" ? "short_put" : "short_call") : contract.right === "P" ? "long_put" : "long_call";

/**
 * One SPY 620/625/660/665 condor sold at 0.5 net: wings bought at 0.3, body sold at 0.6 and 0.5.
 * `closed` maps a strike to the overrides that close that leg.
 */
function condor(id: string, startWhen: string, closed: Record<number, Partial<JournalRow>> = {}): JournalRow {
  const leg = (contract: ContractKey, quantity: number, openPrice: number) =>
    row({ id: `${id}-leg${contract.strike}`, contract, kind: kindOf(contract, quantity), quantity, openPrice, startWhen, ...closed[contract.strike as number] });
  return row({
    id,
    kind: "condor",
    contract: COMPOSITE,
    label: "SPY Aug29'26 IC 620/625/660/665",
    startWhen,
    quantity: -1,
    strike: null,
    openPrice: 0.5,
    legs: [leg(SPY("P", 620), 1, 0.3), leg(SPY("P", 625), -1, 0.6), leg(SPY("C", 660), -1, 0.5), leg(SPY("C", 665), 1, 0.3)],
  });
}

const CLOSED_665: Partial<JournalRow> = { endWhen: "2026-08-10T14:30:00.000Z", closePrice: 0.1, pnl: -21, ongoing: false, event: "sold" };

const leg = (right: "C" | "P", strike: number, quantity: number, marketPrice: number | null, extra: Partial<Position> = {}): Position =>
  option({ symbol: "SPY", right, strike, expiry: EXPIRY, quantity, avgPrice: 0, marketPrice, marketValue: marketPrice === null ? null : marketPrice * quantity * 100, ...extra });

function priced(positions: Position[]): PricedSnapshot {
  return { positions, report: buildRiskReport(positions, null) };
}

/** Cost to close 0.15 against a 0.5 credit: under half, so buy back. */
const CHEAP = () => priced([leg("P", 620, 1, 0.05), leg("P", 625, -1, 0.15), leg("C", 660, -1, 0.1), leg("C", 665, 1, 0.05)]);

/**
 * A credit to close (−0.4): IB would pay to shut this condor down. Its absolute value (0.4) is
 * *above* half the 0.5 credit, so `evaluateBuyback(0.5, −0.4)` alone — which takes Math.abs of
 * both prices — would say "keep"; only the `closingCost <= 0` guard in `condorPositions` catches
 * this and forces "buy back".
 */
const NEGATIVE_CLOSE = () => priced([leg("P", 620, 1, 0.3), leg("P", 625, -1, 0.1), leg("C", 660, -1, 0.1), leg("C", 665, 1, 0.3)]);

describe("condorPositions", () => {
  it("gives one line per open condor: credit, closing cost, value, total P/L and buyback decision", () => {
    const [line] = condorPositions([condor("ic#1", "2026-08-03T14:30:00.000Z")], CHEAP());
    expect(line).toMatchObject({ id: "ic#1", title: "SPY Aug29'26 IC 620/625/660/665", kind: "iron_condor", label: "iron condor", quantity: -1, credit: 0.5, decision: "buy back", naked: 0 });
    expect(line.closingCost).toBeCloseTo(0.15);
    expect(line.marketValue).toBeCloseTo(-15);
    // 0.5 credit − 0.15 to close, on 100 shares.
    expect(line.pnl).toBeCloseTo(35);
    expect(line.realizedPnl).toBe(0);
    expect(line.legs.map((l) => [l.contract.right, l.contract.strike, l.quantity, l.closed])).toEqual([
      ["P", 620, 1, false], ["P", 625, -1, false], ["C", 660, -1, false], ["C", 665, 1, false],
    ]);
    expect(line.legs.map((l) => l.pnl)).toEqual([expect.closeTo(-25), expect.closeTo(45), expect.closeTo(40), expect.closeTo(-25)]);
  });

  it("keeps a condor whose closing cost is above half its credit", () => {
    const snapshot = priced([leg("P", 620, 1, 0.1), leg("P", 625, -1, 0.4), leg("C", 660, -1, 0.3), leg("C", 665, 1, 0.1)]);
    expect(condorPositions([condor("ic#1", "2026-08-03T14:30:00.000Z")], snapshot)[0].decision).toBe("keep");
  });

  it("buys back a complete condor with a negative closing cost, even though evaluateBuyback alone would keep it", () => {
    const [line] = condorPositions([condor("ic#1", "2026-08-03T14:30:00.000Z")], NEGATIVE_CLOSE());
    expect(line.closingCost).toBeCloseTo(-0.4);
    expect(line.decision).toBe("buy back");
  });

  it("sums the day P&L of the open legs and never gives the condor a day change", () => {
    const snapshot = priced([
      leg("P", 620, 1, 0.05, { dailyPnl: -1, dayChange: -0.1 }),
      leg("P", 625, -1, 0.15, { dailyPnl: 4, dayChange: -0.2 }),
      leg("C", 660, -1, 0.1, { dailyPnl: 3, dayChange: -0.3 }),
      leg("C", 665, 1, 0.05, { dailyPnl: -2, dayChange: -0.4 }),
    ]);
    const [line] = condorPositions([condor("ic#1", "2026-08-03T14:30:00.000Z")], snapshot);
    expect(line.dailyPnl).toBeCloseTo(4);
    expect(line.legs[0].dayChange).toBe(-0.1);
    expect("dayChange" in line).toBe(false);
  });

  it("adds what the closed legs realized to what the open ones would, and gives no decision", () => {
    const [line] = condorPositions([condor("ic#1", "2026-08-03T14:30:00.000Z", { 665: CLOSED_665 })], CHEAP());
    expect(line).toMatchObject({ kind: "partial_iron_condor", label: "partial iron condor", decision: null, realizedPnl: -21 });
    // Open legs: −25 + 45 + 40 = 60, plus −21 realized.
    expect(line.pnl).toBeCloseTo(39);
    // Only the open legs: 0.15 + 0.1 − 0.05.
    expect(line.closingCost).toBeCloseTo(0.2);
    const closed = line.legs[3];
    expect(closed).toMatchObject({ closed: true, lastPrice: 0.1, marketValue: null, dailyPnl: null, dayChange: null, pnl: -21 });
  });

  it("shows only the open composite of a condor partly bought back", () => {
    const shut = { ...condor("ic#2", "2026-08-03T14:30:00.000Z"), endWhen: "2026-08-20T14:30:00.000Z" };
    const lines = condorPositions([condor("ic#1", "2026-08-03T14:30:00.000Z"), shut], null);
    expect(lines.map((l) => l.id)).toEqual(["ic#1"]);
  });

  it("gives the still-open composite its own quantity and leg sizes, not the closed composite's", () => {
    // A ×2 condor partly bought back down to ×1: the journal keeps the closed ×2 composite
    // (its own legs at ±2) and opens a fresh ×1 composite (its own legs at ±1).
    const scaleLegs = (base: JournalRow, factor: number): JournalRow => ({
      ...base,
      legs: base.legs!.map((leg) => ({ ...leg, quantity: (leg.quantity as number) * factor })),
    });
    const open = { ...scaleLegs(condor("ic#1", "2026-08-03T14:30:00.000Z"), 1), quantity: -1 };
    const closed = {
      ...scaleLegs(condor("ic#2", "2026-08-01T14:30:00.000Z"), 2),
      quantity: -2,
      endWhen: "2026-08-20T14:30:00.000Z",
    };
    const [line] = condorPositions([open, closed], null);
    expect(line.id).toBe("ic#1");
    expect(line.quantity).toBe(-1);
    expect(line.legs.map((l) => Math.abs(l.quantity))).toEqual([1, 1, 1, 1]);
  });

  it("leaves every priced figure null when an open leg has no price, never 0", () => {
    const snapshot = priced([leg("P", 620, 1, 0.05), leg("P", 625, -1, 0.15), leg("C", 660, -1, 0.1), leg("C", 665, 1, null)]);
    const [line] = condorPositions([condor("ic#1", "2026-08-03T14:30:00.000Z")], snapshot);
    expect(line).toMatchObject({ closingCost: null, marketValue: null, pnl: null, decision: null, dailyPnl: null });
  });

  it("still lists a condor without a snapshot, unpriced", () => {
    const [line] = condorPositions([condor("ic#1", "2026-08-03T14:30:00.000Z")], null);
    expect(line).toMatchObject({ credit: 0.5, closingCost: null, marketValue: null, pnl: null, decision: null, naked: 0 });
  });

  it("gives two condors on the same strikes, opened apart, a line each", () => {
    const lines = condorPositions([condor("ic#1", "2026-08-03T14:30:00.000Z"), condor("ic#2", "2026-08-05T14:30:00.000Z")], null);
    expect(lines.map((l) => l.id)).toEqual(["ic#1", "ic#2"]);
  });

  it("marks the sold leg left naked by a closed wing, on the leg and on its condor", () => {
    // The 665 wing is gone from IB: the 660 call is naked there.
    const snapshot = priced([leg("P", 620, 1, 0.05), leg("P", 625, -1, 0.15), leg("C", 660, -1, 0.1)]);
    const [line] = condorPositions([condor("ic#1", "2026-08-03T14:30:00.000Z", { 665: CLOSED_665 })], snapshot);
    expect(line.naked).toBe(1);
    expect(line.legs.map((l) => l.naked)).toEqual([0, 0, 1, 0]);
  });

  it("gives the naked part to the condor whose wing is closed, even when it opened last", () => {
    // Two condors; the later one sold its 665 wing. IB: 660 ×−2 against 665 ×+1, one naked.
    const snapshot = priced([leg("P", 620, 2, 0.05), leg("P", 625, -2, 0.15), leg("C", 660, -2, 0.1), leg("C", 665, 1, 0.05)]);
    const lines = condorPositions(
      [condor("ic#1", "2026-08-03T14:30:00.000Z"), condor("ic#2", "2026-08-05T14:30:00.000Z", { 665: CLOSED_665 })],
      snapshot,
    );
    expect(lines.map((l) => [l.id, l.naked])).toEqual([["ic#1", 0], ["ic#2", 1]]);
  });
});

describe("condorPositions — the buyback advice is timed", () => {
  const withAsOf = (snapshot: PricedSnapshot): PricedSnapshot => ({ ...snapshot, asOf: "2026-08-10T16:00:00.000Z" });

  it("measures a condor's life from its composite's opening to its expiry", () => {
    const [line] = condorPositions([condor("ic#1", "2026-08-03T14:30:00.000Z")], withAsOf(CHEAP()));
    const total = (Date.parse("2026-08-29T16:00:00.000Z") - Date.parse("2026-08-03T14:30:00.000Z")) / 86_400_000;
    expect(line.buyback?.totalDays).toBeCloseTo(total, 6);
    expect(line.buyback?.remainingDays).toBeCloseTo(19, 6);
    expect(line.decision).toBe(line.buyback?.decision);
  });

  it("keeps buy back with a zero threshold for a negative closing cost", () => {
    const [line] = condorPositions([condor("ic#1", "2026-08-03T14:30:00.000Z")], withAsOf(NEGATIVE_CLOSE()));
    expect(line.decision).toBe("buy back");
    expect(line.buyback).toMatchObject({ decision: "buy back", threshold: 0 });
  });

  it("gives a partial condor no advice", () => {
    const [line] = condorPositions([condor("ic#1", "2026-08-03T14:30:00.000Z", { 665: CLOSED_665 })], withAsOf(CHEAP()));
    expect(line.buyback).toBeNull();
  });
});
