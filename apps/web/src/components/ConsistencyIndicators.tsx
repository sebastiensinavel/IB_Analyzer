import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useAccountJournals, useAccountRiskReport } from "@/db/AccountDataProvider";
import { coverageVerdict, reconstitutionVerdict, type ConsistencyStatus } from "@/lib/consistency";
import { formatSnapshotDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const ICON_TONE: Record<ConsistencyStatus, string> = {
  ok: "text-success",
  alert: "text-destructive",
  unknown: "text-muted-foreground",
};

/**
 * The title bar's two verdicts (spec of sub-project 11, §3), in view on every page of an account,
 * as one link to the Consistency page. Only an uncovered position blinks: a reconstitution gap
 * stays red and still, and nothing moves for a user who asked the system to reduce motion.
 */
export function ConsistencyIndicators({ accountId }: { accountId: string }) {
  const { t } = useTranslation();
  const { report } = useAccountRiskReport();
  const journals = useAccountJournals();
  const coverage = coverageVerdict(report);
  const reconstitution = reconstitutionVerdict(journals);

  const coverageText = t(`consistency.indicators.coverage.${coverage.loading ? "loading" : coverage.status}`, {
    count: coverage.uncovered,
  });
  const reconstitutionText = t(`consistency.indicators.reconstitution.${reconstitution.loading ? "loading" : reconstitution.status}`, {
    count: reconstitution.gaps,
    date: reconstitution.asOf === null ? "" : formatSnapshotDate(reconstitution.asOf),
  });
  const summary = `${coverageText}. ${reconstitutionText}`;

  return (
    <Link
      to={`/accounts/${accountId}/consistency`}
      aria-label={summary}
      title={summary}
      className="flex items-center gap-3 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <Indicator
        testId="coverage-indicator"
        label={t("consistency.indicators.coverage.label")}
        status={coverage.status}
        blink={coverage.status === "alert"}
      />
      <Indicator
        testId="reconstitution-indicator"
        label={t("consistency.indicators.reconstitution.label")}
        status={reconstitution.status}
        blink={false}
      />
    </Link>
  );
}

interface IndicatorProps {
  testId: string;
  label: string;
  status: ConsistencyStatus;
  blink: boolean;
}

function Indicator({ testId, label, status, blink }: IndicatorProps) {
  return (
    <span data-testid={testId} data-status={status} className="flex items-center gap-1.5">
      {/* Below `sm` the icons speak alone; the link's label still says everything. */}
      <span className="hidden sm:inline">{label}</span>
      <ShieldCheck aria-hidden="true" className={cn("size-4", ICON_TONE[status], blink && "motion-safe:animate-pulse")} />
    </span>
  );
}
