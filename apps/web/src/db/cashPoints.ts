import type { CashReport } from "@ib/ib-parsers";
import type { CashPointRecord } from "./schema";

/**
 * Folds the Cash Report of one file into the points already held, and returns only the records
 * to write. The end point moves to a later or same-day file — it is what the balance is anchored
 * on; the start point moves to an earlier or same-day file — it is what the balance is checked
 * against, and a Flex window advancing every day must not push it forward, since the rows of the
 * earlier syncs stay in the ledger. On a tie the incoming file wins. A currency the report does
 * not list keeps its points: an older point is still true at its own date.
 */
export function mergeCashPoints(
  accountId: string,
  current: readonly CashPointRecord[],
  report: CashReport,
  source: CashPointRecord["source"],
  at: string,
): CashPointRecord[] {
  const written: CashPointRecord[] = [];
  for (const kind of ["start", "end"] as const) {
    const values = report[kind];
    for (const [currency, amount] of Object.entries(values.balances)) {
      const existing = current.find((point) => point.currency === currency && point.kind === kind);
      const wins = !existing || (kind === "end" ? values.asOf >= existing.asOf : values.asOf <= existing.asOf);
      if (wins) written.push({ accountId, currency, kind, asOf: values.asOf, amount, source, importedAt: at });
    }
  }
  return written;
}
