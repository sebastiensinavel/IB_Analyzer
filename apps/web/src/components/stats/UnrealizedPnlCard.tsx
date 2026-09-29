import { useTranslation } from "react-i18next";
import type { CurrencyTotal } from "@ib/ledger";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { TotalAmount } from "@/components/stats/TotalAmount";

/** The snapshot's unrealized P/L. */
export function UnrealizedPnlCard({ unrealized }: { unrealized: CurrencyTotal | null }) {
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
      </CardContent>
    </Card>
  );
}
