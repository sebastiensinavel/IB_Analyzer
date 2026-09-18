import type { DetailGroupId } from "@ib/coverage";
import { useTableView, type TableViewState } from "@/hooks/useTableView";
import { tableViewKey } from "@/lib/tableViewStorage";
import type { ColumnMeta } from "@/lib/tableView";

export type PositionGroupViews = Record<DetailGroupId, TableViewState>;

/**
 * The sort and filters of the four tables of the Positions page, held by the page rather than by
 * each card: the expiry buttons write the same criterion in all four at once. One `useTableView`
 * per group, called in a fixed order — DETAIL_GROUPS never changes length at runtime.
 */
export function usePositionGroupViews(accountId: string, columns: readonly ColumnMeta[]): PositionGroupViews {
  const long = useTableView(tableViewKey(accountId, "positions:long"), columns);
  const optionBuys = useTableView(tableViewKey(accountId, "positions:optionBuys"), columns);
  const optionSells = useTableView(tableViewKey(accountId, "positions:optionSells"), columns);
  const other = useTableView(tableViewKey(accountId, "positions:other"), columns);
  // Typed by DetailGroupId: a group added to DETAIL_GROUPS without a hook here fails to compile.
  return { long, optionBuys, optionSells, other };
}
