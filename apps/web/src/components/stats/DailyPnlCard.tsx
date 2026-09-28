import { useTranslation } from "react-i18next";
import type { CurrencyTotal } from "@ib/ledger";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { TotalAmount } from "@/components/stats/TotalAmount";

/** The day's unrealized P/L of the snapshot's positions: the agent's alone, « — » otherwise. */
export function DailyPnlCard({ daily }: { daily: CurrencyTotal | null }) {
  const { t } = useTranslation();
  const title = t("stats.dailyUnrealized");
  return (
    <Card aria-label={title}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p>
          <TotalAmount total={daily} signed large />
        </p>
      </CardContent>
    </Card>
  );
}
