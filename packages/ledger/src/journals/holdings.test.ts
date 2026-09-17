import { beforeEach, describe, expect, it } from "vitest";
import { sharesContract } from "./contract.ts";
import { deliver, option, resetIds, stock } from "./fixtures.ts";
import { wheelHoldings } from "./holdings.ts";
import { buildJournals } from "./replay.ts";
import type { JournalRow } from "./types.ts";

beforeEach(resetIds);

const D1 = "2026-08-01T14:30:00.000Z";
const PUT = { right: "P" as const, strike: 17, expiry: "2026-10-02" };
const CALL = { right: "C" as const, strike: 20, expiry: "2026-11-20" };

/** Wheel shares: 200 MQZA delivered at 17, still open. Fixtures cannot produce a null quantity or price on a row, so these three scenarios build JournalRow objects directly. */
function shareRow(overrides: Partial<JournalRow>): JournalRow {
  return {
    id: "s#1", strategy: "wheel", kind: "shares", ticker: "MQZA", label: "MQZA", currency: "USD",
    contract: sharesContract("MQZA", "USD"),
    startWhen: D1, quantity: 200, strike: null,
    openPrice: 17, openTotal: -3400, openCommission: 0, openNet: -3400, assigned: true,
    endWhen: null, closePrice: null, closeTotal: null, closeCommission: null, closeNet: null, pnl: null,
    ongoing: true, event: null, orphan: false, note: null, openIds: [], closeIds: [],
    ...overrides,
  };
}

/** A Wheel call sold: one MQZA 20 call, still open. */
function callRow(overrides: Partial<JournalRow>): JournalRow {
  return {
    id: "c#1", strategy: "wheel", kind: "short_call", ticker: "MQZA", label: "MQZA Nov20'26 20 Call", currency: "USD",
    contract: { ticker: "MQZA", secType: "OPT", right: "C", strike: 20, expiry: "2026-11-20", currency: "USD" },
    startWhen: "2026-10-05T14:30:00.000Z", quantity: -1, strike: 20,
    openPrice: 0.5, openTotal: 50, openCommission: -1, openNet: 49, assigned: false,
    endWhen: null, closePrice: null, closeTotal: null, closeCommission: null, closeNet: null, pnl: null,
    ongoing: true, event: null, orphan: false, note: null, openIds: [], closeIds: [],
    ...overrides,
  };
}

