import { afterEach, describe, expect, it, vi } from "vitest";
import { getQuotesSnapshot, mergeQuotes, quotedTicker, refreshQuotes, resetQuotes, underlyingDayChangeOf } from "./quotes";
import { QUOTES_MAX_SYMBOLS } from "./client";

afterEach(() => {
  resetQuotes();
  vi.restoreAllMocks();
});

function answer(symbols: string[]) {
  return new Response(JSON.stringify({ fetchedAt: "x", quotes: symbols.map((symbol) => ({ symbol, last: 101, close: 100 })) }));
}

/** The symbols a /quotes URL asked for. */
function asked(url: unknown): string[] {
  return decodeURIComponent(new URL(String(url)).searchParams.get("symbols") ?? "").split(",");
}

describe("quotes", () => {
  it("quotes XSP as SPY, case-insensitively", () => {
    expect(quotedTicker("xsp")).toBe("SPY");
    expect(quotedTicker("aapl")).toBe("AAPL");
    const quotes = new Map<string, number | null>([["SPY", 0.01]]);
    expect(underlyingDayChangeOf(quotes, "XSP")).toBe(0.01);
    expect(underlyingDayChangeOf(quotes, "AAPL")).toBeNull();
  });

  it("splits more than the ceiling into sequential calls and loses no ticker", async () => {
    const tickers = Array.from({ length: QUOTES_MAX_SYMBOLS + 5 }, (_, i) => `T${i}`);
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => answer(asked(url)));
    await refreshQuotes(7496, tickers);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(asked(spy.mock.calls[0][0])).toHaveLength(QUOTES_MAX_SYMBOLS);
    expect(asked(spy.mock.calls[1][0])).toHaveLength(5);
  });

  it("keeps the values already shown when a call fails or answers garbage", async () => {
    mergeQuotes(new Map([["AAPL", 0.02]]));
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 503 }));
    await refreshQuotes(7496, ["AAPL"]);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ quotes: [{ symbol: 1 }] })));
    await refreshQuotes(7496, ["AAPL"]);
    expect(getQuotesSnapshot().get("AAPL")).toBe(0.02);
  });

  it("does not call the agent for an empty list", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await refreshQuotes(7496, []);
    expect(spy).not.toHaveBeenCalled();
  });
});
