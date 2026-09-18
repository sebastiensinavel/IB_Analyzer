import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

/** Opens a column's panel, which holds its sort actions and its filter. */
async function openPanel(user: ReturnType<typeof userEvent.setup>, column: string) {
  const header = screen.getByRole("columnheader", { name: new RegExp(`^${column}`) });
  await user.click(within(header).getByRole("button", { name: new RegExp(`^${column}`) }));
}

/** Sorts from that panel; choosing a direction, or resetting, closes it. */
async function sortBy(user: ReturnType<typeof userEvent.setup>, column: string, action: "Croissant" | "Décroissant" | "Réinitialiser le tri") {
  await openPanel(user, column);
  await user.click(await screen.findByRole("button", { name: action }));
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
  window.localStorage.clear();
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

  it("carries a numeric cell's full formatted text as its title, so a clipped value stays readable on hover", async () => {
    await seed();
    renderHistory();
    const cells = within(await rowFor("AAPL")).getAllByRole("cell");
    expect(cells[CASH_CELL]).toHaveAttribute("title", "-18,051.50");
  });

  it("gives a dash cell no title: there is nothing hidden to reveal", async () => {
    await seed([{ ...SAMPLE_DEPOSIT, amount: 10000 }, { ...SAMPLE_TRANSACTIONS[0], symbol: "SNZA", price: null, amount: null, commission: null }]);
    renderHistory();
    const cells = within(await rowFor("SNZA")).getAllByRole("cell");
    expect(cells[CASH_CELL]).toHaveTextContent("—");
    expect(cells[CASH_CELL]).not.toHaveAttribute("title");
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
    await user.type(screen.getByRole("textbox", { name: "Rechercher un ticker" }), "AAPL");
    await waitFor(() => expect(rowSymbols()).toEqual(["AAPL"]));
    const aapl = within(await rowFor("AAPL")).getAllByRole("cell");
    expect(aapl[USD_CASH_CELL]).toHaveTextContent("-18,543.15");
  });

  it("says on the balance headers what the balances are anchored on", async () => {
    await seed();
    renderHistory();
    const usdHeader = await screen.findByRole("columnheader", { name: /^Cash USD/ });
    expect(usdHeader).toHaveAttribute("title", expect.stringContaining("calé sur le cash de fin"));
    expect(screen.getByRole("columnheader", { name: /^Cash EUR/ })).toHaveAttribute("title", expect.stringContaining("calé sur le cash de fin"));
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

  it("keeps its columns on fixed widths, so scrolling never resizes them", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    const table = screen.getByRole("table");
    expect([...table.querySelectorAll("col")].map((col) => col.style.width)).toEqual(HISTORY_COLUMNS.map((column) => column.width));
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Date/Heure", "Type", "Symbole", "Qté", "Prix", "Prix total", "Frais", "Cash", "Dev.", "Cash USD", "Cash EUR",
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
    await user.type(screen.getByRole("textbox", { name: "Rechercher un ticker" }), "SYM1");
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

  it("sorts in the direction chosen in the panel, and back to the default order on a reset", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    const user = userEvent.setup();
    await sortBy(user, "Prix total", "Croissant");
    // Amounts: AAPL -18050, TSLA -1100, MSFT 610, deposit 10000.
    await waitFor(() => expect(rowSymbols()).toEqual(["AAPL", "TSLA", "MSFT", "ELECTRONIC FUND TRANSFER"]));
    expect(screen.getByRole("columnheader", { name: /^Prix total/ })).toHaveAttribute("aria-sort", "ascending");
    await sortBy(user, "Prix total", "Décroissant");
    await waitFor(() => expect(rowSymbols()).toEqual(["ELECTRONIC FUND TRANSFER", "MSFT", "TSLA", "AAPL"]));
    await sortBy(user, "Prix total", "Réinitialiser le tri");
    await waitFor(() => expect(rowSymbols()).toEqual(["AAPL", "MSFT", "TSLA", "ELECTRONIC FUND TRANSFER"]));
  });

  it("puts the rows without a value last, whatever the direction", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    const user = userEvent.setup();
    await sortBy(user, "Frais", "Croissant");
    await waitFor(() => expect(rowSymbols().at(-1)).toBe("ELECTRONIC FUND TRANSFER"));
    await sortBy(user, "Frais", "Décroissant");
    await waitFor(() => expect(rowSymbols().at(-1)).toBe("ELECTRONIC FUND TRANSFER"));
  });

  it("filters a column with a criterion and keeps each row's whole-ledger balance", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    const user = userEvent.setup();
    await openPanel(user, "Prix total");
    await user.type(await screen.findByRole("textbox", { name: "Critère pour Prix total" }), ">0");
    await waitFor(() => expect(rowSymbols()).toEqual(["MSFT", "ELECTRONIC FUND TRANSFER"]));
    expect(within(await rowFor("MSFT")).getAllByRole("cell")[USD_CASH_CELL]).toHaveTextContent("-491.65");
    expect(screen.getByText("Prix total : >0")).toBeInTheDocument();
  });

  it("shows an invalid criterion in red and does not filter on it", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    const user = userEvent.setup();
    await openPanel(user, "Date/Heure");
    const input = await screen.findByRole("textbox", { name: "Critère pour Date/Heure" });
    // Pasted in one change: typed char by char, the valid prefix "2025" would be applied and kept.
    await user.click(input);
    await user.paste("2025-13");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(rowSymbols()).toHaveLength(4);
    await user.clear(input);
    await user.type(input, "2026-08-2");
    expect(input).toHaveAttribute("aria-invalid", "true");
    await user.type(input, "7");
    await waitFor(() => expect(rowSymbols()).toEqual(["MSFT"]));
  });

  it("keeps the Type list above the table and the Type column filter on one state", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(await screen.findByRole("option", { name: /Dépôt\/Retrait/ }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(rowSymbols()).toEqual(["ELECTRONIC FUND TRANSFER"]));
    await openPanel(user, "Type");
    expect(await screen.findByRole("checkbox", { name: /Dépôt\/Retrait/ })).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: /Trade/ }));
    await waitFor(() => expect(rowSymbols()).toHaveLength(4));
  });

  it("counts the Type values over the whole ledger, not over the filtered rows", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Rechercher un ticker" }), "=MSFT");
    await waitFor(() => expect(rowSymbols()).toEqual(["MSFT"]));
    await openPanel(user, "Type");
    const trade = (await screen.findByRole("checkbox", { name: /Trade/ })).closest("label")!;
    expect(trade).toHaveTextContent("3");
  });

  it("searches the ticker with OR, an option by its underlying", async () => {
    await seed([
      ...SAMPLE_TRANSACTIONS,
      { ...SAMPLE_TRANSACTIONS[0], externalId: "flex:trade:9", symbol: "MSFT  261016C00400000", secType: "OPT", right: "C", strike: 400, expiry: "2026-10-16" },
    ]);
    renderHistory();
    await screen.findByText("AAPL");
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Rechercher un ticker" }), "=MSFT|=TSLA");
    await waitFor(() => expect(rowSymbols()).toEqual(["MSFT Oct16'26 400 Call", "MSFT", "TSLA"]));
  });

  it("hides the timeline under a sort and brings it back on the default order", async () => {
    await seed(manyRows(50));
    renderHistory();
    await screen.findByText("SYM49");
    expect(screen.getByRole("slider", { name: "Frise chronologique" })).toBeInTheDocument();
    const user = userEvent.setup();
    await sortBy(user, "Date/Heure", "Croissant");
    await waitFor(() => expect(screen.queryByRole("slider", { name: "Frise chronologique" })).not.toBeInTheDocument());
    await sortBy(user, "Date/Heure", "Réinitialiser le tri");
    expect(await screen.findByRole("slider", { name: "Frise chronologique" })).toBeInTheDocument();
  });

  it("keeps headers, pills and Clear all when a filter empties the table", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    const user = userEvent.setup();
    await openPanel(user, "Qté");
    await user.type(await screen.findByRole("textbox", { name: "Critère pour Qté" }), ">1000000");
    expect(await screen.findByText("Aucune transaction ne correspond.")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /^Qté/ })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Tout effacer" }));
    await waitFor(() => expect(rowSymbols()).toHaveLength(4));
  });

  it("remembers the view per account, across a remount", async () => {
    await seed();
    await seed([{ ...SAMPLE_TRANSACTIONS[0], accountId: "beta", externalId: "flex:trade:b1", symbol: "BETA" }]);
    const first = renderHistory("alpha");
    await screen.findByText("AAPL");
    const user = userEvent.setup();
    await sortBy(user, "Prix total", "Croissant");
    await waitFor(() => expect(rowSymbols()[0]).toBe("AAPL"));
    first.unmount();
    renderHistory("beta");
    await screen.findByText("BETA");
    expect(screen.getByRole("columnheader", { name: /^Prix total/ })).not.toHaveAttribute("aria-sort");
    cleanup();
    renderHistory("alpha");
    await screen.findByText("AAPL");
    expect(screen.getByRole("columnheader", { name: /^Prix total/ })).toHaveAttribute("aria-sort", "ascending");
    expect(rowSymbols()).toEqual(["AAPL", "TSLA", "MSFT", "ELECTRONIC FUND TRANSFER"]);
  });

  it("no longer offers the date fields nor the period presets", async () => {
    await seed();
    renderHistory();
    await screen.findByText("AAPL");
    expect(screen.queryByLabelText("Date de début")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Période" })).not.toBeInTheDocument();
  });
});
