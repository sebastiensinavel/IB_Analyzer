import Dexie, { type EntityTable, type Table } from "dexie";
import type { DroppedCount, Position, Transaction, TransactionKind, TransactionSource } from "@ib/ledger";
import { toReportTime, type ParseIssue } from "@ib/ib-parsers";
import type { FlexRelay, FlexRelayMode } from "@/flex/relay";
import type { ContractRecord } from "./contracts";

export type AgentSyncCode = "agent-unreachable" | "tws-unreachable" | "agent-error" | "account-mismatch" | "parse-error";

export interface AccountRecord {
  /** Slug of the label; the `:accountId` of every route. */
  id: string;
  label: string;
  ibAccountId: string;
  createdAt: string;
  /** Kinds already reported as dropped by a Flex sync: warn once per kind. */
  warnedDroppedKinds: TransactionKind[];
  /** Flex Web Service token, typed by the user. Leaves the browser only for the relay: the local agent, or the server's proxy when the account allows it. */
  flexToken?: string;
  /** The query id of this account's Flex Query. */
  flexQueryId?: string;
  /** ISO timestamp of the last successful sync; absent means never. */
  lastFlexSyncAt?: string;
  /** Outcome of the last attempt, for the Sources page. `relay` is absent on attempts older than sub-project 19. */
  lastFlexSyncStatus?: { at: string; ok: boolean; code?: string; relay?: FlexRelay };
  /** Who may relay this account's Flex calls. Absent: "agent" — read it through `flexRelayMode`. */
  flexRelay?: FlexRelayMode;
  /** Port of this account's TWS API on the user's own machine. Absent: the agent is never called. */
  twsPort?: number;
  /** ISO timestamp of the last successful agent pass; absent means never. */
  lastAgentSyncAt?: string;
  /** Outcome of the last agent pass, for the Sources page and the pages' status badge. */
  lastAgentSyncStatus?: { at: string; ok: boolean; code?: AgentSyncCode };
}

export interface ImportRecord {
  id?: number;
  accountId: string;
  /** The agent never writes an ImportRecord: a pass every five minutes would drown the table. */
  source: Exclude<TransactionSource, "agent">;
  at: string;
  fileName: string;
  period: { start: string; end: string } | null;
  imported: number;
  skipped: number;
  dropped: DroppedCount[];
  issues: ParseIssue[];
  /** Positions written by this import; absent on records older than version 2. */
  positions?: number | null;
  cashAvailable?: number | null;
}

/** The current positions of one account: one document, replaced whole. */
export interface SnapshotRecord {
  accountId: string;
  source: "flex" | "statement_html" | "agent";
  /** Flex or statement: YYYY-MM-DD of the close. Agent: the full ISO instant of the pass. */
  asOf: string;
  importedAt: string;
  positions: Position[];
  cashAvailable: number | null;
}

/**
 * One point of the Cash Reports of one account's files: per currency, the latest Ending Cash the
 * running balance is anchored on and the oldest Starting Cash it is checked against. Written by
 * file imports and statement replays only, never by the agent.
 */
export interface CashPointRecord {
  accountId: string;
  currency: string;
  kind: "start" | "end";
  /** YYYY-MM-DD */
  asOf: string;
  amount: number;
  source: "flex" | "statement_html";
  importedAt: string;
}

/**
 * The raw HTML of one imported activity statement, kept so the ledger can be rebuilt
 * from the files themselves when the parser improves. Flex responses and the agent's
 * answers are never kept: Flex is re-fetched on demand and the agent is polled again
 * five minutes later, while a statement is a one-off download the user may no longer
 * have. Nothing here ever leaves the browser.
 */
export interface StatementRecord {
  /** `${accountId}|${period.start}|${period.end}`: a statement owns its declared period. */
  id: string;
  accountId: string;
  /** For display only. A browser renaming a second download "(1).htm" must not fork the identity. */
  fileName: string;
  period: { start: string; end: string };
  importedAt: string;
  text: string;
  /** UTF-8 weight of `text`, measured once at write time: the list shows it on every render. */
  bytes: number;
}

