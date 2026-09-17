import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_FETCH_TIMEOUT_MS, AGENT_PROBE_TIMEOUT_MS, AGENT_URL, fetchSnapshot, probeAgent } from "./client";

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    return handler(url, init);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("probeAgent", () => {
  it("calls /health with a short timeout and reads the version", async () => {
    const spy = mockFetch(() => new Response(JSON.stringify({ version: "0.1.0" }), { status: 200 }));
    expect(await probeAgent()).toEqual({ version: "0.1.0" });
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toBe(`${AGENT_URL}/health`);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(AGENT_PROBE_TIMEOUT_MS).toBe(2_000);
  });

  it("is null when the agent is not there (fetch rejects)", async () => {
    mockFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await probeAgent()).toBeNull();
  });

  it("is null on a body that is not a health answer", async () => {
    mockFetch(() => new Response("<html>", { status: 200 }));
    expect(await probeAgent()).toBeNull();
    mockFetch(() => new Response(JSON.stringify({ hello: 1 }), { status: 200 }));
    expect(await probeAgent()).toBeNull();
  });

  it("is null on a non-2xx answer", async () => {
    mockFetch(() => new Response("{}", { status: 500 }));
    expect(await probeAgent()).toBeNull();
  });
});

describe("fetchSnapshot", () => {
  it("calls /snapshot with the port and hands the raw payload back", async () => {
    const payload = { accounts: ["U1"], positions: [] };
    const spy = mockFetch(() => new Response(JSON.stringify(payload), { status: 200 }));
    expect(await fetchSnapshot(7502)).toEqual({ ok: true, payload });
    expect(String(spy.mock.calls[0][0])).toBe(`${AGENT_URL}/snapshot?port=7502`);
    expect(AGENT_FETCH_TIMEOUT_MS).toBe(15_000);
  });

  it("names the agent's absence", async () => {
    mockFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await fetchSnapshot(7502)).toEqual({ ok: false, code: "agent-unreachable" });
  });

  it("names a TWS that the agent could not reach", async () => {
    mockFetch(() => new Response(JSON.stringify({ code: "tws-unreachable", detail: "x" }), { status: 503 }));
    expect(await fetchSnapshot(7502)).toEqual({ ok: false, code: "tws-unreachable" });
  });

  it("names any other failure of the agent, including an unreadable body", async () => {
    mockFetch(() => new Response("{}", { status: 422 }));
    expect(await fetchSnapshot(7502)).toEqual({ ok: false, code: "agent-error" });
    mockFetch(() => new Response("not json", { status: 200 }));
    expect(await fetchSnapshot(7502)).toEqual({ ok: false, code: "agent-error" });
  });
});
