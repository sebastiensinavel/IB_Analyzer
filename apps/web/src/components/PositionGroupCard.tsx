import type { AnalyzedPosition } from "@ib/coverage";
import { PositionRow } from "@/components/PositionRow";
import { FilteredTableBox } from "@/components/table/FilteredTableBox";
import type { TableViewState } from "@/hooks/useTableView";
import { formatContract } from "@/lib/format";
import { POSITION_COLUMNS } from "@/lib/positionColumns";
import { coverageBadges } from "@/lib/riskReport";
import type { ColumnSpec } from "@/lib/tableView";

export interface PositionGroupCardProps {
  title: string;
  /** The group's positions in the snapshot, before search and filters: what the facets count. */
  positions: readonly AnalyzedPosition[];
  /** The same after the page search, this box's filters and its sort: what the table shows. */
  rows: readonly AnalyzedPosition[];
  /** This group's own view, held by the page so the expiry buttons can write in all four at once. */
  table: TableViewState;
  specs: readonly ColumnSpec<AnalyzedPosition>[];
  sectorOf: (symbol: string) => string | null;
}

/** One group of the Positions page: the shared ten columns over a whole IB position. */
export function PositionGroupCard({ title, positions, rows, table, specs, sectorOf }: PositionGroupCardProps) {
  return (
    <FilteredTableBox
      title={title}
      columns={POSITION_COLUMNS}
      labelKey="positions.columns"
      minWidth="60rem"
      specs={specs}
      facetRows={positions}
      rows={rows}
      table={table}
      emptyKey="positions.noResults"
      rowKey={(position) => position.description}
      renderRow={(position) => (
        <PositionRow
          values={{
            contract: formatContract(position),
            label: position.label,
            sector: sectorOf(position.symbol),
            marketValue: position.marketValue,
            quantity: position.quantity,
            avgPrice: position.avgPrice,
            lastPrice: position.lastPrice,
            unrealizedPnl: position.unrealizedPnl,
            decision: position.decision,
            coverage: coverageBadges(position),
          }}
        />
      )}
    />
  );
}
