import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { TableBody } from "@ib/ui/table";
import i18n from "@/i18n";
import { DataTable, DataTableHeader, type ColumnDef } from "@/components/table/DataTable";
import { EMPTY_VIEW, type ColumnSpec } from "@/lib/tableView";

const FIXED: ColumnDef[] = [
  { key: "position", width: "60%", numeric: false },
  { key: "quantity", width: "40%", numeric: true },
];

const AUTO: ColumnDef[] = [
  { key: "position", numeric: false },
  { key: "quantity", numeric: true },
];

const SPECS: ColumnSpec<{ quantity: number }>[] = [
  { key: "position", type: "text", sortable: true, value: () => "AAPL" },
  { key: "quantity", type: "number", sortable: true, value: (row) => row.quantity },
];

function renderTable(columns: ColumnDef[], interactive = false) {
  return render(
    <I18nextProvider i18n={i18n}>
      <DataTable columns={columns} minWidth="60rem">
        <DataTableHeader
          columns={columns}
          labelKey="positions.columns"
          interactive={
            interactive
              ? { specs: SPECS, view: EMPTY_VIEW, facets: {}, onSort: () => {}, onCriterion: () => {} }
              : undefined
          }
        />
        <TableBody />
      </DataTable>
    </I18nextProvider>,
  );
}

describe("DataTable", () => {
  it("lays out declared widths in a colgroup and fixes the layout", () => {
    renderTable(FIXED);
    const table = screen.getByRole("table");
    expect([...table.querySelectorAll("col")].map((col) => col.style.width)).toEqual(["60%", "40%"]);
    expect(table).toHaveClass("table-fixed");
    expect(table.style.minWidth).toBe("60rem");
  });

  it("leaves a table without widths to its content: no colgroup, no fixed layout", () => {
    renderTable(AUTO);
    const table = screen.getByRole("table");
    expect(table.querySelector("colgroup")).toBeNull();
    expect(table).not.toHaveClass("table-fixed");
  });

  it("translates each header under the given key and right-aligns the numeric ones", () => {
    renderTable(FIXED);
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent)).toEqual(["Position", "Qté"]);
    expect(headers[1]).toHaveClass("text-right");
  });

  it("gives no button to a plain header and one to an interactive one", () => {
    renderTable(FIXED);
    expect(within(screen.getAllByRole("columnheader")[0]).queryByRole("button")).not.toBeInTheDocument();
    renderTable(FIXED, true);
    const interactive = screen.getAllByRole("columnheader");
    expect(within(interactive[interactive.length - 1]).getByRole("button")).toBeInTheDocument();
  });
});
