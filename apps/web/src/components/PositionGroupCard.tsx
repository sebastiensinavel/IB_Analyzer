import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AnalyzedPosition } from "@ib/coverage";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { TableBody, TableCell, TableRow } from "@ib/ui/table";
import { PositionRow } from "@/components/PositionRow";
import { PositionTable, PositionTableHeader } from "@/components/PositionTable";
import { ActiveFilters } from "@/components/table/ActiveFilters";
import type { TableViewState } from "@/hooks/useTableView";
import { formatContract } from "@/lib/format";
import { POSITION_COLUMNS } from "@/lib/positionColumns";
import { coverageBadges } from "@/lib/riskReport";
import { facetValues, type ColumnSpec } from "@/lib/tableView";

export interface PositionGroupCardProps {
  title: string;
  /** The group's positions in the snapshot, before search and filters: what the facets count. */
  positions: readonly AnalyzedPosition[];
  /** The same after the page search, this card's filters and its sort: what the table shows. */
  rows: readonly AnalyzedPosition[];
  /** This group's own view, held by the page so the expiry buttons can write in all four at once. */
  table: TableViewState;
  specs: readonly ColumnSpec<AnalyzedPosition>[];
  sectorOf: (symbol: string) => string | null;
}

/**
 * One group of the Positions page with its own sort and filters: a column means something else in
 * another group (a Type, a Decision, a Coverage), so each card remembers its view apart.
 */
export function PositionGroupCard({ title, positions, rows, table, specs, sectorOf }: PositionGroupCardProps) {
  const { t } = useTranslation();
  const facets = useMemo(
    () =>
      Object.fromEntries(
        specs
          .filter((spec) => spec.type === "enum")
          .map((spec) => {
            const criterion = table.view.criteria[spec.key];
            return [spec.key, facetValues(positions, spec, Array.isArray(criterion) ? criterion : [])];
          }),
      ),
    [positions, specs, table.view],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 overflow-x-auto">
        <ActiveFilters
          specs={specs}
          view={table.view}
          columnLabel={(key) => t(`positions.columns.${key}`)}
          onClearColumn={table.clearColumn}
          onClearAll={table.clearAll}
        />
        <PositionTable>
          <PositionTableHeader interactive={{ specs, view: table.view, facets, onSort: table.setSort, onCriterion: table.setCriterion }} />
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={POSITION_COLUMNS.length} className="py-8 text-center text-sm text-muted-foreground">
                  {t("positions.noResults")}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((position) => (
                <PositionRow
                  key={position.description}
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
              ))
            )}
          </TableBody>
        </PositionTable>
      </CardContent>
    </Card>
  );
}
