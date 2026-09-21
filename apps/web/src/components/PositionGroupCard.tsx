import { Fragment } from "react";
import type { AnalyzedPosition } from "@ib/coverage";
import { STRATEGIES } from "@ib/ledger";
import { PositionChartRow } from "@/components/PositionChartRow";
import { PositionRow } from "@/components/PositionRow";
import { FilteredTableBox } from "@/components/table/FilteredTableBox";
import type { OpenChart } from "@/hooks/useOpenChart";
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
  /** The one chart of the whole page: shared so opening one card's line closes another's. */
  chart: OpenChart;
  /** This card's own identifier, prefixing its rows' keys: two cards can hold the same contract. */
  boxId: string;
}

/** One group of the Positions page: the shared twelve columns over a whole IB position. */
export function PositionGroupCard({
  title,
  positions,
  rows,
  table,
  specs,
  sectorOf,
  chart,
  boxId,
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
      renderRow={(position) => {
        const key = `${boxId}|${position.description}`;
        return (
          <Fragment>
            <PositionRow
              onClick={() => chart.toggle(key)}
              expanded={chart.isOpen(key)}
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
            {chart.isOpen(key) && (
              <PositionChartRow
                ticker={position.symbol}
                strategies={STRATEGIES}
                columnCount={POSITION_COLUMNS.length}
                currency={position.currency}
              />
            )}
          </Fragment>
        );
      }}
    />
  );
}
