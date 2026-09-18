import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Table, TableHead, TableHeader, TableRow } from "@ib/ui/table";
import { ColumnHeader } from "@/components/table/ColumnHeader";
import type { ColumnSpec, Criterion, Facet, SortDirection, TableView } from "@/lib/tableView";
import { cn } from "@/lib/utils";

/** One column of a table: its i18n suffix, its share of the width when the table fixes them, its alignment. */
export interface ColumnDef {
  key: string;
  /** Share of the table. Absent on every column, the table lays itself out on its content. */
  width?: string;
  numeric: boolean;
}

/**
 * A table laid out on declared columns. With widths, a `colgroup` and a fixed layout, so several
 * tables of one page line up whatever their content and a long label wraps rather than pushing a
 * column out of sight; without, the browser sizes the columns on the content and a narrow screen
 * scrolls — what the seventeen columns of a journal need.
 */
export function DataTable({ columns, minWidth, children }: { columns: readonly ColumnDef[]; minWidth?: string; children: ReactNode }) {
  const fixed = columns.every((column) => column.width !== undefined);
  return (
    <Table className={cn(fixed && "table-fixed [&_td]:whitespace-normal [&_th]:whitespace-normal")} style={minWidth ? { minWidth } : undefined}>
      {fixed && (
        <colgroup>
          {columns.map((column) => (
            <col key={column.key} style={{ width: column.width }} />
          ))}
        </colgroup>
      )}
      {children}
    </Table>
  );
}

export interface InteractiveHeader<Row> {
  /** Same keys and order as the columns: the header reads them index by index. */
  specs: readonly ColumnSpec<Row>[];
  view: TableView;
  facets: Readonly<Record<string, readonly Facet[]>>;
  onSort: (column: string, dir: SortDirection | null, additive: boolean) => void;
  onCriterion: (column: string, criterion: Criterion | null) => void;
}

/**
 * The header row. Sortable and filterable when `interactive` is given, plain otherwise — the cash
 * table, whose two or three lines sort nothing. A label wraps only where the widths are declared:
 * under an automatic layout, a wrapped header would widen its column instead of the table.
 */
export function DataTableHeader<Row>({
  columns,
  labelKey,
  interactive,
}: {
  columns: readonly ColumnDef[];
  labelKey: string;
  interactive?: InteractiveHeader<Row>;
}) {
  const { t } = useTranslation();
  return (
    <TableHeader>
      <TableRow>
        {columns.map((column, index) =>
          interactive ? (
            <ColumnHeader
              key={column.key}
              meta={interactive.specs[index]}
              label={t(`${labelKey}.${column.key}`)}
              view={interactive.view}
              facets={interactive.facets[column.key]}
              numeric={column.numeric}
              wrap={column.width !== undefined}
              className={cn(column.numeric && "text-right")}
              onSort={(dir, additive) => interactive.onSort(column.key, dir, additive)}
              onCriterion={(criterion) => interactive.onCriterion(column.key, criterion)}
            />
          ) : (
            <TableHead key={column.key} className={cn(column.numeric && "text-right")}>
              {t(`${labelKey}.${column.key}`)}
            </TableHead>
          ),
        )}
      </TableRow>
    </TableHeader>
  );
}
