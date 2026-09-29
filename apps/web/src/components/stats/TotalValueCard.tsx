import { useTranslation } from "react-i18next";
import type { CurrencyTotal } from "@ib/ledger";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { TotalAmount } from "@/components/stats/TotalAmount";

/** The account's total value: the snapshot's positions at market plus the current cash, « — » without a snapshot. */
export function TotalValueCard({ value }: { value: CurrencyTotal | null }) {
  const { t } = useTranslation();
  const title = t("stats.totalValue");
  return (
    <Card aria-label={title}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p>
          <TotalAmount total={value} signed={false} large />
        </p>
      </CardContent>
    </Card>
  );
}
