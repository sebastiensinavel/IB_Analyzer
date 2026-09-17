import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { StatsStrategy, StrategyStats } from "@ib/ledger";
import { Card, CardContent } from "@ib/ui/card";
import { CapitalCard } from "@/components/stats/CapitalCard";
import { CurrencySelect } from "@/components/stats/CurrencySelect";
import { ExposureCard } from "@/components/stats/ExposureCard";
import { MonthlyPnlCard } from "@/components/stats/MonthlyPnlCard";
import { PnlTotalCard } from "@/components/stats/PnlTotalCard";
import { ReturnCard } from "@/components/stats/ReturnCard";
import { useAccountJournals, useAccountRiskReport } from "@/db/AccountDataProvider";
import { useCapitalSeries } from "@/hooks/useCapitalSeries";
import { useTheme } from "@/hooks/useTheme";

interface StatsPageProps {
  strategy: StatsStrategy;
}

export function StatsPage({ strategy }: StatsPageProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const view = useAccountJournals();
  const { sectorOf } = useAccountRiskReport();
  const series = useCapitalSeries(strategy);
  const [chosen, setChosen] = useState<string | null>(null);

  if (view.status === "loading") {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  const all = view.report.stats[strategy];
  const stats: StrategyStats | undefined = all.find((s) => s.currency === chosen) ?? all[0];
  const capital = stats ? view.report.capital[strategy].find((c) => c.currency === stats.currency) : undefined;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-lg font-semibold tracking-tight">{t(`stats.title.${strategy}`)}</h1>
        <CurrencySelect currencies={all.map((s) => s.currency)} value={stats?.currency ?? null} onChange={setChosen} />
      </div>

      {!stats ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("stats.empty")}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <PnlTotalCard stats={stats} />
          <MonthlyPnlCard stats={stats} series={series} isDark={isDark} />
          {/* No exposure by sector for the condors: not asked for (spec of sub-project 14, §1). */}
          {capital && strategy !== "condors" && (
            <ExposureCard
              capital={capital}
              detailed={strategy === "wheel"}
              empty={t(`stats.exposure.empty.${strategy}`)}
              sectorOf={sectorOf}
              isDark={isDark}
            />
          )}
          {capital && <CapitalCard capital={capital} series={series} title={t("stats.capital.title")} isDark={isDark} />}
          {capital && <ReturnCard capital={capital} series={series} isDark={isDark} />}
        </>
      )}
    </div>
  );
}
