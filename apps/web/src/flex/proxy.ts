import { AGENT_URL } from "@/agent/client";
import { csrfToken } from "@/api/csrf";
import type { FlexRelay } from "./relay";

export type ProxyErrorCode =
  | "unauthenticated"
  | "rate-limited"
  | "flex-timeout"
  | "flex-unreachable"
  | "network"
  | "agent-unreachable"
  | "agent-origin-refused";

export type ProxyResult =
  | { ok: true; xml: string }
  // `retryAfterMs` is only ever set on "rate-limited": the server tells us how long its own
  // window still has to run, and `sync.ts` sleeps that long instead of failing. Throwing the
  // header away — as this module used to — turned a "come back in a moment" into a dead sync.
  | { ok: false; code: ProxyErrorCode; retryAfterMs?: number };

/** Used when a 429 carries no readable `Retry-After` at all. */
const FALLBACK_RETRY_AFTER_MS = 2_000;
/** The longest window either of our two throttle rules can be counting down: 10/minute. */
const MAX_RETRY_AFTER_MS = 65_000;

/**
 * `Retry-After` is whole delta-seconds (RFC 9110), which ninja produces by rounding *up* the
 * remaining window. We still add a second: the server's clock and ours are not the same one,
 * and landing on the very edge of the window earns a second 429.
 */
function retryAfterMs(response: Response): number {
  const raw = response.headers.get("retry-after");
  const seconds = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(seconds) || seconds < 0) return FALLBACK_RETRY_AFTER_MS;
  return Math.min(seconds * 1000 + 1000, MAX_RETRY_AFTER_MS);
}

type FlexPath = "send-request" | "get-statement";

async function relayThroughServer(path: FlexPath, body: unknown): Promise<ProxyResult> {
  let response: Response;
  try {
    // openapi-fetch parses JSON; the proxy answers XML, so the raw Response is
    // what we want here. The typed client still guards the request body (task 11).
    //
    // `window.location.origin` rather than a bare relative path: Node's `undici`
    // fetch used under jsdom in tests rejects a relative URL outright (the same
    // constraint `api/client.ts` documents for the typed client).
    response = await fetch(`${window.location.origin}/api/ib/flex/${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        ...csrfHeader(),
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, code: "network" };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, code: "unauthenticated" };
  if (response.status === 429) return { ok: false, code: "rate-limited", retryAfterMs: retryAfterMs(response) };
  if (response.status === 504) return { ok: false, code: "flex-timeout" };
  if (!response.ok) return { ok: false, code: "flex-unreachable" };
  return { ok: true, xml: await response.text() };
}

/**
 * The agent answers with the very same contract as the server's proxy (apps/tws-agent, spec
 * sous-projet 19 §2.1). No cookie and no CSRF: the agent knows no session, it checks the
 * Origin. It has no rate limit either, so no 429 to read here.
 */
async function relayThroughAgent(path: FlexPath, body: unknown): Promise<ProxyResult> {
  let response: Response;
  try {
    response = await fetch(`${AGENT_URL}/flex/${path}`, {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, code: "agent-unreachable" };
  }
  // 403 is the agent refusing this site's origin: its configuration lacks it. Defensive only,
  // for non-browser callers: the 403 carries no CORS header, so a browser rejects the fetch
  // above (`agent-unreachable`), and `/health` refused the same way already marks the agent
  // absent — in the browser a missing origin shows as an absent agent (spec §4.3).
  if (response.status === 403) return { ok: false, code: "agent-origin-refused" };
  if (response.status === 504) return { ok: false, code: "flex-timeout" };
  if (!response.ok) return { ok: false, code: "flex-unreachable" };
  return { ok: true, xml: await response.text() };
}

function csrfHeader(): Record<string, string> {
  const token = csrfToken();
  return token ? { "X-CSRFToken": token } : {};
}

function relay(via: FlexRelay, path: FlexPath, body: unknown): Promise<ProxyResult> {
  return via === "agent" ? relayThroughAgent(path, body) : relayThroughServer(path, body);
}

export function sendRequest(via: FlexRelay, input: { token: string; queryId: string }): Promise<ProxyResult> {
  return relay(via, "send-request", input);
}

export function getStatement(via: FlexRelay, input: { token: string; referenceCode: string }): Promise<ProxyResult> {
  return relay(via, "get-statement", input);
}
