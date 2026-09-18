import type { ColumnSpec, Criterion } from "@/lib/tableView";

/** The criterion as a pill reads it: the typed text, or the checked labels. */
export function criterionSummary<Row>(spec: ColumnSpec<Row>, criterion: Criterion, emptyLabel: string): string {
  if (typeof criterion === "string") return criterion.trim();
  return criterion.map((value) => (value === null ? emptyLabel : (spec.label?.(value) ?? value))).join(", ");
}
