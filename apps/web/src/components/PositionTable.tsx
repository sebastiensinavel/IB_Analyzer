import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Table, TableHead, TableHeader, TableRow } from "@ib/ui/table";
import { POSITION_COLUMNS } from "@/lib/positionColumns";
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

/** The header row of the ten shared columns. */
export function PositionTableHeader() {
  const { t } = useTranslation();
  return (
    <TableHeader>
      <TableRow>
        {POSITION_COLUMNS.map((column) => (
          <TableHead key={column.key} className={cn(column.numeric && "text-right")}>
            {t(`positions.columns.${column.key}`)}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
}
