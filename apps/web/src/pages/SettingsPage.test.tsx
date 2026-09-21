import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@/api/session";
import { SettingsPage } from "./SettingsPage";

function renderPage() {
  return render(
    <MemoryRouter>
      <SessionProvider>
        <SettingsPage />
      </SessionProvider>
    </MemoryRouter>,
  );
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("SettingsPage", () => {
  beforeEach(() => {
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    vi.restoreAllMocks();
  });

  it("offers only a sign-in link when anonymous, no account-management cards", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, 401));

    renderPage();

    expect(await screen.findByText("Non connecté.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Se connecter" })).toHaveAttribute("href", "/login");
    expect(screen.queryByText("Changer le mot de passe")).not.toBeInTheDocument();
    expect(screen.queryByText("Authentification à deux facteurs")).not.toBeInTheDocument();
  });

  it("greys out account management with a discreet note when the server is unreachable, never an alarm", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    renderPage();

    expect(await screen.findByText("Non connecté.")).toBeInTheDocument();
    // The exact note, not a loose /Serveur injoignable/: the backup card on this same page says
    // the same thing about itself, and a regex that matches both stops telling them apart.
    expect(screen.getByText("Serveur injoignable : les réglages de compte sont indisponibles pour l'instant.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the account, the TOTP secret when not yet configured, and lets the password be changed", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      const method = init?.method ?? "GET";
      if (url.includes("/auth/session")) {
        return jsonResponse({ data: { user: { id: 7, email: "a@example.com" } } }, 200);
      }
      if (url.includes("/account/authenticators/totp") && method === "GET") {
        return jsonResponse({ meta: { secret: "JBSWY3DPEHPK3PXP", totp_url: "otpauth://totp/x" } }, 404);
      }
      if (url.includes("/account/authenticators/recovery-codes") && method === "GET") {
        return jsonResponse({}, 404);
      }
      if (url.includes("/account/password/change") && method === "POST") {
        return jsonResponse({ data: { user: { id: 7, email: "a@example.com" } } }, 200);
      }
      return jsonResponse({}, 200);
    });

    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("Connecté en tant que a@example.com")).toBeInTheDocument();
    expect(await screen.findByText(/JBSWY3DPEHPK3PXP/)).toBeInTheDocument();
    expect(await screen.findByText("Aucun code de secours généré pour l'instant.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Mot de passe actuel"), "old-password");
    await user.type(screen.getByLabelText("Nouveau mot de passe"), "new-password-123");
    await user.click(screen.getByRole("button", { name: "Valider" }));

    await waitFor(() => expect(screen.getByText("Mot de passe changé.")).toBeInTheDocument());
  });
});
