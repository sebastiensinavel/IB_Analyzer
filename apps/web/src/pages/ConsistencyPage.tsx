import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { anchoredBalances } from "@ib/ledger";
import { CashCheckCard } from "@/components/CashCheckCard";
import { ReconciliationCard } from "@/components/ReconciliationCard";
import { UncoveredCard } from "@/components/UncoveredCard";
import { useAccountJournals, useAccountRiskReport } from "@/db/AccountDataProvider";
import { useCashPoints, useLedger } from "@/db/hooks";
import { BALANCE_CURRENCIES } from "@/lib/currencies";

/** Spec of sub-project 11, §5: the three checks that say whether the rest of the app can be believed. */
export function ConsistencyPage() {
  const { accountId = "" } = useParams<{ accountId: string }>();
  const { t } = useTranslation();
  const { report } = useAccountRiskReport();
  const journals = useAccountJournals();
  const ledger = useLedger(accountId);
  const points = useCashPoints(accountId);
  const anchored = useMemo(
    () => (ledger && points ? anchoredBalances(ledger, BALANCE_CURRENCIES, points) : undefined),
    [ledger, points],
  );

  if (report === undefined || journals.status === "loading" || anchored === undefined) {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="font-heading text-lg font-semibold tracking-tight">{t("nav.consistency")}</h1>
      <UncoveredCard accountId={accountId} report={report} />
      <ReconciliationCard accountId={accountId} reconciliation={journals.report.reconciliation} />
      {/* Shown even on an empty ledger, where it says no Cash Report anchors anything. */}
      <CashCheckCard accountId={accountId} checks={anchored.checks} />
    </div>
  );
}