/** A statement owns its declared period, so the period is what identifies the stored file. */
export function statementId(accountId: string, period: { start: string; end: string }): string {
  return `${accountId}|${period.start}|${period.end}`;
}

/** One row of the user's personal sector table. Shared by every account on purpose. */
export interface SectorRecord {
  ticker: string;
  name: string;
  category: string;
  score: number | null;
  status: string;
  /** Instant of the last write of this row, whatever wrote it: a CSV import, an edit, an IB import. */
  updatedAt: string;
}

export class AppDatabase extends Dexie {
  accounts!: EntityTable<AccountRecord, "id">;
  transactions!: Table<Transaction, [string, string]>;
  imports!: EntityTable<ImportRecord, "id">;
  snapshots!: EntityTable<SnapshotRecord, "accountId">;
  sectors!: EntityTable<SectorRecord, "ticker">;
  statements!: EntityTable<StatementRecord, "id">;
  contracts!: Table<ContractRecord, [string, string]>;
  cashPoints!: Table<CashPointRecord, [string, string, string]>;

  constructor(name = "ib-analyzer") {
    super(name);
    this.version(1).stores({
      accounts: "id",
      transactions: "[accountId+externalId], accountId, [accountId+when]",
      imports: "++id, accountId",
    });
    this.version(2).stores({
      snapshots: "accountId",
      sectors: "ticker",
    });
    this.version(3).stores({
      accounts: "id",
    });
    // Statements imported before this version were not kept: the store starts empty
    // and fills up from the next import on.
    this.version(4).stores({
      statements: "id, accountId",
    });
    // Additive: adds the `contracts` table and rewrites no existing row.
    // Five and not four: version 4 was already published for the statements
    // store while this store was being written, and two divergent
    // declarations of one version corrupt an existing database.
    this.version(5).stores({
      contracts: "[accountId+conid], accountId",
    });
    // Additive: adds the `cashPoints` table and rewrites no existing row.
    this.version(6).stores({
      cashPoints: "[accountId+currency+kind], accountId",
    });
    // The first upgrade that rewrites rows: a sector row is now also written by hand and by the
    // IB imports, so the instant it carries is its last write, not its import.
    this.version(7)
      .stores({ sectors: "ticker" })
      .upgrade((tx) =>
        tx
          .table("sectors")
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            row.updatedAt = row.importedAt;
            delete row.importedAt;
          }),
      );
    // IB times are New York's wall clock stamped UTC (ib-parsers' common.ts). The agent used
    // to write true UTC instants: its rows and its snapshot are brought to that clock, so that
    // Flex's whole days own them (`planImport`). App instants (`lastAgentSyncAt`, `importedAt`)
    // are not IB times and stay true UTC.
    this.version(8)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table("transactions")
          .filter((row: { source: string }) => row.source === "agent")
          .modify((row: { when: string }) => {
            // An unreadable row must not keep the versionchange transaction from committing.
            if (!Number.isNaN(Date.parse(row.when))) row.when = toReportTime(row.when);
          });
        await tx
          .table("snapshots")
          .filter((row: { source: string }) => row.source === "agent")
          .modify((row: { asOf: string }) => {
            // An unreadable row must not keep the versionchange transaction from committing.
            if (!Number.isNaN(Date.parse(row.asOf))) row.asOf = toReportTime(row.asOf);
          });
      });
    // Sub-project 23: a position carries the day's P&L and move. A snapshot written before it
    // has neither, and `undefined` is not `null`: every reader would have to second-guess the
    // type. No store changes — only the rows.
    this.version(9)
      .stores({})
      .upgrade((tx) =>
        tx
          .table("snapshots")
          .toCollection()
          .modify((row: { positions?: Record<string, unknown>[] }) => {
            for (const position of row.positions ?? []) {
              position.dailyPnl ??= null;
              position.dayChange ??= null;
            }
          }),
      );
  }
}

/** The one database of the app. Tests wipe its tables between cases. */
export const db = new AppDatabase();
