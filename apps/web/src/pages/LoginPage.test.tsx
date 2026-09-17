import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@/api/session";
import LoginPage from "./LoginPage";

function renderPage() {
  render(
    <MemoryRouter>
      <SessionProvider>
        <LoginPage />
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe("LoginPage", () => {
  it("shows the rejection message when the credentials are refused", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/auth/login")) return new Response(JSON.stringify({ errors: [] }), { status: 400 });
      return new Response("{}", { status: 401 });
    });

    renderPage();
    await userEvent.type(screen.getByLabelText(/e-?mail/i), "a@example.com");
    await userEvent.type(screen.getByLabelText(/mot de passe|password/i), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /se connecter|sign in/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("says the server is unreachable rather than blaming the credentials", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    renderPage();
    await userEvent.type(screen.getByLabelText(/e-?mail/i), "a@example.com");
    await userEvent.type(screen.getByLabelText(/mot de passe|password/i), "whatever");
    await userEvent.click(screen.getByRole("button", { name: /se connecter|sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/injoignable|unreachable/i);
  });

  it("shows the second-factor code step, never a rejection, when the password is valid but 2FA is pending", async () => {
    // Constaté shape (django-allauth 65.19.2, HTTP 401): a valid password with a second
    // factor pending carries data.flows with a pending mfa_authenticate entry — see
    // allauth.ts's own tests. This must never be read as a wrong password: if the
    // mfa_required and rejected branches were ever merged or swapped, this test would fail
    // either on the missing code field or on a stray alert.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/auth/login")) {
        return new Response(
          JSON.stringify({
            data: { flows: [{ id: "login" }, { id: "mfa_authenticate", is_pending: true, types: ["totp"] }] },
            meta: { is_authenticated: false },
          }),
          { status: 401 },
        );
      }
      return new Response("{}", { status: 401 });
    });

    renderPage();
    await userEvent.type(screen.getByLabelText(/e-?mail/i), "a@example.com");
    await userEvent.type(screen.getByLabelText(/mot de passe|password/i), "correct-horse-battery");
    await userEvent.click(screen.getByRole("button", { name: /se connecter|sign in/i }));

    expect(await screen.findByLabelText(/code/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
