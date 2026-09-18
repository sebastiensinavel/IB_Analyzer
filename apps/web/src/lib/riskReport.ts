import {
  COVER_NONE,
  type AnalyzedPosition,
  type CoverageAllocation,
  type CoverSource,
  type DetailGroupId,
  type PositionsStrategy,
  type StrategyLine,
} from "@ib/coverage";

export function groupTitleKey(id: DetailGroupId): string {
  return `positions.groups.${id}`;
}

export interface DecisionBadge {
  variant: "success" | "destructive";
  label: "keep" | "buy back";
}

export function decisionBadge(decision: AnalyzedPosition["decision"]): DecisionBadge | null {
  if (decision === "keep") return { variant: "success", label: "keep" };
  if (decision === "buy back") return { variant: "destructive", label: "buy back" };
  return null;
}

export type CoverageBadgeVariant = "default" | "success" | "secondary" | "warning" | "destructive" | "outline";

export interface CoverageBadge {
  variant: CoverageBadgeVariant;
  label: string;
  tooltip: string | null;
}

// Keyed on the literal CoverSource values, not on the imported COVER_* identifiers:
// TypeScript only narrows a `const` back to its literal type within the file that
// declares it, so an imported `COVER_CASH: CoverSource` widens to the whole union
// as a computed key and silently produces an index signature instead of an exact
// object type. Typing the table as Record<CoverSource, ...> is what actually buys
// the compile-time drift check: renaming or removing a member of CoverSource in
// constants.ts makes this object literal fail to satisfy the type below.
const COVERAGE_SOURCE_VARIANT: Record<CoverSource, CoverageBadgeVariant> = {
  cash: "default",
  stock: "success",
  leaps: "secondary",
  spread: "warning",
  UNCOVERED: "destructive",
};

/** One badge per allocation, its detail as tooltip; never an UNCOVERED badge. */
export function allocationBadges(allocations: readonly CoverageAllocation[]): CoverageBadge[] {
  return allocations.map((allocation) => ({
    variant: COVERAGE_SOURCE_VARIANT[allocation.source],
    label: `${allocation.source} ×${allocation.quantity}`,
    tooltip: allocation.detail || null,
  }));
}

/** How much of a long cover backs short options: "used x/y" as soon as anything does, "unused" otherwise. */
export function usedBadge(used: number, total: number): CoverageBadge {
  return used > 0 ? { variant: "success", label: `used ${used}/${total}`, tooltip: null } : { variant: "outline", label: "unused", tooltip: null };
}

/** One badge per allocation, then the uncovered remainder; "used x/y" or "unused" for a long cover; nothing without a position. */
export function coverageBadges(position: AnalyzedPosition | null): CoverageBadge[] {
  if (position === null) return [];
  if (position.kind === "short_call" || position.kind === "short_put") {
    const badges = allocationBadges(position.allocations);
    if (position.uncoveredQuantity > 0) {
      badges.push({ variant: COVERAGE_SOURCE_VARIANT[COVER_NONE], label: `${COVER_NONE} ×${position.uncoveredQuantity}`, tooltip: null });
    }
    if (badges.length === 0) badges.push({ variant: COVERAGE_SOURCE_VARIANT[COVER_NONE], label: COVER_NONE, tooltip: null });
    return badges;
  }
  if (position.kind === "long_stock" || position.kind === "long_call" || position.kind === "long_put") {
    return [usedBadge(position.usedQuantity, Math.abs(position.quantity))];
  }
  return [];
}

/**
 * The coverage sources a Positions filter checks, from the position itself, never from badge text:
 * the same branches as coverageBadges, one value per distinct source.
 */
export function coverageValues(position: AnalyzedPosition): string[] {
  if (position.kind === "short_call" || position.kind === "short_put") {
    const sources = new Set<string>(position.allocations.map((allocation) => allocation.source));
    if (position.uncoveredQuantity > 0 || position.allocations.length === 0) sources.add(COVER_NONE);
    return [...sources];
  }
  if (position.kind === "long_stock" || position.kind === "long_call" || position.kind === "long_put") {
    return [position.usedQuantity > 0 ? "used" : "unused"];
  }
  return [];
}

/**
 * The coverage a strategy's positions page shows (spec of sub-project 16, §3.4, extended by
 * sub-project 21, §4.5): on a sold option the strategy's own cover — the Wheel's shares and cash,
 * the LEAPS' calls, a condor's spread —, on a LEAPS or a condor's wing how much of it covers
 * calls, nothing on shares, whose cover of calls is the Wheel's.
 *
 * Others is the exception: what is filed there is precisely what nothing covers, and UNCOVERED is
 * never an allocation. Its quantity is the naked part, the engine having already split off the
 * part the Wheel or the LEAPS cover, so the badge is read off the line itself.
 */
export function strategyCoverageBadges(line: StrategyLine, strategy: PositionsStrategy): CoverageBadge[] {
  if (line.kind === "short_call" || line.kind === "short_put") {
    if (strategy !== "others") return allocationBadges(line.coverage);
    return [{ variant: COVERAGE_SOURCE_VARIANT[COVER_NONE], label: `${COVER_NONE} ×${Math.abs(line.quantity)}`, tooltip: null }];
  }
  if (line.kind === "long_call" || line.kind === "long_put") return coverageBadges(line.position);
  return [];
}

/** The same branches, as filterable values: the filter never reads the badges' text. */
export function strategyCoverageValues(line: StrategyLine, strategy: PositionsStrategy): string[] {
  if (line.kind === "short_call" || line.kind === "short_put") {
    if (strategy === "others") return [COVER_NONE];
    return [...new Set(line.coverage.map((allocation) => allocation.source))];
  }
  if (line.kind === "long_call" || line.kind === "long_put") {
    return line.position === null ? ["unused"] : [line.position.usedQuantity > 0 ? "used" : "unused"];
  }
  return [];
}
