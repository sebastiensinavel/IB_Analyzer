import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActiveFilters } from "@/components/table/ActiveFilters";
import { EMPTY_VIEW, type ColumnSpec } from "@/lib/tableView";

interface Row {
  amount: number | null;
  kind: string | null;
}

const SPECS: ColumnSpec<Row>[] = [
  { key: "amount", type: "number", sortable: true, value: (row) => row.amount },
  { key: "kind", type: "enum", sortable: true, value: (row) => row.kind, label: (value) => (value === "trade" ? "Trade" : "Dividende") },
];
const LABELS: Record<string, string> = { amount: "P/L latent", kind: "Type" };

describe("ActiveFilters", () => {
  it("renders nothing without an active criterion", () => {
    const { container } = render(
      <ActiveFilters specs={SPECS} view={{ sort: [{ column: "amount", dir: "asc" }], criteria: { amount: ">abc" } }} columnLabel={(key) => LABELS[key]} onClearColumn={() => {}} onClearAll={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("summarizes each active column, clears one, and clears all", async () => {
    const onClearColumn = vi.fn();
    const onClearAll = vi.fn();
    render(
      <ActiveFilters
        specs={SPECS}
        view={{ ...EMPTY_VIEW, criteria: { amount: "<0", kind: ["trade", null] } }}
        columnLabel={(key) => LABELS[key]}
        onClearColumn={onClearColumn}
        onClearAll={onClearAll}
      />,
    );
    expect(screen.getByText("P/L latent : <0")).toBeInTheDocument();
    expect(screen.getByText("Type : Trade, —")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Retirer le filtre Type" }));
    expect(onClearColumn).toHaveBeenCalledWith("kind");
    await user.click(screen.getByRole("button", { name: "Tout effacer" }));
    expect(onClearAll).toHaveBeenCalled();
  });
});
