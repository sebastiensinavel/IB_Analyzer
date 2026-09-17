import type { SessionState } from "@/api/session";
import type { AccountRecord } from "@/db/schema";

/** Who may relay an account's Flex calls (spec sous-projet 19 §2.2). */
export type FlexRelayMode = "agent" | "agent-and-server";
/** Who actually relayed one sync. */
export type FlexRelay = "agent" | "server";
export type FlexRelayUnavailable = "agent-absent" | "needs-agent-or-account" | "server-unreachable" | "session-loading";
export type FlexRelayChoice = { relay: FlexRelay } | { relay: null; reason: FlexRelayUnavailable };

/** The one place that reads the default: an account that never chose relays through the agent only. */
export function flexRelayMode(account: Pick<AccountRecord, "flexRelay">): FlexRelayMode {
  return account.flexRelay ?? "agent";
}

/**
 * Agent first, whatever the mode: when it is there, the token has no reason to cross the
 * server. The server is only ever a fallback for an absent agent, never for a failing one.
 */
export function pickFlexRelay(mode: FlexRelayMode, agentPresent: boolean, session: SessionState["status"]): FlexRelayChoice {
  if (agentPresent) return { relay: "agent" };
  if (mode === "agent") return { relay: null, reason: "agent-absent" };
  switch (session) {
    case "authenticated":
      return { relay: "server" };
    case "anonymous":
      return { relay: null, reason: "needs-agent-or-account" };
    case "unreachable":
      return { relay: null, reason: "server-unreachable" };
    case "loading":
      return { relay: null, reason: "session-loading" };
  }
}
