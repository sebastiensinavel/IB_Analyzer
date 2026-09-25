import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import i18n from "@/i18n";
import { ACTIVABLE_STRATEGIES } from "@ib/ledger";
import { db } from "@/db/schema";
import { DashboardPage } from "@/pages/DashboardPage";
import { WithAccountData } from "@/test/WithAccountData";
import { SAMPLE_SNAPSHOT } from "@/mocks/positions";
import { SAMPLE_JOURNAL_SNAPSHOT, SAMPLE_JOURNAL_TRANSACTIONS } from "@/mocks/journals";

function renderDashboard(accountId = "alpha") {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[`/accounts/${accountId}/dashboard`]}>
        <Routes>
          <Route
            path="/accounts/:accountId/dashboard"
            element={
              <WithAccountData>
                <DashboardPage />
              </WithAccountData>
            }
          />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(async () => {
  await Promise.all([db.transactions.clear(), db.snapshots.clear(), db.sectors.clear(), db.imports.clear()]);
  // Every strategy on: these tests read the LEAPS and the condors (the default is the Wheel alone).
  await db.accounts.put({ id: "alpha", label: "alpha", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [], strategies: [...ACTIVABLE_STRATEGIES] });
  await db.accounts.put({ id: "beta", label: "beta", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [], strategies: [...ACTIVABLE_STRATEGIES] });
});

function tileValue(card: HTMLElement, label: string): HTMLElement {
  const tile = within(card).getByText(label).parentElement as HTMLElement;
  return tile.lastElementChild as HTMLElement;
}

/** The card titled « Profit/Perte total », once the page has rendered it. */
async function findTotalCard(): Promise<HTMLElement> {
  const card = (await screen.findByText("Profit/Perte total")).closest("[data-slot=card]");
  if (!(card instanceof HTMLElement)) throw new Error("« Profit/Perte total » is not the title of a card");
  return card;
}

const sector = (ticker: string, category: string, score: number | null, status = "on") => ({
  ticker, name: "", category, score, status, updatedAt: "2026-09-03T08:00:00.000Z",
});

/** The rows of the suggestion card, header excluded, as the text of their cells. */
async function suggestionRows(): Promise<string[][]> {
  const card = await screen.findByLabelText("Suggestion de Position");
  // The card shows its own loading text while the sector table's live query is still answering.
  await waitFor(() => expect(within(card).queryByText("Chargement…")).not.toBeInTheDocument());
  return within(card)
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent ?? ""));
}

