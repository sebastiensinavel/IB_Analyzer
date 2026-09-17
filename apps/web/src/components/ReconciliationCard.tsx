import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { Reconciliation } from "@ib/ledger";
import { Badge } from "@ib/ui/badge";
import { buttonVariants } from "@ib/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { formatSnapshotDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ReconciliationCardProps {
  accountId: string;
  reconciliation: Reconciliation;
}

/** Spec §7.2: the replayed portfolio against the snapshot, in one of three states. */
export function ReconciliationCard({ accountId, reconciliation }: ReconciliationCardProps) {
  const { t } = useTranslation();
  return (
    <Card aria-label={t("consistency.reconciliation.title")}>
      <CardHeader>
        <CardTitle>{t("consistency.reconciliation.title")}</CardTitle>
      </CardHeader>
      <ReconciliationContent accountId={accountId} reconciliation={reconciliation} />
    </Card>
  );
}

function ReconciliationContent({ accountId, reconciliation }: ReconciliationCardProps) {
  const { t } = useTranslation();
  const { asOf, differences, orphans } = reconciliation;

  if (asOf === null) {
    return (
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("reconciliation.none")}</p>
        <Link to={`/accounts/${accountId}/sources`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          {t("reconciliation.noneLink")}
        </Link>
      </CardContent>
    );
  }

  const date = formatSnapshotDate(asOf);
  if (differences.length === 0 && orphans.length === 0) {
    return (
      <CardContent className="flex items-center gap-3">
        <Badge variant="success">OK</Badge>
        <p className="text-sm">{t("reconciliation.ok", { date })}</p>
      </CardContent>
    );
  }

  return (
    <CardContent className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Badge variant="warning">{differences.length}</Badge>
        <p className="text-sm font-medium">{t("reconciliation.differences", { count: differences.length, date })}</p>
      </div>
      <p className="text-xs text-muted-foreground">{t("reconciliation.hint")}</p>
      <ul className="list-disc pl-5 font-mono text-xs tabular-nums">
        {differences.map((d) => (
          <li key={d.label}>{t("reconciliation.difference", { label: d.label, ledger: d.ledgerQty, snapshot: d.snapshotQty })}</li>
        ))}
      </ul>
      {orphans.length > 0 && <p className="text-xs text-muted-foreground">{t("reconciliation.orphans", { count: orphans.length })}</p>}
    </CardContent>
  );
}
