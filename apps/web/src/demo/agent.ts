import { packedOptionSymbol, type Position } from "@ib/ledger";
import type { AgentSnapshotPayload } from "@ib/ib-parsers";
import type { AgentFetchResult, AgentInfo, BarsResponse } from "@/agent/client";
import { referenceDay } from "@/demo/calendar";
import { DEMO_IB_ACCOUNT, generateDemo, type DemoWorld } from "@/demo/generate";
import { DEMO_TICKERS, barsFor, closeAgo } from "@/demo/prices";

/**
 * The simulated agent (sub-project 41, spec §6): answers what apps/tws-agent answers, in its
 * format, so the real pipeline — parseAgentSnapshot, syncAgent, quotes — runs unchanged. Never
 * a request to 127.0.0.1:8100.
 */
export function demoProbe(): AgentInfo {
  return { version: "demo" };
}

// The instant the demo ledger was seeded at (`ensureDemoSeeded` sets it at every startup, from the
// demo account's `createdAt`): the agent's world is the seed's, never the clock's alone, or a tab
// left open past the visit day would lay another day's snapshot over the seeded ledger.
let seedInstant: Date | null = null;
export function setDemoSeedInstant(at: Date): void {
  seedInstant = at;
}

// One world per visit day: a pass every few minutes must not replay the whole scenario.
let cached: { day: string; world: DemoWorld } | null = null;
function worldAt(now: Date): DemoWorld {
  const day = referenceDay(now);
  if (cached?.day !== day) cached = { day, world: generateDemo(now) };
  return cached.world;
}

const round2 = (x: number) => Math.round(x * 100) / 100 + 0;

function knownTicker(symbol: string): boolean {
  return (DEMO_TICKERS as readonly string[]).includes(symbol);
}

/** TWS spells an option's localSymbol in packed OSI form, the one the parser reads its identity from. */
function localSymbolOf(p: Position): string {
  return p.secType === "OPT" ? (packedOptionSymbol(p.symbol, p.expiry, p.right, p.strike) ?? p.symbol) : p.symbol;
}

/** The generated snapshot, spelled as the agent's `/snapshot`: per-contract averageCost, a day's P&L from yesterday's mark. */
export function agentPayload(world: DemoWorld, now: Date): AgentSnapshotPayload {
  return {
    accounts: [DEMO_IB_ACCOUNT],
    fetchedAt: now.toISOString(),
    cashAvailable: world.cashAvailable,
    executions: [],
    positions: world.positions.map((p) => {
      const multiplier = p.multiplier ?? 1;
      const mark = p.marketPrice ?? 0;
      const previous = world.previousMarks.get(p.conid) ?? mark;
      const dailyPnL = round2((mark - previous) * p.quantity * multiplier);
      return {
        conId: Number(p.conid),
        symbol: p.symbol,
        localSymbol: localSymbolOf(p),
        secType: p.secType,
        right: p.right,
        strike: p.strike ?? 0,
        lastTradeDateOrContractMonth: p.expiry ? p.expiry.replaceAll("-", "") : "",
        multiplier: p.secType === "OPT" ? String(multiplier) : "",
        currency: p.currency,
        position: p.quantity,
        averageCost: (p.avgPrice ?? 0) * multiplier,
        marketPrice: mark,
        marketValue: p.marketValue ?? 0,
        unrealizedPNL: p.unrealizedPnl ?? 0,
        pnl: { dailyPnL, value: p.marketValue },
      };
    }),
  };
}

/** The agent's GET routes: `/snapshot`, `/bars`, `/quotes`. Anything else answers like an agent error. */
export function demoAgentJson(path: string, clock = new Date()): AgentFetchResult {
  const url = new URL(path, "http://demo.invalid");
  const seed = seedInstant ?? clock;
  // Past the seed's visit day, the pass stays at the seed's instant: a later `fetchedAt` would date
  // the snapshot after options the seeded ledger never saw expire.
  const now = referenceDay(clock) === referenceDay(seed) ? clock : seed;
  const world = worldAt(seed);
  switch (url.pathname) {
    case "/snapshot":
      return { ok: true, payload: agentPayload(world, now) };
    case "/bars": {
      const symbol = url.searchParams.get("symbol") ?? "";
      const payload: BarsResponse = { symbol, fetchedAt: now.toISOString(), bars: knownTicker(symbol) ? barsFor(symbol, world.reference) : [] };
      return { ok: true, payload };
    }
    case "/quotes": {
      // `indices` is `SYM:EXCH`, comma-separated; the demo's world has no exchange, only the symbol.
      const stocks = (url.searchParams.get("symbols") ?? "").split(",").filter(Boolean);
      const indices = (url.searchParams.get("indices") ?? "").split(",").filter(Boolean).map((entry) => entry.split(":")[0]);
      const symbols = [...stocks, ...indices];
      const quotes = symbols.map((symbol) =>
        knownTicker(symbol) ? { symbol, last: closeAgo(symbol, 0), close: closeAgo(symbol, 1) } : { symbol, last: null, close: null },
      );
      return { ok: true, payload: { quotes } };
    }
    default:
      return { ok: false, code: "agent-error" };
  }
}
