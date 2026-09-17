import { uncovered, type RiskReport } from "@ib/coverage";
import type { JournalsView } from "@/db/hooks";

/** Spec of sub-project 11, §2: green, red, or grey for want of anything to check. */
export type ConsistencyStatus = "ok" | "alert" | "unknown";

export interface CoverageVerdict {
  status: ConsistencyStatus;
  /** `true` while the snapshot has not been read yet; the status is then `unknown`. */
  loading: boolean;
  /** Uncovered positions; 0 unless the status is `alert`. */
  uncovered: number;
}

export interface ReconstitutionVerdict {
  status: ConsistencyStatus;
  /** `true` while the journals are being computed; the status is then `unknown`. */
  loading: boolean;
  /** Differences plus orphan lines; 0 unless the status is `alert`. */
  gaps: number;
  /** The snapshot the replay was checked against; `null` without one or while loading. */
  asOf: string | null;
}

/** `report` as `RiskReportView.report` has it: `undefined` while loading, `null` without a snapshot. */
export function coverageVerdict(report: RiskReport | null | undefined): CoverageVerdict {
  if (report === undefined) return { status: "unknown", loading: true, uncovered: 0 };
  if (report === null) return { status: "unknown", loading: false, uncovered: 0 };
  const count = uncovered(report).length;
  return { status: count === 0 ? "ok" : "alert", loading: false, uncovered: count };
}

/** An orphan alone is a gap: `ReconciliationCard` leaves its matching state for one. */
export function reconstitutionVerdict(journals: JournalsView): ReconstitutionVerdict {
  if (journals.status === "loading") return { status: "unknown", loading: true, gaps: 0, asOf: null };
  const { asOf, differences, orphans } = journals.report.reconciliation;
  if (asOf === null) return { status: "unknown", loading: false, gaps: 0, asOf: null };
  const gaps = differences.length + orphans.length;
  return { status: gaps === 0 ? "ok" : "alert", loading: false, gaps, asOf };
}
