import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAgentIndex } from "./agentIndex";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchAgentIndex", () => {
  it("reads /agent/index.json of the given origin", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ version: "0.1.0", filename: "ib_tws_agent-0.1.0-py3-none-any.whl" }), { status: 200 }),
    );
    expect(await fetchAgentIndex("https://app.example")).toEqual({ version: "0.1.0", filename: "ib_tws_agent-0.1.0-py3-none-any.whl" });
    expect(String(spy.mock.calls[0][0])).toBe("https://app.example/agent/index.json");
  });

  it("is null on 404, on a rejection, and on a body that is not an index", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>", { status: 404 }));
    expect(await fetchAgentIndex("https://app.example")).toBeNull();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("x"));
    expect(await fetchAgentIndex("https://app.example")).toBeNull();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ version: 1 }), { status: 200 }));
    expect(await fetchAgentIndex("https://app.example")).toBeNull();
  });
});
