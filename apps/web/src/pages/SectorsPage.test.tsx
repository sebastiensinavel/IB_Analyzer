import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { Position } from "@ib/ledger";
import { db, type SectorRecord, type SnapshotRecord } from "@/db/schema";
import { updateSector } from "@/db/sectors";
import { formatDateTime } from "@/lib/format";
import { LABEL_TONE_CLASS } from "@/lib/journalTone";
import { SectorsPage } from "@/pages/SectorsPage";

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <SectorsPage />
    </I18nextProvider>,
  );
}

const record = (ticker: string, fields: Partial<SectorRecord> = {}): SectorRecord => ({
  ticker,
  name: "",
  category: "",
  score: null,
  status: "",
  updatedAt: "2026-09-01T08:00:00.000Z",
  ...fields,
});

function position(fields: Partial<Position>): Position {
  return {
    symbol: "", secType: "STK", right: "", strike: null, expiry: null, multiplier: null, quantity: 1, avgPrice: null,
    marketPrice: null, marketValue: null, unrealizedPnl: null, dailyPnl: null, dayChange: null, currency: "USD", conid: "", description: "", ...fields,
  };
}

const snapshot = (accountId: string, positions: Position[]): SnapshotRecord => ({
  accountId,
  source: "flex",
  asOf: "2026-09-01",
  importedAt: "2026-09-01T08:00:00.000Z",
  positions,
  cashAvailable: null,
});

/** Each row's ticker, the text of its En cours cell, and whether that cell wears the Wheel's open-put green. */
function ongoingCells() {
  return screen.queryAllByTestId("sector-row").map((row) => {
    const cell = row.querySelector("[data-testid='sector-ongoing']")!;
    const green = LABEL_TONE_CLASS.open.split(" ").every((name) => cell.classList.contains(name));
    return [row.getAttribute("data-ticker"), cell.textContent, green];
  });
}

