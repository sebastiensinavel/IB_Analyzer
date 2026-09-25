import ReactECharts from "echarts-for-react";
import { useTranslation } from "react-i18next";
import type { StrategyStats } from "@ib/ledger";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { type CapitalSeries, monthGrid } from "@/lib/capitalCharts";
import { CHART_FONT, chartColors } from "@/lib/chartColors";
import { formatAmount } from "@/lib/format";

interface MonthlyPnlCardProps {
  stats: StrategyStats;
  /** The capital chart's lines below: the bars take its frame, so a month sits at the same x. */
  series: readonly CapitalSeries[];
  isDark: boolean;
}

export function MonthlyPnlCard({ stats, series, isDark }: MonthlyPnlCardProps) {
  const { t } = useTranslation();
  const colors = chartColors(isDark);
  const option = {
    textStyle: { fontFamily: CHART_FONT, color: colors.foreground },
    grid: { ...monthGrid(series), top: 16, bottom: 32 },
    tooltip: { trigger: "axis", confine: true, valueFormatter: (value: number) => `${formatAmount(value)} ${stats.currency}` },
    xAxis: { type: "category", data: stats.months.map((m) => m.month), axisLine: { lineStyle: { color: colors.track } } },
    yAxis: { type: "value", splitLine: { lineStyle: { color: colors.track } } },
    series: [
      {
        type: "bar",
        data: stats.months.map((m) => ({ value: m.pnl, itemStyle: { color: m.pnl >= 0 ? colors.success : colors.destructive } })),
      },
    ],
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("stats.monthly")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div data-testid="monthly-chart" className="w-full">
          <ReactECharts option={option} opts={{ renderer: "svg" }} style={{ height: 260, width: "100%" }} />
        </div>
      </CardContent>
    </Card>
  );
}
