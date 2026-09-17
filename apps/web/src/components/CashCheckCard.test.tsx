import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import type { CashCheck } from "@ib/ledger";
import i18n from "@/i18n";
import { CashCheckCard } from "@/components/CashCheckCard";

function renderCard(checks: CashCheck[]) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <CashCheckCard accountId="beta" checks={checks} />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

const END = { asOf: "2026-09-09", amount: 12345.67 };

describe("CashCheckCard", () => {
  it("says the balance comes back to the Starting Cash, within how much", () => {
    renderCard([{ currency: "USD", offset: 0.06, end: END, start: { asOf: "2022-01-01", amount: 0, balance: 0.06, gap: 0.06 } }]);
    expect(
      screen.getByText("USD : solde calé sur le cash de fin du 2026-09-09 (12,345.67), retrouvé au 2022-01-01 sur le Starting Cash (0.00) à 0.06 près"),
    ).toBeInTheDocument();
    expect(screen.getByText("OK")).toHaveClass("text-success");
    expect(screen.queryByText(/historique incomplet/)).not.toBeInTheDocument();
  });

  it("shows a gap beyond the tolerance, signed, with the hint", () => {
    renderCard([{ currency: "EUR", offset: 0, end: END, start: { asOf: "2025-01-01", amount: 1000, balance: 987.5, gap: -12.5 } }]);
    expect(screen.getByText("-12.50")).toHaveClass("text-warning");
    expect(
      screen.getByText("EUR : solde calé sur le cash de fin du 2026-09-09 (12,345.67), mais 987.50 au 2025-01-01 contre un Starting Cash de 1,000.00"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Un historique incomplet/)).toBeInTheDocument();
  });

  it("says when the start was never checked", () => {
    renderCard([{ currency: "USD", offset: 3, end: END, start: null }]);
    expect(screen.getByText("USD : solde calé sur le cash de fin du 2026-09-09 (12,345.67), début non vérifié")).toBeInTheDocument();
  });

  it("says when no Cash Report anchors a currency, and points at the data sources", () => {
    renderCard([{ currency: "USD", offset: 0, end: null, start: null }]);
    expect(screen.getByText("USD : aucun Cash Report, le solde part de 0")).toBeInTheDocument();
    expect(screen.getByText(/Ajoutez la section Cash Report/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Aller aux sources de données" })).toHaveAttribute("href", "/accounts/beta/sources");
  });

  it("carries its title", () => {
    renderCard([{ currency: "USD", offset: 0, end: null, start: null }]);
    expect(screen.getByLabelText("Cohérence du cash")).toHaveTextContent(/^Cohérence du cash/);
  });
});
