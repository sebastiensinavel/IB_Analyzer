import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import i18n from "@/i18n";
import { AccountSwitcher } from "@/components/AccountSwitcher";
import { db } from "@/db/schema";
import type { AlertStateRecord } from "@/db/schema";

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

const accounts = [
  { id: "alpha", label: "alpha", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [] },
  { id: "beta", label: "beta", ibAccountId: "U0000002", createdAt: "", warnedDroppedKinds: [] },
];

function renderSwitcher(path = "/accounts/alpha/dashboard") {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <Routes>
          <Route path="*" element={<AccountSwitcher accountId="alpha" accounts={accounts} />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe("AccountSwitcher", () => {
  it("navigates to the other account's dashboard when selected", async () => {
    const user = userEvent.setup();
    renderSwitcher();
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByText("beta"));
    expect(screen.getByTestId("location")).toHaveTextContent("/accounts/beta/dashboard");
  });

  it("stays on the same page of the other account", async () => {
    const user = userEvent.setup();
    renderSwitcher("/accounts/alpha/positions/leaps");
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByText("beta"));
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/accounts\/beta\/positions\/leaps$/);
  });

  it("opens the other account's dashboard from a page outside the account scope", async () => {
    const user = userEvent.setup();
    renderSwitcher("/settings");
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByText("beta"));
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/accounts\/beta\/dashboard$/);
  });

  it("offers to add an account", async () => {
    const user = userEvent.setup();
    renderSwitcher();
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByText("Ajouter un compte…"));
    expect(screen.getByTestId("location")).toHaveTextContent("/accounts");
  });
});

describe("AccountSwitcher in the demo", () => {
  afterEach(() => window.sessionStorage.clear());

  it("offers to leave the demo instead of adding an account", async () => {
    window.sessionStorage.setItem("ib2:demo", "1");
    const user = userEvent.setup();
    renderSwitcher();
    await user.click(screen.getByRole("combobox"));
    expect(await screen.findByText("Quitter la démo")).toBeInTheDocument();
    expect(screen.queryByText("Ajouter un compte…")).toBeNull();
  });
});

describe("AccountSwitcher alert badges", () => {
  beforeEach(() => db.alertStates.clear());
  afterEach(() => db.alertStates.clear());

  const state = (accountId: string, alertId: string, fields: Partial<AlertStateRecord> = {}): AlertStateRecord => ({
    accountId, alertId, triggeredAt: "2026-09-30T18:00:00.000Z", acknowledgedAt: null, disabled: false, armed: false, anchor: null, override: null, ...fields,
  });

  it("shows the other accounts' triggered alerts on the closed button, never the current one's", async () => {
    await db.alertStates.bulkPut([
      state("alpha", "manual:1"),
      state("beta", "manual:2"),
      state("beta", "manual:3"),
      state("beta", "manual:4", { acknowledgedAt: "2026-09-30T18:05:00.000Z" }),
    ]);
    renderSwitcher();
    const trigger = await screen.findByRole("combobox", { name: "Compte" });
    await waitFor(() => expect(within(trigger).getByLabelText(/^2 alertes/)).toBeInTheDocument());
    expect(trigger).toHaveTextContent(/^alpha/);
  });

  it("shows each account's count in the list", async () => {
    await db.alertStates.bulkPut([state("alpha", "manual:1"), state("beta", "manual:2")]);
    renderSwitcher();
    await userEvent.click(await screen.findByRole("combobox", { name: "Compte" }));
    const beta = await screen.findByRole("option", { name: /beta/ });
    await waitFor(() => expect(within(beta).getByLabelText(/^1 alerte/)).toBeInTheDocument());
  });

  it("shows nothing when nothing is triggered", async () => {
    renderSwitcher();
    const trigger = await screen.findByRole("combobox", { name: "Compte" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(within(trigger).queryByLabelText(/alerte/i)).toBeNull();
  });
});
