import type { Position, Transaction } from "@ib/ledger";
import type { SectorRecord, SnapshotRecord } from "@/db/schema";

function trade(overrides: Partial<Transaction>): Transaction {
  return {
    accountId: "beta", externalId: "", source: "flex", kind: "trade", symbol: "", secType: "OPT", right: "", strike: null, expiry: null,
    quantity: null, price: null, amount: null, commission: -1, currency: "USD", when: "", description: "", ...overrides,
  };
}

const MARA_PUT = { symbol: "MQZA  261002P00017000", right: "P" as const, strike: 17, expiry: "2026-10-02" };
const MARA_CALL = { symbol: "MQZA  260821C00020000", right: "C" as const, strike: 20, expiry: "2026-08-21" };
const ZZZ_LEAPS = { symbol: "ZZZ   270618C00015000", right: "C" as const, strike: 15, expiry: "2027-06-18" };
const ZZZ_CALL = { symbol: "ZZZ   260918C00020000", right: "C" as const, strike: 20, expiry: "2026-09-18" };
const SPY = (right: "C" | "P", strike: number) => ({ symbol: `SPY   260829${right}00${strike}000`, right, strike, expiry: "2026-08-29" });
const XOM_PUT = { symbol: "XOM   261016P00110000", right: "P" as const, strike: 110, expiry: "2026-10-16" };
const QQQ = (right: "C" | "P", strike: number) => ({ symbol: `QQQ   261016${right}00${strike}000`, right, strike, expiry: "2026-10-16" });
const MARA_CALL_15 = { symbol: "MQZA  261016C00015000", right: "C" as const, strike: 15, expiry: "2026-10-16" };

/**
 * beta: two MQZA puts sold, assigned, two calls sold on the shares and expired;
 * one ZZZ LEAPS with a call sold against it; one SPY condor expired; ten AAPL bought.
 */
export const SAMPLE_JOURNAL_TRANSACTIONS: Transaction[] = [
  trade({ externalId: "flex:trade:101", ...MARA_PUT, quantity: -2, price: 0.21, amount: 42, when: "2026-06-01T14:30:00.000Z" }),
  trade({ externalId: "flex:trade:102", ...MARA_PUT, quantity: 2, price: 0, amount: 0, commission: null, when: "2026-07-17T20:00:00.000Z" }),
  trade({ externalId: "flex:trade:103", symbol: "MQZA", secType: "STK", quantity: 200, price: 17, amount: -3400, commission: 0, when: "2026-07-17T20:00:00.000Z" }),
  trade({ externalId: "flex:trade:104", ...MARA_CALL, quantity: -2, price: 0.5, amount: 100, when: "2026-07-20T14:30:00.000Z" }),
  trade({ externalId: "flex:trade:105", ...MARA_CALL, quantity: 2, price: 0, amount: 0, commission: null, when: "2026-08-21T20:00:00.000Z" }),
  trade({ externalId: "flex:trade:106", ...ZZZ_LEAPS, quantity: 1, price: 3, amount: -300, when: "2026-06-05T14:30:00.000Z" }),
  trade({ externalId: "flex:trade:107", ...ZZZ_CALL, quantity: -1, price: 0.5, amount: 50, when: "2026-06-10T14:30:00.000Z" }),
  trade({ externalId: "flex:trade:108", ...SPY("P", 620), quantity: 1, price: 0.3, amount: -30, when: "2026-08-03T14:30:00.000Z" }),
  trade({ externalId: "flex:trade:109", ...SPY("P", 625), quantity: -1, price: 0.6, amount: 60, when: "2026-08-03T14:30:00.000Z" }),
  trade({ externalId: "flex:trade:110", ...SPY("C", 660), quantity: -1, price: 0.5, amount: 50, when: "2026-08-03T14:30:00.000Z" }),
  trade({ externalId: "flex:trade:111", ...SPY("C", 665), quantity: 1, price: 0.3, amount: -30, when: "2026-08-03T14:30:00.000Z" }),
  trade({ externalId: "flex:trade:112", ...SPY("P", 620), quantity: -1, price: 0, amount: 0, commission: null, when: "2026-08-29T20:00:00.000Z" }),
  trade({ externalId: "flex:trade:113", ...SPY("P", 625), quantity: 1, price: 0, amount: 0, commission: null, when: "2026-08-29T20:00:00.000Z" }),
  trade({ externalId: "flex:trade:114", ...SPY("C", 660), quantity: 1, price: 0, amount: 0, commission: null, when: "2026-08-29T20:00:00.000Z" }),
  trade({ externalId: "flex:trade:115", ...SPY("C", 665), quantity: -1, price: 0, amount: 0, commission: null, when: "2026-08-29T20:00:00.000Z" }),
  trade({ externalId: "flex:trade:116", symbol: "AAPL", secType: "STK", quantity: 10, price: 180, amount: -1800, when: "2026-05-15T14:30:00.000Z" }),
];

