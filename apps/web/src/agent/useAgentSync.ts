import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useDb } from "@/db/DbProvider";
import { fetchSnapshot, probeAgent } from "./client";
import { syncAgent } from "./sync";

/** Five minutes: TWS reconnects on every pass, and a hidden tab never opens one for nothing. */
export const AGENT_POLL_MS = 5 * 60 * 1000;

export type AgentPresence = { status: "unknown" } | { status: "absent" } | { status: "present"; version: string };

// Module-level state, shared by every hook instance of the tab, for the same reasons as
// `useFlexAutoSync`'s `runningAccounts`: AppLayout drives the cadence, pages read the presence
// and press the button, and none of them may see a different "running" than the others.
let presence: AgentPresence = { status: "unknown" };
const runningAccounts = new Set<string>();
const lastRunAt = new Map<string, number>();
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
  lastRunAt.clear();
  notify();
}

export function useAgentPresence(): AgentPresence {
  return useSyncExternalStore(subscribe, () => presence);
}

export function useAgentSync(accountId: string) {
  const db = useDb();
  // Read through a ref: see useFlexAutoSync for why `useDb()` may change under a running hook.
  const dbRef = useRef(db);
  useEffect(() => {
    dbRef.current = db;
  }, [db]);
  const running = useSyncExternalStore(subscribe, () => runningAccounts.has(accountId));
  const agentPresence = useAgentPresence();

  const run = useCallback(async () => {
    // Check-then-add with no `await` in between: two callers in one tick cannot both pass.
    if (!accountId || runningAccounts.has(accountId)) return;
    runningAccounts.add(accountId);
    lastRunAt.set(accountId, Date.now());
    notify();
    try {
      const account = await dbRef.current.accounts.get(accountId);
      if (!account) return;
      await syncAgent({ db: dbRef.current, fetchSnapshot, now: () => new Date() }, account);
    } finally {
      runningAccounts.delete(accountId);
      notify();
    }
  }, [accountId]);

  return { presence: agentPresence, state: running ? ("running" as const) : ("idle" as const), run };
}

/**
 * Mounted once, by AppLayout, for the account currently open (spec §6.5): probe at open,
 * a pass at once when the agent is present and a port is set, then one every five minutes
 * while the tab is visible. A hidden tab skips its ticks; coming back after more than five
 * minutes passes at once. A manual `run` restarts the countdown. Without a port nothing is
 * even probed: the Sources page says so.
 */
export function useAgentPolling(accountId: string): void {
  const db = useDb();
  const twsPort = useLiveQuery(
    async () => (accountId ? (await db.accounts.get(accountId))?.twsPort : undefined),
    [db, accountId],
  );
  const { run } = useAgentSync(accountId);

  useEffect(() => {
    if (!accountId || twsPort === undefined) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const due = () => Date.now() - (lastRunAt.get(accountId) ?? 0) >= AGENT_POLL_MS;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void tick(), AGENT_POLL_MS);
    };
    const tick = async () => {
      if (cancelled) return;
      if (document.visibilityState === "visible") {
        const found = await refreshPresence();
        if (cancelled) return;
        if (found.status === "present") await run();
      }
      if (!cancelled) arm();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible" && due()) void tick();
    };
    // A manual run (the button) moved `lastRunAt`: restart the countdown from it.
    let seen = lastRunAt.get(accountId);
    const unsubscribe = subscribe(() => {
      const now = lastRunAt.get(accountId);
      if (now !== seen) {
        seen = now;
        if (!cancelled) arm();
      }
    });

    void tick();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [accountId, twsPort, run]);
}
