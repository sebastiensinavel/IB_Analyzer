import { NormalizationError, parseAgentSnapshot, type AgentSnapshot } from "@ib/ib-parsers";
import { planImport, type ImportPlan } from "@ib/ledger";
import { suppressBackupTrigger } from "@/db/backup/trigger";
import { withImportLock } from "@/db/importLock";
import type { AccountRecord, AgentSyncCode, AppDatabase } from "@/db/schema";
import { shouldReplaceSnapshot } from "@/db/snapshot";
import { mergeContractRecords } from "@/db/contracts";
import { addMissingSectors } from "@/db/sectors";
import type { AgentFetchResult } from "./client";

export interface AgentSyncDeps {
  db: AppDatabase;
  fetchSnapshot: (port: number) => Promise<AgentFetchResult>;
  now: () => Date;
}

export type AgentSyncOutcome =
  | { status: "ok"; transactions: number; positions: number }
  | { status: "skipped"; code: "no-port" }
  | { status: "failed"; code: AgentSyncCode };

async function fail(deps: AgentSyncDeps, accountId: string, code: AgentSyncCode): Promise<AgentSyncOutcome> {
  // Only the outcome of *this* attempt: `lastAgentSyncAt` keeps pointing at the last success.
  await deps.db.accounts.update(accountId, { lastAgentSyncStatus: { at: deps.now().toISOString(), ok: false, code } });
  return { status: "failed", code };
}

/**
 * One agent pass: call, parse, check the account, then a single IndexedDB transaction. No
 * ImportRecord — the account carries the state — and nothing is ever deleted (`planAgent`).
 * Serialized per account behind the import lock like every other writer of the ledger.
 */
export async function syncAgent(deps: AgentSyncDeps, account: AccountRecord): Promise<AgentSyncOutcome> {
  const port = account.twsPort;
  if (port === undefined) return { status: "skipped", code: "no-port" };

  // A pass never triggers a deposit, whichever tables it ends up touching: the agent polls
  // every five minutes, writing `accounts` on every attempt and `contracts` on every one that
  // sees an identity — both are in TRIGGER_TABLES, so a table-scoped trigger alone would push
  // the whole database every five minutes for the length of the session, the exact loop this
  // rule exists to stop. Its transactions are not lost for that: they still leave at the next
  // triggered deposit — an import, a Flex sync, a sector edit, or the manual button. The
  // trigger decides *when*, never *what*.
  //
  // Only the writes are muted: `deps.fetchSnapshot(port)` is a round trip to the local agent,
  // itself possibly waiting on TWS — seconds, not microtasks — and `suppressBackupTrigger`'s
  // counter is module-level, not scoped to this account. Muting across that wait would also
  // swallow an unrelated deposit — another account's Flex sync, say — landing in the same
  // window. Every write below, success or failure, stays wrapped.
  const fetched = await deps.fetchSnapshot(port);
  if (!fetched.ok) return suppressBackupTrigger(() => fail(deps, account.id, fetched.code));

  let parsed: AgentSnapshot;
  try {
    parsed = parseAgentSnapshot(fetched.payload, account.id);
  } catch (e) {
    if (e instanceof NormalizationError) return suppressBackupTrigger(() => fail(deps, account.id, "parse-error"));
    throw e;
  }
  // Exact match, not membership: ib_async's portfolio(""), accountValues("") and fills() merge
  // *every* managed account of a multi-account TWS, and extract_usd_cash sums across them too.
  // `includes` would pass precisely when that merge happens, silently combining two accounts'
  // data - the one thing "Comptes jamais combinés" forbids. Failing honestly on a TWS that
  // manages more than this one account beats writing a merged snapshot.
  if (parsed.accounts.length !== 1 || parsed.accounts[0] !== account.ibAccountId) {
    return suppressBackupTrigger(() => fail(deps, account.id, "account-mismatch"));
  }

  const at = deps.now().toISOString();
  let plan!: ImportPlan;
  await suppressBackupTrigger(() =>
    withImportLock(account.id, () =>
      deps.db.transaction(
        "rw",
        [deps.db.transactions, deps.db.snapshots, deps.db.accounts, deps.db.contracts, deps.db.sectors],
        async () => {
        const existing = await deps.db.transactions.where("accountId").equals(account.id).toArray();
        plan = planImport(existing, { source: "agent", transactions: parsed.transactions, period: null });
        await deps.db.transactions.bulkPut(plan.upsert);
        const current = await deps.db.snapshots.get(account.id);
        // Always true for an agent snapshot; called anyway so there is exactly one rule.
        if (shouldReplaceSnapshot(current, { source: "agent", asOf: parsed.fetchedAt })) {
          await deps.db.snapshots.put({
            accountId: account.id,
            source: "agent",
            asOf: parsed.fetchedAt,
            importedAt: at,
            positions: parsed.positions,
            cashAvailable: parsed.cashAvailable,
          });
        }
        if (parsed.identities.length > 0) {
          const currentContracts = await deps.db.contracts.where("accountId").equals(account.id).toArray();
          await deps.db.contracts.bulkPut(mergeContractRecords(account.id, currentContracts, parsed.identities, null, at));
        }
        await addMissingSectors(deps.db, { transactions: parsed.transactions, positions: parsed.positions, identities: parsed.identities }, at);
        await deps.db.accounts.update(account.id, { lastAgentSyncAt: at, lastAgentSyncStatus: { at, ok: true } });
        },
      ),
    ),
  );
  return { status: "ok", transactions: plan.upsert.length, positions: parsed.positions.length };
}
