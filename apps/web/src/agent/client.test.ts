import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_FETCH_TIMEOUT_MS, AGENT_PROBE_TIMEOUT_MS, AGENT_URL, exclusiveTws, fetchQuotes, fetchSnapshot, probeAgent } from "./client";

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

describe("exclusiveTws", () => {
  it("never lets two agent calls that open a TWS connection overlap", async () => {
    const order: string[] = [];
    let release!: () => void;
    const first = exclusiveTws(async () => {
      order.push("first:start");
      await new Promise<void>((resolve) => (release = resolve));
      order.push("first:end");
    });
    const second = exclusiveTws(async () => {
      order.push("second:start");
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("runs the next call after one that failed", async () => {
    await expect(exclusiveTws(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(exclusiveTws(async () => 42)).resolves.toBe(42);
  });
});

describe("fetchQuotes", () => {
  it("asks /quotes for the symbols, comma-separated and encoded", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ fetchedAt: "x", quotes: [] })));
    const result = await fetchQuotes(7496, ["AAPL", "BRK B"]);
    expect(String(spy.mock.calls[0][0])).toBe("http://127.0.0.1:8100/quotes?port=7496&symbols=AAPL%2CBRK%20B");
    expect(result).toEqual({ ok: true, payload: { fetchedAt: "x", quotes: [] } });
  });

  it("maps a 503 to tws-unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 503 }));
    expect(await fetchQuotes(7496, ["AAPL"])).toEqual({ ok: false, code: "tws-unreachable" });
  });
});
