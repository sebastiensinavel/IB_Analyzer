import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import statementHtml from "../../../../packages/ib-parsers/tests/fixtures/activity_statement_sample.htm?raw";
import i18n from "@/i18n";
import { db, type AccountRecord } from "@/db/schema";
import { importFile } from "@/db/importFile";
import { PositionsPage } from "@/pages/PositionsPage";
import { WithAccountData } from "@/test/WithAccountData";
import { SAMPLE_TRANSACTIONS } from "@/mocks/ledger";
import { SAMPLE_POSITIONS, SAMPLE_SECTORS, SAMPLE_SNAPSHOT } from "@/mocks/positions";

function renderPositions(accountId = "alpha") {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[`/accounts/${accountId}/positions`]}>
        <Routes>
          <Route
            path="/accounts/:accountId/positions"
            element={
              <WithAccountData>
                <PositionsPage />
              </WithAccountData>
            }
          />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(async () => {
  window.localStorage.clear();
  await Promise.all([db.snapshots.clear(), db.sectors.clear(), db.transactions.clear(), db.cashPoints.clear()]);
});

/** SAMPLE_TRANSACTIONS end on USD -18,543.15 raw and EUR 10,000; the end point moves USD to 1,456.85. */
async function seedCash() {
  await db.transactions.bulkAdd(SAMPLE_TRANSACTIONS);
  await db.cashPoints.put({ accountId: "alpha", currency: "USD", kind: "end", asOf: "2026-12-31", amount: 1456.85, source: "flex", importedAt: "" });
}

async function rowFor(description: string): Promise<HTMLTableRowElement> {
  return (await screen.findByText(description)).closest("tr") as HTMLTableRowElement;
}

/** Opens a column's panel in one card: it holds that column's sort actions and its filter. */
async function openPanel(user: ReturnType<typeof userEvent.setup>, card: HTMLElement, column: string) {
  const header = within(card).getByRole("columnheader", { name: new RegExp(`^${column}`) });
  await user.click(within(header).getByRole("button", { name: new RegExp(`^${column}`) }));
}

