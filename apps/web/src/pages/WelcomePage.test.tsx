import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, expect, it } from "vitest";
import i18n from "@/i18n";
import { db } from "@/db/schema";
import { WelcomePage } from "@/pages/WelcomePage";

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={["/welcome"]}>
        <Routes>
          <Route path="/welcome" element={<WelcomePage />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(async () => {
  await db.accounts.clear();
});

it("leads to adding an account, to the help and to a backup restore", () => {
  renderPage();
  expect(screen.getByRole("link", { name: "Ajouter un compte IB" })).toHaveAttribute("href", "/accounts");
  // Once in the actions, once in the footer.
  const help = screen.getAllByRole("link", { name: "Aide" });
  expect(help).toHaveLength(2);
  for (const link of help) expect(link).toHaveAttribute("href", "/help");
  expect(screen.getByRole("link", { name: "Restaurer une sauvegarde" })).toHaveAttribute("href", "/settings");
  expect(screen.getByRole("button", { name: "Explorer la démo" })).toBeInTheDocument();
});

it("still renders when accounts exist", async () => {
  await db.accounts.put({ id: "alpha", label: "alpha", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [] });
  renderPage();
  expect(screen.getByRole("link", { name: "Ajouter un compte IB" })).toBeInTheDocument();
});

it("walks through the features, privacy, how it works and the FAQ", () => {
  renderPage();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Vos options Interactive Brokers, lues stratégie par stratégie.");
  for (const id of ["dashboard", "positions", "wheel", "journal-wheel", "condors", "history"]) {
    expect(document.querySelector(`img[src^="/welcome/${id}."]`)).not.toBeNull();
  }
  expect(screen.getByRole("link", { name: /sécurité/i })).toHaveAttribute("href", "/help#security");
  expect(screen.getByText("Est-ce gratuit ?")).toBeInTheDocument();
  expect(screen.getByText("Aucun frais d'utilisation.")).toBeInTheDocument();
});
