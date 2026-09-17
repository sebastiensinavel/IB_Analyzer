import ReactECharts from "echarts-for-react";
import { useTranslation } from "react-i18next";
import { cashOk, cashRequired, type RiskReport } from "@ib/coverage";
import { Badge } from "@ib/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { CHART_FONT, chartColors } from "@/lib/chartColors";
import { formatMoney, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The cash the account holds against the cash its short puts and condors require, in USD. */
export function CashCoverageCard({ report, isDark }: { report: RiskReport; isDark: boolean }) {
  const { t } = useTranslation();
  const required = cashRequired(report);
  const ok = cashOk(report);
  const available = report.cashAvailable;
  const remaining = available === null ? null : available - required;
  const ratio = available === null ? null : required > 0 ? Math.min(available / required, 1) : 1;
  const colors = chartColors(isDark);

  const gaugeOption = {
    series: [
      {
        type: "gauge",
        startAngle: 210,
        endAngle: -30,
        min: 0,
        max: 1,
        progress: { show: true, width: 14, itemStyle: { color: ok ? colors.success : colors.destructive } },
        axisLine: { lineStyle: { width: 14, color: [[1, colors.track]] } },
        pointer: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        detail: {
          formatter: () => formatPercent(ratio ?? 0),
          fontSize: 26,
          fontWeight: 600,
          fontFamily: CHART_FONT,
          color: colors.foreground,
          offsetCenter: [0, "0%"],
        },
        data: [{ value: ratio ?? 0 }],
      },
    ],
  };

  const verdict =
    ok === null
      ? { variant: "outline" as const, label: t("dashboard.cashCard.unknown") }
      : ok
        ? { variant: "success" as const, label: t("dashboard.cashCard.ok") }
        : { variant: "destructive" as const, label: t("dashboard.cashCard.short") };

  return (
    <Card aria-label={t("dashboard.cashCard.title")}>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t("dashboard.cashCard.title")}</CardTitle>
        <CardAction>
          <Badge variant={verdict.variant}>{verdict.label}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        {ratio !== null && (
          <div data-testid="cash-gauge" className="w-full">
            <ReactECharts option={gaugeOption} opts={{ renderer: "svg" }} style={{ height: 180, width: "100%" }} />
          </div>
        )}
        <div className="@container w-full">
          <div className="grid grid-cols-1 gap-3 @sm:grid-cols-3">
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">{t("dashboard.cashCard.portfolio")}</p>
              <p className="font-mono text-base font-medium tabular-nums">{formatMoney(available)}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">{t("dashboard.cashCard.required")}</p>
              <p className="font-mono text-base font-medium tabular-nums">{formatMoney(required)}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">{t("dashboard.cashCard.available")}</p>
              <p className={cn("font-mono text-base font-medium tabular-nums", remaining !== null && remaining < 0 && "text-destructive")}>
                {formatMoney(remaining)}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
