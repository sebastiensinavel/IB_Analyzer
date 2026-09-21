import { Fragment } from "react";
import type { AnalyzedPosition } from "@ib/coverage";
import { PositionChartRow } from "@/components/PositionChartRow";
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
  /** Prototype (graphes) : the one line of the whole page whose chart is open, if it is in this group. */
  openKey: string | null;
  onToggle: (key: string) => void;
}

/** One group of the Positions page: the shared twelve columns over a whole IB position. */
export function PositionGroupCard({
  title,
  positions,
  rows,
  table,
  specs,
  sectorOf,
  openKey,
  onToggle,
}: PositionGroupCardProps) {
  return (
    <FilteredTableBox
      title={title}
      columns={POSITION_COLUMNS}
      labelKey="positions.columns"
      minWidth="70rem"
      specs={specs}
      facetRows={positions}
      rows={rows}
      table={table}
      emptyKey="positions.noResults"
      rowKey={(position) => position.description}
      renderRow={(position) => (
        <Fragment>
        <PositionRow
          onClick={() => onToggle(position.description)}
          expanded={openKey === position.description}
          values={{
            contract: formatContract(position),
            label: position.label,
            sector: sectorOf(position.symbol),
            marketValue: position.marketValue,
            quantity: position.quantity,
            avgPrice: position.avgPrice,
            lastPrice: position.lastPrice,
            dayChange: position.dayChange,
            dailyPnl: position.dailyPnl,
            unrealizedPnl: position.unrealizedPnl,
            decision: position.decision,
            coverage: coverageBadges(position),
          }}
        />
        {openKey === position.description && <PositionChartRow columnCount={POSITION_COLUMNS.length} />}
        </Fragment>
      )}
    />
  );
}
