import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { Transaction } from "@ib/ledger";

export interface StatementIdParts {
  accountId: string;
  section: string;
  symbol: string;
  when: string;
  quantity: number | null;
  price: number | null;
  amount: number | null;
}

/** A statement has no stable id: key by a hash of the row's content. */
export function statementExternalId(parts: StatementIdParts): string {
  const raw = [parts.accountId, parts.section, parts.symbol, parts.when, parts.quantity, parts.price, parts.amount]
    .map((v) => String(v))
    .join("|");
  return `html:${bytesToHex(sha256(utf8ToBytes(raw)))}`;
}

/**
 * Two identical rows in one file are two real transactions (same contract,
 * same price, same second). Suffix the second and following so both survive,
 * and so a re-import of the same file lands on the same ids.
 */
export function suffixTwins(transactions: Transaction[]): Transaction[] {
  const seen = new Map<string, number>();
  return transactions.map((tx) => {
    const n = (seen.get(tx.externalId) ?? 0) + 1;
    seen.set(tx.externalId, n);
    return n === 1 ? tx : { ...tx, externalId: `${tx.externalId}#${n}` };
  });
}
