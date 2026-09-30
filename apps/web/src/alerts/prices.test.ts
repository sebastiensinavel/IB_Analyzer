import { describe, expect, it } from "vitest";
import type { Position } from "@ib/ledger";
import type { AgentQuote } from "@ib/ib-parsers";
import type { SnapshotRecord } from "@/db/schema";
import { alertPriceOf } from "./prices";

function stock(symbol: string, marketPrice: number | null): Position {
  return {
    symbol, secType: "STK", right: "", strike: null, expiry: null, multiplier: 1, quantity: 10, avgPrice: 200,
    marketPrice, marketValue: null, unrealizedPnl: null, dailyPnl: null, dayChange: null, currency: "USD", conid: "", description: "",
  };
}

function snapshot(source: SnapshotRecord["source"], positions: Position[]): SnapshotRecord {
  return { accountId: "beta", source, asOf: "2026-09-30T14:35:00.000Z", importedAt: "2026-09-30T18:35:00.000Z", positions, cashAvailable: null };
}

const QUOTES: ReadonlyMap<string, AgentQuote> = new Map([["AAPL", { last: 248, change: 0.01 }]]);

describe("alertPriceOf", () => {
  it("reads a stock held in the agent snapshot as real time", () => {
    const priceOf = alertPriceOf(snapshot("agent", [stock("AAPL", 250)]), QUOTES);
    expect(priceOf("AAPL")).toEqual({ price: 250, realtime: true });
    expect(priceOf("aapl")).toEqual({ price: 250, realtime: true });
  });

  it("falls back on the delayed quote for a Flex snapshot, never on its closing price", () => {
    expect(alertPriceOf(snapshot("flex", [stock("AAPL", 250)]), QUOTES)("AAPL")).toEqual({ price: 248, realtime: false });
  });

  it("falls back on the quote when the agent snapshot has no market price for the stock", () => {
    expect(alertPriceOf(snapshot("agent", [stock("AAPL", null)]), QUOTES)("AAPL")).toEqual({ price: 248, realtime: false });
  });

  it("gives null with neither source", () => {
    expect(alertPriceOf(null, new Map())("AAPL")).toBeNull();
    expect(alertPriceOf(snapshot("agent", [stock("MSFT", 400)]), QUOTES)("NVDA")).toBeNull();
  });
});
