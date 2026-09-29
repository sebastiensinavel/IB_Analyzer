import { useTranslation } from "react-i18next";
import type { CurrencyTotal } from "@ib/ledger";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { TotalAmount } from "@/components/stats/TotalAmount";

/**
 * The day's unrealized P/L of the snapshot's positions, with what the lines closed that day realized
 * at the right end of the amount's own line, so the card is no taller than the others: the agent's
 * alone, « — » otherwise.
 */
export function DailyPnlCard({ daily, realizedToday }: { daily: CurrencyTotal | null; realizedToday: CurrencyTotal | null }) {
  const { t } = useTranslation();
  const title = t("stats.dailyUnrealized");
  return (
    <Card aria-label={title}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="flex flex-wrap items-baseline justify-between gap-x-4">
          <TotalAmount total={daily} signed large />
          <span className="text-sm">
            <span className="text-muted-foreground">{t("stats.realizedToday")}</span> <TotalAmount total={realizedToday} signed />
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
