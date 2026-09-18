import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Table, TableHeader, TableRow } from "@ib/ui/table";
import { ColumnHeader, type ColumnHeaderProps } from "@/components/table/ColumnHeader";
import { EMPTY_VIEW } from "@/lib/tableView";

function renderHeader(props: Partial<ColumnHeaderProps> = {}) {
  const onSort = vi.fn();
  const onCriterion = vi.fn();
  render(
    <Table>
      <TableHeader>
        <TableRow>
          <ColumnHeader meta={{ key: "amount", type: "number", sortable: true }} label="Montant" view={EMPTY_VIEW} onSort={onSort} onCriterion={onCriterion} {...props} />
        </TableRow>
      </TableHeader>
    </Table>,
  );
  return { onSort, onCriterion };
}

describe("ColumnHeader", () => {
  it("sorts in the direction chosen from its panel, additively with shift", async () => {
    const { onSort } = renderHeader({ view: { sort: [{ column: "amount", dir: "desc" }], criteria: {} } });
    const header = screen.getByRole("columnheader");
    expect(header).toHaveAttribute("aria-sort", "descending");
    const user = userEvent.setup();
    await user.click(within(header).getByRole("button", { name: "Montant" }));
    await user.click(await screen.findByRole("button", { name: "Croissant" }));
    expect(onSort).toHaveBeenLastCalledWith("asc", false);
    await user.click(within(header).getByRole("button", { name: "Montant" }));
    await user.keyboard("{Shift>}");
    await user.click(await screen.findByRole("button", { name: "Décroissant" }));
    await user.keyboard("{/Shift}");
    expect(onSort).toHaveBeenLastCalledWith("desc", true);
  });

  it("marks the direction in force and resets the sort, that one key only with shift", async () => {
    const { onSort } = renderHeader({ view: { sort: [{ column: "amount", dir: "desc" }], criteria: {} } });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Montant" }));
    expect(await screen.findByRole("button", { name: "Décroissant" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Croissant" })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: "Réinitialiser le tri" }));
    expect(onSort).toHaveBeenLastCalledWith(null, false);
    await user.click(screen.getByRole("button", { name: /^Montant/ }));
    await user.keyboard("{Shift>}");
    await user.click(await screen.findByRole("button", { name: "Réinitialiser le tri" }));
    await user.keyboard("{/Shift}");
    expect(onSort).toHaveBeenLastCalledWith(null, true);
  });

  it("closes its panel once a direction is chosen", async () => {
    renderHeader();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Montant/ }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Croissant" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows the double chevron of a sortable column that is not sorted", () => {
    renderHeader();
    // Permanently, in the layout: hiding it until hover would shrink the label under the cursor,
    // and the column widths are sized with it in place.
    const indicator = screen.getByTestId("sort-indicator");
    expect(indicator).toBeVisible();
    expect(indicator).not.toHaveClass("hidden");
  });

  it("gives a non-sortable column no indicator at all", () => {
    renderHeader({ meta: { key: "coverage", type: "enum", sortable: false }, label: "Couverture" });
    expect(screen.queryByTestId("sort-indicator")).not.toBeInTheDocument();
  });

  it("offers no reset while its column is not a sort key", async () => {
    renderHeader();
    await userEvent.setup().click(screen.getByRole("button", { name: "Montant" }));
    expect(await screen.findByRole("button", { name: "Croissant" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "Réinitialiser le tri" })).not.toBeInTheDocument();
  });

  it("numbers the keys of a multiple sort, aria-sort staying on the first key's header", () => {
    renderHeader({ view: { sort: [{ column: "name", dir: "asc" }, { column: "amount", dir: "asc" }], criteria: {} } });
    expect(screen.getByRole("columnheader")).not.toHaveAttribute("aria-sort");
    const trigger = screen.getByRole("button", { name: /^Montant/ });
    expect(trigger).toHaveAccessibleName("Montant Tri n°2");
    expect(trigger).not.toHaveAccessibleName("Montant2");
  });

  it("names the panel after its column", async () => {
    renderHeader();
    await userEvent.setup().click(screen.getByRole("button", { name: "Montant" }));
    expect(await screen.findByRole("dialog", { name: "Options de la colonne Montant" })).toBeInTheDocument();
  });

  it("gives a non-sortable column no sort row, only its filter", async () => {
    renderHeader({ meta: { key: "coverage", type: "enum", sortable: false }, label: "Couverture", facets: [{ value: "cash", label: "cash", count: 2 }] });
    await userEvent.setup().click(screen.getByRole("button", { name: "Couverture" }));
    expect(await screen.findByRole("checkbox", { name: /cash/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Croissant" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Décroissant" })).not.toBeInTheDocument();
  });

  it("passes a valid criterion on, keeps an invalid one to itself, and clears", async () => {
    const { onCriterion } = renderHeader();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Montant" }));
    const input = await screen.findByRole("textbox", { name: "Critère pour Montant" });
    await user.type(input, ">100");
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(onCriterion).toHaveBeenLastCalledWith(">100");
    await user.type(input, "x");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Nombre illisible");
    // The last valid criterion stays applied: nothing new reached the table.
    expect(onCriterion).toHaveBeenLastCalledWith(">100");
    await user.click(screen.getByRole("button", { name: "Effacer" }));
    expect(onCriterion).toHaveBeenLastCalledWith(null);
  });

  it("offers the present values of an enum column as checkboxes with their counts", async () => {
    const { onCriterion } = renderHeader({
      meta: { key: "kind", type: "enum", sortable: true },
      label: "Type",
      view: { sort: [], criteria: { kind: ["trade"] } },
      facets: [
        { value: "trade", label: "Trade", count: 3 },
        { value: "dividend", label: "Dividende", count: 0 },
        { value: null, label: null, count: 1 },
      ],
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Type" }));
    const trade = await screen.findByRole("checkbox", { name: /Trade/ });
    expect(trade).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /— \(vide\)/ })).not.toBeChecked();
    expect(screen.getByText("3")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /Dividende/ }));
    expect(onCriterion).toHaveBeenLastCalledWith(["trade", "dividend"]);
    await user.click(trade);
    expect(onCriterion).toHaveBeenLastCalledWith(null);
  });
});