function position(overrides: Partial<Position>): Position {
  return {
    symbol: "", secType: "OPT", right: "", strike: null, expiry: null, multiplier: 100, quantity: 0, avgPrice: null,
    marketPrice: null, marketValue: null, unrealizedPnl: null, currency: "USD", conid: "", description: "", ...overrides,
  };
}

/** Exactly what the ledger above leaves open on 2026-09-02. */
export const SAMPLE_JOURNAL_SNAPSHOT: SnapshotRecord = {
  accountId: "beta",
  source: "flex",
  asOf: "2026-09-02",
  importedAt: "2026-09-03T06:00:00.000Z",
  cashAvailable: 12000,
  positions: [
    position({ symbol: "MQZA", secType: "STK", multiplier: 1, quantity: 200, description: "MQZA HOLDINGS" }),
    position({ symbol: "ZZZ", right: "C", strike: 15, expiry: "2027-06-18", quantity: 1, description: "ZZZ 18JUN27 15 C" }),
    position({ symbol: "ZZZ", right: "C", strike: 20, expiry: "2026-09-18", quantity: -1, description: "ZZZ 18SEP26 20 C" }),
    position({ symbol: "AAPL", secType: "STK", multiplier: 1, quantity: 10, description: "APPLE INC" }),
  ],
};

/**
 * Demo only, never in the tests' ledger: a MQZA 15 call sold on the assigned shares, below their
 * assignment price, so the Wheel positions page shows its yellow cell; an XOM put still open, so the
 * Wheel statistics show put cash beside the assigned MQZA shares, and a QQQ condor still open, wings
 * of 5, so every strategy ties money up on the dashboard; a sector for MQZA, ZZZ and QQQ, so the
 * exposure pies have several.
 */
export const DEMO_TRANSACTIONS: Transaction[] = [
  trade({ externalId: "flex:trade:117", ...XOM_PUT, quantity: -1, price: 1.2, amount: 120, when: "2026-08-10T14:30:00.000Z" }),
  trade({ externalId: "flex:trade:118", ...QQQ("P", 480), quantity: 1, price: 0.25, amount: -25, when: "2026-08-20T14:30:00.000Z" }),
  trade({ externalId: "flex:trade:119", ...QQQ("P", 485), quantity: -1, price: 0.75, amount: 75, when: "2026-08-20T14:30:00.000Z" }),
  trade({ externalId: "flex:trade:120", ...QQQ("C", 520), quantity: -1, price: 0.5, amount: 50, when: "2026-08-20T14:30:00.000Z" }),
  trade({ externalId: "flex:trade:121", ...QQQ("C", 525), quantity: 1, price: 0.25, amount: -25, when: "2026-08-20T14:30:00.000Z" }),
  trade({ externalId: "flex:trade:122", ...MARA_CALL_15, quantity: -1, price: 0.8, amount: 80, when: "2026-08-25T14:30:00.000Z" }),
];

export const DEMO_POSITIONS: Position[] = [
  position({ symbol: "XOM", right: "P", strike: 110, expiry: "2026-10-16", quantity: -1, description: "XOM 16OCT26 110 P" }),
  position({ symbol: "QQQ", right: "P", strike: 480, expiry: "2026-10-16", quantity: 1, description: "QQQ 16OCT26 480 P" }),
  position({ symbol: "QQQ", right: "P", strike: 485, expiry: "2026-10-16", quantity: -1, description: "QQQ 16OCT26 485 P" }),
  position({ symbol: "QQQ", right: "C", strike: 520, expiry: "2026-10-16", quantity: -1, description: "QQQ 16OCT26 520 C" }),
  position({ symbol: "QQQ", right: "C", strike: 525, expiry: "2026-10-16", quantity: 1, description: "QQQ 16OCT26 525 C" }),
  position({ symbol: "MQZA", right: "C", strike: 15, expiry: "2026-10-16", quantity: -1, description: "MQZA 16OCT26 15 C" }),
];

export const DEMO_SECTORS: SectorRecord[] = [
  { ticker: "MQZA", name: "MQZA Holdings", category: "Crypto", score: null, status: "on", updatedAt: "2026-09-03T08:00:00.000Z" },
  { ticker: "ZZZ", name: "ZZZ Corp", category: "Materials", score: null, status: "on", updatedAt: "2026-09-03T08:00:00.000Z" },
  { ticker: "QQQ", name: "Invesco QQQ Trust", category: "ETF", score: null, status: "on", updatedAt: "2026-09-03T08:00:00.000Z" },
];
