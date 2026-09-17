import type { Position } from "@ib/ledger";
import { analyze } from "./classify.ts";
import { DETAIL_GROUPS, MAX_STRUCTURE_LOSS, STRUCT_IRON_CONDOR, type DetailGroupId } from "./constants.ts";
import { computeCoverage } from "./coverage.ts";
import { fmtMoney, fmtNum } from "./format.ts";
import type { AnalyzedPosition, RiskReport, Structure } from "./types.ts";

/** Run the coverage engine and wrap the result. The Python properties are the pure functions below. */
export function buildRiskReport(positions: readonly Position[], cashAvailable: number | null): RiskReport {
  const analyzed = positions.map(analyze);
  const structures = computeCoverage(analyzed);
  return { cashAvailable, positions: analyzed, structures };
}

// --- Structure --------------------------------------------------------------

/** Worst case minus credit. The two sides of a condor are not additive. */
export function structureMaxLoss(s: Structure): number {
  return Math.max(s.callRisk, s.putRisk) - s.credit;
}

/**
 * Gross cash needed on the worst side. The credit is already in the account's cash: not netted.
 * The same rule is applied to journal condor legs by `worstWing` in
 * `packages/ledger/src/journals/capital.ts`, which cannot import this package.
 */
export function structureAssignmentCash(s: Structure): number {
  return Math.max(s.callRisk, s.putRisk);
}

export function structureOk(s: Structure): boolean {
  return structureMaxLoss(s) <= MAX_STRUCTURE_LOSS;
}

export function structureDescription(s: Structure): string {
  return `${s.symbol} ${s.expiry} ${s.kind}`;
}

// --- Position ---------------------------------------------------------------

/**
 * Capital genuinely at stake, in USD. Market value for everything the
 * account can only lose what it put in; the assignment amount for a short
 * put, i.e. the `requiredCash` the coverage engine computed (0 for a leg
 * of a spread, 0 before coverage ran). `null` when the market value is unknown.
 */
export function riskValue(p: AnalyzedPosition): number | null {
  if (p.kind === "short_put") return p.requiredCash;
  return p.marketValue === null ? null : Math.abs(p.marketValue);
}

// --- Report -----------------------------------------------------------------

export function putCashRequired(report: RiskReport): number {
  return report.positions.reduce((sum, p) => sum + p.requiredCash, 0);
}

export function ironCondors(report: RiskReport): Structure[] {
  return report.structures.filter((s) => s.kind === STRUCT_IRON_CONDOR);
}

/** Gross assignment cash of every condor, never max loss: the credit is already in cashAvailable. */
export function ironCondorCashRequired(report: RiskReport): number {
  return ironCondors(report).reduce((sum, s) => sum + structureAssignmentCash(s), 0);
}

/** Cash-secured puts plus condors: the broker holds the condor's worst case as margin. */
export function cashRequired(report: RiskReport): number {
  return putCashRequired(report) + ironCondorCashRequired(report);
}

/** `null` when the cash is unknown: no verdict, never a false one. */
export function cashOk(report: RiskReport): boolean | null {
  return report.cashAvailable === null ? null : cashRequired(report) <= report.cashAvailable;
}

/** Short options with nothing behind them: unbounded loss. */
export function uncovered(report: RiskReport): AnalyzedPosition[] {
  return report.positions.filter((p) => p.uncoveredQuantity > 0);
}

export function shortStock(report: RiskReport): AnalyzedPosition[] {
  return report.positions.filter((p) => p.kind === "short_stock");
}

export function breaches(report: RiskReport): Structure[] {
  return report.structures.filter((s) => !structureOk(s));
}

/** Covered short calls that would be assigned at a loss. */
export function moderateShortCalls(report: RiskReport): AnalyzedPosition[] {
  return report.positions.filter((p) => p.kind === "short_call" && p.riskNotes.length > 0);
}

/** Every blocking problem, in plain English, as the Python wrote them. */
export function issues(report: RiskReport): string[] {
  const problems: string[] = [];
  for (const pos of uncovered(report)) {
    problems.push(`${pos.description}: ${fmtNum(pos.uncoveredQuantity)} contract(s) not covered - unlimited loss risk`);
  }
  for (const pos of shortStock(report)) {
    problems.push(`${pos.description}: short stock position - unlimited loss risk`);
  }
  if (report.cashAvailable !== null && cashRequired(report) > report.cashAvailable) {
    problems.push(
      `cash required (short puts + iron condors) needs ${fmtMoney(cashRequired(report))} USD ` +
        `but only ${fmtMoney(report.cashAvailable)} USD is available`,
    );
  }
  for (const structure of breaches(report)) {
    problems.push(
      `${structureDescription(structure)}: max loss ${fmtMoney(structureMaxLoss(structure))} USD ` +
        `exceeds the ${fmtMoney(MAX_STRUCTURE_LOSS)} USD limit`,
    );
  }
  return problems;
}

export function isOk(report: RiskReport): boolean {
  return issues(report).length === 0;
}

// --- Grouping ---------------------------------------------------------------

export interface PositionGroup {
  id: DetailGroupId;
  title: string;
  positions: AnalyzedPosition[];
}

/** Split positions into DETAIL_GROUPS, each sorted by description (plain string order, like Python). */
export function groupedPositions(positions: readonly AnalyzedPosition[]): PositionGroup[] {
  const grouped = new Set(DETAIL_GROUPS.flatMap((g) => (g.kinds ? [...g.kinds] : [])));
  return DETAIL_GROUPS.map((group) => {
    const kinds = group.kinds;
    const matched = kinds ? positions.filter((p) => kinds.has(p.kind)) : positions.filter((p) => !grouped.has(p.kind));
    const sorted = [...matched].sort((a, b) => (a.description < b.description ? -1 : a.description > b.description ? 1 : 0));
    return { id: group.id, title: group.title, positions: sorted };
  });
}
