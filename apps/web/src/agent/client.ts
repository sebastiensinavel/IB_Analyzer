/**
 * The network boundary with the local agent (apps/tws-agent). Nothing here interprets the
 * payload: that is `parseAgentSnapshot`'s job (packages/ib-parsers). `AGENT_URL` is the
 * user's own machine, never a domain name.
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

export async function fetchSnapshot(port: number): Promise<AgentFetchResult> {
  let response: Response;
  try {
    response = await fetch(`${AGENT_URL}/snapshot?port=${port}`, { signal: AbortSignal.timeout(AGENT_FETCH_TIMEOUT_MS) });
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

/** Prototype (graphes) : daily bars of one underlying, straight from TWS. */
export interface PriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BarsResponse {
  symbol: string;
  fetchedAt: string;
  bars: PriceBar[];
}

export type BarsResult = { ok: true; payload: BarsResponse } | { ok: false; code: AgentFetchCode };

export async function fetchBars(port: number, symbol: string, currency = "USD"): Promise<BarsResult> {
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
    return { ok: true, payload };
  } catch {
    return { ok: false, code: "agent-error" };
  }
}
