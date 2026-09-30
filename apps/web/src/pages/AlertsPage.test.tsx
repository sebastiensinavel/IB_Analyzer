import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "@ib/ledger";
import { mergeQuotes, resetQuotes } from "@/agent/quotes";
import { refreshPresence, resetAgentState } from "@/agent/useAgentSync";
import { AccountDataProvider } from "@/db/AccountDataProvider";
import { createManualAlert } from "@/db/alerts";
import { db, type AccountRecord } from "@/db/schema";
import i18n from "@/i18n";
import { SAMPLE_JOURNAL_TRANSACTIONS } from "@/mocks/journals";
import { AlertsPage } from "@/pages/AlertsPage";

const account = (fields: Partial<AccountRecord> = {}): AccountRecord => ({
  id: "beta", label: "beta", ibAccountId: "U0000000", createdAt: "2026-09-01T00:00:00.000Z", warnedDroppedKinds: [], ...fields,
});

function trade(overrides: Partial<Transaction>): Transaction {
  return {
    accountId: "beta", externalId: "", source: "flex", kind: "trade", symbol: "", secType: "OPT", right: "", strike: null, expiry: null,
    quantity: null, price: null, amount: null, commission: -1, currency: "USD", when: "", description: "", ...overrides,
  };
}

/** MQZA assigned at 17, then a call 15 sold under it: one open Wheel alert, its S₀ still to observe. */
const WHEEL_TRANSACTIONS: Transaction[] = [
  ...SAMPLE_JOURNAL_TRANSACTIONS.slice(0, 5),
  trade({ externalId: "flex:trade:301", symbol: "MQZA  261016C00015000", right: "C", strike: 15, expiry: "2026-10-16", quantity: -2, price: 0.4, amount: 80, when: "2026-09-29T14:30:00.000Z" }),
];
const WHEEL_ID = "wheel:MQZA|OPT|C|15|2026-10-16|USD";

function mockAgent(present: boolean) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/health")) {
      if (!present) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ version: "0.1.0" }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
}

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={["/accounts/beta/alerts"]}>
        <Routes>
          <Route
            path="/accounts/:accountId/alerts"
            element={
              <AccountDataProvider accountId="beta">
                <AlertsPage />
              </AccountDataProvider>
            }
          />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

const rowOf = (ticker: string) => screen.getByRole("link", { name: ticker }).closest("tr") as HTMLElement;
const groupLabels = () => screen.getAllByRole("row").map((row) => row.textContent ?? "").filter((text) => /^(Déclenchées|Actives|Désactivées)/.test(text));

beforeEach(async () => {
  resetQuotes();
  resetAgentState();
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  vi.stubGlobal("Notification", class { static permission = "default"; static requestPermission = vi.fn(async () => "granted"); });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetQuotes();
  resetAgentState();
});

