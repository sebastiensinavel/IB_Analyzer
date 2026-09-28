import { useMemo } from "react";
import { anchoredBalances, currentCashBalances, type CashCheck, type LedgerRow } from "@ib/ledger";
import { useCashPoints, useLedger } from "@/db/hooks";
import { BALANCE_CURRENCIES } from "@/lib/currencies";

export interface CurrentCash {
  /** The History's anchored running balance, which the Positions page's Cash card lays out. */
  anchored: { rows: LedgerRow[]; checks: CashCheck[] };
  /** The cash of each currency now, the last point of that balance (`currentCashBalances`). */
  cash: Record<string, number | null>;
}

/**
 * The account's cash now, for the Positions page and the dashboard alike: the ledger, anchored on
 * its Cash Report points. `undefined` while either is loading — a caller counts the cash as
 * missing then, never as nothing.
 */
export function useCurrentCash(accountId: string): CurrentCash | undefined {
  const ledger = useLedger(accountId);
  const points = useCashPoints(accountId);
  return useMemo(() => {
    if (!ledger || !points) return undefined;
    const anchored = anchoredBalances(ledger, BALANCE_CURRENCIES, points);
    return { anchored, cash: currentCashBalances(anchored.rows, anchored.checks) };
  }, [ledger, points]);
}
