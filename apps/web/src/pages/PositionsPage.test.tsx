import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import statementHtml from "../../../../packages/ib-parsers/tests/fixtures/activity_statement_sample.htm?raw";
import i18n from "@/i18n";
import { mergeQuotes, resetQuotes } from "@/agent/quotes";
import { db, type AccountRecord } from "@/db/schema";
import { importFile } from "@/db/importFile";
import { PositionsPage } from "@/pages/PositionsPage";
import { WithAccountData } from "@/test/WithAccountData";
import { POSITION_COLUMNS } from "@/lib/positionColumns";
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

afterEach(() => {
  resetQuotes();
});

/** SAMPLE_TRANSACTIONS end on USD -18,543.15 raw and EUR 10,000; the end point moves USD to 1,456.85. */
async function seedCash() {
  await db.transactions.bulkAdd(SAMPLE_TRANSACTIONS);
  await db.cashPoints.put({ accountId: "alpha", currency: "USD", kind: "end", asOf: "2026-12-31", amount: 1456.85, source: "flex", importedAt: "" });
}

/** SAMPLE_POSITIONS[0]: AAPL, 200 shares, a long stock position under "Positions longues". */
function stockPosition(overrides: Partial<(typeof SAMPLE_POSITIONS)[number]> = {}) {
  return { ...SAMPLE_POSITIONS[0], ...overrides };
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
    const order = () => within(sells).getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[1].textContent);
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
    expect(cells[4]).toHaveTextContent("—");
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
      expect(widths(table)).toHaveLength(POSITION_COLUMNS.length);
      expect(widths(table)).toEqual(widths(tables[0]));
      expect((within(table).getByText("Valeur de marché").closest("th") as HTMLTableCellElement).cellIndex).toBe(4);
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

  it("shows the day's move and P&L of an agent snapshot, and an em dash without them", async () => {
    await db.snapshots.put({
      ...SAMPLE_SNAPSHOT,
      positions: [
        stockPosition({ dailyPnl: 550.45, dayChange: 0.0816 }),
        stockPosition({ symbol: "ONDS", description: "ONDAS HOLDINGS", dailyPnl: null, dayChange: null }),
      ],
    });
    renderPositions();
    const withMove = await rowFor("AAPL");
    // Cell index, not just presence in the row: dayChange is POSITION_COLUMNS[8], dailyPnl is
    // [9], between lastPrice and unrealizedPnl — a swap between the two values (both distinct
    // and non-null here) would fail this, where presence-only assertions would not.
    const moveCells = within(withMove).getAllByRole("cell");
    expect(moveCells[8]).toHaveTextContent("+8.2%");
    // formatMoney, like the unrealized P&L column next to it (spec §7): a signed dollar amount.
    expect(moveCells[9]).toHaveTextContent("$550.45");
    // A held stock is its own underlying: "Var. jour action" (column 0) shows the same live
    // dayChange here, without being the same source — no tooltip, unlike a delayed quote.
    expect(moveCells[0]).toHaveTextContent("+8.2%");
    const withoutMove = await rowFor("ONDS");
    // dayChange (—), dailyPnl (—), and now underlyingDayChange (—): a held stock with no live
    // dayChange and no /quotes pass shows a dash there too.
    expect(within(withoutMove).getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });

  it("leaves the day columns of the cash table empty", async () => {
    // The cash card lays the thirteen shared columns and fills only Position and Market value; the
    // other eleven are `aria-hidden`, so they need `hidden: true` to be counted at all.
    await seedCash();
    renderPositions();
    const cashRow = (await screen.findByText("USD")).closest("tr") as HTMLTableRowElement;
    expect(within(cashRow).getAllByRole("cell", { hidden: true })).toHaveLength(POSITION_COLUMNS.length);
  });

  it("shows the underlying's day move first, and a dash before any quote", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    const before = within(await rowFor("XOM Mar20'26 100 Put")).getAllByRole("cell");
    expect(before[0]).toHaveTextContent("—");
  });

  it("shows the underlying's day move first, once the agent has quoted it", async () => {
    mergeQuotes(new Map([["XOM", { last: null, change: -0.0312 }]]));
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    const cells = within(await rowFor("XOM Mar20'26 100 Put")).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("-3.1%");
  });

  it("shows a delayed-quote tooltip on a sold put not held", async () => {
    mergeQuotes(new Map([["XOM", { last: null, change: -0.0312 }]]));
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    const cells = within(await rowFor("XOM Mar20'26 100 Put")).getAllByRole("cell");
    await userEvent.setup().hover(within(cells[0]).getByText("-3.1%"));
    expect(await screen.findByText("Cotation différée de 15 min.", {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it("prefers the account's own live dayChange over a stale quote for a held stock, with no tooltip", async () => {
    mergeQuotes(new Map([["AAPL", { last: null, change: -0.5 }]])); // stale/wrong: the held dayChange below must win
    await db.snapshots.put({ ...SAMPLE_SNAPSHOT, positions: [stockPosition({ dayChange: 0.05 }), ...SAMPLE_POSITIONS.slice(1)] });
    renderPositions();
    const cells = within(await rowFor("AAPL")).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("+5.0%");
    // No tooltip wrapper at all for a held value — a hover-and-wait assertion would pass
    // vacuously here: base-ui's TooltipProvider default OPEN_DELAY is 600 ms and no provider
    // is mounted in this tree, so the popup never appears within a short wait whether or not
    // the cell wraps its text in a trigger. The trigger itself (`data-slot="tooltip-trigger"`,
    // packages/ui/src/components/ui/tooltip.tsx) is the structural fact to check instead.
    expect(cells[0].querySelector('[data-slot="tooltip-trigger"]')).toBeNull();
  });

  it("falls back to the delayed quote when a held stock's own dayChange is null", async () => {
    mergeQuotes(new Map([["AAPL", { last: null, change: 0.02 }]]));
    await db.snapshots.put({ ...SAMPLE_SNAPSHOT, positions: [stockPosition({ dayChange: null }), ...SAMPLE_POSITIONS.slice(1)] });
    renderPositions();
    const cells = within(await rowFor("AAPL")).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("+2.0%");
    await userEvent.setup().hover(within(cells[0]).getByText("+2.0%"));
    expect(await screen.findByText("Cotation différée de 15 min.", {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it("never sorts the underlying's day move by default", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    const sells = (await screen.findByText("Ventes d'options")).closest("[data-slot=card]") as HTMLElement;
    expect(within(sells).getByRole("columnheader", { name: /^Var\. jour action/ })).not.toHaveAttribute("aria-sort");
  });

  it("reads XSP's day move from its own quote, with the delayed tooltip", async () => {
    mergeQuotes(new Map([["XSP", { last: null, change: 0.004 }]]));
    await db.snapshots.put({ ...SAMPLE_SNAPSHOT, positions: [stockPosition({ symbol: "XSP", description: "XSP TEST" })] });
    renderPositions();
    const row = await rowFor("XSP");
    const cells = within(row).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("+0.4%");
    await userEvent.setup().hover(within(cells[0]).getByText("+0.4%"));
    expect(
      await screen.findByText("Cotation différée de 15 min.", {}, { timeout: 2000 }),
    ).toBeInTheDocument();
  });

  it("sorts a card on the underlying's day move, unknown values last", async () => {
    mergeQuotes(new Map([["AAPL", { last: null, change: 0.02 }], ["XOM", { last: null, change: -0.03 }]]));
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    const sells = (await screen.findByText("Ventes d'options")).closest("[data-slot=card]") as HTMLElement;
    const user = userEvent.setup();
    await openPanel(user, sells, "Var. jour action");
    await user.click(await screen.findByRole("button", { name: "Croissant" }));
    const order = () => within(sells).getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[1].textContent);
    await waitFor(() => expect(order()[0]).toBe("XOM Mar20'26 100 Put"));
  });

  it("sorts by the resolved value, a held stock's live move ahead of a stale quote for the same ticker", async () => {
    // AAPL's /quotes value (+2%) must lose to the account's own held dayChange (-50%): both AAPL
    // option rows below share it, sorting ahead of XOM's quoted -3%.
    mergeQuotes(new Map([["AAPL", { last: null, change: 0.02 }], ["XOM", { last: null, change: -0.03 }]]));
    await db.snapshots.put({
      ...SAMPLE_SNAPSHOT,
      positions: SAMPLE_POSITIONS.map((position) => (position.symbol === "AAPL" && position.secType === "STK" ? { ...position, dayChange: -0.5 } : position)),
    });
    renderPositions();
    const sells = (await screen.findByText("Ventes d'options")).closest("[data-slot=card]") as HTMLElement;
    const user = userEvent.setup();
    await openPanel(user, sells, "Var. jour action");
    await user.click(await screen.findByRole("button", { name: "Croissant" }));
    const order = () => within(sells).getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[1].textContent);
    await waitFor(() => expect(order()[0]).toBe("AAPL Jan16'26 150 Call"));
    expect(order()[1]).toBe("AAPL Feb20'26 155 Call");
  });

  /**
   * Two positions only, one per group, so each totals test below sums a known, small set: the
   * AAPL stock (`stockPosition`) lands under "Positions longues", the MSFT short call (uncovered
   * here, its LEAPS not seeded) under "Ventes d'options".
   */
  function totalsSnapshot(dailyPnlA: number | null, dailyPnlB: number | null) {
    return {
      ...SAMPLE_SNAPSHOT,
      positions: [
        stockPosition({ marketValue: 1000, unrealizedPnl: 50, dailyPnl: dailyPnlA }),
        { ...SAMPLE_POSITIONS[4], marketValue: -200, unrealizedPnl: 20, dailyPnl: dailyPnlB },
      ],
    };
  }

  it("heads the page with the day P/L, the liquidation value cash included, and the P/L", async () => {
    await db.snapshots.put(totalsSnapshot(10, -4));
    await db.cashPoints.put({ accountId: "alpha", currency: "USD", kind: "end", asOf: "2026-09-02", amount: 5000, source: "flex", importedAt: "" });
    renderPositions();
    const header = await screen.findByTestId("page-totals");
    const usd = within(header).getByTestId("header-totals-USD");
    expect(usd).toHaveTextContent("6.00"); // 10 − 4
    expect(usd).toHaveTextContent("5,800.00"); // 1000 − 200 + 5000
    expect(usd).toHaveTextContent("70.00"); // 50 + 20
  });

  it("heads each group card with its own lines", async () => {
    await db.snapshots.put(totalsSnapshot(10, -4));
    renderPositions();
    const sells = (await screen.findByText("Ventes d'options")).closest("[data-slot=card]") as HTMLElement;
    expect(within(sells).getByTestId("header-totals-USD")).toHaveTextContent("-200.00");
  });

  it("leaves the cash out of the page value once a search is active, and says so", async () => {
    await db.snapshots.put(totalsSnapshot(10, -4));
    await db.cashPoints.put({ accountId: "alpha", currency: "USD", kind: "end", asOf: "2026-09-02", amount: 5000, source: "flex", importedAt: "" });
    renderPositions();
    const user = userEvent.setup();
    const input = await screen.findByRole("textbox", { name: "Rechercher un ticker" });
    await user.type(input, "AAPL");
    await waitFor(() => expect(screen.queryByText("Ventes d'options")).not.toBeInTheDocument());
    const usd = within(screen.getByTestId("page-totals")).getByTestId("header-totals-USD");
    expect(usd).not.toHaveTextContent("5,800.00");
    expect(usd).toHaveTextContent("*");
  });

  it("draws no line for a currency the page neither holds nor has cash in", async () => {
    await db.snapshots.put(totalsSnapshot(10, -4));
    await db.transactions.bulkAdd(SAMPLE_TRANSACTIONS.filter((tx) => tx.currency === "USD"));
    await db.cashPoints.put({ accountId: "alpha", currency: "USD", kind: "end", asOf: "2026-12-31", amount: 1456.85, source: "flex", importedAt: "" });
    renderPositions();
    const header = await screen.findByTestId("page-totals");
    await waitFor(() => expect(within(header).getByTestId("header-totals-USD")).toHaveTextContent("2,256.85")); // 1000 − 200 + 1456.85
    expect(within(header).queryByTestId("header-totals-EUR")).not.toBeInTheDocument();
  });

  it("keeps the line of a currency the account holds cash in, positions or not", async () => {
    await db.snapshots.put(totalsSnapshot(10, -4));
    await seedCash();
    renderPositions();
    const header = await screen.findByTestId("page-totals");
    await waitFor(() => expect(within(header).getByTestId("header-totals-EUR")).toHaveTextContent("10,000.00"));
  });

  it("shows — for the day P/L from a Flex snapshot, never 0.00", async () => {
    await db.snapshots.put(totalsSnapshot(null, null));
    renderPositions();
    const usd = within(await screen.findByTestId("page-totals")).getByTestId("header-totals-USD");
    expect(usd.textContent).toMatch(/P\/L du jour\s*—/);
  });
});

/** The sample expiries — Jan16'26 to Jan21'28 — are all ahead of this day. */
function freezeBefore() {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2025-12-01T12:00:00.000Z") });
}

/** And all behind this one. */
function freezeAfter() {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2029-01-01T12:00:00.000Z") });
}

function expiryBar(): HTMLElement {
  return screen.getByRole("group", { name: "Filtrer par expiration" });
}

describe("PositionsPage expiry filters", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers the coming expiries under the search, nearest first", async () => {
    freezeBefore();
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    await screen.findByText("XOM Mar20'26 100 Put");
    const bar = expiryBar();
    expect(within(bar).getAllByRole("button").map((button) => button.textContent)).toEqual(["Jan16'26", "Feb20'26", "Mar20'26", "Jan21'28"]);
    const input = screen.getByRole("textbox", { name: "Rechercher un ticker" });
    expect(input.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("has no expiry bar when every option has expired", async () => {
    freezeAfter();
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    await screen.findByText("XOM Mar20'26 100 Put");
    expect(screen.queryByRole("group", { name: "Filtrer par expiration" })).not.toBeInTheDocument();
  });

  it("filters every table on its Position column and hides the ones it empties", async () => {
    freezeBefore();
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    await screen.findByText("XOM Mar20'26 100 Put");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(within(expiryBar()).getByRole("button", { name: "Mar20'26" }));
    // Shares have no expiry: their card goes away rather than showing an empty table.
    await waitFor(() => expect(screen.queryByText("Positions longues")).not.toBeInTheDocument());
    expect(screen.queryByText("AAPL Jan16'26 150 Call")).not.toBeInTheDocument();
    expect(screen.getByText("XOM Mar20'26 100 Put")).toBeInTheDocument();
    expect(screen.getByText("XYZ Mar20'26 110 Call")).toBeInTheDocument();
    // The very filter a hand typing it in the column panel would have set.
    const sells = (screen.getByText("Ventes d'options")).closest("[data-slot=card]") as HTMLElement;
    expect(within(sells).getByText("Position : Mar20'26")).toBeInTheDocument();
  });

  it("marks the chosen expiry and lets a second click undo it", async () => {
    freezeBefore();
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    await screen.findByText("XOM Mar20'26 100 Put");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const button = () => within(expiryBar()).getByRole("button", { name: "Jan21'28" });
    await user.click(button());
    await waitFor(() => expect(button()).toHaveAttribute("aria-pressed", "true"));
    expect(screen.queryByText("XOM Mar20'26 100 Put")).not.toBeInTheDocument();
    await user.click(button());
    expect(await screen.findByText("XOM Mar20'26 100 Put")).toBeInTheDocument();
    expect(button()).toHaveAttribute("aria-pressed", "false");
  });

  it("clears the expiry filter of every table at once", async () => {
    freezeBefore();
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    await screen.findByText("XOM Mar20'26 100 Put");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(within(expiryBar()).getByRole("button", { name: "Feb20'26" }));
    await waitFor(() => expect(screen.queryByText("XOM Mar20'26 100 Put")).not.toBeInTheDocument());
    await user.click(within(expiryBar()).getByRole("button", { name: "Tout effacer" }));
    expect(await screen.findByText("XOM Mar20'26 100 Put")).toBeInTheDocument();
    expect(await screen.findByText("Positions longues")).toBeInTheDocument();
    expect(within(expiryBar()).queryByRole("button", { name: "Tout effacer" })).not.toBeInTheDocument();
  });

  it("takes the chosen expiry back from the stored views", async () => {
    freezeBefore();
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    for (const group of ["long", "optionBuys", "optionSells", "other"]) {
      window.localStorage.setItem(`ib2:tableView:alpha:positions:${group}`, JSON.stringify({ v: 1, sort: [], criteria: { position: "Mar20'26" } }));
    }
    renderPositions();
    await screen.findByText("XOM Mar20'26 100 Put");
    expect(within(expiryBar()).getByRole("button", { name: "Mar20'26" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Positions longues")).not.toBeInTheDocument();
  });

  it("offers only the expiries of the searched ticker", async () => {
    freezeBefore();
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderPositions();
    await screen.findByText("XOM Mar20'26 100 Put");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(screen.getByRole("textbox", { name: "Rechercher un ticker" }), "=MSFT");
    await waitFor(() => expect(within(expiryBar()).getAllByRole("button").map((button) => button.textContent)).toEqual(["Mar20'26", "Jan21'28"]));
  });
});
