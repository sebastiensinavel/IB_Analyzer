import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import { saleInstants } from "@ib/coverage";
import type { ActivableStrategy } from "@ib/ledger";
import { useUnderlyingQuotes } from "@/agent/useUnderlyingQuotes";
import { useAlertEngine, type AlertsView } from "@/alerts/useAlertEngine";
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
  /** The account's alerts, evaluated here at every price change (spec of sub-project 42, §6). */
  alerts: AlertsView;
}

const AccountDataContext = createContext<AccountData | null>(null);

/**
 * The journals, the risk report and the alerts of the account on screen, computed once for the
 * whole shell, sidebar included (spec of sub-project 11, §4; sub-project 42, §6.1): the sidebar's
 * badges, the title bar's verdicts and every page read them here, so a
 * change of the ledger replays it once, whatever the page — and quotes the account's
 * underlyings for the Var. jour action column (spec of sub-project 35).
 */
export function AccountDataProvider({ accountId, children }: { accountId: string; children: ReactNode }) {
  const strategies = useActiveStrategies(accountId);
  const journals = useJournals(accountId, strategies);
  // The same Map while its content is unchanged, so a ledger write that moves no sale date
  // does not rebuild the report and everything downstream.
  const built = useMemo(() => (journals.status === "ready" ? saleInstants(journals.report.rows) : undefined), [journals]);
  const stable = useRef<{ key: string; map: Map<string, string> } | undefined>(undefined);
  const soldAt = useMemo(() => {
    if (built === undefined) return undefined;
    const key = JSON.stringify([...built].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    if (stable.current?.key !== key) stable.current = { key, map: built };
    return stable.current.map;
  }, [built]);
  const { snapshot, report, sectorOf } = useRiskReport(accountId, soldAt);
  const alerts = useAlertEngine(accountId, journals, snapshot);
  // The manual alerts' tickers are quoted too, held or not; the same array while unchanged.
  const manualKey = alerts.status === "ready" ? alerts.manualTickers.join(",") : "";
  const manualTickers = useMemo(() => (manualKey === "" ? [] : manualKey.split(",")), [manualKey]);
  useUnderlyingQuotes(accountId, report ?? null, manualTickers);
  const heldDayChange = useMemo(() => buildHeldDayChange(snapshot?.positions ?? []), [snapshot]);
  const value = useMemo(
    () => ({ journals, risk: { snapshot, report, sectorOf }, strategies, heldDayChange, alerts }),
    [journals, snapshot, report, sectorOf, strategies, heldDayChange, alerts],
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

/** The account's alerts, their state and the badge counts (spec of sub-project 42, §6.1). */
export function useAccountAlerts(): AlertsView {
  return useAccountData("useAccountAlerts").alerts;
}

/** The same, or `null` outside an account: the sidebar is rendered with and without one. */
export function useOptionalAccountAlerts(): AlertsView | null {
  return useContext(AccountDataContext)?.alerts ?? null;
}
