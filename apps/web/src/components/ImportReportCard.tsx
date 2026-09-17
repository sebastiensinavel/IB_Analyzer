import { useTranslation } from "react-i18next";
import type { ParseIssue } from "@ib/ib-parsers";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import type { ImportReport } from "@/db/importFile";
import { formatMoney, formatPeriod } from "@/lib/format";

export function IssueList({ issues }: { issues: readonly ParseIssue[] }) {
  const { t } = useTranslation();
  if (issues.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {issues.map((issue, index) => (
        <li key={index} className={issue.severity === "error" ? "text-destructive" : "text-warning-foreground"}>
          <span className="font-medium">{t(`sources.issues.${issue.code}`)}</span>
          {" : "}
          <span className="font-mono text-xs">{issue.detail}</span>
        </li>
      ))}
    </ul>
  );
}

export function ImportReportCard({ report }: { report: ImportReport }) {
  const { t } = useTranslation();
  return (
    <Card data-testid="import-report">
      <CardHeader>
        <CardTitle className={report.status === "error" ? "text-destructive" : undefined}>
          {t(report.status === "ok" ? "sources.report.ok" : "sources.report.error")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {/* Several files imported together leave several cards: the name tells them apart. */}
          <dt className="text-muted-foreground">{t("sources.report.file")}</dt>
          <dd className="min-w-0 truncate" title={report.fileName}>{report.fileName}</dd>
          <dt className="text-muted-foreground">{t("sources.report.source")}</dt>
          <dd>{report.source ? t(`sources.report.sources.${report.source}`) : "—"}</dd>
          {report.status === "ok" && (
            <>
              <dt className="text-muted-foreground">{t("sources.report.period")}</dt>
              <dd className="font-mono">{formatPeriod(report.period)}</dd>
              <dt className="text-muted-foreground">{t("sources.report.imported")}</dt>
              <dd className="font-mono">{report.imported}</dd>
              <dt className="text-muted-foreground">{t("sources.report.skipped")}</dt>
              <dd className="font-mono">{report.skipped}</dd>
              {report.positions !== null && (
                <>
                  <dt className="text-muted-foreground">{t("sources.report.positions")}</dt>
                  <dd className="font-mono">{report.positions}</dd>
                </>
              )}
              {report.cashAvailable !== null && (
                <>
                  <dt className="text-muted-foreground">{t("sources.report.cashAvailable")}</dt>
                  <dd className="font-mono">{formatMoney(report.cashAvailable)}</dd>
                </>
              )}
              {report.dropped.length > 0 && (
                <>
                  <dt className="text-muted-foreground">{t("sources.report.dropped")}</dt>
                  <dd>
                    <span className="font-mono">
                      {report.dropped.map((d) => `${t(`history.kinds.${d.kind}`)}: ${d.count}`).join(", ")}
                    </span>
                    <p className="text-xs text-muted-foreground">{t("sources.report.droppedHint")}</p>
                  </dd>
                </>
              )}
            </>
          )}
        </dl>
        {report.status === "ok" && report.staleSnapshot && (
          <p className="text-sm text-warning-foreground">{t("sources.report.staleSnapshot")}</p>
        )}
        {report.issues.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="text-sm font-medium">{t("sources.report.issues")}</div>
            <IssueList issues={report.issues} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
