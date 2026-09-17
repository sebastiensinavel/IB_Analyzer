import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { isCashCheckOk, type CashCheck } from "@ib/ledger";
import { Badge } from "@ib/ui/badge";
import { buttonVariants } from "@ib/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";

interface CashCheckCardProps {
  accountId: string;
  checks: CashCheck[];
}

/**
 * Spec §6.1 of sub-project 9: per currency, the running balance anchored on the latest Ending
 * Cash, checked against the oldest Starting Cash — the cash twin of `ReconciliationCard`.
 * Amounts carry no currency symbol: the currency code leads every line.
 */
export function CashCheckCard({ accountId, checks }: CashCheckCardProps) {
  const { t } = useTranslation();
  const anyGap = checks.some((check) => isCashCheckOk(check) === false);
  const anyUnanchored = checks.some((check) => check.end === null);
  return (
    <Card aria-label={t("consistency.cash.title")}>
      <CardHeader>
        <CardTitle>{t("consistency.cash.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {checks.map((check) => (
          <CashCheckLine key={check.currency} check={check} />
        ))}
        {anyGap && <p className="text-xs text-muted-foreground">{t("cashCheck.hint")}</p>}
        {anyUnanchored && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">{t("cashCheck.noneHint")}</p>
            <Link to={`/accounts/${accountId}/sources`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              {t("cashCheck.noneLink")}
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CashCheckLine({ check }: { check: CashCheck }) {
  const { t } = useTranslation();
  const { currency, end, start } = check;
  if (end === null) {
    return <Line badge={<Badge variant="outline">—</Badge>} text={t("cashCheck.none", { currency })} />;
  }
  const anchored = { currency, end: end.asOf, endAmount: formatAmount(end.amount) };
  if (start === null) {
    return <Line badge={<Badge variant="outline">{currency}</Badge>} text={t("cashCheck.anchored", anchored)} />;
  }
  const values = {
    ...anchored,
    start: start.asOf,
    startAmount: formatAmount(start.amount),
    balance: formatAmount(start.balance),
    gap: formatAmount(Math.abs(start.gap)),
  };
  return isCashCheckOk(check) ? (
    <Line badge={<Badge variant="success">OK</Badge>} text={t("cashCheck.ok", values)} />
  ) : (
    <Line badge={<Badge variant="warning">{formatAmount(start.gap)}</Badge>} text={t("cashCheck.gap", values)} />
  );
}

function Line({ badge, text }: { badge: ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3">
      {badge}
      <p className="text-sm">{text}</p>
    </div>
  );
}
