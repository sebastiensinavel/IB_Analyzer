import { buildIdentities, buildJournals, pairCorporateActions, sortTransactions, type ActivableStrategy, type IdentityInput, type Transaction } from "@ib/ledger";
import { activeStrategies } from "@/lib/strategies";
import { readIdentityInputs } from "./contracts";
import type { JournalsView } from "./hooks";
import type { AccountRecord, AppDatabase, SnapshotRecord } from "./schema";

export type ReadyJournals = Extract<JournalsView, { status: "ready" }>;

/** The whole ledger of one account, in reference order — what `useLedger` shows. */
export async function readLedger(db: AppDatabase, accountId: string): Promise<Transaction[]> {
  return sortTransactions(await db.transactions.where("accountId").equals(accountId).toArray());
}

/**
 * The journals of one account from its stored inputs, the one sequence `useJournals` and the
 * alert watcher (sub-project 43) both run: the events date the ambiguous tickers, and the same
 * events are paired again inside `buildJournals` — pairing is pure and cheap, and passing a
 * pre-built list in would make the engine's own input ambiguous.
 */
export function computeJournals(
  ledger: Transaction[],
  snapshot: SnapshotRecord | null,
  inputs: IdentityInput[],
  active: readonly ActivableStrategy[],
): ReadyJournals {
  const { events, issues: actionIssues } = pairCorporateActions(ledger);
  const identities = buildIdentities(inputs, events);
  return {
    status: "ready",
    report: buildJournals(ledger, snapshot ? { asOf: snapshot.asOf, positions: snapshot.positions } : undefined, identities, active),
    identityIssues: [...identities.issues, ...actionIssues],
  };
}

/** One account's journals read straight from the base, outside React; `null` for an unknown account. */
export async function loadAccountJournals(
  db: AppDatabase,
  accountId: string,
): Promise<{ account: AccountRecord; snapshot: SnapshotRecord | null; journals: ReadyJournals } | null> {
  const [account, ledger, snapshot, inputs] = await Promise.all([
    db.accounts.get(accountId),
    readLedger(db, accountId),
    db.snapshots.get(accountId),
    readIdentityInputs(db, accountId),
  ]);
  if (account === undefined) return null;
  const own = snapshot ?? null;
  return { account, snapshot: own, journals: computeJournals(ledger, own, inputs, activeStrategies(account)) };
}
