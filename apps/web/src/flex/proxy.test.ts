import { beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_URL } from "@/agent/client";
import { getStatement, sendRequest } from "./proxy";

function clearCookies() {
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

function mockFetchOnce(status: number, body = "", headers?: Record<string, string>) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status, headers }));
}

describe("proxy, server relay", () => {
  beforeEach(() => {
    clearCookies();
    vi.restoreAllMocks();
  });

  it("relays a successful send-request and returns the raw XML", async () => {
    const xml = "<FlexStatementResponse><Status>Success</Status></FlexStatementResponse>";
    mockFetchOnce(200, xml);
    const result = await sendRequest("server", { token: "tok", queryId: "123" });
    expect(result).toEqual({ ok: true, xml });
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${window.location.origin}/api/ib/flex/send-request`);
    expect(init.credentials).toBe("same-origin");
  });

  it("maps 401 to unauthenticated", async () => {
    mockFetchOnce(401);
    expect(await sendRequest("server", { token: "tok", queryId: "123" })).toEqual({ ok: false, code: "unauthenticated" });
  });

  it("maps 403 to unauthenticated", async () => {
    mockFetchOnce(403);
    expect(await sendRequest("server", { token: "tok", queryId: "123" })).toEqual({ ok: false, code: "unauthenticated" });
  });

  // The 429 is the one error the caller can do something about: `sync.ts` sleeps
  // `retryAfterMs` and tries again rather than killing the sync, so dropping this header —
  // which this module used to do — is what turned "come back in a moment" into a dead sync.
  it("maps 429 to rate-limited and carries Retry-After, plus a second of slack", async () => {
    mockFetchOnce(429, "", { "retry-after": "7" });
    expect(await getStatement("server", { token: "tok", referenceCode: "REF1" })).toEqual({
      ok: false,
      code: "rate-limited",
      retryAfterMs: 8000,
    });
  });

  it("falls back to two seconds when the 429 carries no usable Retry-After", async () => {
    mockFetchOnce(429);
    expect(await getStatement("server", { token: "tok", referenceCode: "REF1" })).toEqual({
      ok: false,
      code: "rate-limited",
      retryAfterMs: 2000,
    });
    mockFetchOnce(429, "", { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" });
    expect(await sendRequest("server", { token: "tok", queryId: "1" })).toEqual({
      ok: false,
      code: "rate-limited",
      retryAfterMs: 2000,
    });
  });

  it("never sleeps longer than the widest throttle window, whatever the server claims", async () => {
    mockFetchOnce(429, "", { "retry-after": "86400" });
    expect(await getStatement("server", { token: "tok", referenceCode: "REF1" })).toEqual({
      ok: false,
      code: "rate-limited",
      retryAfterMs: 65000,
    });
  });

  it("maps 504 to flex-timeout", async () => {
    mockFetchOnce(504);
    expect(await getStatement("server", { token: "tok", referenceCode: "REF1" })).toEqual({ ok: false, code: "flex-timeout" });
  });

  it("maps any other non-ok status, such as 502, to flex-unreachable", async () => {
    mockFetchOnce(502);
    expect(await getStatement("server", { token: "tok", referenceCode: "REF1" })).toEqual({ ok: false, code: "flex-unreachable" });
  });

  it("maps a thrown fetch exception to network, without letting it escape", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(sendRequest("server", { token: "tok", queryId: "123" })).resolves.toEqual({ ok: false, code: "network" });
  });

  it("sends the CSRF header from the cookie when one is set", async () => {
    document.cookie = "csrftoken=abc123; path=/";
    const fetchSpy = mockFetchOnce(200, "<x/>");
    await sendRequest("server", { token: "tok", queryId: "123" });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("X-CSRFToken")).toBe("abc123");
  });

  it("sends no CSRF header at all when the cookie is absent", async () => {
    const fetchSpy = mockFetchOnce(200, "<x/>");
    await getStatement("server", { token: "tok", referenceCode: "REF1" });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has("X-CSRFToken")).toBe(false);
  });
});

describe("proxy, agent relay", () => {
  beforeEach(() => {
    clearCookies();
    vi.restoreAllMocks();
  });

  it("posts the same body to the agent, without cookie or CSRF, and returns the raw XML", async () => {
    document.cookie = "csrftoken=abc123; path=/";
    const fetchSpy = mockFetchOnce(200, "<x/>");
    expect(await sendRequest("agent", { token: "tok", queryId: "123" })).toEqual({ ok: true, xml: "<x/>" });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${AGENT_URL}/flex/send-request`);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(new Headers(init.headers).has("X-CSRFToken")).toBe(false);
    expect(JSON.parse(String(init.body))).toEqual({ token: "tok", queryId: "123" });
  });

  it("targets get-statement on the agent", async () => {
    const fetchSpy = mockFetchOnce(200, "<x/>");
    await getStatement("agent", { token: "tok", referenceCode: "REF1" });
    expect((fetchSpy.mock.calls[0] as [string])[0]).toBe(`${AGENT_URL}/flex/get-statement`);
  });

  it("maps a thrown fetch to agent-unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await sendRequest("agent", { token: "tok", queryId: "1" })).toEqual({ ok: false, code: "agent-unreachable" });
  });

  it("maps 403 to agent-origin-refused, never to unauthenticated", async () => {
    mockFetchOnce(403);
    expect(await sendRequest("agent", { token: "tok", queryId: "1" })).toEqual({ ok: false, code: "agent-origin-refused" });
  });

  it("maps 504 to flex-timeout and any other non-ok status to flex-unreachable", async () => {
    mockFetchOnce(504);
    expect(await getStatement("agent", { token: "tok", referenceCode: "R" })).toEqual({ ok: false, code: "flex-timeout" });
    mockFetchOnce(502);
    expect(await getStatement("agent", { token: "tok", referenceCode: "R" })).toEqual({ ok: false, code: "flex-unreachable" });
    mockFetchOnce(422);
    expect(await getStatement("agent", { token: "tok", referenceCode: "R" })).toEqual({ ok: false, code: "flex-unreachable" });
  });
});
