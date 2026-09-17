import { dayOf, runningBalances, type Transaction } from "@ib/ledger";
import { db, type CashPointRecord } from "@/db/schema";
import { DEMO_POSITIONS, DEMO_SECTORS, DEMO_TRANSACTIONS, SAMPLE_JOURNAL_SNAPSHOT, SAMPLE_JOURNAL_TRANSACTIONS } from "@/mocks/journals";
import { SAMPLE_TRANSACTIONS } from "@/mocks/ledger";
import { SAMPLE_SECTORS, SAMPLE_SNAPSHOT } from "@/mocks/positions";

const DEMO_CURRENCIES = ["USD", "EUR"] as const;

/** The two demo accounts and nothing else: what a user sees before their first import. */
export async function seedAccounts(): Promise<void> {
  await db.accounts.bulkPut([
    { id: "alpha", label: "alpha", ibAccountId: "U0000001", createdAt: new Date().toISOString(), warnedDroppedKinds: [] },
    { id: "beta", label: "beta", ibAccountId: "U0000002", createdAt: new Date().toISOString(), warnedDroppedKinds: [] },
  ]);
}

/**
 * Cash points that match a demo ledger exactly: a Starting Cash of 0 on its first day, an Ending
 * Cash equal to its last raw balance, so the History shows the cash card in its OK state.
 */
function demoCashPoints(accountId: string, transactions: readonly Transaction[]): CashPointRecord[] {
  const rows = runningBalances(transactions, DEMO_CURRENCIES);
  if (rows.length === 0) return [];
  const first = dayOf(rows[0].transaction.when);
  const last = rows[rows.length - 1];
  const importedAt = new Date().toISOString();
  return DEMO_CURRENCIES.flatMap((currency): CashPointRecord[] => [
    { accountId, currency, kind: "start", asOf: first, amount: 0, source: "flex", importedAt },
    { accountId, currency, kind: "end", asOf: dayOf(last.transaction.when), amount: last.balances[currency], source: "flex", importedAt },
  ]);
}

/**
 * Two accounts, a small ledger, a positions snapshot and a few sectors on `alpha`, and on
 * `beta` a Wheel cycle with a put still open, a covered LEAPS, a condor expired and one still
 * open, with the snapshot that matches them, and on both the cash points that match their
 * ledgers, for screenshots without any file.
 */
export async function seedDemo(): Promise<void> {
  const beta = [...SAMPLE_JOURNAL_TRANSACTIONS, ...DEMO_TRANSACTIONS];
  await seedAccounts();
  await db.transactions.bulkPut(SAMPLE_TRANSACTIONS);
  await db.snapshots.put(SAMPLE_SNAPSHOT);
  await db.sectors.bulkPut([...SAMPLE_SECTORS, ...DEMO_SECTORS]);
  await db.transactions.bulkPut(beta);
  await db.snapshots.put({ ...SAMPLE_JOURNAL_SNAPSHOT, positions: [...SAMPLE_JOURNAL_SNAPSHOT.positions, ...DEMO_POSITIONS] });
  await db.cashPoints.bulkPut([...demoCashPoints("alpha", SAMPLE_TRANSACTIONS), ...demoCashPoints("beta", beta)]);
}
