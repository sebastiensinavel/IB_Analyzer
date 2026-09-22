import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import i18n from "@/i18n";
import { FirstStepCard } from "./FirstStepCard";

function renderCard(showSourcesLink?: boolean) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <FirstStepCard accountId="beta" showSourcesLink={showSourcesLink} />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe("FirstStepCard", () => {
  it("names the two ways to feed an account and links to both pages", () => {
    renderCard();
    expect(screen.getByText("Première étape")).toBeInTheDocument();
    expect(screen.getByText(/relevé d'activité HTML/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Aller aux sources de données" })).toHaveAttribute(
      "href",
      "/accounts/beta/sources",
    );
    expect(screen.getByRole("link", { name: "Comment obtenir un relevé" })).toHaveAttribute("href", "/help#statement");
  });

  // On the Sources page itself, a link to the Sources page is noise; the Help link is not.
  it("drops the sources link when asked, keeping the help link", () => {
    renderCard(false);
    expect(screen.queryByRole("link", { name: "Aller aux sources de données" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Comment obtenir un relevé" })).toBeInTheDocument();
  });
});
