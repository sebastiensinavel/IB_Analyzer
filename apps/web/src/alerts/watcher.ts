import { liveQuery } from "dexie";
import { fetchBars } from "@/agent/client";
import { getQuotesSnapshot, refreshQuotes } from "@/agent/quotes";
import { AGENT_POLL_MS, refreshPresence, runAgentSync } from "@/agent/useAgentSync";
import type { AppDatabase } from "@/db/schema";
import i18n from "@/i18n";
import { evaluateAccountAlerts } from "./evaluateAccount";
import { notifyTriggered } from "./notify";

export interface WatcherDeps {
  db: AppDatabase;
  /** Opens an in-app path (the router's `navigate`). */
  open: (path: string) => void;
  /** `navigator.locks` by default; `null` watches alone, without an election. */
  locks?: Pick<LockManager, "request"> | null;
}

function defaultLocks(): Pick<LockManager, "request"> | null {
  return typeof navigator !== "undefined" && navigator.locks ? navigator.locks : null;
}

/**
 * One pass over every account with a TWS port, one after the other (sub-project 43, §3.3): the
 * agent pass, then the account's alerts, then a notification per alert triggered. An account's
 * failure never stops the next one.
 */
async function pass(db: AppDatabase, open: (path: string) => void): Promise<void> {
  if ((await refreshPresence()).status !== "present") return;
  const accounts = await db.accounts.orderBy("id").toArray();
  const named = accounts.length > 1;
  for (const account of accounts) {
    if (account.twsPort === undefined) continue;
    try {
      const outcome = await runAgentSync(db, account.id);
      // Already syncing in this tab (the Refresh button), or deleted meanwhile: skipped this pass.
      if (outcome === null) continue;
      const triggered = await evaluateAccountAlerts(db, account.id, {
        fresh: outcome.status === "ok",
        quote: refreshQuotes,
        quotes: getQuotesSnapshot,
        fetchBars,
        now: () => new Date(),
      });
      for (const { alert, price } of triggered) {
        notifyTriggered(alert, () => open(`/accounts/${account.id}/alerts`), i18n.t, i18n.language, price, named ? account.id : undefined);
      }
    } catch {
      // A closed base, an engine that throws: the next account passes, the next pass retries.
    }
    // Hands the main thread back between two accounts' journals.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * The alert watcher (sub-project 43): started once per tab by `main.tsx`, whatever the route. Every
 * tab probes the agent (its presence is the tab's own state); only the tab holding
 * `ib2:watcher:<base>` passes — at once, then `AGENT_POLL_MS` after the end of each pass, hidden
 * or not, and at once when an account gains a TWS port. Returns `stop`, which releases the lock.
 */
export function startAlertWatcher({ db, open, locks = defaultLocks() }: WatcherDeps): () => void {
  let stopped = false;

  // Presence, in every tab: `/health` opens no TWS connection, and a tab that never probed would
  // stay "unknown" — no quotes, no Refresh button, no Flex relay through the agent (§3.1).
  let hasPort = false;
  let lastProbe = 0;
  const probe = () => {
    if (stopped || !hasPort) return;
    lastProbe = Date.now();
    void refreshPresence();
  };
  const probeTimer = setInterval(probe, AGENT_POLL_MS);
  const onVisibility = () => {
    if (document.visibilityState === "visible" && Date.now() - lastProbe >= AGENT_POLL_MS) probe();
  };
  document.addEventListener("visibilitychange", onVisibility);

  // Passes, in the leading tab only. Never two at once: one asked for while another runs is played
  // right after it, once; the next one is armed only at the end of a pass (§3.2).
  let leading = false;
  let running = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const request = async (): Promise<void> => {
    if (!leading || stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    clearTimeout(timer);
    try {
      do {
        again = false;
        lastProbe = Date.now();
        await pass(db, open);
      } while (again && !stopped);
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(() => void request(), AGENT_POLL_MS);
    }
  };

  // The accounts' ports, live: a port gained (or changed) asks for a pass at once.
  let ports: Set<string> | null = null;
  const subscription = liveQuery(() => db.accounts.toArray()).subscribe({
    next: (accounts) => {
      const next = new Set(accounts.filter((a) => a.twsPort !== undefined).map((a) => `${a.id}|${a.twsPort}`));
      const first = ports === null;
      const gained = !first && [...next].some((key) => !ports!.has(key));
      ports = next;
      hasPort = next.size > 0;
      if (first) probe();
      else if (gained) {
        probe();
        void request();
      }
    },
    error: () => {},
  });

  // The election: the lock is held until `stop` (the tab's end), then another tab's request is granted.
  const controller = new AbortController();
  let release: (() => void) | undefined;
  const lead = () => {
    leading = true;
    void request();
  };
  if (locks) {
    locks
      .request(`ib2:watcher:${db.name}`, { signal: controller.signal }, () => {
        if (stopped) return undefined;
        lead();
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      })
      // Aborted while waiting (stopped before leading): nothing to do.
      .catch(() => {});
  } else lead();

  return () => {
    stopped = true;
    leading = false;
    clearTimeout(timer);
    clearInterval(probeTimer);
    document.removeEventListener("visibilitychange", onVisibility);
    subscription.unsubscribe();
    controller.abort();
    release?.();
  };
}
