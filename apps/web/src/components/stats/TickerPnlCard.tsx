import ReactECharts from "echarts-for-react";
import { useTranslation } from "react-i18next";
import type { StrategyStats } from "@ib/ledger";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { chartColors } from "@/lib/chartColors";
import { TICKER_PNL_FRAME, tickerChartHeight, tickerPnlOption } from "@/lib/tickerCharts";

interface TickerPnlCardProps {
  stats: StrategyStats;
  isDark: boolean;
}

/** What each ticker has brought the strategy since its first flow: the bars sum to the total profit/loss. */
export function TickerPnlCard({ stats, isDark }: TickerPnlCardProps) {
  const { t } = useTranslation();
  return (
    <Card aria-label={t("stats.tickerPnl.title")}>
      <CardHeader>
        <CardTitle>{t("stats.tickerPnl.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div data-testid="ticker-pnl-chart" className="w-full">
          <ReactECharts
            option={tickerPnlOption(stats.tickers, chartColors(isDark), stats.currency)}
            opts={{ renderer: "svg" }}
            style={{ height: tickerChartHeight(stats.tickers.length, TICKER_PNL_FRAME), width: "100%" }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
