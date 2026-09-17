import { useTranslation } from "react-i18next";
import type { StrategyStats } from "@ib/ledger";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { PnlTotal } from "@/components/stats/PnlTotal";

/** A scope's total profit or loss in its own card: a strategy's on its page, the three strategies' on the dashboard. */
export function PnlTotalCard({ stats }: { stats: StrategyStats }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("stats.total")}</CardTitle>
      </CardHeader>
      <CardContent>
        <PnlTotal stats={stats} />
      </CardContent>
    </Card>
  );
}
