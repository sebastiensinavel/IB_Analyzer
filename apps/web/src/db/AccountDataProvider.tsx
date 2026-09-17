import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useJournals, useRiskReport, type JournalsView, type RiskReportView } from "./hooks";

interface AccountData {
  journals: JournalsView;
  risk: RiskReportView;
}

const AccountDataContext = createContext<AccountData | null>(null);

/**
 * The journals and the risk report of the account on screen, computed once for the whole shell
 * (spec of sub-project 11, §4): the title bar's verdicts and every page read them here, so a
 * change of the ledger replays it once, whatever the page.
 */
export function AccountDataProvider({ accountId, children }: { accountId: string; children: ReactNode }) {
  const journals = useJournals(accountId);
  const { snapshot, report, sectorOf } = useRiskReport(accountId);
  const value = useMemo(
    () => ({ journals, risk: { snapshot, report, sectorOf } }),
    [journals, snapshot, report, sectorOf],
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
