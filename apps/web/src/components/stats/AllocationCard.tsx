import ReactECharts from "echarts-for-react";
import { useTranslation } from "react-i18next";
import type { StrategyCapital } from "@ib/ledger";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { chartColors } from "@/lib/chartColors";
import { ALLOCATION_FRAME, allocationBars, allocationOption, tickerChartHeight } from "@/lib/tickerCharts";

interface AllocationCardProps {
  capital: StrategyCapital;
  isDark: boolean;
}

/** What the Wheel ties up now per ticker: the shares assigned and the puts' cash, stacked, the most allocated first. */
export function AllocationCard({ capital, isDark }: AllocationCardProps) {
  const { t } = useTranslation();
  const bars = allocationBars(capital.exposure);
  const names = { assigned: t("stats.exposure.assigned"), putCash: t("stats.exposure.putCash"), allocated: t("stats.capital.allocated") };
  return (
    <Card aria-label={t("stats.allocation.title")}>
      <CardHeader>
        <CardTitle>{t("stats.allocation.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {bars.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("stats.exposure.empty.wheel")}</p>
        ) : (
          <div data-testid="allocation-chart" className="w-full">
            <ReactECharts
              option={allocationOption(bars, names, chartColors(isDark), capital.currency)}
              opts={{ renderer: "svg" }}
              style={{ height: tickerChartHeight(bars.length, ALLOCATION_FRAME), width: "100%" }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
