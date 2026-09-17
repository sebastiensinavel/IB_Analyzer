import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import type { Reconciliation } from "@ib/ledger";
import i18n from "@/i18n";
import { ReconciliationCard } from "@/components/ReconciliationCard";

function renderCard(reconciliation: Reconciliation) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <ReconciliationCard accountId="beta" reconciliation={reconciliation} />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

const PUT = { ticker: "MQZA", secType: "OPT", right: "P" as const, strike: 17, expiry: "2026-10-02", currency: "USD" };

describe("ReconciliationCard", () => {
  it("says the portfolio matches, dated by the snapshot", () => {
    renderCard({ asOf: "2026-09-02", differences: [], orphans: [] });
    expect(screen.getByText("Portefeuille reconstitué conforme au snapshot du 2026-09-02")).toBeInTheDocument();
  });

  it("lists the differences and the orphans", () => {
    renderCard({
      asOf: "2026-09-02",
      differences: [{ contract: PUT, label: "MQZA Oct02'26 17 Put", ledgerQty: -3, snapshotQty: -2 }],
      orphans: [{ id: "o" } as Reconciliation["orphans"][number]],
    });
    expect(screen.getByText("1 écart entre le portefeuille reconstitué et le snapshot du 2026-09-02")).toBeInTheDocument();
    expect(screen.getByText("MQZA Oct02'26 17 Put : ledger -3, snapshot -2")).toBeInTheDocument();
    expect(screen.getByText("1 ligne d'origine inconnue")).toBeInTheDocument();
    expect(screen.getByText(/ne remonte pas à l'ouverture/)).toBeInTheDocument();
  });

  it("points at the data sources without a snapshot", () => {
    renderCard({ asOf: null, differences: [], orphans: [] });
    expect(screen.getByText(/Aucun snapshot de positions : importez un relevé HTML ou une réponse Flex/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Aller aux sources de données" })).toHaveAttribute("href", "/accounts/beta/sources");
  });

  it("dates an agent snapshot by its instant", () => {
    renderCard({ asOf: "2026-09-06T13:02:00.000Z", differences: [], orphans: [] });
    expect(screen.getByText(/conforme au snapshot du 2026-09-06 13:02:00/)).toBeInTheDocument();
  });

  it("carries its title, in every state", () => {
    renderCard({ asOf: null, differences: [], orphans: [] });
    expect(screen.getByLabelText("Reconstitution du portefeuille")).toHaveTextContent(/^Reconstitution du portefeuille/);
  });
});
