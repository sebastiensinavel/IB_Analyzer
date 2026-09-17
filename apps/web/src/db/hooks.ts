import { useCallback, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  buildIdentities,
  buildJournals,
  pairCorporateActions,
  sortTransactions,
  type IdentityInput,
  type IdentityIssue,
  type JournalsReport,
  type Transaction,
} from "@ib/ledger";
import { buildRiskReport, type RiskReport } from "@ib/coverage";
import { readIdentityInputs } from "./contracts";
import { useDb } from "./DbProvider";
import { heldTickers } from "./sectors";
import type { AccountRecord, CashPointRecord, ImportRecord, SectorRecord, SnapshotRecord, StatementRecord } from "./schema";

/** `undefined` while the query has not answered yet. */
export function useAccounts(): AccountRecord[] | undefined {
  const db = useDb();
  return useLiveQuery(() => db.accounts.orderBy("id").toArray(), [db]);
}

/** `undefined` while loading, `null` when there is no such account. */
export function useAccount(id: string | undefined): AccountRecord | null | undefined {
  const db = useDb();
  return useLiveQuery(async () => (id ? ((await db.accounts.get(id)) ?? null) : null), [db, id]);
}

/** The whole ledger of one account, in reference order; `undefined` while loading. */
export function useLedger(accountId: string): Transaction[] | undefined {
  const db = useDb();
  const rows = useLiveQuery(() => db.transactions.where("accountId").equals(accountId).toArray(), [db, accountId]);
  return useMemo(() => (rows ? sortTransactions(rows) : undefined), [rows]);
}

/** Past imports of one account, newest first. */
export function useImports(accountId: string): ImportRecord[] | undefined {
  const db = useDb();
  return useLiveQuery(
    () => db.imports.where("accountId").equals(accountId).reverse().sortBy("at"),
    [db, accountId],
  );
}

/**
 * The statements kept for one account, by the period each one declares, oldest first.
 * A rebuild may re-key a file whose period the parser now reads differently, so this is
 * the stored order, not a promise about the next replay. `undefined` while loading.
 */
export function useStatements(accountId: string): StatementRecord[] | undefined {
  const db = useDb();
  const rows = useLiveQuery(() => db.statements.where("accountId").equals(accountId).toArray(), [db, accountId]);
  return useMemo(
    () =>
      rows
        ? [...rows].sort(
            (a, b) =>
              a.period.start.localeCompare(b.period.start) ||
              a.period.end.localeCompare(b.period.end) ||
              a.fileName.localeCompare(b.fileName),
          )
        : undefined,
    [rows],
  );
}

/** `undefined` while loading, `null` when the account has no positions yet. */
export function useSnapshot(accountId: string): SnapshotRecord | null | undefined {
  const db = useDb();
  return useLiveQuery(async () => (await db.snapshots.get(accountId)) ?? null, [db, accountId]);
}

/** The cash points of one account; `undefined` while loading. */
export function useCashPoints(accountId: string): CashPointRecord[] | undefined {
  const db = useDb();
  return useLiveQuery(() => db.cashPoints.where("accountId").equals(accountId).toArray(), [db, accountId]);
}

/** The whole sector table keyed by ticker; `undefined` while loading. */
export function useSectors(): Map<string, SectorRecord> | undefined {
  const db = useDb();
  const rows = useLiveQuery(() => db.sectors.toArray(), [db]);
  return useMemo(() => (rows ? new Map(rows.map((row) => [row.ticker, row])) : undefined), [rows]);
}

/** The tickers a position of any account holds, every account at once like the sector table; `undefined` while loading. */
export function useHeldTickers(): ReadonlySet<string> | undefined {
  const db = useDb();
  const snapshots = useLiveQuery(() => db.snapshots.toArray(), [db]);
  return useMemo(() => (snapshots ? heldTickers(snapshots.flatMap((snapshot) => snapshot.positions)) : undefined), [snapshots]);
}

export interface RiskReportView {
  snapshot: SnapshotRecord | null | undefined;
  /** Same three states as `snapshot`. */
  report: RiskReport | null | undefined;
  /** Category of the ticker, `null` when the table does not know it. */
  sectorOf: (symbol: string) => string | null;
}

/** The risk report of one account, recomputed when its snapshot changes. */
export function useRiskReport(accountId: string): RiskReportView {
  const snapshot = useSnapshot(accountId);
  const sectors = useSectors();
  const report = useMemo(
    () => (snapshot ? buildRiskReport(snapshot.positions, snapshot.cashAvailable) : snapshot),
    [snapshot],
  );
  const sectorOf = useCallback((symbol: string) => sectors?.get(symbol)?.category || null, [sectors]);
  return { snapshot, report, sectorOf };
}

/** The identity table of one account, ready for the replay; `undefined` while loading. */
export function useContractIdentities(accountId: string): IdentityInput[] | undefined {
  const db = useDb();
  return useLiveQuery(() => readIdentityInputs(db, accountId), [db, accountId]);
}

export type JournalsView =
  | { status: "loading" }
  | { status: "ready"; report: JournalsReport; identityIssues: IdentityIssue[] };

/** The journals of one account, recomputed from its ledger, snapshot and contracts; never stored. */
export function useJournals(accountId: string): JournalsView {
  const ledger = useLedger(accountId);
  const snapshot = useSnapshot(accountId);
  const inputs = useContractIdentities(accountId);
  return useMemo<JournalsView>(() => {
    if (ledger === undefined || snapshot === undefined || inputs === undefined) return { status: "loading" };
    // The events date the ambiguous tickers, and the same events are paired
    // again inside `buildJournals`: pairing is pure and cheap, and passing a
    // pre-built list in would make the engine's own input ambiguous.
    const { events, issues: actionIssues } = pairCorporateActions(ledger);
    const identities = buildIdentities(inputs, events);
    return {
      status: "ready",
      report: buildJournals(ledger, snapshot ? { asOf: snapshot.asOf, positions: snapshot.positions } : undefined, identities),
      identityIssues: [...identities.issues, ...actionIssues],
    };
  }, [ledger, snapshot, inputs]);
}
