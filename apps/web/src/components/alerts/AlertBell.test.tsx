import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { Alert, AlertStatus, AlertThreshold } from "@ib/alerts";
import type { AlertView } from "@/alerts/useAlertEngine";
import i18n from "@/i18n";
import { AlertBell } from "./AlertBell";

const STATE = { alertId: "", triggeredAt: null, acknowledgedAt: null, disabled: false, armed: true, anchor: null, override: null };

function view(id: string, thresholds: AlertThreshold[], price: number | null = null, status: AlertStatus = "triggered"): AlertView {
  const alert = { id, kind: "manual", ticker: "NVDA", currency: "USD", thresholds, note: null, createdAt: "" } as Alert;
  return { alert, state: { ...STATE, alertId: id }, status, price: price === null ? null : ({ price } as AlertView["price"]), distance: null };
}

function renderBell(alerts: AlertView[]) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={["/accounts/alpha/positions"]}>
        <Routes>
          <Route path="/accounts/:accountId/positions" element={<AlertBell alerts={alerts} />} />
          <Route path="/accounts/:accountId/alerts" element={<p>page des alertes</p>} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

afterEach(() => i18n.changeLanguage("fr"));

describe("AlertBell", () => {
  it("ne rend rien sans alerte", () => {
    const { container } = renderBell([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("est un lien jaune vers la page des alertes, nommé par ses seuils, sans nombre", async () => {
    renderBell([view("m", [{ price: 38.2, direction: "above" }])]);
    const link = screen.getByRole("link", { name: "Alerte ↑ 38,20" });
    expect(link).toHaveClass("bg-warning", "text-warning-foreground");
    expect(link).not.toHaveClass("animate-pulse");
    expect(link).toHaveTextContent("");
    await userEvent.click(link);
    expect(await screen.findByText("page des alertes")).toBeInTheDocument();
  });

  it("liste chaque seuil franchi, dans la langue de l'interface", async () => {
    await i18n.changeLanguage("en");
    // Un condor : seul le seuil bas est franchi par le cours ; un second seuil d'une autre alerte.
    renderBell([
      view("condor:k", [{ price: 756, direction: "below" }, { price: 784, direction: "above" }], 750),
      view("m", [{ price: 1234.5, direction: "above" }]),
    ]);
    expect(screen.getByRole("link", { name: "Alert ↓ 756.00, Alert ↑ 1,234.50" })).toBeInTheDocument();
  });
});