describe("AlertsPage", () => {
  it("says there is no alert on an empty account", async () => {
    await db.accounts.add(account());
    renderPage();
    expect(await screen.findByText(/Aucune alerte/)).toBeInTheDocument();
  });

  it("groups triggered, active and disabled alerts in that order, the triggered one edged in warning and the disabled one dimmed", async () => {
    await db.accounts.add(account());
    await createManualAlert(db, "beta", { ticker: "OFFZ", price: 10, direction: "above" });
    await createManualAlert(db, "beta", { ticker: "ACTV", price: 50, direction: "above", note: "à surveiller" });
    const hit = await createManualAlert(db, "beta", { ticker: "HITT", price: 245, direction: "below" });
    const off = await createManualAlert(db, "beta", { ticker: "OFFZ", price: 10, direction: "above" });
    await db.alertStates.put({ accountId: "beta", alertId: off, triggeredAt: null, acknowledgedAt: "2026-09-29T10:00:00.000Z", disabled: true, armed: true, anchor: null, override: null });
    mockAgent(true);
    await refreshPresence();
    renderPage();
    await screen.findByText("ACTV");
    act(() => mergeQuotes(new Map([["HITT", { last: 244, change: null }]])));
    await waitFor(() => expect(rowOf("HITT")).toHaveAttribute("data-status", "triggered"));
    expect(hit).toMatch(/^manual:/);
    expect(groupLabels()).toEqual(["Déclenchées (1)", "Actives (2)", "Désactivées (1)"]);
    expect(rowOf("HITT")).toHaveClass("border-l-2", "border-l-warning");
    expect(rowOf("ACTV")).not.toHaveClass("border-l-warning");
    expect(screen.getAllByRole("link", { name: "OFFZ" }).at(-1)?.closest("tr")).toHaveClass("opacity-60");
    // Cours 244, seuil 245 déjà franchi : distance négative ; temps réel inconnu → différé.
    expect(within(rowOf("HITT")).getByText("244.00")).toBeInTheDocument();
    expect(within(rowOf("HITT")).getByText("-0.4%")).toBeInTheDocument();
    expect(within(rowOf("ACTV")).getByText("à surveiller")).toBeInTheDocument();
  });

  it("'Vu' disables a triggered manual alert and moves it to Disabled; 'Réactiver' brings it back, re-arming on the side of the price", async () => {
    await db.accounts.add(account());
    const id = await createManualAlert(db, "beta", { ticker: "HITT", price: 245, direction: "below" });
    mockAgent(true);
    await refreshPresence();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("HITT");
    act(() => mergeQuotes(new Map([["HITT", { last: 244, change: null }]])));
    await waitFor(() => expect(rowOf("HITT")).toHaveAttribute("data-status", "triggered"));

    await user.click(within(rowOf("HITT")).getByRole("button", { name: "Vu" }));
    await waitFor(() => expect(rowOf("HITT")).toHaveAttribute("data-status", "disabled"));
    expect(groupLabels()).toEqual(["Désactivées (1)"]);
    expect((await db.alertStates.get(["beta", id]))?.disabled).toBe(true);

    await user.click(within(rowOf("HITT")).getByRole("button", { name: "Réactiver" }));
    // The price is 244, under the 245 threshold: the alert now waits for a rise.
    await waitFor(() => expect(rowOf("HITT")).toHaveAttribute("data-status", "active"));
    expect((await db.alerts.get(id))?.direction).toBe("above");
    expect((await db.alertStates.get(["beta", id]))?.disabled).toBe(false);
  });

  it("deletes a manual alert", async () => {
    await db.accounts.add(account());
    const id = await createManualAlert(db, "beta", { ticker: "ACTV", price: 50, direction: "above" });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Supprimer l'alerte ACTV" }));
    await waitFor(() => expect(screen.queryByText("ACTV")).toBeNull());
    expect(await db.alerts.get(id)).toBeUndefined();
  });

  it("writes the account's margins on blur, and puts a refused value back", async () => {
    await db.accounts.add(account());
    const user = userEvent.setup();
    renderPage();
    const wheel = await screen.findByRole("spinbutton", { name: "Wheel" });
    expect(wheel).toHaveValue(70);
    expect(screen.getByRole("spinbutton", { name: "Condors" })).toHaveValue(15);

    await user.clear(wheel);
    await user.type(wheel, "60");
    await user.tab();
    await waitFor(async () => expect((await db.accounts.get("beta"))?.alertMargins).toEqual({ wheel: 0.6 }));

    const condors = screen.getByRole("spinbutton", { name: "Condors" });
    await user.clear(condors);
    await user.type(condors, "150{Enter}");
    expect(condors).toHaveValue(15);
    expect((await db.accounts.get("beta"))?.alertMargins).toEqual({ wheel: 0.6 });
  });

  it("writes the override of an automatic alert, and clears it when emptied", async () => {
    await db.accounts.add(account());
    await db.transactions.bulkAdd(WHEEL_TRANSACTIONS);
    const user = userEvent.setup();
    renderPage();
    const field = await screen.findByRole("spinbutton", { name: /Fraction de S₀ pour MQZA/ });
    expect(field).toHaveValue(null);
    expect(field).toHaveAttribute("placeholder", "70");
    expect(within(rowOf("MQZA")).getByText("S₀ en attente")).toBeInTheDocument();
    expect(within(rowOf("MQZA")).getByText("Wheel")).toBeInTheDocument();

    await user.type(field, "50");
    await user.tab();
    await waitFor(async () => expect((await db.alertStates.get(["beta", WHEEL_ID]))?.override).toBe(0.5));

    // The live query hands the stored value back to the field; only then does it make sense to empty it.
    await waitFor(() => expect(screen.getByRole("spinbutton", { name: /Fraction de S₀ pour MQZA/ })).toHaveValue(50));
    await user.clear(screen.getByRole("spinbutton", { name: /Fraction de S₀ pour MQZA/ }));
    await user.tab();
    await waitFor(async () => expect((await db.alertStates.get(["beta", WHEEL_ID]))?.override).toBeNull());
  });

  it("links a ticker to the positions of its strategy, and a manual alert to Positions", async () => {
    await db.accounts.add(account());
    await db.transactions.bulkAdd(WHEEL_TRANSACTIONS);
    await createManualAlert(db, "beta", { ticker: "ACTV", price: 50, direction: "above" });
    renderPage();
    expect(await screen.findByRole("link", { name: "MQZA" })).toHaveAttribute("href", "/accounts/beta/positions/wheel");
    expect(screen.getByRole("link", { name: "ACTV" })).toHaveAttribute("href", "/accounts/beta/positions");
  });

  it("says the alerts are not evaluated without the agent, and shows a dash for the price and the distance", async () => {
    await db.accounts.add(account());
    await createManualAlert(db, "beta", { ticker: "ACTV", price: 50, direction: "above" });
    act(() => mergeQuotes(new Map([["ACTV", { last: 48, change: null }]])));
    mockAgent(false);
    await refreshPresence();
    renderPage();
    await screen.findByText("ACTV");
    expect(screen.getByText(/L'agent local est absent/)).toBeInTheDocument();
    const cells = within(rowOf("ACTV")).getAllByRole("cell");
    // Type, Ticker, Seuils, Cours, Distance: the last two are dashes though a quote is held.
    expect(cells[3]).toHaveTextContent("—");
    expect(cells[4]).toHaveTextContent("—");
  });

  it("shows no such line with the agent present, and a dash while the quote is unknown", async () => {
    await db.accounts.add(account());
    await createManualAlert(db, "beta", { ticker: "ACTV", price: 50, direction: "above" });
    mockAgent(true);
    await refreshPresence();
    renderPage();
    await screen.findByText("ACTV");
    expect(screen.queryByText(/L'agent local est absent/)).toBeNull();
    const cells = within(rowOf("ACTV")).getAllByRole("cell");
    expect(cells[3]).toHaveTextContent("—");
    expect(cells[4]).toHaveTextContent("—");
  });

  it("offers to enable notifications only while the permission is undecided", async () => {
    await db.accounts.add(account());
    const user = userEvent.setup();
    renderPage();
    const button = await screen.findByRole("button", { name: "Activer les notifications" });
    await user.click(button);
    expect(Notification.requestPermission).toHaveBeenCalled();
    cleanup();
    vi.stubGlobal("Notification", class { static permission = "granted"; });
    renderPage();
    await screen.findByRole("heading", { name: "Alertes" });
    expect(screen.queryByRole("button", { name: "Activer les notifications" })).toBeNull();
  });
});
