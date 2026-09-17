import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { buildRiskReport, type RiskReport } from "@ib/coverage";
import i18n from "@/i18n";
import { UncoveredCard } from "@/components/UncoveredCard";
import { SAMPLE_POSITIONS, SAMPLE_SNAPSHOT } from "@/mocks/positions";

function renderCard(report: RiskReport | null) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <UncoveredCard accountId="alpha" report={report} />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe("UncoveredCard", () => {
  it("lists the uncovered positions with their uncovered quantity", () => {
    renderCard(buildRiskReport(SAMPLE_SNAPSHOT.positions, SAMPLE_SNAPSHOT.cashAvailable));
    const card = screen.getByLabelText("Positions non couvertes");
    expect(within(card).getByText("AAPL Feb20'26 155 Call")).toBeInTheDocument();
    // "1" twice: the card's count badge and the row's uncovered quantity.
    expect(within(card).getAllByText("1")).toHaveLength(2);
  });

  it("shows the covered state when nothing is uncovered", () => {
    renderCard(buildRiskReport([SAMPLE_POSITIONS[5]], 42000));
    expect(screen.getByText("Aucune position non couverte.")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("points at the data sources without a snapshot, and counts nothing", () => {
    renderCard(null);
    const card = screen.getByLabelText("Positions non couvertes");
    expect(within(card).getByText(/Aucun snapshot de positions : importez un relevé HTML ou une réponse Flex/)).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Aller aux sources de données" })).toHaveAttribute("href", "/accounts/alpha/sources");
    expect(within(card).queryByText("0")).not.toBeInTheDocument();
    expect(within(card).queryByText("Aucune position non couverte.")).not.toBeInTheDocument();
  });
});
