import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { TableCell, TableRow } from "@ib/ui/table";
import i18n from "@/i18n";
import { FilteredTableBox } from "@/components/table/FilteredTableBox";
import type { ColumnDef } from "@/components/table/DataTable";
import type { TableViewState } from "@/hooks/useTableView";
import { EMPTY_VIEW, type ColumnSpec, type TableView } from "@/lib/tableView";

interface Line {
  position: string;
  type: string;
}

const COLUMNS: ColumnDef[] = [
  { key: "position", width: "70%", numeric: false },
  { key: "type", width: "30%", numeric: false },
];

const SPECS: ColumnSpec<Line>[] = [
  { key: "position", type: "text", sortable: true, value: (line) => line.position },
  { key: "type", type: "enum", sortable: true, value: (line) => line.type },
];

const LINES: Line[] = [
  { position: "AAPL", type: "long_stock" },
  { position: "XOM Mar20'26 100 Put", type: "short_put" },
];

function table(view: TableView = EMPTY_VIEW): TableViewState {
  return { view, setCriterion: vi.fn(), setSort: vi.fn(), clearColumn: vi.fn(), clearAll: vi.fn() };
}

// `...titleArg` (rather than a plain default parameter) so a test can pass `undefined`
// explicitly for "no title" without JS's default-parameter substitution overriding it:
// a default parameter fires on an explicit `undefined` too, not only on an omitted argument.
function renderBox(rows: Line[], state = table(), ...titleArg: [title: string | undefined] | []) {
  const title = titleArg.length > 0 ? titleArg[0] : "Ventes d'options";
  return render(
    <I18nextProvider i18n={i18n}>
      <FilteredTableBox
        title={title}
        columns={COLUMNS}
        labelKey="positions.columns"
        specs={SPECS}
        facetRows={LINES}
        rows={rows}
        table={state}
        emptyKey="positions.noResults"
        rowKey={(line) => line.position}
        renderRow={(line) => (
          <TableRow>
            <TableCell>{line.position}</TableCell>
            <TableCell>{line.type}</TableCell>
          </TableRow>
        )}
      />
    </I18nextProvider>,
  );
}

describe("FilteredTableBox", () => {
  it("names the box for a screen reader and titles it", () => {
    renderBox(LINES);
    expect(within(screen.getByLabelText("Ventes d'options")).getByText("AAPL")).toBeInTheDocument();
  });

  it("renders no card header when it has no title", () => {
    renderBox(LINES, table(), undefined);
    expect(screen.queryByText("Ventes d'options")).not.toBeInTheDocument();
    expect(screen.getByText("AAPL")).toBeInTheDocument();
  });

  it("keeps its headers and says so when the view empties it", () => {
    renderBox([]);
    expect(screen.getByText("Aucune position ne correspond.")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /^Position/ })).toBeInTheDocument();
  });

  it("counts the facets on every line of the box, not on the ones left", async () => {
    renderBox([LINES[0]]);
    const header = screen.getByRole("columnheader", { name: /^Type/ });
    await userEvent.click(within(header).getByRole("button"));
    // Both values of facetRows are offered, each counted once, although one row is displayed.
    // Each checkbox's accessible name also carries its count (e.g. "long_stock 1"), so the
    // match is a prefix, as elsewhere in the codebase (ColumnHeader.test.tsx, PositionsPage.test.tsx).
    expect(await screen.findByRole("checkbox", { name: /^long_stock/ })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /^short_put/ })).toBeInTheDocument();
  });

  it("shows a pill per filtered column, above the table", () => {
    renderBox(LINES, table({ sort: [], criteria: { position: "AAPL" } }));
    expect(screen.getByText("Position : AAPL")).toBeInTheDocument();
  });
});
