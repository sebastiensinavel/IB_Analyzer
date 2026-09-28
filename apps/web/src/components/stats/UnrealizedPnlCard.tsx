import { useTranslation } from "react-i18next";
import type { CurrencyTotal } from "@ib/ledger";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { TotalAmount } from "@/components/stats/TotalAmount";

/** The snapshot's unrealized P/L, with what the lines closed on the agent's market day realized under it. */
export function UnrealizedPnlCard({ unrealized, realizedToday }: { unrealized: CurrencyTotal | null; realizedToday: CurrencyTotal | null }) {
  const { t } = useTranslation();
  const title = t("stats.unrealized");
  return (
    <Card aria-label={title}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p>
          <TotalAmount total={unrealized} signed large />
        </p>
        <p className="mt-2 text-sm">
          <span className="text-muted-foreground">{t("stats.realizedToday")}</span> <TotalAmount total={realizedToday} signed />
        </p>
      </CardContent>
    </Card>
  );
}
