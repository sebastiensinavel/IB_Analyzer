import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import i18n from "@/i18n";
import { AccountSwitcher } from "@/components/AccountSwitcher";

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

const accounts = [
  { id: "alpha", label: "alpha", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [] },
  { id: "beta", label: "beta", ibAccountId: "U0000002", createdAt: "", warnedDroppedKinds: [] },
];

function renderSwitcher() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={["/accounts/alpha/dashboard"]}>
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

  it("offers to add an account", async () => {
    const user = userEvent.setup();
    renderSwitcher();
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByText("Ajouter un compte…"));
    expect(screen.getByTestId("location")).toHaveTextContent("/accounts");
  });
});
