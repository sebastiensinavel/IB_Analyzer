import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useSession } from "@/api/session";
import { refreshPresence, useAgentPresence } from "@/agent/useAgentSync";
import { useDb } from "@/db/DbProvider";
import { getStatement, sendRequest } from "./proxy";
import { flexRelayMode, pickFlexRelay } from "./relay";
import { isFlexSyncStale } from "./stale";
import { syncAccount } from "./sync";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Per-account lock shared by every `useFlexAutoSync` instance in the tab, not per component
 * instance: AppLayout calls this hook for its auto-trigger effect, and SourcesPage calls it a
 * second time for the manual button's `state`/`run`. A `useRef` guard would only protect one
 * of those two call sites against the other — two independent instances for the same account
 * would each see their own ref as free and could both launch `syncAccount` at once. Keying the
 * lock by `accountId` at module scope also means switching accounts never bleeds one account's
 * "running" state onto another's: `running` below is recomputed fresh from this map on every
 * render, for whichever `accountId` the hook was called with, so there is nothing local to
 * reset by hand (task 15's lesson about `<Outlet />` never remounting on an account switch).
 */
const runningAccounts = new Set<string>();
const listeners = new Set<() => void>();

/**
 * What each account's last sync attempt was made with: `relay|lastFlexSyncAt`. The auto-trigger
 * re-evaluates whenever the session or the agent's presence changes, and `run`'s own ping is
 * one such change — without this record the effect would run again right after the pass it
 * just made and, a failed pass leaving `lastFlexSyncAt` untouched, sync a second time through
 * the same relay. An automatic attempt only goes ahead when the relay or the last successful
 * sync differs from the recorded attempt. Module-level, like `runningAccounts`, so two hook
 * instances share it; forgotten once the last instance leaves the account, so entering it again
 * retries, as it always has. `mounted` counts the live instances per account: AppLayout stays
 * on the account while the Sources page comes and goes, and leaving the Sources page alone must
 * not forget the attempt AppLayout's instance still relies on.
 */
const attempts = new Map<string, string>();
const mounted = new Map<string, number>();

/** Test seam: forget every attempt, lock and mounted instance between tests. */
export function resetFlexAutoSyncState(): void {
  attempts.clear();
  mounted.clear();
  runningAccounts.clear();
  notify();
}

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFlexAutoSync(accountId: string) {
  const db = useDb();
  const session = useSession();
  const running = useSyncExternalStore(subscribe, () => runningAccounts.has(accountId));

  // Read through a ref, not as a `useCallback`/`useEffect` dependency: `useDb()` can return a
  // *different* `AppDatabase` instance later in the very same visit to an account —
  // `DbProvider` swaps from the default profile to the signed-in user's own database once its
  // one-time adoption (db/profile.ts) finishes opening, shortly after `session` turns
  // "authenticated". If that swap changed `run`'s or the auto-trigger effect's identity, the
  // effect below would re-run and could judge the account stale and sync it a second time in
  // the same visit — a real, if narrow, race on first login with a stale account, and each
  // extra attempt burns a real Flex `send-request` round trip against IB's own quota (the
  // whole reason `stale.ts`'s twelve-hour floor exists). Reading `dbRef.current` instead keeps
  // `run` and the effect stable across that swap while still using whichever `AppDatabase` is
  // actually current at the moment they run.
  const dbRef = useRef(db);
  useEffect(() => {
    dbRef.current = db;
  }, [db]);

  const agentStatus = useAgentPresence().status;
  // Read at run time through a ref, like `db`: the session settling must re-evaluate the
  // auto-trigger (it is an effect dependency below), never change `run`'s identity. This
  // effect is declared before the auto-trigger one, so the ref is current when it runs.
  const sessionRef = useRef(session.status);
  useEffect(() => {
    sessionRef.current = session.status;
  }, [session.status]);

  const attempt = useCallback(async (auto: boolean) => {
    // Check-then-add with no `await` in between: two calls racing in the same tick (the
    // auto-trigger effect and a manual click, or two hook instances) can never both pass this
    // guard, unlike a naive `if (running) return; ...await...; running = true`.
    if (runningAccounts.has(accountId)) return;
    runningAccounts.add(accountId);
    notify();
    try {
      const runDb = dbRef.current;
      const account = await runDb.accounts.get(accountId);
      if (!account?.flexToken || !account.flexQueryId) return;
      // A fresh ping on every sync: agent first, and the server only if the account allows it.
      const presence = await refreshPresence();
      const choice = pickFlexRelay(flexRelayMode(account), presence.status === "present", sessionRef.current);
      // No relay is not a failure: nothing is recorded, the Sources page explains why.
      if (choice.relay === null) return;
      const via = choice.relay;
      const key = `${via}|${account.lastFlexSyncAt ?? ""}`;
      if (auto && attempts.get(accountId) === key) return;
      // Left during the awaits above: recording now would outlive the visit and block the retry
      // on re-entry, the cleanup below having already run.
      if (mounted.has(accountId)) attempts.set(accountId, key);
      await syncAccount(
        {
          db: runDb,
          relay: via,
          sendRequest: (input) => sendRequest(via, input),
          getStatement: (input) => getStatement(via, input),
          sleep,
          now: () => new Date(),
        },
        account,
      );
    } finally {
      runningAccounts.delete(accountId);
      notify();
    }
  }, [accountId]);

  const run = useCallback(() => attempt(false), [attempt]);

  useEffect(() => {
    mounted.set(accountId, (mounted.get(accountId) ?? 0) + 1);
    return () => {
      const left = (mounted.get(accountId) ?? 0) - 1;
      if (left > 0) {
        mounted.set(accountId, left);
      } else {
        mounted.delete(accountId);
        attempts.delete(accountId);
      }
    };
  }, [accountId]);

  useEffect(() => {
    // Never without credentials, never when fresh. No session required any more: the agent
    // relays without one, and `run` decides whether any relay is available. But never while
    // the session is still loading either: `DbProvider` may yet swap to the signed-in user's
    // database, and `dbRef` would still point at the default profile. The session settling
    // re-runs this effect; a manual `run` is not held back.
    if (session.status === "loading") return;
    let cancelled = false;
    void (async () => {
      const account = await dbRef.current.accounts.get(accountId);
      if (cancelled || !account?.flexToken || !account.flexQueryId) return;
      if (!isFlexSyncStale(account.lastFlexSyncAt, Date.now())) return;
      await attempt(true);
    })();
    return () => {
      cancelled = true;
    };
    // `db` deliberately excluded: see the `dbRef` comment above. Entering an account, the
    // session settling, or the agent appearing or vanishing re-evaluates whether to auto-sync.
  }, [accountId, attempt, session.status, agentStatus]);

  return { state: running ? ("running" as const) : ("idle" as const), run };
}