describe("wheelHoldings", () => {
  it("reads an assigned put and the call sold on its shares", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -2, price: 0.21, when: D1 }),
      ...deliver({ ...PUT, quantity: 2 }),
      option({ ...CALL, quantity: -1, price: 0.5, when: "2026-10-05T14:30:00.000Z" }),
    ]);
    expect(wheelHoldings(report.rows)).toEqual([
      { ticker: "MQZA", currency: "USD", quantity: 200, averageAssignmentPrice: 17, assignedTotal: 3400, openCallContracts: 1, averageCallStrike: 20, coveredShares: 100 },
    ]);
  });

  it("averages two assignments at different strikes, the total equal to the Wheel's assigned capital", () => {
    const PUT15 = { right: "P" as const, strike: 15, expiry: "2026-10-16" };
    const report = buildJournals([
      option({ ...PUT, quantity: -1, price: 0.21, when: D1 }),
      ...deliver({ ...PUT, quantity: 1 }),
      option({ ...PUT15, quantity: -1, price: 0.3, when: "2026-10-05T14:30:00.000Z" }),
      ...deliver({ ...PUT15, quantity: 1 }),
    ]);
    const [holding] = wheelHoldings(report.rows);
    expect(holding).toMatchObject({ quantity: 200, averageAssignmentPrice: 16, assignedTotal: 3200, openCallContracts: 0, averageCallStrike: null, coveredShares: 0 });
    expect(report.capital.wheel[0].exposure[0].assigned).toBe(holding.assignedTotal);
  });

  it("reads shares taken over by a covered call at the call's strike", () => {
    const report = buildJournals([
      stock({ quantity: 100, price: 10, when: "2026-03-02T14:30:00.000Z" }),
      option({ right: "C", strike: 20, expiry: "2026-09-18", quantity: -1, price: 0.5, when: "2026-08-03T14:30:00.000Z" }),
    ]);
    expect(wheelHoldings(report.rows)).toEqual([
      { ticker: "MQZA", currency: "USD", quantity: 100, averageAssignmentPrice: 20, assignedTotal: 2000, openCallContracts: 1, averageCallStrike: 20, coveredShares: 100 },
    ]);
  });

  it("forgets a call bought back and averages the calls still open by contract", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -3, price: 0.21, when: D1 }),
      ...deliver({ ...PUT, quantity: 3 }),
      option({ right: "C", strike: 20, expiry: "2026-11-20", quantity: -1, price: 0.5, when: "2026-10-05T14:30:00.000Z" }),
      option({ right: "C", strike: 22, expiry: "2026-12-18", quantity: -1, price: 0.4, when: "2026-10-06T14:30:00.000Z" }),
      option({ right: "C", strike: 18, expiry: "2026-11-20", quantity: -1, price: 0.9, when: "2026-10-07T14:30:00.000Z" }),
      option({ right: "C", strike: 18, expiry: "2026-11-20", quantity: 1, price: 0.1, when: "2026-10-09T14:30:00.000Z" }),
    ]);
    expect(wheelHoldings(report.rows)).toEqual([
      { ticker: "MQZA", currency: "USD", quantity: 300, averageAssignmentPrice: 17, assignedTotal: 5100, openCallContracts: 2, averageCallStrike: 21, coveredShares: 200 },
    ]);
  });

  it("caps the covered shares at the shares still held when some were sold under open calls", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -2, price: 0.21, when: D1 }),
      ...deliver({ ...PUT, quantity: 2 }),
      option({ ...CALL, quantity: -2, price: 0.5, when: "2026-10-05T14:30:00.000Z" }),
      stock({ quantity: -100, price: 18, when: "2026-10-08T15:00:00.000Z" }),
    ]);
    expect(wheelHoldings(report.rows)).toEqual([
      { ticker: "MQZA", currency: "USD", quantity: 100, averageAssignmentPrice: 17, assignedTotal: 1700, openCallContracts: 2, averageCallStrike: 20, coveredShares: 100 },
    ]);
  });

  it("leaves out a ticker whose Wheel shares are all sold, even with a call still open", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -1, price: 0.21, when: D1 }),
      ...deliver({ ...PUT, quantity: 1 }),
      option({ ...CALL, quantity: -1, price: 0.5, when: "2026-10-05T14:30:00.000Z" }),
      stock({ quantity: -100, price: 18, when: "2026-10-08T15:00:00.000Z" }),
    ]);
    expect(wheelHoldings(report.rows)).toEqual([]);
  });

  it("counts the Wheel's shares only, never shares bought beside them", () => {
    const report = buildJournals([
      option({ ...PUT, quantity: -2, price: 0.21, when: D1 }),
      ...deliver({ ...PUT, quantity: 2 }),
      stock({ quantity: 50, price: 18, when: "2026-10-05T14:30:00.000Z" }),
    ]);
    expect(wheelHoldings(report.rows)).toEqual([
      { ticker: "MQZA", currency: "USD", quantity: 200, averageAssignmentPrice: 17, assignedTotal: 3400, openCallContracts: 0, averageCallStrike: null, coveredShares: 0 },
    ]);
  });

  it("keeps the quantity of a share row with an unknown price but nulls the averages", () => {
    const rows = [shareRow({}), shareRow({ id: "s#2", openPrice: null, openTotal: null, openNet: null })];
    expect(wheelHoldings(rows)).toEqual([
      { ticker: "MQZA", currency: "USD", quantity: 400, averageAssignmentPrice: null, assignedTotal: null, openCallContracts: 0, averageCallStrike: null, coveredShares: 0 },
    ]);
  });

  it("keeps the contracts of a call with an unknown strike but nulls the average strike", () => {
    const rows = [shareRow({}), callRow({ strike: null })];
    expect(wheelHoldings(rows)).toEqual([
      { ticker: "MQZA", currency: "USD", quantity: 200, averageAssignmentPrice: 17, assignedTotal: 3400, openCallContracts: 1, averageCallStrike: null, coveredShares: 100 },
    ]);
  });

  it("skips a share row with an unknown quantity rather than counting it as zero or nulling the averages", () => {
    const rows = [
      shareRow({ quantity: 100, openTotal: -1700, openNet: -1700 }),
      shareRow({ id: "s#2", quantity: null, openPrice: null, openTotal: null, openNet: null }),
    ];
    expect(wheelHoldings(rows)).toEqual([
      { ticker: "MQZA", currency: "USD", quantity: 100, averageAssignmentPrice: 17, assignedTotal: 1700, openCallContracts: 0, averageCallStrike: null, coveredShares: 0 },
    ]);
  });
});