describe("DashboardPage", () => {
  it("shows the cash in portfolio, the cash required (puts + condors) and what is left available, covered", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderDashboard();
    const card = await screen.findByLabelText("Couverture en Cash");
    expect(tileValue(card, "Cash en portefeuille")).toHaveTextContent("$42,000.00");
    expect(tileValue(card, "Cash requis")).toHaveTextContent("$20,500.00");
    expect(tileValue(card, "Cash disponible")).toHaveTextContent("$21,500.00");
    expect(tileValue(card, "Cash disponible")).not.toHaveClass("text-destructive");
    expect(within(card).getByText("Couvert")).toBeInTheDocument();
    expect(within(card).getByTestId("cash-gauge")).toBeInTheDocument();
  });

  it("says when the cash is short, with a negative cash available in red", async () => {
    await db.snapshots.put({ ...SAMPLE_SNAPSHOT, cashAvailable: 1000 });
    renderDashboard();
    const card = await screen.findByLabelText("Couverture en Cash");
    expect(within(card).getByText("Cash insuffisant")).toBeInTheDocument();
    expect(tileValue(card, "Cash disponible")).toHaveTextContent("-$19,500.00");
    expect(tileValue(card, "Cash disponible")).toHaveClass("text-destructive");
  });

  it("gives no verdict, no gauge and no cash available when the cash is unknown", async () => {
    await db.snapshots.put({ ...SAMPLE_SNAPSHOT, cashAvailable: null });
    renderDashboard();
    const card = await screen.findByLabelText("Couverture en Cash");
    expect(within(card).getByText("Cash inconnu")).toBeInTheDocument();
    expect(tileValue(card, "Cash en portefeuille")).toHaveTextContent("—");
    expect(tileValue(card, "Cash requis")).toHaveTextContent("$20,500.00");
    expect(tileValue(card, "Cash disponible")).toHaveTextContent("—");
    expect(within(card).queryByTestId("cash-gauge")).not.toBeInTheDocument();
  });

  it("shows the empty state with a link to the data sources without a snapshot", async () => {
    await db.imports.add({
      accountId: "alpha",
      source: "statement_html",
      at: "2026-09-01T10:00:00.000Z",
      fileName: "x.htm",
      period: null,
      imported: 0,
      skipped: 0,
      dropped: [],
      issues: [],
    });
    renderDashboard();
    expect(await screen.findByText("Aucune position — importez un relevé HTML ou une réponse de Flex Query avec Open Positions.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Aller aux sources de données" })).toHaveAttribute("href", "/accounts/alpha/sources");
    expect(screen.queryByText("Profit/Perte total")).not.toBeInTheDocument();
    expect(screen.queryByTestId("capital-chart")).not.toBeInTheDocument();
  });

  it("leaves the uncovered positions to the Consistency page", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderDashboard();
    await screen.findByLabelText("Couverture en Cash");
    expect(screen.queryByLabelText("Positions non couvertes")).not.toBeInTheDocument();
    expect(screen.queryByText("AAPL Feb20'26 155 Call")).not.toBeInTheDocument();
  });

  it("totals the three strategies in a card above the cash card, the Wheel's 140, the LEAPS' 49 and the condor's 46", async () => {
    await db.transactions.bulkAdd(SAMPLE_JOURNAL_TRANSACTIONS);
    await db.snapshots.put(SAMPLE_JOURNAL_SNAPSHOT);
    renderDashboard("beta");
    const total = await findTotalCard();
    expect(within(total).getByText("235.00 USD")).toHaveClass("text-success");
    // One column on the left: the total, then the cash card; the exposure stands beside them.
    const cash = screen.getByLabelText("Couverture en Cash");
    expect(total.parentElement).toBe(cash.parentElement);
    expect(total.compareDocumentPosition(cash) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const exposure = screen.getByText("Exposition par secteur").closest("[data-slot=card]") as HTMLElement;
    expect(total.parentElement).not.toContainElement(exposure);
    // The total lives in its card only, never repeated at the top right.
    expect(screen.getAllByText("235.00 USD")).toHaveLength(1);
    expect(screen.queryByLabelText("Devise")).not.toBeInTheDocument();
  });

  it("draws the money of every strategy at once: monthly bars, exposure, capital and return", async () => {
    await db.transactions.bulkAdd(SAMPLE_JOURNAL_TRANSACTIONS);
    await db.snapshots.put(SAMPLE_JOURNAL_SNAPSHOT);
    renderDashboard("beta");
    expect(await screen.findByLabelText("Couverture en Cash")).toBeInTheDocument();
    expect(screen.getByTestId("monthly-chart")).toBeInTheDocument();
    const card = screen.getByText("Exposition par secteur").closest("[data-slot=card]") as HTMLElement;
    // The dashboard's legend table names each sector and its share, never an amount.
    expect(within(card).getByTestId("exposure-chart")).toBeInTheDocument();
    const table = within(card).getByTestId("exposure-table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Secteur", "Part"]);
    expect(within(table).getAllByRole("row").length).toBeGreaterThan(1);
    expect(screen.getByText("Capital de toutes les stratégies")).toBeInTheDocument();
    expect(screen.getByTestId("capital-chart")).toBeInTheDocument();
    expect(screen.getByTestId("return-chart")).toBeInTheDocument();
  });

  it("offers a currency switch when the strategies span several, EUR first, the cash card still in USD", async () => {
    await db.transactions.bulkAdd([
      ...SAMPLE_JOURNAL_TRANSACTIONS,
      { ...SAMPLE_JOURNAL_TRANSACTIONS[0], externalId: "flex:trade:201", symbol: "SAP   261002P00017000", currency: "EUR", amount: 30 },
    ]);
    await db.snapshots.put(SAMPLE_JOURNAL_SNAPSHOT);
    renderDashboard("beta");
    expect(await screen.findByLabelText("Devise")).toBeInTheDocument();
    expect(within(await findTotalCard()).getByText("29.00 EUR")).toBeInTheDocument();
    expect(tileValue(screen.getByLabelText("Couverture en Cash"), "Cash en portefeuille")).toHaveTextContent("$12,000.00");
  });

  it("keeps the journal cards without a snapshot, the total above the empty message that replaces the cash card", async () => {
    await db.transactions.bulkAdd(SAMPLE_JOURNAL_TRANSACTIONS);
    renderDashboard("beta");
    const total = await findTotalCard();
    expect(within(total).getByText("235.00 USD")).toBeInTheDocument();
    const empty = screen.getByText("Aucune position — importez un relevé HTML ou une réponse de Flex Query avec Open Positions.");
    expect(total.parentElement).toContainElement(empty);
    expect(total.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("link", { name: "Aller aux sources de données" })).toHaveAttribute("href", "/accounts/beta/sources");
    expect(screen.queryByLabelText("Couverture en Cash")).not.toBeInTheDocument();
    expect(screen.getByTestId("capital-chart")).toBeInTheDocument();
  });

  it("suggests the least exposed sectors first, the best score next, with the share of risk already exposed", async () => {
    // SAMPLE_SNAPSHOT weighs 61,095 of risk: AAPL 30,700 and XOM 20,000 are over 5%, so never suggested.
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    await db.sectors.bulkPut([
      sector("AAPL", "Tech", 9), sector("NVDA", "Tech", 8), sector("XOM", "Energy", 9), sector("CVX", "Energy", 7),
      sector("KO", "Staples", 6), sector("PEP", "Staples", 5.5), sector("T", "Telecom", 9, "off"),
    ]);
    renderDashboard();
    expect(await suggestionRows()).toEqual([
      ["1", "KO", "Staples", "6", "0.0%", "0.0%"],
      ["2", "CVX", "Energy", "7", "32.7%", "0.0%"],
      ["3", "NVDA", "Tech", "8", "50.2%", "0.0%"],
    ]);
  });

  it("still suggests without a snapshot, every share at 0", async () => {
    await db.sectors.bulkPut([sector("KO", "Staples", 6), sector("CVX", "Energy", 7)]);
    renderDashboard();
    expect(await suggestionRows()).toEqual([
      ["1", "CVX", "Energy", "7", "0.0%", "0.0%"],
      ["2", "KO", "Staples", "6", "0.0%", "0.0%"],
    ]);
  });

  it("says why nothing is suggested, with a link to the sector table", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    // One scored row, too low to be suggested: the card has a table to speak about, so it
    // renders and explains itself. Without any score at all it would not render — see below.
    await db.sectors.put(sector("KO", "Staples", 3));
    renderDashboard();
    const card = await screen.findByLabelText("Suggestion de Position");
    expect(await within(card).findByText("Aucune suggestion : aucune ligne de la table sectorielle ne remplit les critères.")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Aller à Secteur et Score" })).toHaveAttribute("href", "/accounts/alpha/sectors");
  });

  // Decided 2026-09-22: on an account whose sector table has not been scored yet, the card has
  // nothing to rank and would only compete with the page's own instruction.
  it("hides the suggestion card entirely while no ticker has been scored", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderDashboard();
    await screen.findByLabelText("Couverture en Cash");
    expect(screen.queryByLabelText("Suggestion de Position")).not.toBeInTheDocument();
  });

  it("brings the card back as soon as one ticker carries a score", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    await db.sectors.put(sector("KO", "Staples", 3));
    renderDashboard();
    expect(await screen.findByLabelText("Suggestion de Position")).toBeInTheDocument();
  });

  // A row whose score was cleared is not a scored row: the column is nullable and « — » means
  // absent, never zero (repo rule).
  it("treats a row with no score as no score at all", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    await db.sectors.put(sector("KO", "Staples", null));
    renderDashboard();
    await screen.findByLabelText("Couverture en Cash");
    expect(screen.queryByLabelText("Suggestion de Position")).not.toBeInTheDocument();
  });
});

describe("DashboardPage: a brand new account", () => {
  beforeEach(async () => {
    await db.accounts.clear();
    await db.accounts.add({ id: "neuf", label: "Neuf", ibAccountId: "U0000009", createdAt: "", warnedDroppedKinds: [] });
  });

  it("shows the first step instead of an empty page", async () => {
    renderDashboard("neuf");
    expect(await screen.findByText("Première étape")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Aller aux sources de données" })).toHaveAttribute(
      "href",
      "/accounts/neuf/sources",
    );
    expect(screen.queryByText(/Aucune position —/)).not.toBeInTheDocument();
  });

  it("goes back to « Aucune position » once an import happened without a snapshot", async () => {
    await db.imports.add({
      accountId: "neuf",
      source: "statement_html",
      at: "2026-09-01T10:00:00.000Z",
      fileName: "x.htm",
      period: null,
      imported: 0,
      skipped: 0,
      dropped: [],
      issues: [],
    });
    renderDashboard("neuf");
    expect(await screen.findByText(/Aucune position —/)).toBeInTheDocument();
    expect(screen.queryByText("Première étape")).not.toBeInTheDocument();
  });
});
