import { render, waitFor } from "@testing-library/react";
import { act, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RiskReport } from "@ib/coverage";
import { useAccount } from "@/db/hooks";
import { db, type AccountRecord, type SectorRecord } from "@/db/schema";
import { getQuotesSnapshot, resetQuotes } from "./quotes";
import { quoteTickers, useUnderlyingQuotes } from "./useUnderlyingQuotes";
import { refreshPresence, resetAgentState } from "./useAgentSync";

const ACCOUNT: AccountRecord = {
  id: "beta",
  label: "Beta",
  ibAccountId: "U1234567",
  createdAt: "2026-09-01T00:00:00.000Z",
  warnedDroppedKinds: [],
  twsPort: 7502,
};

const REPORT = { positions: [{ symbol: "AAPL", secType: "STK", currency: "USD" }] } as unknown as RiskReport;

/** A full SectorRecord, default values everywhere but the fields the test cares about. */
function sectorRow(fields: Partial<SectorRecord> = {}): SectorRecord {
  return { ticker: "", name: "", category: "", score: null, status: "", updatedAt: "2026-01-01T00:00:00.000Z", ...fields };
}

/** A full-enough position: STK, USD, the fields quoteTickers reads plus the ones the type demands. */
function position(fields: Partial<{ symbol: string; secType: string; currency: string }>): RiskReport["positions"][number] {
  return { symbol: "AAPL", secType: "STK", currency: "USD", ...fields } as unknown as RiskReport["positions"][number];
}

describe("quoteTickers", () => {
  it("asks for every underlying of the report and every suggestion, XSP as itself, once each", () => {
    const report = {
      positions: [position({ symbol: "AAPL" }), position({ symbol: "AAPL" }), position({ symbol: "XSP" })],
    } as unknown as RiskReport;
    const sectors = [sectorRow({ ticker: "MSFT", category: "Tech", score: 8, status: "on" })];
    expect(quoteTickers(report, sectors)).toEqual(["AAPL", "MSFT", "XSP"]);
  });

  it("adds the manual alerts' tickers, upper-cased", () => {
    expect(quoteTickers(null, [], ["nvda"])).toEqual(["NVDA"]);
  });

  it("asks for nothing without a report nor a scored sector table", () => {
    expect(quoteTickers(null, [])).toEqual([]);
  });

  it("leaves out a forex position, a non-USD stock and a .OLD ticker, and keeps a USD stock and a USD option's underlying", () => {
    const report = {
      positions: [
        position({ symbol: "EUR.USD", secType: "CASH", currency: "USD" }),
        position({ symbol: "VOD", secType: "STK", currency: "GBP" }),
        position({ symbol: "ZXAL.OLD", secType: "STK", currency: "USD" }),
        position({ symbol: "AAPL", secType: "STK", currency: "USD" }),
        position({ symbol: "MSFT", secType: "OPT", currency: "USD" }),
      ],
    } as unknown as RiskReport;
    expect(quoteTickers(report, [])).toEqual(["AAPL", "MSFT"]);
  });
});

/**
 * Set once `useAccount` has answered (loaded or not), whatever the answer: a test that wants to
 * prove "no call" must first prove the effect actually ran with a settled account, not that it
 * merely hasn't resolved yet — `useLiveQuery` on fake-indexeddb settles on a macrotask, one tick
 * later than the module's own `port === undefined` guard would suggest.
 */
let accountLoaded = false;

function Probe({ accountId = "beta" }: { accountId?: string }) {
  const account = useAccount(accountId);
  useEffect(() => {
    if (account !== undefined) accountLoaded = true;
  }, [account]);
  useUnderlyingQuotes(accountId, REPORT);
  return null;
}

/** Routes /health and /quotes; every other call is a 200 `{}`. */
function mockAgent() {
  const calls = { health: 0, quotes: 0 };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/health")) {
      calls.health += 1;
      return new Response(JSON.stringify({ version: "0.1.0" }), { status: 200 });
    }
    if (url.includes("/quotes")) {
      calls.quotes += 1;
      return new Response(JSON.stringify({ fetchedAt: "x", quotes: [{ symbol: "AAPL", last: 101, close: 100 }] }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  return calls;
}

function mockAgentAbsent() {
  const calls = { health: 0, quotes: 0 };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/health")) {
      calls.health += 1;
      return Promise.reject(new TypeError("Failed to fetch"));
    }
    if (url.includes("/quotes")) {
      calls.quotes += 1;
    }
    return new Response("{}", { status: 200 });
  });
  return calls;
}

beforeEach(async () => {
  resetAgentState();
  resetQuotes();
  accountLoaded = false;
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

afterEach(() => {
  resetQuotes();
  resetAgentState();
  vi.restoreAllMocks();
});

describe("useUnderlyingQuotes", () => {
  it("does not call /quotes while the agent is absent", async () => {
    await db.accounts.put(ACCOUNT);
    const calls = mockAgentAbsent();
    await refreshPresence();
    render(<Probe />);
    // Prove the effect ran with a settled, ported account before trusting the zero: with
    // `useLiveQuery` still pending, `port === undefined` alone would explain the zero.
    await waitFor(() => expect(accountLoaded).toBe(true));
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls.quotes).toBe(0);
  });

  it("quotes once the agent is present, and again after each agent pass", async () => {
    await db.accounts.put({ ...ACCOUNT, lastAgentSyncAt: "2026-09-28T13:00:00.000Z" });
    const calls = mockAgent();
    await refreshPresence();
    render(<Probe />);
    await waitFor(() => expect(calls.quotes).toBe(1));
    await waitFor(() => expect(getQuotesSnapshot().get("AAPL")?.change).toBeCloseTo(0.01));

    await act(async () => {
      await db.accounts.update("beta", { lastAgentSyncAt: "2026-09-28T13:05:00.000Z" });
    });
    await waitFor(() => expect(calls.quotes).toBe(2));
  });

  it("does not call /quotes for an account without a TWS port", async () => {
    await db.accounts.put({ ...ACCOUNT, twsPort: undefined });
    const calls = mockAgent();
    await refreshPresence();
    render(<Probe />);
    // Same proof: a loaded account confirmed to have no port, not merely one not yet loaded.
    await waitFor(() => expect(accountLoaded).toBe(true));
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls.quotes).toBe(0);
  });
});
