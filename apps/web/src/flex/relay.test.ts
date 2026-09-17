import { describe, expect, it } from "vitest";
import { flexRelayMode, pickFlexRelay } from "./relay";

const SESSIONS = ["loading", "anonymous", "unreachable", "authenticated"] as const;

describe("flexRelayMode", () => {
  it("reads an absent choice as agent only", () => {
    expect(flexRelayMode({})).toBe("agent");
  });

  it("returns a stored choice as is", () => {
    expect(flexRelayMode({ flexRelay: "agent" })).toBe("agent");
    expect(flexRelayMode({ flexRelay: "agent-and-server" })).toBe("agent-and-server");
  });
});

describe("pickFlexRelay", () => {
  it.each(SESSIONS)("takes the agent whenever it is present, in either mode, session %s", (session) => {
    expect(pickFlexRelay("agent", true, session)).toEqual({ relay: "agent" });
    expect(pickFlexRelay("agent-and-server", true, session)).toEqual({ relay: "agent" });
  });

  it.each(SESSIONS)("never falls back on the server in agent-only mode, session %s", (session) => {
    expect(pickFlexRelay("agent", false, session)).toEqual({ relay: null, reason: "agent-absent" });
  });

  it("falls back on the server only with an open session", () => {
    expect(pickFlexRelay("agent-and-server", false, "authenticated")).toEqual({ relay: "server" });
    expect(pickFlexRelay("agent-and-server", false, "anonymous")).toEqual({ relay: null, reason: "needs-agent-or-account" });
    expect(pickFlexRelay("agent-and-server", false, "unreachable")).toEqual({ relay: null, reason: "server-unreachable" });
    expect(pickFlexRelay("agent-and-server", false, "loading")).toEqual({ relay: null, reason: "session-loading" });
  });
});
