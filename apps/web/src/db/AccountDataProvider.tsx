import { createContext, useContext, useMemo, type ReactNode } from "react";
import { saleInstants } from "@ib/coverage";
import type { ActivableStrategy } from "@ib/ledger";
import { useUnderlyingQuotes } from "@/agent/useUnderlyingQuotes";
import { buildHeldDayChange } from "@/lib/underlyingDayChange";
import { useActiveStrategies, useJournals, useRiskReport, type JournalsView, type RiskReportView } from "./hooks";

interface AccountData {
  journals: JournalsView;
  risk: RiskReportView;
  strategies: readonly ActivableStrategy[] | undefined;
  /** The account's held stocks' live dayChange, built once per snapshot (task addendum to
   * sub-project 35) — every `UnderlyingDayChangeCell` and column spec reads this same map
   * instead of rebuilding it from `snapshot.positions` on every row. */
  heldDayChange: ReadonlyMap<string, number>;
}

const AccountDataContext = createContext<AccountData | null>(null);

/**
 * The journals and the risk report of the account on screen, computed once for the whole shell
 * (spec of sub-project 11, §4): the title bar's verdicts and every page read them here, so a
 * change of the ledger replays it once, whatever the page — and quotes the account's
 * underlyings for the Var. jour action column (spec of sub-project 35).
 */
export function AccountDataProvider({ accountId, children }: { accountId: string; children: ReactNode }) {
  const strategies = useActiveStrategies(accountId);
  const journals = useJournals(accountId, strategies);
  // Built once per journals, so the report is rebuilt only when a sale date can have moved.
  const soldAt = useMemo(() => (journals.status === "ready" ? saleInstants(journals.report.rows) : undefined), [journals]);
  const { snapshot, report, sectorOf } = useRiskReport(accountId, soldAt);
  useUnderlyingQuotes(accountId, report ?? null);
  const heldDayChange = useMemo(() => buildHeldDayChange(snapshot?.positions ?? []), [snapshot]);
  const value = useMemo(
    () => ({ journals, risk: { snapshot, report, sectorOf }, strategies, heldDayChange }),
    [journals, snapshot, report, sectorOf, strategies, heldDayChange],
  );
  return <AccountDataContext.Provider value={value}>{children}</AccountDataContext.Provider>;
}

function useAccountData(hook: string): AccountData {
  const data = useContext(AccountDataContext);
  // Never a silent fallback on useJournals: it would replay the ledger a second time, unseen.
  if (data === null) throw new Error(`${hook} must be used inside <AccountDataProvider>`);
  return data;
}

export function useAccountJournals(): JournalsView {
  return useAccountData("useAccountJournals").journals;
}

export function useAccountRiskReport(): RiskReportView {
  return useAccountData("useAccountRiskReport").risk;
}

/** The account's active strategies, the list its journals were built with; `undefined` while loading. */
export function useAccountStrategies(): readonly ActivableStrategy[] | undefined {
  return useAccountData("useAccountStrategies").strategies;
}

/** The account's held stocks' live dayChange (task addendum to sub-project 35, §4): built once
 * per snapshot by the provider, read by `useUnderlyingDayChange`. */
export function useAccountHeldDayChange(): ReadonlyMap<string, number> {
  return useAccountData("useAccountHeldDayChange").heldDayChange;
}
