import { useCallback, useSyncExternalStore } from "react";
import { useDb } from "@/db/DbProvider";
import { fetchSnapshot, probeAgent } from "./client";
import type { AppDatabase } from "@/db/schema";
import { syncAgent, type AgentSyncOutcome } from "./sync";

/** Five minutes, the watcher's cadence (sub-project 43): TWS reconnects on every pass. */
export const AGENT_POLL_MS = 5 * 60 * 1000;

export type AgentPresence = { status: "unknown" } | { status: "absent" } | { status: "present"; version: string };

// Module-level state, shared by every hook instance of the tab, for the same reasons as
// `useFlexAutoSync`'s `runningAccounts`: the watcher drives the cadence, pages read the presence
// and press the button, and none of them may see a different "running" than the others.
let presence: AgentPresence = { status: "unknown" };
const runningAccounts = new Set<string>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function refreshPresence(): Promise<AgentPresence> {
  const info = await probeAgent();
  presence = info ? { status: "present", version: info.version } : { status: "absent" };
  notify();
  return presence;
}

/** Test seam: forget everything between tests. */
export function resetAgentState(): void {
  presence = { status: "unknown" };
  runningAccounts.clear();
  notify();
}

/** The tab's agent presence, outside React (the watcher, its tests). */
export function agentPresence(): AgentPresence {
  return presence;
}

export function useAgentPresence(): AgentPresence {
  return useSyncExternalStore(subscribe, () => presence);
}

/**
 * One agent pass for one account, shared by the Refresh button and the watcher (sub-project 43,
 * §3.3): `null` when there is nothing to do — no id, an unknown account, or a pass of this account
 * already running in this tab.
 */
export async function runAgentSync(db: AppDatabase, accountId: string): Promise<AgentSyncOutcome | null> {
  // Check-then-add with no `await` in between: two callers in one tick cannot both pass.
  if (!accountId || runningAccounts.has(accountId)) return null;
  runningAccounts.add(accountId);
  notify();
  try {
    const account = await db.accounts.get(accountId);
    if (!account) return null;
    return await syncAgent({ db, fetchSnapshot, now: () => new Date() }, account);
  } finally {
    runningAccounts.delete(accountId);
    notify();
  }
}

export function useAgentSync(accountId: string) {
  const db = useDb();
  const running = useSyncExternalStore(subscribe, () => runningAccounts.has(accountId));
  const current = useAgentPresence();

  const run = useCallback(async () => {
    // A manual pass never moves the watcher's cadence, which is per pass, not per account (§3.4).
    await runAgentSync(db, accountId);
    // `db` is the module singleton `useDb()` always returns: listing it here is exhaustive-deps
    // correctness, not a real dependency — it never changes, so it never re-creates `run`.
  }, [accountId, db]);

  return { presence: current, state: running ? ("running" as const) : ("idle" as const), run };
}
