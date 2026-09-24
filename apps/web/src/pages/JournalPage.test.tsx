import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import { ACTIVABLE_STRATEGIES, type Strategy, type Transaction } from "@ib/ledger";
import i18n from "@/i18n";
import { db } from "@/db/schema";
import { LABEL_TONE_CLASS } from "@/lib/journalTone";
import { JournalPage } from "@/pages/JournalPage";
import { WithAccountData } from "@/test/WithAccountData";
import { SAMPLE_JOURNAL_SNAPSHOT, SAMPLE_JOURNAL_TRANSACTIONS } from "@/mocks/journals";

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    accountId: "beta", externalId: "", source: "flex", kind: "trade", symbol: "", secType: "OPT", right: "", strike: null, expiry: null,
    quantity: null, price: null, amount: null, commission: -1, currency: "USD", when: "", description: "", ...overrides,
  };
}

/** 100 NVDA bought at 120, a call sold on them at 150, and a TSLA call sold on nothing at all. */
const TAKEOVER_TRANSACTIONS: Transaction[] = [
  tx({ externalId: "flex:trade:201", symbol: "NVDA", secType: "STK", quantity: 100, price: 120, amount: -12000, when: "2026-03-02T14:30:00.000Z" }),
  tx({ externalId: "flex:trade:202", symbol: "NVDA  260821C00150000", right: "C", strike: 150, expiry: "2026-08-21", quantity: -1, price: 2, amount: 200, when: "2026-08-03T14:30:00.000Z" }),
  tx({ externalId: "flex:trade:203", symbol: "TSLA  260821C00300000", right: "C", strike: 300, expiry: "2026-08-21", quantity: -1, price: 1, amount: 100, when: "2026-08-04T14:30:00.000Z" }),
];

async function withTakeoverLedger(): Promise<void> {
  await Promise.all([db.transactions.clear(), db.snapshots.clear()]);
  await db.transactions.bulkAdd(TAKEOVER_TRANSACTIONS);
}

function renderJournal(strategy: Strategy, accountId = "beta") {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[`/accounts/${accountId}/journal/${strategy}`]}>
        <Routes>
          <Route
            path="/accounts/:accountId/journal/:strategy"
            element={
              <WithAccountData>
                <JournalPage strategy={strategy} />
              </WithAccountData>
            }
          />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

/** By the Label cell: the ticker cell repeats "MQZA" on every MQZA row, so a text query would be ambiguous. */
async function rowFor(label: string): Promise<HTMLTableRowElement> {
  const labels = await screen.findAllByTestId("journal-label");
  const cell = labels.find((el) => el.textContent === label);
  if (!cell) throw new Error(`no row labelled ${label}`);
  return cell.closest("tr") as HTMLTableRowElement;
}

function cells(row: HTMLTableRowElement): string[] {
  return within(row).getAllByRole("cell").map((cell) => cell.textContent ?? "");
}

beforeEach(async () => {
  window.localStorage.clear();
  await Promise.all([db.transactions.clear(), db.snapshots.clear()]);
  // Every strategy on: these tests read the LEAPS and the condors (the default is the Wheel alone).
  await db.accounts.put({ id: "beta", label: "beta", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [], strategies: [...ACTIVABLE_STRATEGIES] });
  await db.transactions.bulkAdd(SAMPLE_JOURNAL_TRANSACTIONS);
  await db.snapshots.put(SAMPLE_JOURNAL_SNAPSHOT);
});

