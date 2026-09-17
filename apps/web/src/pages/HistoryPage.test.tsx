import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import type { Transaction } from "@ib/ledger";
import i18n from "@/i18n";
import { refreshPresence, resetAgentState } from "@/agent/useAgentSync";
import { db } from "@/db/schema";
import { HISTORY_COLUMNS, HISTORY_ROW_HEIGHT } from "@/lib/historyColumns";
import { HistoryPage } from "@/pages/HistoryPage";
import { SAMPLE_DEPOSIT, SAMPLE_TRANSACTIONS } from "@/mocks/ledger";

function renderHistory(accountId = "alpha") {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[`/accounts/${accountId}/history`]}>
        <Routes>
          <Route path="/accounts/:accountId/history" element={<HistoryPage />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

// Column order: date, type, symbol, quantity, price, total price, fee, cash,
// currency, USD cash, EUR cash.
const CASH_CELL = 7;
const CURRENCY_CELL = 8;
const USD_CASH_CELL = 9;
const EUR_CASH_CELL = 10;

async function rowFor(text: string | RegExp): Promise<HTMLTableRowElement> {
  const cell = await screen.findByText(text);
  return cell.closest("tr") as HTMLTableRowElement;
}

// Spacer rows are aria-hidden, so getAllByRole leaves them out: header row, then data rows.
function rowSymbols(): string[] {
  return screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[2].textContent ?? "");
}

function scroller(): HTMLElement {
  return screen.getByRole("region", { name: "Historique" });
}

/**
 * `${prefix}0` is the oldest row, `${prefix}{count-1}` the newest: one a day from 2024-01-01.
 * A distinct `accountId`/`prefix` lets a test seed two accounts without their rows colliding.
 */
function manyRows(count: number, accountId = "alpha", prefix = "SYM"): Transaction[] {
  return Array.from({ length: count }, (_, i) => ({
    ...SAMPLE_TRANSACTIONS[0],
    accountId,
    externalId: `flex:trade:${1000 + i}`,
    symbol: `${prefix}${i}`,
    when: new Date(Date.UTC(2024, 0, 1 + i, 12)).toISOString(),
  }));
}

