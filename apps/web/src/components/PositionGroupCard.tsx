import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AnalyzedPosition } from "@ib/coverage";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { TableBody, TableCell, TableRow } from "@ib/ui/table";
import { PositionRow } from "@/components/PositionRow";
import { PositionTable, PositionTableHeader } from "@/components/PositionTable";
import { ActiveFilters } from "@/components/table/ActiveFilters";
import { useTableView } from "@/hooks/useTableView";
import { formatContract } from "@/lib/format";
import { POSITION_COLUMNS } from "@/lib/positionColumns";
import { coverageBadges } from "@/lib/riskReport";
import { applyView, facetValues, type ColumnSpec } from "@/lib/tableView";
import { tableViewKey } from "@/lib/tableViewStorage";

export interface PositionGroupCardProps {
  accountId: string;
  groupId: string;
  title: string;
  /** The group's positions in the snapshot, before search and filters: what the facets count. */
  positions: readonly AnalyzedPosition[];
  /** The same after the page search. */
  searched: readonly AnalyzedPosition[];
  specs: readonly ColumnSpec<AnalyzedPosition>[];
  sectorOf: (symbol: string) => string | null;
}

/**
 * One group of the Positions page with its own sort and filters: a column means something else in
 * another group (a Type, a Decision, a Coverage), so each card remembers its view apart.
 */
export function PositionGroupCard({ accountId, groupId, title, positions, searched, specs, sectorOf }: PositionGroupCardProps) {
  const { t } = useTranslation();
  const table = useTableView(tableViewKey(accountId, `positions:${groupId}`), specs);
  const rows = useMemo(() => applyView(searched, specs, table.view), [searched, specs, table.view]);
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
