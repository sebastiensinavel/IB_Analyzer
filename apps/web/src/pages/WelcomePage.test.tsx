import { render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { db } from "@/db/schema";
import { navigation } from "@/demo/mode";
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

afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

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

it("leads back into the app once an account exists", async () => {
  await db.accounts.put({ id: "alpha", label: "alpha", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [] });
  renderPage();
  expect(await screen.findByRole("link", { name: "Explorer vos comptes IB" })).toHaveAttribute("href", "/");
  expect(screen.queryByRole("link", { name: "Ajouter un compte IB" })).toBeNull();
});

it("walks through the features, privacy, how it works and the FAQ", () => {
  renderPage();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Vos options Interactive Brokers, lues stratégie par stratégie.");
  for (const id of ["dashboard", "positions", "wheel", "journal-wheel", "condors", "history"]) {
    expect(document.querySelector(`img[src^="/shots/${id}."]`)).not.toBeNull();
  }
  expect(screen.getByRole("link", { name: /sécurité/i })).toHaveAttribute("href", "/help#security");
  expect(screen.getByText("Est-ce gratuit ?")).toBeInTheDocument();
  expect(screen.getByText("Aucun frais d'utilisation.")).toBeInTheDocument();
  expect(screen.getByText("Que faire si une seule stratégie m'intéresse ?")).toBeInTheDocument();
});

it("enters the demo from the welcome page", async () => {
  const assign = vi.spyOn(navigation, "assign").mockImplementation(() => {});
  renderPage();
  await userEvent.setup().click(screen.getByRole("button", { name: "Explorer la démo" }));
  expect(assign).toHaveBeenCalledWith("/accounts/demo/dashboard");
});

it("in the demo, shows the banner, continues the demo and leaves it to add an account", async () => {
  window.sessionStorage.setItem("ib2:demo", "1");
  vi.spyOn(db, "close").mockImplementation(() => {});
  const assign = vi.spyOn(navigation, "assign").mockImplementation(() => {});
  renderPage();
  expect(screen.getByRole("status")).toHaveTextContent("Mode démonstration — données fictives");
  expect(screen.getByRole("link", { name: "Continuer la démo" })).toHaveAttribute("href", "/accounts/demo/dashboard");
  expect(screen.queryByRole("link", { name: "Ajouter un compte IB" })).toBeNull();
  await userEvent.setup().click(screen.getByRole("button", { name: "Ajouter un compte IB" }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith("/accounts"));
});

it("in the demo, leaves it for the real accounts when the browser holds one", async () => {
  await db.accounts.put({ id: "alpha", label: "alpha", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [] });
  window.sessionStorage.setItem("ib2:demo", "1");
  vi.spyOn(db, "close").mockImplementation(() => {});
  const assign = vi.spyOn(navigation, "assign").mockImplementation(() => {});
  renderPage();
  await userEvent.setup().click(await screen.findByRole("button", { name: "Explorer vos comptes IB" }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
  expect(screen.queryByRole("button", { name: "Ajouter un compte IB" })).toBeNull();
  expect(screen.getByRole("link", { name: "Continuer la démo" })).toBeInTheDocument();
  expect(window.sessionStorage.getItem("ib2:demo")).toBeNull();
});
