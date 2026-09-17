import type { ContractIdentity } from "@ib/ib-parsers";
import type { IdentityInput } from "@ib/ledger";
import type { AppDatabase } from "./schema";

/** One IB contract of one account, and every ticker it has been seen under. */
export interface ContractRecord {
  accountId: string;
  conid: string;
  isin: string;
  secType: string;
  currency: string;
  description: string;
  /** Every spelling, with the window of import periods that showed it. */
  aliases: { ticker: string; firstSeen: string; lastSeen: string }[];
  updatedAt: string;
}

/**
 * Folds what a file or an agent pass just reported into the records already
 * held, and returns **only the records that changed** — the caller writes
 * exactly those. Windows only ever widen: importing an old statement after a
 * recent one must not make a contract look younger than it is.
 */
export function mergeContractRecords(
  accountId: string,
  current: readonly ContractRecord[],
  identities: readonly ContractIdentity[],
  period: { start: string; end: string } | null,
  at: string,
): ContractRecord[] {
  // An agent pass declares no period: its own day is the whole window.
  const day = at.slice(0, 10);
  const start = period?.start ?? day;
  const end = period?.end ?? day;
  const byConid = new Map(current.map((record) => [record.conid, record]));
  const touched = new Map<string, ContractRecord>();
  for (const identity of identities) {
    const existing = touched.get(identity.conid) ?? byConid.get(identity.conid);
    const record: ContractRecord = existing
      ? { ...existing, aliases: existing.aliases.map((alias) => ({ ...alias })) }
      : {
          accountId,
          conid: identity.conid,
          isin: identity.isin,
          secType: identity.secType,
          currency: identity.currency,
          description: identity.description,
          aliases: [],
          updatedAt: at,
        };
    record.isin ||= identity.isin;
    record.secType ||= identity.secType;
    record.currency ||= identity.currency;
    record.description ||= identity.description;
    record.updatedAt = at;
    for (const ticker of identity.tickers) {
      const alias = record.aliases.find((a) => a.ticker === ticker);
      if (!alias) record.aliases.push({ ticker, firstSeen: start, lastSeen: end });
      else {
        if (start < alias.firstSeen) alias.firstSeen = start;
        if (end > alias.lastSeen) alias.lastSeen = end;
      }
    }
    touched.set(identity.conid, record);
  }
  return [...touched.values()];
}

/** What `buildIdentities` needs, read from one account's store. */
export async function readIdentityInputs(db: AppDatabase, accountId: string): Promise<IdentityInput[]> {
  const records = await db.contracts.where("accountId").equals(accountId).toArray();
  return records.map((record) => ({ conid: record.conid, secType: record.secType, isin: record.isin, aliases: record.aliases }));
}
