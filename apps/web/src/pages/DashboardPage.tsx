import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type { StrategyStats } from "@ib/ledger";
import { buttonVariants } from "@ib/ui/button";
import { Card, CardContent } from "@ib/ui/card";
import { CashCoverageCard } from "@/components/CashCoverageCard";
import { FirstStepCard } from "@/components/FirstStepCard";
import { PositionSuggestionsCard } from "@/components/PositionSuggestionsCard";
import { CapitalCard } from "@/components/stats/CapitalCard";
import { CurrencySelect } from "@/components/stats/CurrencySelect";
import { ExposureCard } from "@/components/stats/ExposureCard";
import { MonthlyPnlCard } from "@/components/stats/MonthlyPnlCard";
import { PnlTotalCard } from "@/components/stats/PnlTotalCard";
import { ReturnCard } from "@/components/stats/ReturnCard";
import { useAccountJournals, useAccountRiskReport } from "@/db/AccountDataProvider";
import { useNeverFed } from "@/db/hooks";
import { useCapitalSeries } from "@/hooks/useCapitalSeries";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

export function DashboardPage() {
  const { accountId = "" } = useParams<{ accountId: string }>();
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { report, sectorOf } = useAccountRiskReport();
  const view = useAccountJournals();
  const series = useCapitalSeries("portfolio");
  const [chosen, setChosen] = useState<string | null>(null);
  const neverFed = useNeverFed(accountId);

  if (report === undefined || view.status === "loading") {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  // The three strategies at once: the same statistics and capital as their own pages, computed
  // over more lines, never a sum of their results (spec of sub-project 14, §3).
  const all = view.report.stats.portfolio;
  const stats: StrategyStats | undefined = all.find((s) => s.currency === chosen) ?? all[0];
  const capital = stats ? view.report.capital.portfolio.find((c) => c.currency === stats.currency) : undefined;
  const title = <h1 className="font-heading text-lg font-semibold tracking-tight">{t("nav.dashboard")}</h1>;

  const noPositions = (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">{t("positions.empty")}</p>
        <Link to={`/accounts/${accountId}/sources`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          {t("positions.emptyLink")}
        </Link>
      </CardContent>
    </Card>
  );

  if (report === null && !stats) {
    // An account nothing has ever fed gets a first step rather than an empty page: this is
    // where « Ouvrir » lands a newcomer straight after they added their account. While
    // `neverFed` is still undefined, neither card is rendered — showing one and swapping it a
    // moment later reads as a glitch.
    return (
      <div className="flex flex-col gap-4 p-4 md:p-6">
        {title}
        {neverFed === true && <FirstStepCard accountId={accountId} />}
        {neverFed === false && noPositions}
        <PositionSuggestionsCard accountId={accountId} report={report} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {title}
        {stats && <CurrencySelect currencies={all.map((s) => s.currency)} value={stats.currency} onChange={setChosen} />}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          {stats && <PnlTotalCard stats={stats} />}
          {report === null ? noPositions : <CashCoverageCard report={report} isDark={isDark} />}
        </div>
        {capital && <ExposureCard capital={capital} detailed={false} empty={t("stats.exposure.empty.portfolio")} sectorOf={sectorOf} isDark={isDark} />}
      </div>
      {stats && capital && (
        <>
          <MonthlyPnlCard stats={stats} series={series} isDark={isDark} />
          <CapitalCard capital={capital} series={series} title={t("stats.capital.titlePortfolio")} isDark={isDark} />
          <ReturnCard capital={capital} series={series} isDark={isDark} />
        </>
      )}
      <PositionSuggestionsCard accountId={accountId} report={report} />
    </div>
  );
}