describe("JournalPage", () => {
  it("shows the seventeen columns in order", async () => {
    renderJournal("wheel");
    await screen.findByText("MQZA Oct02'26 17 Put");
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Date début", "Label", "Ticker", "Quantité", "Prix initial", "Prix total initial", "Commission initiale", "Assigné",
      "Prix total initial net", "Date fin", "Prix final", "Prix total final", "Commission finale", "Prix total final net", "Gain/Perte", "En cours",
      "Commentaire",
    ]);
  });

  it("explains, in the Wheel journal, why shares already held are there and at what price", async () => {
    await withTakeoverLedger();
    renderJournal("wheel");
    const taken = cells(await rowFor("NVDA"));
    expect(taken[0]).toBe("2026-08-03 14:30:00");
    expect(taken[4]).toBe("150.00");
    expect(taken[7]).toBe("0");
    expect(taken[16]).toBe("Actions déjà détenues, reprises au strike du call NVDA Aug21'26 150 Call");
    // The call that caused it needs no explaining.
    expect(cells(await rowFor("NVDA Aug21'26 150 Call"))[16]).toBe("");
  });

  it("explains, in the Others journal, where the shares went and why a call is naked", async () => {
    await withTakeoverLedger();
    renderJournal("others");
    const handed = cells(await rowFor("NVDA"));
    expect(handed[10]).toBe("150.00");
    expect(handed[14]).toBe("2,999.00");
    expect(handed[16]).toBe("Reprises par la stratégie Wheel au strike du call NVDA Aug21'26 150 Call");
    expect(cells(await rowFor("TSLA Aug21'26 300 Call"))[16]).toBe("Call nu : ni actions ni LEAPS pour le couvrir");
  });

  it("fills a Wheel put assigned: exit at 0, assigned 1, still ongoing while the shares are held", async () => {
    renderJournal("wheel");
    expect(cells(await rowFor("MQZA Oct02'26 17 Put"))).toEqual([
      "2026-06-01 14:30:00", "MQZA Oct02'26 17 Put", "MQZA", "-2", "0.21", "42.00", "-1.00", "1", "41.00",
      "2026-07-17 20:00:00", "0.00", "0.00", "—", "0.00", "41.00", "1", "",
    ]);
    expect(cells(await rowFor("MQZA"))).toEqual([
      "2026-07-17 20:00:00", "MQZA", "MQZA", "200", "17.00", "-3,400.00", "0.00", "1", "-3,400.00", "—", "—", "—", "—", "—", "—", "1", "",
    ]);
    expect(cells(await rowFor("MQZA Aug21'26 20 Call"))[15]).toBe("0");
  });

  it("dates both date columns to the second, like every other timestamp in the app", async () => {
    renderJournal("wheel");
    // The opening trade is 2026-06-01T14:30:00Z, its assignment 2026-07-17T20:00:00Z: a row
    // that kept only the day would leave two lots opened the same day indistinguishable.
    const row = cells(await rowFor("MQZA Oct02'26 17 Put"));
    expect(row[0]).toBe("2026-06-01 14:30:00");
    expect(row[9]).toBe("2026-07-17 20:00:00");
    // An open line has no closing instant: a dash, never a zero-filled date.
    expect(cells(await rowFor("MQZA"))[9]).toBe("—");
  });

  it("shows only its own strategy", async () => {
    renderJournal("wheel");
    await screen.findByText("MQZA Oct02'26 17 Put");
    expect(screen.queryByText("ZZZ Jun18'27 15 Call")).not.toBeInTheDocument();
    expect(screen.queryByText("AAPL")).not.toBeInTheDocument();
  });

  it("colours the Label cell: blue delivered shares, orange short call, green long call, nothing once closed", async () => {
    renderJournal("wheel");
    expect(within(await rowFor("MQZA")).getAllByRole("cell")[1]).toHaveClass(LABEL_TONE_CLASS.shares);
    expect(within(await rowFor("MQZA Aug21'26 20 Call")).getAllByRole("cell")[1]).not.toHaveClass(LABEL_TONE_CLASS.shortCall);
    // Unmount the Wheel page before mounting LEAPS: without it, the stale "MQZA" labels
    // still in the DOM satisfy findAllByTestId's very first (synchronous) check, which
    // resolves the promise immediately and never waits for the ZZZ rows to actually render
    // (a real navigation between journal pages unmounts the previous one the same way).
    cleanup();
    renderJournal("leaps");
    expect(within(await rowFor("ZZZ Jun18'27 15 Call")).getAllByRole("cell")[1]).toHaveClass(LABEL_TONE_CLASS.open);
    expect(within(await rowFor("ZZZ Sep18'26 20 Call")).getAllByRole("cell")[1]).toHaveClass(LABEL_TONE_CLASS.shortCall);
  });

  it("folds a condor into one row and unfolds its four legs on demand", async () => {
    renderJournal("condors");
    const row = await rowFor("SPY Aug29'26 IC 620/625/660/665");
    expect(cells(row)[3]).toBe("-1");
    expect(cells(row)[14]).toBe("46.00");
    expect(screen.queryByText("SPY Aug29'26 620 Put")).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: "Voir les jambes" }));
    expect(screen.getAllByTestId("journal-leg")).toHaveLength(4);
    expect(screen.getByText("SPY Aug29'26 620 Put")).toBeInTheDocument();
  });

  it("lists what fits nowhere else under Others", async () => {
    renderJournal("others");
    expect(cells(await rowFor("AAPL"))[3]).toBe("10");
  });

  it("searches on the ticker with the shared grammar and says when nothing matches", async () => {
    renderJournal("wheel");
    await screen.findByText("MQZA Oct02'26 17 Put");
    await userEvent.type(screen.getByRole("textbox", { name: "Rechercher un ticker" }), "=ZZZ");
    expect(await screen.findByText("Aucune position ne correspond.")).toBeInTheDocument();
  });

  it("says when the strategy has nothing at all", async () => {
    await db.transactions.clear();
    renderJournal("wheel");
    expect(await screen.findByText("Aucune position pour cette stratégie.")).toBeInTheDocument();
  });

  it("leaves the reconciliation to the Consistency page", async () => {
    renderJournal("wheel");
    await screen.findAllByTestId("journal-label");
    expect(screen.queryByLabelText("Reconstitution du portefeuille")).not.toBeInTheDocument();
    expect(screen.queryByText(/Portefeuille reconstitué/)).not.toBeInTheDocument();
  });

  it("sorts on a column and keeps the legs under their condor", async () => {
    renderJournal("condors");
    const row = await rowFor("SPY Aug29'26 IC 620/625/660/665");
    const user = userEvent.setup();
    await user.click(within(row).getByRole("button", { name: "Voir les jambes" }));
    expect(screen.getAllByTestId("journal-leg")).toHaveLength(4);
    const header = screen.getByRole("columnheader", { name: /^Gain\/Perte/ });
    await user.click(within(header).getByRole("button", { name: /^Gain\/Perte/ }));
    await user.click(await screen.findByRole("button", { name: "Croissant" }));
    // The sort runs on the head rows; the legs stay attached to theirs.
    expect(screen.getAllByTestId("journal-leg")).toHaveLength(4);
  });

  it("filters a column and keeps the table, with a way back", async () => {
    renderJournal("wheel");
    await screen.findByText("MQZA Oct02'26 17 Put");
    const user = userEvent.setup();
    const header = screen.getByRole("columnheader", { name: /^En cours/ });
    await user.click(within(header).getByRole("button", { name: /^En cours/ }));
    // By regex: a facet's checkbox is named with its count too ("0 3").
    await user.click(await screen.findByRole("checkbox", { name: /^0/ }));
    await waitFor(() => expect(screen.queryByText("MQZA Oct02'26 17 Put")).not.toBeInTheDocument());
    await user.keyboard("{Escape}");
    expect(screen.getByText("En cours : 0")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tout effacer" }));
    expect(await screen.findByText("MQZA Oct02'26 17 Put")).toBeInTheDocument();
  });

  it("remembers the view of each journal apart, per account", async () => {
    window.localStorage.setItem(
      "ib2:tableView:beta:journal:wheel",
      JSON.stringify({ v: 1, sort: [], criteria: { ticker: "=NOPE" } }),
    );
    renderJournal("wheel");
    expect(await screen.findByText("Aucune position ne correspond.")).toBeInTheDocument();
  });
});
