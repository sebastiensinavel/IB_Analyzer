import { COVER_NONE, type AnalyzedPosition, type CoverageAllocation, type CoverSource, type DetailGroupId, type StrategyLine } from "@ib/coverage";

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
 * The coverage a strategy's positions page shows (spec of sub-project 16, §3.4): on a sold option
 * the strategy's own cover, never UNCOVERED; on a LEAPS bought how much of it covers calls; nothing
 * on shares, whose cover of calls is the Wheel's.
 */
export function strategyCoverageBadges(line: StrategyLine): CoverageBadge[] {
  if (line.kind === "short_call" || line.kind === "short_put") return allocationBadges(line.coverage);
  if (line.kind === "long_call") return coverageBadges(line.position);
  return [];
}
