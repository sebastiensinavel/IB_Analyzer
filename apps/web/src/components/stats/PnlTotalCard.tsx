import { useTranslation } from "react-i18next";
import type { StrategyStats } from "@ib/ledger";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { PnlTotal } from "@/components/stats/PnlTotal";

/** A scope's total profit or loss in its own card: a strategy's on its page, the active strategies' on the dashboard. */
export function PnlTotalCard({ stats }: { stats: StrategyStats }) {
  const { t } = useTranslation();
  const title = t("stats.total");
  return (
    <Card aria-label={title}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <PnlTotal stats={stats} />
      </CardContent>
    </Card>
  );
}
