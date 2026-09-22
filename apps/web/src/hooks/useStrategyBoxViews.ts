import type { PositionsStrategy } from "@ib/coverage";
import { useTableView, type TableViewState } from "@/hooks/useTableView";
import type { StrategyBoxId } from "@/lib/strategyBoxes";
import type { ColumnMeta } from "@/lib/tableView";
import { tableViewKey } from "@/lib/tableViewStorage";

/**
 * The stored views of a strategy's positions page, held by the page rather than by each box: the
 * expiry buttons write the same criterion in all of them at once. Eleven `useTableView` in a fixed
 * order, one per StrategyBoxId, whatever the strategy shows — a hook count never varies between
 * renders, and a view a page does not display costs one read of localStorage.
 */
export function useStrategyBoxViews(
  accountId: string,
  strategy: PositionsStrategy,
  lineColumns: readonly ColumnMeta[],
  shareColumns: readonly ColumnMeta[],
): Record<StrategyBoxId, TableViewState> {
  const prefix = `positions:${strategy}`;
  const long = useTableView(tableViewKey(accountId, `${prefix}:long`), lineColumns);
  const optionBuys = useTableView(tableViewKey(accountId, `${prefix}:optionBuys`), lineColumns);
  const optionSells = useTableView(tableViewKey(accountId, `${prefix}:optionSells`), lineColumns);
  const other = useTableView(tableViewKey(accountId, `${prefix}:other`), lineColumns);
  const callSells = useTableView(tableViewKey(accountId, `${prefix}:callSells`), lineColumns);
  const putSells = useTableView(tableViewKey(accountId, `${prefix}:putSells`), lineColumns);
  const leapsUncovered = useTableView(tableViewKey(accountId, `${prefix}:leapsUncovered`), lineColumns);
  const leapsCovered = useTableView(tableViewKey(accountId, `${prefix}:leapsCovered`), lineColumns);
  const sharesUncovered = useTableView(tableViewKey(accountId, `${prefix}:sharesUncovered`), shareColumns);
  const sharesCallAbove = useTableView(tableViewKey(accountId, `${prefix}:sharesCallAbove`), shareColumns);
  const sharesCallBelow = useTableView(tableViewKey(accountId, `${prefix}:sharesCallBelow`), shareColumns);
  // Typed by StrategyBoxId: a box added to STRATEGY_BOXES without a hook here fails to compile.
  return {
    long,
    optionBuys,
    optionSells,
    other,
    callSells,
    putSells,
    leapsUncovered,
    leapsCovered,
    sharesUncovered,
    sharesCallAbove,
    sharesCallBelow,
  };
}
