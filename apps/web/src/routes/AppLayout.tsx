import { useEffect } from "react";
import { Navigate, Outlet, useLocation, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Separator } from "@ib/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@ib/ui/sidebar";
import { useAgentPolling } from "@/agent/useAgentSync";
import { AppSidebar } from "@/components/app-sidebar";
import { ConsistencyIndicators } from "@/components/ConsistencyIndicators";
import { SnapshotStatus } from "@/components/SnapshotStatus";
import { AccountDataProvider } from "@/db/AccountDataProvider";
import { useAccounts } from "@/db/hooks";
import { useFlexAutoSync } from "@/flex/useFlexAutoSync";
import { getLastAccountId, setLastAccountId } from "@/lib/accountStorage";
import { findNavItem } from "@/lib/navigation";
import { UnknownAccountPage } from "@/pages/UnknownAccountPage";

export function AppLayout() {
  const { accountId } = useParams<{ accountId: string }>();
  const location = useLocation();
  const { t } = useTranslation();
  const accounts = useAccounts();
  const scoped = accountId !== undefined && accounts?.some((a) => a.id === accountId) ? accountId : null;

  // Entering an account's pages is the trigger (spec: sub-project 3, palier C): AppLayout is
  // the component mounted at that point. An empty accountId (no account currently scoped, e.g.
  // /accounts or /settings) is a harmless no-op for the hook — its own checks bail out before
  // ever reading anything meaningful from an empty id. Called unconditionally, before either
  // early return below, as React's rules of hooks require.
  useFlexAutoSync(scoped ?? "");
  useAgentPolling(scoped ?? "");

  useEffect(() => {
    if (scoped) setLastAccountId(scoped);
  }, [scoped]);

  if (accounts === undefined) {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  // Configuration pages live outside the account scope, and point the rest of the nav at
  // whichever account was last visited, when there is one.
  const remembered = getLastAccountId();
  const navAccountId =
    scoped ?? (remembered && accounts.some((a) => a.id === remembered) ? remembered : accounts[0]?.id) ?? null;

  // `accountId` (from the URL) is defined only for a route scoped to an account
  // (/accounts/:accountId/...): with no account at all to fall back on, there is nothing to
  // show but the accounts page. Settings and Help carry no :accountId in their path and render
  // regardless — they are the only way back into the app for a browser that has never held an
  // account, which is exactly the state a restored backup starts from (CLAUDE.md).
  if (accountId !== undefined && navAccountId === null) return <Navigate to="/accounts" replace />;

  const pageLabelKey = findNavItem(location.pathname, navAccountId ?? "")?.labelKey;

  const inset = (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <SidebarTrigger />
        <Separator orientation="vertical" className="h-5" />
        {scoped ? (
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">{scoped}</span>
        ) : (
          <span className="text-xs font-medium text-muted-foreground">{pageLabelKey ? t(pageLabelKey) : null}</span>
        )}
        {scoped && (
          <div className="ml-auto flex items-center gap-2">
            <SnapshotStatus accountId={scoped} />
            <ConsistencyIndicators accountId={scoped} />
          </div>
        )}
      </header>
      {accountId !== undefined && scoped === null ? <UnknownAccountPage id={accountId} /> : <Outlet />}
    </>
  );

  return (
    <SidebarProvider>
      <AppSidebar accountId={navAccountId} accounts={accounts} />
      <SidebarInset>
        {/* The account on screen computes its journals and risk report once, for the title bar
            and every page (sub-project 11, §4). Account-less pages never read them. */}
        {scoped ? <AccountDataProvider accountId={scoped}>{inset}</AccountDataProvider> : inset}
      </SidebarInset>
    </SidebarProvider>
  );
}
