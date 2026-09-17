import ReactECharts from "echarts-for-react";
import { useTranslation } from "react-i18next";
import type { StrategyCapital } from "@ib/ledger";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { type CapitalSeries, capitalOption } from "@/lib/capitalCharts";
import { chartColors } from "@/lib/chartColors";

interface CapitalCardProps {
  capital: StrategyCapital;
  series: readonly CapitalSeries[];
  title: string;
  isDark: boolean;
}

/** A scope's capital month by month, and the amounts it had to leave out. */
export function CapitalCard({ capital, series, title, isDark }: CapitalCardProps) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {/* The statistics routes share one StatsPage, so this chart outlives a change of scope:
            merged, the option would keep the lines the previous scope drew, and their range. */}
        <div data-testid="capital-chart" className="w-full">
          <ReactECharts
            option={capitalOption(capital, series, chartColors(isDark))}
            replaceMerge={["series"]}
            opts={{ renderer: "svg" }}
            style={{ height: 300, width: "100%" }}
          />
        </div>
        {capital.incomplete > 0 && <p className="text-xs text-muted-foreground">{t("stats.incomplete", { count: capital.incomplete })}</p>}
      </CardContent>
    </Card>
  );
}
