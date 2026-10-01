import { isDemo } from "@/demo/mode";

/**
 * The network boundary with the local agent (apps/tws-agent). Nothing here interprets the
 * payload: that is `parseAgentSnapshot`'s job (packages/ib-parsers). `AGENT_URL` is the
 * user's own machine, never a domain name.
 *
 * In the demo (sub-project 41), no request leaves: `src/demo/agent.ts`, loaded on demand, answers
 * in the agent's place, behind `exclusiveTws` like the real one.
 */
export const AGENT_URL = "http://127.0.0.1:8100";
/** A ping must be cheap: the agent is absent far more often than present. */
export const AGENT_PROBE_TIMEOUT_MS = 2_000;
/** A pass opens a TWS connection (5 s ceiling agent-side) and reads a whole portfolio. */
export const AGENT_FETCH_TIMEOUT_MS = 15_000;

export type AgentFetchCode = "agent-unreachable" | "tws-unreachable" | "agent-error";
export type AgentFetchResult = { ok: true; payload: unknown } | { ok: false; code: AgentFetchCode };

export interface AgentInfo {
  version: string;
}

export async function probeAgent(): Promise<AgentInfo | null> {
  if (isDemo()) return (await import("@/demo/agent")).demoProbe();
  try {
    const response = await fetch(`${AGENT_URL}/health`, { signal: AbortSignal.timeout(AGENT_PROBE_TIMEOUT_MS) });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return null;
    const version = (body as { version?: unknown }).version;
    return typeof version === "string" ? { version } : null;
  } catch {
    // Absent, refused, timed out, not JSON: all the same thing, the agent is not usable now.
    return null;
  }
}

/** Same ceiling as the agent's QUOTES_MAX_SYMBOLS (apps/tws-agent), one per language. */
export const QUOTES_MAX_SYMBOLS = 90;

// Every agent call that opens a TWS connection goes through here, one after the other: the agent
// connects with clientId 0 each time, and TWS refuses a second connection on the same clientId
// while the first lives (spec of sub-project 35, §4). A call's own timeout only starts on its turn.
let twsQueue: Promise<unknown> = Promise.resolve();

export function exclusiveTws<T>(call: () => Promise<T>): Promise<T> {
  const turn = twsQueue.then(call, call);
  twsQueue = turn.catch(() => undefined);
  return turn;
}

async function getAgentJson(path: string): Promise<AgentFetchResult> {
  if (isDemo()) return (await import("@/demo/agent")).demoAgentJson(path);
  let response: Response;
  try {
    response = await fetch(`${AGENT_URL}${path}`, { signal: AbortSignal.timeout(AGENT_FETCH_TIMEOUT_MS) });
  } catch {
    return { ok: false, code: "agent-unreachable" };
  }
  // 503 is the agent's one documented failure: it answered, TWS did not (spec §3.5).
  if (response.status === 503) return { ok: false, code: "tws-unreachable" };
  if (!response.ok) return { ok: false, code: "agent-error" };
  try {
    return { ok: true, payload: await response.json() };
  } catch {
    return { ok: false, code: "agent-error" };
  }
}

export function fetchSnapshot(port: number): Promise<AgentFetchResult> {
  return exclusiveTws(() => getAgentJson(`/snapshot?port=${port}`));
}

/** `indices` are already `SYM:EXCH`; the parameter is left out when empty. */
export function fetchQuotes(port: number, symbols: readonly string[], indices: readonly string[] = []): Promise<AgentFetchResult> {
  const extra = indices.length > 0 ? `&indices=${encodeURIComponent(indices.join(","))}` : "";
  return exclusiveTws(() => getAgentJson(`/quotes?port=${port}&symbols=${encodeURIComponent(symbols.join(","))}${extra}`));
}

/** Prototype (graphes) : daily bars of one underlying, straight from TWS. */
export interface PriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** The bar's VWAP as TWS gives it; `null` when absent. */
  average: number | null;
}

export interface BarsResponse {
  symbol: string;
  fetchedAt: string;
  bars: PriceBar[];
}

export type BarsResult = { ok: true; payload: BarsResponse } | { ok: false; code: AgentFetchCode };

/** An `average` the agent did not send, or not as a number, is `null`. */
function withAverage(bar: PriceBar): PriceBar {
  return { ...bar, average: typeof bar.average === "number" && Number.isFinite(bar.average) ? bar.average : null };
}

export function fetchBars(port: number, symbol: string, currency = "USD"): Promise<BarsResult> {
  return exclusiveTws(async () => {
    if (isDemo()) {
      const path = `/bars?port=${port}&symbol=${encodeURIComponent(symbol)}&currency=${encodeURIComponent(currency)}`;
      const result = (await import("@/demo/agent")).demoAgentJson(path);
      if (!result.ok) return result;
      const payload = result.payload as BarsResponse;
      return { ok: true, payload: { ...payload, bars: payload.bars.map(withAverage) } };
    }
    let response: Response;
    try {
      response = await fetch(
        `${AGENT_URL}/bars?port=${port}&symbol=${encodeURIComponent(symbol)}&currency=${encodeURIComponent(currency)}`,
        { signal: AbortSignal.timeout(AGENT_FETCH_TIMEOUT_MS) },
      );
    } catch {
      return { ok: false, code: "agent-unreachable" };
    }
    if (response.status === 503) return { ok: false, code: "tws-unreachable" };
    if (!response.ok) return { ok: false, code: "agent-error" };
    try {
      const payload = (await response.json()) as BarsResponse;
      if (!Array.isArray(payload?.bars)) return { ok: false, code: "agent-error" };
      return { ok: true, payload: { ...payload, bars: payload.bars.map(withAverage) } };
    } catch {
      return { ok: false, code: "agent-error" };
    }
  });
}
