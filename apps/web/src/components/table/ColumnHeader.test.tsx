import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Table, TableHeader, TableRow } from "@ib/ui/table";
import { ColumnHeader, type ColumnHeaderProps } from "@/components/table/ColumnHeader";
import { EMPTY_VIEW, type Criterion, type TableView } from "@/lib/tableView";

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

/** A header wired to real state, as a page would. */
function Stateful({ initial }: { initial: TableView }) {
  const [view, setView] = useState(initial);
  const onCriterion = (criterion: Criterion | null) =>
    setView((previous): TableView => ({ ...previous, criteria: criterion === null ? {} : { amount: criterion } }));
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <ColumnHeader meta={{ key: "amount", type: "number", sortable: true }} label="Montant" view={view} onSort={() => {}} onCriterion={onCriterion} />
        </TableRow>
      </TableHeader>
    </Table>
  );
}

describe("ColumnHeader", () => {
  it("sorts on a click, additively with shift, and says the direction", async () => {
    const { onSort } = renderHeader({ view: { sort: [{ column: "amount", dir: "desc" }], criteria: {} } });
    const header = screen.getByRole("columnheader");
    expect(header).toHaveAttribute("aria-sort", "descending");
    const user = userEvent.setup();
    await user.click(within(header).getByRole("button", { name: "Montant" }));
    expect(onSort).toHaveBeenLastCalledWith(false);
    await user.keyboard("{Shift>}");
    await user.click(within(header).getByRole("button", { name: "Montant" }));
    await user.keyboard("{/Shift}");
    expect(onSort).toHaveBeenLastCalledWith(true);
  });

  it("numbers the keys of a multiple sort, aria-sort staying on the first key's header", () => {
    renderHeader({ view: { sort: [{ column: "name", dir: "asc" }, { column: "amount", dir: "asc" }], criteria: {} } });
    expect(screen.getByRole("columnheader")).not.toHaveAttribute("aria-sort");
    const sort = screen.getByRole("button", { name: /^Montant/ });
    expect(sort).toHaveAccessibleName("Montant Tri n°2");
    expect(sort).not.toHaveAccessibleName("Montant2");
  });

  it("keeps the filter trigger in the accessibility tree while its column is not filtered", () => {
    renderHeader();
    const trigger = screen.getByRole("button", { name: "Filtrer Montant" });
    expect(trigger).toHaveAttribute("data-active", "false");
    expect(trigger).toBeVisible();
    // Faded out until hover or focus, never removed: `invisible` or `hidden` would take it out of the tab order.
    expect(trigger.className).not.toMatch(/(^|\s)(invisible|hidden)(\s|$)/);
  });

  it("names the filter popover after its column", async () => {
    renderHeader();
    await userEvent.setup().click(screen.getByRole("button", { name: "Filtrer Montant" }));
    expect(await screen.findByRole("dialog", { name: "Filtrer Montant" })).toBeInTheDocument();
  });

  it("has no sort button on a non-sortable column, only its filter", () => {
    renderHeader({ meta: { key: "coverage", type: "enum", sortable: false }, label: "Couverture" });
    expect(screen.queryByRole("button", { name: "Couverture" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filtrer Couverture" })).toBeInTheDocument();
  });

  it("passes a valid criterion on, shows an invalid one in red without passing it, and clears", async () => {
    render(<Stateful initial={EMPTY_VIEW} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Filtrer Montant" }));
    const input = await screen.findByRole("textbox", { name: "Critère pour Montant" });
    await user.type(input, ">abc");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Nombre illisible");
    expect(screen.getByRole("button", { name: "Filtrer Montant" })).toHaveAttribute("data-active", "false");
    await user.clear(input);
    await user.type(input, ">100");
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(screen.getByRole("button", { name: "Filtrer Montant" })).toHaveAttribute("data-active", "true");
    await user.click(screen.getByRole("button", { name: "Effacer" }));
    expect(screen.getByRole("button", { name: "Filtrer Montant" })).toHaveAttribute("data-active", "false");
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
    await user.click(screen.getByRole("button", { name: "Filtrer Type" }));
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
