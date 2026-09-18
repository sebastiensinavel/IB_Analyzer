import { Fragment, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { TableBody, TableCell, TableRow } from "@ib/ui/table";
import { DataTable, DataTableHeader, type ColumnDef } from "@/components/table/DataTable";
import { ActiveFilters } from "@/components/table/ActiveFilters";
import type { TableViewState } from "@/hooks/useTableView";
import { facetValues, type ColumnSpec } from "@/lib/tableView";

export interface FilteredTableBoxProps<Row> {
  /** Absent: no card header — a page whose heading already names the single table. */
  title?: string;
  columns: readonly ColumnDef[];
  /** i18n prefix of the column labels, used by the header and by the filter pills. */
  labelKey: string;
  minWidth?: string;
  /** Same keys and order as `columns`. */
  specs: readonly ColumnSpec<Row>[];
  /** Every line of the box, before search and filters: what the facets count. */
  facetRows: readonly Row[];
  /** The lines the view keeps, in its order: what the table shows. */
  rows: readonly Row[];
  table: TableViewState;
  /** i18n key of the line shown when `rows` is empty. */
  emptyKey: string;
  rowKey: (row: Row) => string;
  renderRow: (row: Row) => ReactNode;
}

/**
 * One titled table with its own sort and filters: the pills that clear them, the interactive
 * header, and the rows. A column means something else from one box to the next — a Type, a
 * Decision, a Coverage — so each box holds its view apart, and the facets count the whole box so
 * that a value filtered out keeps its entry in the list that would bring it back.
 */
export function FilteredTableBox<Row>({
  title,
  columns,
  labelKey,
  minWidth,
  specs,
  facetRows,
  rows,
  table,
  emptyKey,
  rowKey,
  renderRow,
}: FilteredTableBoxProps<Row>) {
  const { t } = useTranslation();
  const facets = useMemo(
    () =>
      Object.fromEntries(
        specs
          .filter((spec) => spec.type === "enum")
          .map((spec) => {
            const criterion = table.view.criteria[spec.key];
            return [spec.key, facetValues(facetRows, spec, Array.isArray(criterion) ? criterion : [])];
          }),
      ),
    [facetRows, specs, table.view],
  );

  return (
    <Card aria-label={title}>
      {title !== undefined && (
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
      )}
      <CardContent className="flex flex-col gap-3 overflow-x-auto">
        <ActiveFilters
          specs={specs}
          view={table.view}
          columnLabel={(key) => t(`${labelKey}.${key}`)}
          onClearColumn={table.clearColumn}
          onClearAll={table.clearAll}
        />
        <DataTable columns={columns} minWidth={minWidth}>
          <DataTableHeader
            columns={columns}
            labelKey={labelKey}
            interactive={{ specs, view: table.view, facets, onSort: table.setSort, onCriterion: table.setCriterion }}
          />
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-8 text-center text-sm text-muted-foreground">
                  {t(emptyKey)}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => <Fragment key={rowKey(row)}>{renderRow(row)}</Fragment>)
            )}
          </TableBody>
        </DataTable>
      </CardContent>
    </Card>
  );
}
