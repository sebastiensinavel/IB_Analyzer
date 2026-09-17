import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AnalyzedPosition } from "@ib/coverage";
import { Table, TableHead, TableHeader, TableRow } from "@ib/ui/table";
import { ColumnHeader } from "@/components/table/ColumnHeader";
import { POSITION_COLUMNS } from "@/lib/positionColumns";
import type { ColumnSpec, Criterion, Facet, SortDirection, TableView } from "@/lib/tableView";
import { cn } from "@/lib/utils";

/**
 * A table of the Positions page, laid out on the shared column widths. Cells may wrap, since a
 * fixed layout would otherwise let a long label spill over its neighbour; below the minimal
 * width a narrow screen scrolls instead of squeezing the columns.
 */
export function PositionTable({ children }: { children: ReactNode }) {
  return (
    <Table className="min-w-[60rem] table-fixed [&_td]:whitespace-normal [&_th]:whitespace-normal">
      <colgroup>
        {POSITION_COLUMNS.map((column) => (
          <col key={column.key} style={{ width: column.width }} />
        ))}
      </colgroup>
      {children}
    </Table>
  );
}

export interface InteractiveHeader {
  specs: readonly ColumnSpec<AnalyzedPosition>[];
  view: TableView;
  facets: Readonly<Record<string, readonly Facet[]>>;
  onSort: (column: string, dir: SortDirection | null, additive: boolean) => void;
  onCriterion: (column: string, criterion: Criterion | null) => void;
}

/**
 * The header row of the ten shared columns. Sortable and filterable when `interactive` is given;
 * plain otherwise, as on the strategy pages, which are out of this feature's scope.
 */
export function PositionTableHeader({ interactive }: { interactive?: InteractiveHeader }) {
  const { t } = useTranslation();
  return (
    <TableHeader>
      <TableRow>
        {POSITION_COLUMNS.map((column, index) =>
          interactive ? (
            <ColumnHeader
              key={column.key}
              meta={interactive.specs[index]}
              label={t(`positions.columns.${column.key}`)}
              view={interactive.view}
              facets={interactive.facets[column.key]}
              numeric={column.numeric}
              wrap
              className={cn(column.numeric && "text-right")}
              onSort={(dir, additive) => interactive.onSort(column.key, dir, additive)}
              onCriterion={(criterion) => interactive.onCriterion(column.key, criterion)}
            />
          ) : (
            <TableHead key={column.key} className={cn(column.numeric && "text-right")}>
              {t(`positions.columns.${column.key}`)}
            </TableHead>
          ),
        )}
      </TableRow>
    </TableHeader>
  );
}
