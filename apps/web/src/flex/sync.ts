import { parseFlexSendRequest, parseFlexStatementEnvelope } from "@ib/ib-parsers";
import { importFile, type ImportReport } from "@/db/importFile";
import { withImportLock } from "@/db/importLock";
import type { AccountRecord, AppDatabase } from "@/db/schema";
import type { ProxyResult } from "./proxy";
import type { FlexRelay } from "./relay";

/**
 * IB allows one request per second and ten per minute (spec fondateur §3.2), and our own proxy
 * enforces exactly those two rules per user (`apps/api/ib/throttling.py`). Both proxy endpoints
 * share one bucket, so `send-request` and every `get-statement` spend from the same budget:
 * this loop has to be dimensioned against the server's limit, not just against IB's.
 *
 * Worst-case schedule, every wait at its floor — `send-request` at t=0, `get-statement` #k at
 * t = 1.5 + 7(k-1) seconds:
 *   - one per second: the tightest gap is the 1.5 s between `send-request` and the first
 *     `get-statement`; every later gap is at least 7 s;
 *   - ten per minute: a call is refused only when the ten calls before it all fall inside the
 *     preceding 60 s. Call #11 (get #10, t=64.5 s) is 64.5 s after `send-request`, and call #12
 *     is 70 s after get #1 — both outside the window, the tightest margin being 4.5 s.
 * With `MAX_ATTEMPTS` at 12 the loop polls for about 79 s before giving up, and every one of
 * the twelve attempts is actually reachable.
 *
 * IB's 5 s and 10 s are *minimums* it imposes, never maximums: waiting longer is allowed,
 * waiting less is not. `POLL_WAIT_MS` is that 5 s floor raised to fit our own budget; 1018's
 * 10 s already exceeds it and is kept as is.
 *
 * `apps/api/tests/test_flex_throttling.py` replays exactly this schedule against the real
 * router. Change a number here and change it there, or that test goes red.
 *
 * The local agent has no rate limit of its own; the same schedule keeps it inside IB's.
 */
const POLL_WAIT_MS = 7000;
const RETRY_WAIT_MS: Record<string, number> = { "1009": POLL_WAIT_MS, "1019": POLL_WAIT_MS, "1018": 10000 };
const FIRST_STATEMENT_WAIT_MS = 1500;
const MAX_ATTEMPTS = 12;

/**
 * A 429 is the proxy saying "not yet", never "no". We honour its `Retry-After` and try again,
 * but a small number of times: an unbounded wait loop would let two tabs syncing the same user
 * push each other around for ever. Four is enough to absorb a whole 60 s window's worth of
 * contention without the sync becoming unbounded.
 */
const MAX_THROTTLE_WAITS = 4;
const FALLBACK_THROTTLE_WAIT_MS = 2000;

export interface FlexSyncDeps {
  db: AppDatabase;
  /** Who carries this sync, chosen once by `useFlexAutoSync` (flex/relay.ts). Recorded, never used to route. */
  relay: FlexRelay;
  sendRequest: (input: { token: string; queryId: string }) => Promise<ProxyResult>;
  getStatement: (input: { token: string; referenceCode: string }) => Promise<ProxyResult>;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
}

export type FlexSyncOutcome =
  | { status: "ok"; report: ImportReport }
  | { status: "skipped"; code: "no-credentials" }
  | { status: "failed"; code: string };

async function record(deps: FlexSyncDeps, accountId: string, outcome: FlexSyncOutcome): Promise<FlexSyncOutcome> {
  const at = deps.now().toISOString();
  const ok = outcome.status === "ok";
  await deps.db.accounts.update(accountId, {
    // `record` is only ever called on "ok" and "failed": a skipped sync returns
    // before it, and must leave the account untouched.
    lastFlexSyncStatus:
      outcome.status === "ok" ? { at, ok, relay: deps.relay } : { at, ok, code: outcome.code, relay: deps.relay },
    ...(ok ? { lastFlexSyncAt: at } : {}),
  });
  return outcome;
}

/**
 * Runs one proxy call, waiting out a 429 rather than failing on it. `budget` is shared by every
 * call of a single sync, so the whole run — not each call — is bounded.
 */
async function callThroughProxy(
  deps: FlexSyncDeps,
  call: () => Promise<ProxyResult>,
  budget: { throttleWaitsLeft: number },
): Promise<ProxyResult> {
  for (;;) {
    const result = await call();
    if (result.ok || result.code !== "rate-limited") return result;
    if (budget.throttleWaitsLeft <= 0) return result;
    budget.throttleWaitsLeft -= 1;
    await deps.sleep(result.retryAfterMs ?? FALLBACK_THROTTLE_WAIT_MS);
  }
}

export async function syncAccount(deps: FlexSyncDeps, account: AccountRecord): Promise<FlexSyncOutcome> {
  const token = account.flexToken;
  const queryId = account.flexQueryId;
  if (!token || !queryId) return { status: "skipped", code: "no-credentials" };

  const budget = { throttleWaitsLeft: MAX_THROTTLE_WAITS };
  const sent = await callThroughProxy(deps, () => deps.sendRequest({ token, queryId }), budget);
  if (!sent.ok) return record(deps, account.id, { status: "failed", code: sent.code });

  const envelope = parseFlexSendRequest(sent.xml);
  if (envelope.status !== "success") {
    return record(deps, account.id, {
      status: "failed",
      code: envelope.status === "error" ? envelope.errorCode : "unreadable",
    });
  }

  // The proxy's "one per second" rule counts `send-request` too: asking for the statement in
  // the same breath is a guaranteed 429 whenever IB answers `SendRequest` in under a second,
  // which is the usual case since it only queues the report.
  await deps.sleep(FIRST_STATEMENT_WAIT_MS);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const answer = await callThroughProxy(
      deps,
      () => deps.getStatement({ token, referenceCode: envelope.referenceCode }),
      budget,
    );
    if (!answer.ok) return record(deps, account.id, { status: "failed", code: answer.code });

    const state = parseFlexStatementEnvelope(answer.xml);
    if (state.status === "ready") {
      const day = deps.now().toISOString().slice(0, 10);
      const file = new File([answer.xml], `flex-${day}.xml`, { type: "application/xml" });
      const fresh = (await deps.db.accounts.get(account.id)) ?? account;
      const report = await withImportLock(account.id, () => importFile(deps.db, fresh, file));
      if (report.status === "error") {
        return record(deps, account.id, { status: "failed", code: "import-refused" });
      }
      return record(deps, account.id, { status: "ok", report });
    }

    const wait = state.status === "error" ? RETRY_WAIT_MS[state.errorCode] : undefined;
    if (wait === undefined) {
      return record(deps, account.id, {
        status: "failed",
        code: state.status === "error" ? state.errorCode : "unreadable",
      });
    }
    await deps.sleep(wait);
  }

  return record(deps, account.id, { status: "failed", code: "flex-retry-exhausted" });
}