beforeEach(async () => {
  await Promise.all([db.sectors.clear(), db.snapshots.clear()]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function pickCsv(content: string) {
  const input = screen.getByLabelText("Importer un CSV") as HTMLInputElement;
  await userEvent.setup().upload(input, new File([content], "company.csv", { type: "text/csv" }));
}

/** The tickers of the table's rows, in the order shown. */
function shownTickers() {
  return screen.queryAllByTestId("sector-row").map((row) => row.getAttribute("data-ticker"));
}

describe("SectorsPage", () => {
  it("says the table is shared by every account, and that it is empty", async () => {
    renderPage();
    expect(await screen.findByText("Pas encore de table sectorielle.")).toBeInTheDocument();
    expect(screen.getByText(/commune à tous les comptes/)).toBeInTheDocument();
  });

  it("merges a CSV into the table and reports what it added and updated", async () => {
    await db.sectors.bulkPut([record("AAPL", { category: "Old", status: "keep" }), record("KEEP", { category: "Kept" })]);
    renderPage();
    await screen.findAllByTestId("sector-row");
    await pickCsv("Ticker;Name;Category;Score\nAAPL;Apple;Tech;7\nXOM;Exxon;Energy;");
    expect(await screen.findByText("Tickers ajoutés : 1, mis à jour : 1.")).toBeInTheDocument();
    await waitFor(() => expect(shownTickers()).toEqual(["AAPL", "KEEP", "XOM"]));
    expect(await db.sectors.get("AAPL")).toMatchObject({ name: "Apple", category: "Tech", score: 7, status: "keep" });
  });

  it("shows the error of an unreadable file and keeps the table", async () => {
    await db.sectors.put(record("OLD"));
    renderPage();
    await screen.findAllByTestId("sector-row");
    await pickCsv("Name;Category\nApple;Tech");
    expect(await screen.findByText('Import annulé : Column "Ticker" missing')).toBeInTheDocument();
    expect(await db.sectors.count()).toBe(1);
  });

  it("sums the table up with its size and its latest modification", async () => {
    await db.sectors.bulkPut([
      record("AAPL", { updatedAt: "2026-09-05T08:00:00.000Z" }),
      record("XOM", { updatedAt: "2026-09-01T08:00:00.000Z" }),
    ]);
    renderPage();
    expect(await screen.findByText(`2 tickers, dernière modification ${formatDateTime("2026-09-05T08:00:00.000Z")}`)).toBeInTheDocument();
  });

  it("sorts by ticker and filters on ticker, name and sector, case aside", async () => {
    await db.sectors.bulkPut([
      record("XOM", { name: "Exxon Mobil", category: "Energy" }),
      record("AAPL", { name: "Apple Inc.", category: "Tech" }),
      record("MSFT", { name: "Microsoft", category: "Tech" }),
    ]);
    renderPage();
    const user = userEvent.setup();
    await screen.findAllByTestId("sector-row");
    expect(shownTickers()).toEqual(["AAPL", "MSFT", "XOM"]);

    const filter = screen.getByLabelText("Filtrer");
    await user.type(filter, "tech");
    expect(shownTickers()).toEqual(["AAPL", "MSFT"]);
    await user.clear(filter);
    await user.type(filter, "EXXON");
    expect(shownTickers()).toEqual(["XOM"]);
    await user.clear(filter);
    await user.type(filter, "msf");
    expect(shownTickers()).toEqual(["MSFT"]);
    await user.clear(filter);
    await user.type(filter, "zzz");
    expect(shownTickers()).toEqual([]);
    expect(screen.getByText("Aucun ticker ne correspond au filtre.")).toBeInTheDocument();
  });
});

describe("SectorsPage: editing", () => {
  it("shows a dash placeholder on an empty score, in the add row and on a stored row", async () => {
    await db.sectors.put(record("AAPL"));
    renderPage();
    await screen.findAllByTestId("sector-row");
    expect(screen.getByLabelText("Score du nouveau ticker")).toHaveAttribute("placeholder", "—");
    expect(screen.getByLabelText("Score AAPL")).toHaveAttribute("placeholder", "—");
  });

  it("adds a ticker from the add row, normalized, and empties the row", async () => {
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Pas encore de table sectorielle.");
    await user.type(screen.getByLabelText("Nouveau ticker"), " nvda");
    await user.type(screen.getByLabelText("Secteur du nouveau ticker"), "Semis");
    await user.type(screen.getByLabelText("Score du nouveau ticker"), "8,5");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    await waitFor(() => expect(shownTickers()).toEqual(["NVDA"]));
    expect(await db.sectors.get("NVDA")).toMatchObject({ ticker: "NVDA", name: "", category: "Semis", score: 8.5, status: "" });
    expect(screen.getByLabelText("Nouveau ticker")).toHaveValue("");
    expect(screen.getByLabelText("Nouveau ticker")).toHaveFocus();
  });

  it("keeps Add disabled without a ticker, and adds on Enter", async () => {
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Pas encore de table sectorielle.");
    expect(screen.getByRole("button", { name: "Ajouter" })).toBeDisabled();
    await user.type(screen.getByLabelText("Nouveau ticker"), "amd{Enter}");
    await waitFor(async () => expect(await db.sectors.get("AMD")).toBeDefined());
  });

  it("refuses a ticker already in the table, overwrites nothing and keeps what was typed", async () => {
    const existing = record("AAPL", { category: "Tech" });
    await db.sectors.put(existing);
    renderPage();
    const user = userEvent.setup();
    await screen.findAllByTestId("sector-row");
    await user.type(screen.getByLabelText("Nouveau ticker"), "aapl");
    await user.type(screen.getByLabelText("Secteur du nouveau ticker"), "Other");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    expect(await screen.findByText("AAPL est déjà dans la table.")).toBeInTheDocument();
    expect(await db.sectors.get("AAPL")).toEqual(existing);
    expect(screen.getByLabelText("Secteur du nouveau ticker")).toHaveValue("Other");
  });

  it("refuses an unreadable score in the add row and adds nothing", async () => {
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Pas encore de table sectorielle.");
    await user.type(screen.getByLabelText("Nouveau ticker"), "X");
    await user.type(screen.getByLabelText("Score du nouveau ticker"), "high");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    expect(await screen.findByText("Score illisible : un nombre, ou vide.")).toBeInTheDocument();
    expect(await db.sectors.count()).toBe(0);
  });

  it("adds only once on a double Enter, and shows no false 'already in the table' error", async () => {
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Pas encore de table sectorielle.");
    await user.type(screen.getByLabelText("Nouveau ticker"), "nvda{Enter}{Enter}");
    await waitFor(() => expect(shownTickers()).toEqual(["NVDA"]));
    expect(screen.queryByText("NVDA est déjà dans la table.")).not.toBeInTheDocument();
  });

  it("saves an edited field when it loses focus, and on Enter", async () => {
    await db.sectors.put(record("AAPL", { name: "Apple", category: "Tech", score: 7, status: "on" }));
    renderPage();
    const user = userEvent.setup();
    const category = await screen.findByLabelText("Secteur AAPL");
    await user.clear(category);
    await user.type(category, "Hardware");
    await user.tab();
    await waitFor(async () => expect(await db.sectors.get("AAPL")).toMatchObject({ category: "Hardware" }));

    const status = screen.getByLabelText("Statut AAPL");
    await user.clear(status);
    await user.type(status, "off{Enter}");
    await waitFor(async () => expect(await db.sectors.get("AAPL")).toMatchObject({ status: "off" }));
  });

  it("puts the stored value back on Escape and writes nothing", async () => {
    const stored = record("AAPL", { category: "Tech" });
    await db.sectors.put(stored);
    renderPage();
    const user = userEvent.setup();
    const category = await screen.findByLabelText("Secteur AAPL");
    await user.clear(category);
    await user.type(category, "Oops{Escape}");
    expect(category).toHaveValue("Tech");
    await user.tab();
    expect(await db.sectors.get("AAPL")).toEqual(stored);
  });

  it("does not rewrite a score typed back to the same value in a different spelling", async () => {
    const stored = record("AAPL", { score: 7.5, updatedAt: "2026-09-01T08:00:00.000Z" });
    await db.sectors.put(stored);
    renderPage();
    const user = userEvent.setup();
    const score = await screen.findByLabelText("Score AAPL");
    await user.clear(score);
    await user.type(score, "7,5");
    await user.tab();
    expect(score).toHaveValue("7.5");
    expect(await db.sectors.get("AAPL")).toEqual(stored);
  });

  it("does not rewrite a category typed back to the same value with trailing whitespace", async () => {
    const stored = record("AAPL", { category: "Tech", updatedAt: "2026-09-01T08:00:00.000Z" });
    await db.sectors.put(stored);
    renderPage();
    const user = userEvent.setup();
    const category = await screen.findByLabelText("Secteur AAPL");
    await user.clear(category);
    await user.type(category, "Tech ");
    await user.tab();
    expect(category).toHaveValue("Tech");
    expect(await db.sectors.get("AAPL")).toEqual(stored);
  });

  it("marks an unreadable score without saving it, then saves a decimal comma as a point", async () => {
    await db.sectors.put(record("AAPL", { score: 7 }));
    renderPage();
    const user = userEvent.setup();
    const score = await screen.findByLabelText("Score AAPL");
    await user.clear(score);
    await user.type(score, "high");
    await user.tab();
    await waitFor(() => expect(score).toHaveAttribute("aria-invalid", "true"));
    expect((await db.sectors.get("AAPL"))?.score).toBe(7);
    expect(score).toHaveValue("high");

    await user.clear(score);
    await user.type(score, "7,5");
    await user.tab();
    await waitFor(async () => expect((await db.sectors.get("AAPL"))?.score).toBe(7.5));
    await waitFor(() => expect(score).not.toHaveAttribute("aria-invalid"));
  });

  it("deletes a row only once confirmed", async () => {
    await db.sectors.bulkPut([record("AAPL"), record("MSFT")]);
    renderPage();
    const user = userEvent.setup();
    await screen.findAllByTestId("sector-row");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await user.click(screen.getByRole("button", { name: "Supprimer AAPL" }));
    expect(confirm).toHaveBeenCalledWith("Supprimer AAPL de la table sectorielle ?");
    expect(await db.sectors.count()).toBe(2);

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Supprimer AAPL" }));
    await waitFor(() => expect(shownTickers()).toEqual(["MSFT"]));
    expect(await db.sectors.get("AAPL")).toBeUndefined();
  });

  it("offers the sectors and statuses already in the table", async () => {
    await db.sectors.bulkPut([
      record("AAPL", { category: "Tech", status: "on" }),
      record("MSFT", { category: "Tech", status: "watch" }),
      record("XOM", { category: "Energy" }),
    ]);
    renderPage();
    const category = await screen.findByLabelText("Secteur AAPL");
    const options = (input: HTMLElement) =>
      [...document.getElementById(input.getAttribute("list")!)!.querySelectorAll("option")].map((option) => option.value);
    expect(options(category)).toEqual(["Energy", "Tech"]);
    expect(options(screen.getByLabelText("Statut AAPL"))).toEqual(["on", "watch"]);
    expect(screen.getByLabelText("Secteur du nouveau ticker")).toHaveAttribute("list", category.getAttribute("list"));
  });

  it("says 0 in the En cours column for every ticker when no account holds anything", async () => {
    await db.sectors.bulkPut([record("AAPL"), record("XOM")]);
    renderPage();
    expect(await screen.findByRole("columnheader", { name: "En cours" })).toBeInTheDocument();
    await waitFor(() => expect(ongoingCells()).toEqual([["AAPL", "0", false], ["XOM", "0", false]]));
  });

  it("says 1 in green for a ticker held as a share or an option by any account, and follows the snapshots live", async () => {
    await db.sectors.bulkPut([record("AAPL"), record("MQZA"), record("XOM")]);
    await db.snapshots.bulkPut([
      snapshot("beta", [position({ symbol: "AAPL" })]),
      snapshot("alpha", [position({ symbol: "MQZA", secType: "OPT", right: "P", strike: 20, expiry: "2026-10-16", quantity: -1 })]),
    ]);
    renderPage();
    await waitFor(() => expect(ongoingCells()).toEqual([["AAPL", "1", true], ["MQZA", "1", true], ["XOM", "0", false]]));
    await db.snapshots.delete("beta");
    await waitFor(() => expect(ongoingCells()).toEqual([["AAPL", "0", false], ["MQZA", "1", true], ["XOM", "0", false]]));
  });

  it("keeps a field being typed into when its row is rewritten underneath, and follows the untouched ones", async () => {
    await db.sectors.put(record("AAPL", { name: "Apple", category: "Tech" }));
    renderPage();
    const user = userEvent.setup();
    const name = await screen.findByLabelText("Nom AAPL");
    await user.clear(name);
    await user.type(name, "Apple Computer");
    // What a CSV import does to the row while the user is typing.
    await updateSector(db, "AAPL", { category: "Hardware" });
    await waitFor(() => expect(screen.getByLabelText("Secteur AAPL")).toHaveValue("Hardware"));
    expect(name).toHaveValue("Apple Computer");
  });
});
