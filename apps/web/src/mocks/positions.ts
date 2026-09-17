import type { Position } from "@ib/ledger";
import type { SectorRecord, SnapshotRecord } from "@/db/schema";

function position(overrides: Partial<Position>): Position {
  return {
    symbol: "AAPL",
    secType: "OPT",
    right: "C",
    strike: 150,
    expiry: "2026-01-16",
    multiplier: 100,
    quantity: -1,
    avgPrice: 2,
    marketPrice: 1,
    marketValue: -100,
    unrealizedPnl: 100,
    currency: "USD",
    conid: "",
    description: "",
    ...overrides,
  };
}

/**
 * alpha: 200 AAPL shares cover one call fully and one of two on the next
 * expiry (one contract UNCOVERED); an MSFT LEAPS covers a short call; two XOM
 * puts lock 20,000 of cash; an XYZ iron condor adds 500 of assignment cash.
 */
export const SAMPLE_POSITIONS: Position[] = [
  position({ symbol: "AAPL", secType: "STK", right: "", strike: null, expiry: null, multiplier: 1, quantity: 200, avgPrice: 140, marketPrice: 150, marketValue: 30000, unrealizedPnl: 2000, description: "APPLE INC" }),
  position({ symbol: "AAPL", right: "C", strike: 150, expiry: "2026-01-16", quantity: -1, avgPrice: 2, marketPrice: 0.8, marketValue: -80, unrealizedPnl: 120 }),
  position({ symbol: "AAPL", right: "C", strike: 155, expiry: "2026-02-20", quantity: -2, avgPrice: 3, marketPrice: 3.1, marketValue: -620, unrealizedPnl: -20 }),
  position({ symbol: "MSFT", right: "C", strike: 300, expiry: "2028-01-21", quantity: 1, avgPrice: 90, marketPrice: 95, marketValue: 9500, unrealizedPnl: 500 }),
  position({ symbol: "MSFT", right: "C", strike: 400, expiry: "2026-03-20", quantity: -1, avgPrice: 6.1, marketPrice: 6.2, marketValue: -620, unrealizedPnl: -10 }),
  position({ symbol: "XOM", right: "P", strike: 100, expiry: "2026-03-20", quantity: -2, avgPrice: 4.2, marketPrice: 1.75, marketValue: -350, unrealizedPnl: 490 }),
  position({ symbol: "XYZ", right: "P", strike: 90, expiry: "2026-03-20", quantity: 1, avgPrice: 1, marketPrice: 0.5, marketValue: 50, unrealizedPnl: -50 }),
  position({ symbol: "XYZ", right: "P", strike: 95, expiry: "2026-03-20", quantity: -1, avgPrice: 2, marketPrice: 1, marketValue: -100, unrealizedPnl: 100 }),
  position({ symbol: "XYZ", right: "C", strike: 105, expiry: "2026-03-20", quantity: -1, avgPrice: 2, marketPrice: 1.5, marketValue: -150, unrealizedPnl: 50 }),
  position({ symbol: "XYZ", right: "C", strike: 110, expiry: "2026-03-20", quantity: 1, avgPrice: 1, marketPrice: 0.75, marketValue: 75, unrealizedPnl: -25 }),
];

/** Cash required 20,500 against 42,000 available: covered. */
export const SAMPLE_SNAPSHOT: SnapshotRecord = {
  accountId: "alpha",
  source: "flex",
  asOf: "2026-09-02",
  importedAt: "2026-09-03T08:00:00.000Z",
  positions: SAMPLE_POSITIONS,
  cashAvailable: 42000,
};

export const SAMPLE_SECTORS: SectorRecord[] = [
  { ticker: "AAPL", name: "Apple Inc.", category: "Tech", score: 7.5, status: "on", updatedAt: "2026-09-03T08:00:00.000Z" },
  { ticker: "MSFT", name: "Microsoft", category: "Tech", score: 8, status: "on", updatedAt: "2026-09-03T08:00:00.000Z" },
  { ticker: "XOM", name: "Exxon Mobil", category: "Energy", score: null, status: "off", updatedAt: "2026-09-03T08:00:00.000Z" },
];
