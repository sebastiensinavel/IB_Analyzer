import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { uncovered, type RiskReport } from "@ib/coverage";
import { Badge } from "@ib/ui/badge";
import { buttonVariants } from "@ib/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { formatContract } from "@/lib/format";

interface UncoveredCardProps {
  accountId: string;
  /** `null` without a positions snapshot. */
  report: RiskReport | null;
}

/** The positions nothing covers, with how much of each is naked (spec of sub-project 11, §5). */
export function UncoveredCard({ accountId, report }: UncoveredCardProps) {
  const { t } = useTranslation();
  // Without a snapshot there is no count to show: never a "0" that would read as covered.
  const naked = report === null ? null : uncovered(report);

  return (
    <Card aria-label={t("consistency.uncovered.title")}>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t("consistency.uncovered.title")}</CardTitle>
        {naked !== null && (
          <CardAction>
            <Badge variant={naked.length > 0 ? "warning" : "outline"}>{naked.length}</Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {naked === null ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{t("reconciliation.none")}</p>
            <Link to={`/accounts/${accountId}/sources`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("reconciliation.noneLink")}
            </Link>
          </div>
        ) : naked.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <ShieldCheck className="size-8 text-success" />
            <p className="text-sm text-muted-foreground">{t("consistency.uncovered.empty")}</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {naked.map((position) => (
              <div key={position.description} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="truncate text-sm">{formatContract(position)}</span>
                <span className="shrink-0 font-mono text-sm font-medium text-destructive tabular-nums">
                  {position.uncoveredQuantity}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