beforeEach(async () => {
  await Promise.all([db.transactions.clear(), db.accounts.clear(), db.cashPoints.clear()]);
  // jsdom lays nothing out: every element measures 0, and a virtualizer over a 0 px viewport
  // renders no row. @tanstack/virtual-core reads offsetWidth/offsetHeight (its getRect) and does
  // without ResizeObserver, which jsdom lacks: an 800 px viewport is all it needs.
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1280);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function seed(rows: Transaction[] = SAMPLE_TRANSACTIONS) {
  await db.transactions.bulkAdd(rows);
}

// The shared `@/i18n` singleton defaults to French: page strings are asserted in French.
describe("HistoryPage", () => {
  it("has no Refresh button of its own, even with the agent there: it lives in the title bar", async () => {
    resetAgentState();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ version: "0.1.0" }), { status: 200 }));
    await refreshPresence();
    await db.accounts.put({ id: "alpha", label: "alpha", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [], twsPort: 7502 });
    await seed();
    renderHistory();
    await screen.findAllByRole("row");
    // The button would wait on the account's own live query: give it time to answer before asserting absence.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByRole("button", { name: "Actualiser" })).not.toBeInTheDocument();
  });

  it("renders every transaction of the account as a row, newest first", async () => {
    await seed();
    renderHistory();
    expect(await screen.findByText("AAPL")).toBeInTheDocument();
    expect(rowSymbols()).toEqual(["AAPL", "MSFT", "TSLA", "ELECTRONIC FUND TRANSFER"]);
  });

  it("spells an option like the journals do, out of Flex's packed OCC symbol", async () => {
    await seed([
      { ...SAMPLE_TRANSACTIONS[0], symbol: "OQZA  261016C00012000", secType: "OPT", right: "C", strike: 12, expiry: "2026-10-16" },
    ]);
    renderHistory();
    expect(await screen.findByText("OQZA Oct16'26 12 Call")).toBeInTheDocument();
  });

  it("never shows another account's rows", async () => {
    await seed([{ ...SAMPLE_TRANSACTIONS[0], accountId: "beta" }]);
    renderHistory("alpha");
    expect(await screen.findByText("Aucune transaction ne correspond.")).toBeInTheDocument();
  });

  it("shows the cash impact and its currency, without a hardcoded dollar sign", async () => {
    await seed();
    renderHistory();
    const cells = within(await rowFor("AAPL")).getAllByRole("cell");
    expect(cells[CASH_CELL]).toHaveTextContent("-18,051.50");
    expect(cells[CASH_CELL]).not.toHaveTextContent("$");
    expect(cells[CURRENCY_CELL]).toHaveTextContent("USD");
  });

  it("computes the running balances over the whole ledger and carries both currencies on every row", async () => {
    await seed();
    renderHistory();
    const deposit = within(await rowFor("ELECTRONIC FUND TRANSFER")).getAllByRole("cell");
    expect(deposit[USD_CASH_CELL]).toHaveTextContent("0.00");
    expect(deposit[EUR_CASH_CELL]).toHaveTextContent("10,000.00");
    const aapl = within(await rowFor("AAPL")).getAllByRole("cell");
    expect(aapl[USD_CASH_CELL]).toHaveTextContent("-18,543.15");
    expect(aapl[EUR_CASH_CELL]).toHaveTextContent("10,000.00");
  });

  it("keeps the balances of the whole ledger when a filter hides earlier rows", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Filtrer par symbole…"), "AAPL");
    await waitFor(() => expect(rowSymbols()).toEqual(["AAPL"]));
    const aapl = within(await rowFor("AAPL")).getAllByRole("cell");
    expect(aapl[USD_CASH_CELL]).toHaveTextContent("-18,543.15");
  });

  it("says on the balance headers what the balances are anchored on", async () => {
    await seed();
    renderHistory();
    const usdHeader = await screen.findByRole("columnheader", { name: "Cash USD" });
    expect(usdHeader).toHaveAttribute("title", expect.stringContaining("calé sur le cash de fin"));
    expect(screen.getByRole("columnheader", { name: "Cash EUR" })).toHaveAttribute("title", expect.stringContaining("calé sur le cash de fin"));
    expect(usdHeader).toHaveAttribute("title", expect.stringContaining("la page Consistance dit s'il retombe sur le cash de début"));
  });

  it("anchors the balances on the end point of the Cash Report", async () => {
    await seed();
    await db.cashPoints.put({ accountId: "alpha", currency: "USD", kind: "end", asOf: "2026-12-31", amount: 1456.85, source: "flex", importedAt: "" });
    renderHistory();
    // Raw USD ends on -18,543.15: the whole column moves by 20,000.
    expect(within(await rowFor("AAPL")).getAllByRole("cell")[USD_CASH_CELL]).toHaveTextContent("1,456.85");
    expect(within(await rowFor("ELECTRONIC FUND TRANSFER")).getAllByRole("cell")[USD_CASH_CELL]).toHaveTextContent("20,000.00");
    expect(within(await rowFor("AAPL")).getAllByRole("cell")[EUR_CASH_CELL]).toHaveTextContent("10,000.00");
  });

  it("leaves the cash check to the Consistency page", async () => {
    await seed();
    await db.cashPoints.put({ accountId: "alpha", currency: "USD", kind: "end", asOf: "2026-12-31", amount: 1456.85, source: "flex", importedAt: "" });
    renderHistory();
    // Still anchored: only the card moved.
    expect(within(await rowFor("AAPL")).getAllByRole("cell")[USD_CASH_CELL]).toHaveTextContent("1,456.85");
    expect(screen.queryByLabelText("Cohérence du cash")).not.toBeInTheDocument();
    expect(screen.queryByText(/solde calé sur le cash de fin/)).not.toBeInTheDocument();
    expect(screen.queryByText(/aucun Cash Report/)).not.toBeInTheDocument();
  });

  it("labels each transaction with its translated kind and falls back to the description without a symbol", async () => {
    await seed();
    renderHistory();
    const cells = within(await rowFor("ELECTRONIC FUND TRANSFER")).getAllByRole("cell");
    expect(cells[1]).toHaveTextContent("Dépôt/Retrait");
    expect(cells[CASH_CELL]).toHaveTextContent("10,000.00");
  });

  it("filters by kind and drops the filter again on All types", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(await screen.findByRole("option", { name: "Dépôt/Retrait" }));
    await waitFor(() => expect(rowSymbols()).toEqual(["ELECTRONIC FUND TRANSFER"]));
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(await screen.findByRole("option", { name: "Tous les types" }));
    await waitFor(() => expect(rowSymbols()).toHaveLength(4));
  });

  it("filters by date range, inclusive", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    fireEvent.change(screen.getByLabelText("Date de début"), { target: { value: "2026-08-20" } });
    fireEvent.change(screen.getByLabelText("Date de fin"), { target: { value: "2026-08-27" } });
    await waitFor(() => expect(rowSymbols()).toEqual(["MSFT", "TSLA"]));
  });

  it("fills both dates from a year preset, keeps that year's rows, and lets All drop them", async () => {
    await seed([...SAMPLE_TRANSACTIONS, { ...SAMPLE_TRANSACTIONS[0], externalId: "flex:trade:2025", symbol: "OLD", when: "2025-06-02T10:00:00.000Z" }]);
    renderHistory();
    await screen.findByText("AAPL");
    const presets = screen.getByRole("group", { name: "Période" });
    // Years come from the ledger, newest first.
    expect(within(presets).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Tout", "30 derniers jours", "12 derniers mois", "2026", "2025",
    ]);
    expect(within(presets).getByRole("button", { name: "Tout" })).toHaveAttribute("aria-pressed", "true");
    const user = userEvent.setup();
    await user.click(within(presets).getByRole("button", { name: "2025" }));
    expect(screen.getByLabelText("Date de début")).toHaveValue("2025-01-01");
    expect(screen.getByLabelText("Date de fin")).toHaveValue("2025-12-31");
    await waitFor(() => expect(rowSymbols()).toEqual(["OLD"]));
    expect(within(presets).getByRole("button", { name: "2025" })).toHaveAttribute("aria-pressed", "true");
    expect(within(presets).getByRole("button", { name: "Tout" })).toHaveAttribute("aria-pressed", "false");
    // The 2026 preset stays offered although the filter emptied its year.
    expect(within(presets).getByRole("button", { name: "2026" })).toBeInTheDocument();
    await user.click(within(presets).getByRole("button", { name: "Tout" }));
    expect(screen.getByLabelText("Date de début")).toHaveValue("");
    await waitFor(() => expect(rowSymbols()).toHaveLength(5));
  });

  it("keeps its columns on fixed widths, so scrolling never resizes them", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    const table = screen.getByRole("table");
    expect([...table.querySelectorAll("col")].map((col) => col.style.width)).toEqual(HISTORY_COLUMNS.map((column) => column.width));
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Date/Heure", "Type", "Symbole", "Quantité", "Prix", "Prix total", "Frais", "Cash", "Devise", "Cash USD", "Cash EUR",
    ]);
  });

  it("renders only the rows in view out of a long history, with no pagination", async () => {
    await seed(manyRows(200));
    renderHistory();
    expect(await screen.findByText("SYM199")).toBeInTheDocument();
    expect(rowSymbols().length).toBeGreaterThan(0);
    expect(rowSymbols().length).toBeLessThan(60);
    expect(screen.queryByText("SYM0")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suivant" })).not.toBeInTheDocument();
  });

  it("renders the oldest row once the table is scrolled to its bottom", async () => {
    await seed(manyRows(200));
    renderHistory();
    await screen.findByText("SYM199");
    scroller().scrollTop = 200 * HISTORY_ROW_HEIGHT;
    fireEvent.scroll(scroller());
    expect(await screen.findByText("SYM0")).toBeInTheDocument();
    expect(screen.queryByText("SYM199")).not.toBeInTheDocument();
  });

  it("brings the table back to its top when a filter changes", async () => {
    await seed(manyRows(200));
    renderHistory();
    await screen.findByText("SYM199");
    scroller().scrollTop = 150 * HISTORY_ROW_HEIGHT;
    fireEvent.scroll(scroller());
    await screen.findByText("SYM49");
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Filtrer par symbole…"), "SYM1");
    // SYM1, SYM10-19 and SYM100-199 match: the newest of them, SYM199, is back on top.
    await waitFor(() => expect(scroller().scrollTop).toBe(0));
    expect(await screen.findByText("SYM199")).toBeInTheDocument();
  });

  it("brings the table back to its top when the account changes", async () => {
    await seed(manyRows(200));
    await seed(manyRows(200, "beta", "ROB"));
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={["/accounts/alpha/history"]}>
          <Link to="/accounts/beta/history">switch account</Link>
          <Routes>
            <Route path="/accounts/:accountId/history" element={<HistoryPage />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>,
    );
    await screen.findByText("SYM199");
    scroller().scrollTop = 150 * HISTORY_ROW_HEIGHT;
    fireEvent.scroll(scroller());
    await screen.findByText("SYM49");
    const user = userEvent.setup();
    await user.click(screen.getByText("switch account"));
    expect((await screen.findAllByText(/^ROB\d+$/)).length).toBeGreaterThan(0);
    expect(scroller().scrollTop).toBe(0);
  });

  it("keeps the reader's scroll position when a row arrives live", async () => {
    await seed(manyRows(200));
    renderHistory();
    await screen.findByText("SYM199");
    scroller().scrollTop = 150 * HISTORY_ROW_HEIGHT;
    fireEvent.scroll(scroller());
    await screen.findByText("SYM49");
    await db.transactions.add({ ...SAMPLE_TRANSACTIONS[0], accountId: "alpha", externalId: "flex:trade:new", symbol: "NEW", when: "2026-09-01T00:00:00.000Z" });
    const slider = screen.getByRole("slider", { name: "Frise chronologique" });
    await waitFor(() => expect(slider).toHaveAttribute("aria-valuemax", "200"));
    expect(scroller().scrollTop).toBe(150 * HISTORY_ROW_HEIGHT);
  });

  it("jumps from the timeline to the row it names", async () => {
    await seed(manyRows(200));
    renderHistory();
    await screen.findByText("SYM199");
    const slider = screen.getByRole("slider", { name: "Frise chronologique" });
    // The newest row is the 200th day of 2024: July 18.
    expect(slider).toHaveAttribute("aria-valuetext", "juillet 2024");
    fireEvent.keyDown(slider, { key: "End" });
    expect(scroller().scrollTop).toBe(199 * HISTORY_ROW_HEIGHT);
  });

  it("renders a dash for an unknown amount instead of 0.00", async () => {
    await seed([{ ...SAMPLE_DEPOSIT, amount: 10000 }, { ...SAMPLE_TRANSACTIONS[0], symbol: "SNZA", price: null, amount: null, commission: null }]);
    renderHistory();
    const row = await rowFor("SNZA");
    const cells = within(row).getAllByRole("cell");
    expect(cells[4]).toHaveTextContent("—");
    expect(cells[5]).toHaveTextContent("—");
    expect(cells[CASH_CELL]).toHaveTextContent("—");
    expect(cells[EUR_CASH_CELL]).toHaveTextContent("10,000.00");
  });

  it("shows a no-results message on an empty ledger", async () => {
    renderHistory();
    expect(await screen.findByText("Aucune transaction ne correspond.")).toBeInTheDocument();
  });

  it("follows the ledger: a row written later appears without reloading", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    await db.transactions.add({ ...SAMPLE_TRANSACTIONS[0], externalId: "flex:trade:new", symbol: "NEW", when: "2026-09-01T00:00:00.000Z" });
    expect(await screen.findByText("NEW")).toBeInTheDocument();
  });
});
