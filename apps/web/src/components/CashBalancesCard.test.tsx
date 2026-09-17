import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { anchoredBalances, type CashPoint, type Transaction } from "@ib/ledger";
import i18n from "@/i18n";
import { CashBalancesCard } from "@/components/CashBalancesCard";
import { POSITION_COLUMNS } from "@/lib/positionColumns";
import { BALANCE_CURRENCIES } from "@/lib/currencies";
import { SAMPLE_TRANSACTIONS } from "@/mocks/ledger";

function renderCard(transactions: Transaction[], points: CashPoint[]) {
  const { rows, checks } = anchoredBalances(transactions, BALANCE_CURRENCIES, points);
  return render(
    <I18nextProvider i18n={i18n}>
      <CashBalancesCard rows={rows} checks={checks} />
    </I18nextProvider>,
  );
}

/** The cells of the row whose Position reads `currency`: Position, then market value. */
function cellsOf(currency: string): HTMLElement[] {
  return within(screen.getByText(currency).closest("tr") as HTMLTableRowElement).getAllByRole("cell");
}

// SAMPLE_TRANSACTIONS: USD -1,101.00 on 2026-08-20, then MSFT and AAPL after; EUR +10,000 only.
const USD_END: CashPoint = { currency: "USD", kind: "end", asOf: "2026-08-25", amount: 5000 };

describe("CashBalancesCard", () => {
  it("lays the currencies out like the positions, under Position and Market value", () => {
    renderCard(SAMPLE_TRANSACTIONS, [USD_END]);
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Position", "Valeur de marché"]);
    expect(screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0].textContent)).toEqual([...BALANCE_CURRENCIES]);
  });

  it("lines its columns up with the position tables: same widths, the amount under Market value", () => {
    renderCard(SAMPLE_TRANSACTIONS, [USD_END]);
    const table = screen.getByRole("table");
    expect([...table.querySelectorAll("col")].map((col) => col.style.width)).toEqual(POSITION_COLUMNS.map((column) => column.width));
    const marketValue = POSITION_COLUMNS.findIndex((column) => column.key === "marketValue");
    expect((screen.getByText("Valeur de marché").closest("th") as HTMLTableCellElement).cellIndex).toBe(marketValue);
    expect((cellsOf("USD")[1] as HTMLTableCellElement).cellIndex).toBe(marketValue);
  });

  it("shows the latest anchored balance, which carries the rows after the Cash Report", () => {
    renderCard(SAMPLE_TRANSACTIONS, [USD_END]);
    // 5,000 on 2026-08-25, then MSFT +609.35 and AAPL -18,051.50.
    expect(cellsOf("USD")[1]).toHaveTextContent(/^-12,442\.15$/);
  });

  it("says what a balance is anchored on in a tooltip on its currency, never inline", async () => {
    renderCard(SAMPLE_TRANSACTIONS, [USD_END]);
    expect(screen.queryByText("calé sur le Cash Report du 2026-08-25")).not.toBeInTheDocument();
    await userEvent.setup().hover(screen.getByText("USD"));
    expect(await screen.findByText("calé sur le Cash Report du 2026-08-25", {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it("shows the raw balance of a currency no Cash Report anchors, and says in its tooltip that it starts from 0", async () => {
    renderCard(SAMPLE_TRANSACTIONS, [USD_END]);
    expect(cellsOf("EUR")[1]).toHaveTextContent(/^10,000\.00$/);
    await userEvent.setup().hover(screen.getByText("EUR"));
    expect(await screen.findByText("aucun Cash Report, le solde part de 0", {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it("shows the Ending Cash itself when the ledger is empty", () => {
    renderCard([], [USD_END]);
    expect(cellsOf("USD")[1]).toHaveTextContent(/^5,000\.00$/);
  });

  it("shows a dash, never a zero, and no tooltip, with neither a transaction nor a Cash Report", () => {
    renderCard([], []);
    for (const currency of BALANCE_CURRENCIES) {
      const [position, value] = cellsOf(currency);
      expect(value).toHaveTextContent(/^—$/);
      expect(position.querySelector("[data-slot=tooltip-trigger]")).toBeNull();
    }
  });

  it("carries its title", () => {
    renderCard([], []);
    expect(screen.getByLabelText("Cash")).toHaveTextContent(/^Cash/);
  });
});