// The shared i18n singleton defaults to French: page strings are asserted in
// French. Badge internals (keep, buy back, cash ×2) are not translated.
describe("PositionsPage", () => {
  it("renders the short put under Option sells with its decision and coverage badges", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    const row = await rowFor("XOM Mar20'26 100 Put");
    expect(screen.getByText("Ventes d'options")).toBeInTheDocument();
    expect(within(row).getByText("buy back")).toBeInTheDocument();
    expect(within(row).getByText("cash ×2")).toBeInTheDocument();
  });

  it("shows the uncovered contract, the stock cover and the LEAPS cover", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    expect(within(await rowFor("AAPL Feb20'26 155 Call")).getByText("UNCOVERED ×1")).toBeInTheDocument();
    expect(within(await rowFor("AAPL")).getByText("used 200/200")).toBeInTheDocument();
    expect(within(await rowFor("MSFT Mar20'26 400 Call")).getByText("leaps ×1")).toBeInTheDocument();
  });

  it("joins the sector table on the symbol and leaves unknown tickers blank", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    await db.sectors.bulkPut(SAMPLE_SECTORS);
    renderPositions();
    expect(within(await rowFor("XOM Mar20'26 100 Put")).getByText("Energy")).toBeInTheDocument();
    expect(within(await rowFor("XYZ Mar20'26 105 Call")).queryByText(/Tech|Energy/)).not.toBeInTheDocument();
  });

  it("leaves the snapshot date to the title bar", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    await screen.findByText("XOM Mar20'26 100 Put");
    // The badge would come from its own live query: give it time to answer before asserting absence.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByText("Données du 2026-09-02")).not.toBeInTheDocument();
  });

  it("does not render a group with no positions in it", async () => {
    await db.snapshots.put({ ...SAMPLE_SNAPSHOT, positions: [SAMPLE_POSITIONS[5]] });
    renderPositions();
    await screen.findByText("XOM Mar20'26 100 Put");
    expect(screen.queryByText("Positions longues")).not.toBeInTheDocument();
    expect(screen.queryByText("Achats d'options")).not.toBeInTheDocument();
  });

  it("searches every card on the ticker, with OR, and says when nothing matches", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    await screen.findByText("XOM Mar20'26 100 Put");
    const user = userEvent.setup();
    const input = screen.getByRole("textbox", { name: "Rechercher un ticker" });
    await user.type(input, "=MSFT|=XOM");
    await waitFor(() => expect(screen.queryByText("AAPL Jan16'26 150 Call")).not.toBeInTheDocument());
    expect(screen.getByText("MSFT Mar20'26 400 Call")).toBeInTheDocument();
    expect(screen.getByText("XOM Mar20'26 100 Put")).toBeInTheDocument();
    // AAPL shares were the only long position: the card goes with them.
    expect(screen.queryByText("Positions longues")).not.toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "=NOPE");
    expect(await screen.findByText("Aucune position ne correspond.")).toBeInTheDocument();
  });

  it("spells a contract like the journals do", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    expect(await screen.findByText("AAPL Jan16'26 150 Call")).toBeInTheDocument();
  });

  it("filters one card on its own column, leaving the other cards alone", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    const sells = (await screen.findByText("Ventes d'options")).closest("[data-slot=card]") as HTMLElement;
    const user = userEvent.setup();
    await openPanel(user, sells, "P&L latent");
    await user.type(await screen.findByRole("textbox", { name: "Critère pour P&L latent" }), "<0");
    await waitFor(() => expect(within(sells).queryByText("XOM Mar20'26 100 Put")).not.toBeInTheDocument());
    expect(within(sells).getByText("AAPL Feb20'26 155 Call")).toBeInTheDocument();
    expect(screen.getByText("MSFT Jan21'28 300 Call")).toBeInTheDocument();
    expect(within(sells).getByText("P&L latent : <0")).toBeInTheDocument();
  });

  it("keeps a card emptied by its own filter, with its headers and a way back", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    const longs = (await screen.findByText("Positions longues")).closest("[data-slot=card]") as HTMLElement;
    const user = userEvent.setup();
    await openPanel(user, longs, "Qté");
    await user.type(await screen.findByRole("textbox", { name: "Critère pour Qté" }), ">1000");
    expect(await within(longs).findByText("Aucune position ne correspond.")).toBeInTheDocument();
    expect(within(longs).getByRole("columnheader", { name: /^Qté/ })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(within(longs).getByRole("button", { name: "Tout effacer" }));
    expect(await within(longs).findByText("AAPL")).toBeInTheDocument();
  });

  it("sorts a card on unrealized P/L, unknown values last", async () => {
    await db.snapshots.put({ ...SAMPLE_SNAPSHOT, positions: [...SAMPLE_POSITIONS.slice(0, 5), { ...SAMPLE_POSITIONS[5], unrealizedPnl: null }, ...SAMPLE_POSITIONS.slice(6)] });
    renderPositions();
    const sells = (await screen.findByText("Ventes d'options")).closest("[data-slot=card]") as HTMLElement;
    const user = userEvent.setup();
    await openPanel(user, sells, "P&L latent");
    await user.click(await screen.findByRole("button", { name: "Croissant" }));
    const order = () => within(sells).getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0].textContent);
    // Sells' P&L: AAPL 155 C -20, MSFT 400 C -10, XYZ 105 C 50, XYZ 95 P 100, AAPL 150 C 120, XOM unknown.
    await waitFor(() =>
      expect(order()).toEqual(["AAPL Feb20'26 155 Call", "MSFT Mar20'26 400 Call", "XYZ Mar20'26 105 Call", "XYZ Mar20'26 95 Put", "AAPL Jan16'26 150 Call", "XOM Mar20'26 100 Put"]),
    );
    await openPanel(user, sells, "P&L latent");
    await user.click(await screen.findByRole("button", { name: "Décroissant" }));
    await waitFor(() =>
      expect(order()).toEqual(["AAPL Jan16'26 150 Call", "XYZ Mar20'26 95 Put", "XYZ Mar20'26 105 Call", "MSFT Mar20'26 400 Call", "AAPL Feb20'26 155 Call", "XOM Mar20'26 100 Put"]),
    );
  });

  it("filters the coverage on UNCOVERED", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    const sells = (await screen.findByText("Ventes d'options")).closest("[data-slot=card]") as HTMLElement;
    const user = userEvent.setup();
    await openPanel(user, sells, "Couverture");
    await user.click(await screen.findByRole("checkbox", { name: /UNCOVERED/ }));
    await waitFor(() => expect(within(sells).getAllByRole("row")).toHaveLength(2));
    expect(within(sells).getByText("AAPL Feb20'26 155 Call")).toBeInTheDocument();
  });

  it("gives the cash card no interactive header", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    await seedCash();
    renderPositions();
    const cash = (await screen.findByText("Cash", { selector: "[data-slot=card-title]" })).closest("[data-slot=card]") as HTMLElement;
    expect(within(within(cash).getAllByRole("row")[0]).queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a dash, never a zero, for an unknown market value", async () => {
    await db.snapshots.put({ ...SAMPLE_SNAPSHOT, positions: [{ ...SAMPLE_POSITIONS[0], marketValue: null }] });
    renderPositions();
    const cells = within(await rowFor("AAPL")).getAllByRole("cell");
    expect(cells[3]).toHaveTextContent("—");
  });

  it("shows the empty state with a link to the data sources when the account has no snapshot", async () => {
    await db.snapshots.put({ ...SAMPLE_SNAPSHOT, accountId: "beta" });
    renderPositions("alpha");
    expect(await screen.findByText("Aucune position — importez un relevé HTML ou une réponse de Flex Query avec Open Positions.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Aller aux sources de données" })).toHaveAttribute("href", "/accounts/alpha/sources");
    expect(screen.queryByText("XOM Mar20'26 100 Put")).not.toBeInTheDocument();
  });

  it("shows the cash of each currency below the positions, on the History's anchored balance", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    await seedCash();
    renderPositions();
    const card = await screen.findByLabelText("Cash");
    expect(await within(card).findByText("1,456.85")).toBeInTheDocument();
    const eur = within(card).getByText("EUR").closest("tr") as HTMLTableRowElement;
    expect(within(eur).getAllByRole("cell")[1]).toHaveTextContent(/^10,000\.00$/);
    // Below the last group of positions.
    const lastGroup = screen.getByText("Ventes d'options");
    expect(lastGroup.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("lines up the columns of every table on the page, the cash included", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    await seedCash();
    renderPositions();
    await within(await screen.findByLabelText("Cash")).findByText("1,456.85");
    const tables = screen.getAllByRole("table");
    // Long positions, option buys, option sells, cash.
    expect(tables).toHaveLength(4);
    const widths = (table: HTMLElement) => [...table.querySelectorAll("col")].map((col) => col.style.width);
    for (const table of tables) {
      expect(widths(table)).toHaveLength(10);
      expect(widths(table)).toEqual(widths(tables[0]));
      expect((within(table).getByText("Valeur de marché").closest("th") as HTMLTableCellElement).cellIndex).toBe(3);
    }
  });

  it("shows the cash even when the account has no snapshot", async () => {
    await seedCash();
    renderPositions();
    await screen.findByText("Aucune position — importez un relevé HTML ou une réponse de Flex Query avec Open Positions.");
    expect(await within(screen.getByLabelText("Cash")).findByText("1,456.85")).toBeInTheDocument();
  });

  it("renders a snapshot read from a statement, dated by its period's end", async () => {
    await Promise.all([
      db.accounts.clear(),
      db.transactions.clear(),
      db.imports.clear(),
      db.snapshots.clear(),
      db.sectors.clear(),
      db.statements.clear(),
      db.contracts.clear(),
      db.cashPoints.clear(),
    ]);
    const account: AccountRecord = { id: "alpha", label: "alpha", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [] };
    await db.accounts.put(account);
    await importFile(db, account, new File([statementHtml], "2025.htm", { type: "text/plain" }));
    // The date badge itself lives in the title bar (AppLayout.test.tsx, SnapshotStatus.test.tsx).
    expect((await db.snapshots.get("alpha"))?.asOf).toBe("2025-12-31");
    renderPositions();
    expect(await rowFor("TWINX")).toBeInTheDocument();
    expect(await rowFor("TESTX Jan16'26 15 Put")).toBeInTheDocument();
  });
});
