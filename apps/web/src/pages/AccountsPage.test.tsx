import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import i18n from "@/i18n";
import { SessionProvider } from "@/api/session";
import { db } from "@/db/schema";
import { AccountsPage } from "@/pages/AccountsPage";

function Probe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={["/accounts"]}>
        <Probe />
        <Routes>
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(async () => {
  await db.accounts.clear();
});

describe("AccountsPage", () => {
  it("says there is no account yet", async () => {
    renderPage();
    expect(await screen.findByText(/Aucun compte pour l'instant/)).toBeInTheDocument();
  });

  it("creates an account and lands on its data sources", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText("Libellé"), "Beta");
    await user.type(screen.getByLabelText("Identifiant de compte IB"), "u1234567");
    await user.click(screen.getByRole("button", { name: "Créer le compte" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/accounts/beta/sources"));
    expect(await db.accounts.get("beta")).toMatchObject({ ibAccountId: "U1234567" });
  });

  it("shows the error for a bad IB id and creates nothing", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText("Libellé"), "x");
    await user.type(screen.getByLabelText("Identifiant de compte IB"), "nope");
    await user.click(screen.getByRole("button", { name: "Créer le compte" }));
    expect(await screen.findByText("Ce n'est pas un identifiant de compte IB.")).toBeInTheDocument();
    expect(await db.accounts.count()).toBe(0);
  });

  it("lists existing accounts with a link to open them", async () => {
    await db.accounts.add({ id: "alpha", label: "Alpha", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [] });
    renderPage();
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ouvrir" })).toHaveAttribute("href", "/accounts/alpha/dashboard");
  });
});

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderWithSession(fetchImpl: typeof fetch) {
  vi.spyOn(globalThis, "fetch").mockImplementation(fetchImpl);
  return render(
    <I18nextProvider i18n={i18n}>
      <SessionProvider>
        <MemoryRouter initialEntries={["/accounts"]}>
          <Routes>
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="*" element={null} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </I18nextProvider>,
  );
}

/**
 * `/accounts` is the landing page of a device with no local account, and the only route a
 * newcomer reaches on their own. `SessionMenuItem` lives in the sidebar footer, which this
 * page does not render: signing in was a feature nobody could reach here without already
 * knowing the `/login` URL.
 */
describe("AccountsPage: session", () => {
  afterEach(() => vi.restoreAllMocks());

  it("offers a way to sign in when anonymous", async () => {
    renderWithSession(async () => jsonResponse({}, 401));
    const link = await screen.findByRole("link", { name: "Se connecter" });
    expect(link).toHaveAttribute("href", "/login");
  });

  it("offers the same way in when the server is unreachable, and raises no alarm", async () => {
    renderWithSession(async () => {
      throw new TypeError("Failed to fetch");
    });
    const link = await screen.findByRole("link", { name: "Se connecter" });
    expect(link).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows who is signed in, and signs out on click", async () => {
    renderWithSession(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/auth/session") && init?.method === "DELETE") return jsonResponse({}, 200);
      if (url.includes("/auth/session")) return jsonResponse({ data: { user: { id: 7, email: "a@example.com" } } }, 200);
      return jsonResponse({}, 200);
    });
    expect(await screen.findByText("a@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Se connecter" })).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Se déconnecter" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Se connecter" })).toBeInTheDocument());
  });

  it("shows nothing at all while the session is still loading", () => {
    renderWithSession(() => new Promise(() => {}));
    expect(screen.queryByRole("link", { name: "Se connecter" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Se déconnecter" })).not.toBeInTheDocument();
  });
});
