import { useTranslation } from "react-i18next";
import type { CurrencyTotal, StrategyStats } from "@ib/ledger";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { PnlTotal } from "@/components/stats/PnlTotal";
import { TotalAmount } from "@/components/stats/TotalAmount";

/**
 * A scope's total profit or loss in its own card: a strategy's on its page, the active strategies'
 * on the dashboard, which adds the account's total value under it. `value` absent: no such line
 * (statistics pages); `null`: « — ».
 */
export function PnlTotalCard({ stats, value }: { stats: StrategyStats; value?: CurrencyTotal | null }) {
  const { t } = useTranslation();
  const title = t("stats.total");
  return (
    <Card aria-label={title}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <PnlTotal stats={stats} />
        {value !== undefined && (
          <p className="mt-2 text-sm">
            <span className="text-muted-foreground">{t("stats.totalValue")}</span> <TotalAmount total={value} signed={false} />
          </p>
        )}
      </CardContent>
    </Card>
  );
}
