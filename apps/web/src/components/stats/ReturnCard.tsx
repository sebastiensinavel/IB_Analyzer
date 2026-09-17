import ReactECharts from "echarts-for-react";
import { useTranslation } from "react-i18next";
import type { StrategyCapital } from "@ib/ledger";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { type CapitalSeries, returnOption } from "@/lib/capitalCharts";
import { chartColors } from "@/lib/chartColors";

interface ReturnCardProps {
  capital: StrategyCapital;
  /** The capital chart's lines, for its frame only. */
  series: readonly CapitalSeries[];
  isDark: boolean;
}

export function ReturnCard({ capital, series, isDark }: ReturnCardProps) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("stats.return.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div data-testid="return-chart" className="w-full">
          <ReactECharts option={returnOption(capital, series, chartColors(isDark))} opts={{ renderer: "svg" }} style={{ height: 260, width: "100%" }} />
        </div>
      </CardContent>
    </Card>
  );
}
