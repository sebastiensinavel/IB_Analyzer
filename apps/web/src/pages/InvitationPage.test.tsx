import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@/api/session";
import InvitationPage from "./InvitationPage";

function Probe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderPage(token = "abc123") {
  return render(
    <MemoryRouter initialEntries={[`/invitation/${token}`]}>
      <SessionProvider>
        <Probe />
        <Routes>
          <Route path="/invitation/:token" element={<InvitationPage />} />
          <Route path="/" element={null} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );
}

function mockFetch(handler: (url: string) => Response) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    return handler(url);
  });
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("InvitationPage", () => {
  beforeEach(() => {
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    vi.restoreAllMocks();
  });

  it("shows the invalid-invitation message for a bad token", async () => {
    mockFetch((url) => {
      if (url.includes("/core/invitations/accept")) {
        return jsonResponse({ code: "invitation-invalid", detail: "Invitation inconnue." }, 400);
      }
      return jsonResponse({}, 401);
    });

    renderPage();
    await userEvent.type(screen.getByLabelText(/mot de passe/i), "correct-horse-battery");
    await userEvent.click(screen.getByRole("button", { name: /valider/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Cette invitation n'est plus valable.");
  });

  it("shows the server's detail when the password is refused", async () => {
    mockFetch((url) => {
      if (url.includes("/core/invitations/accept")) {
        return jsonResponse({ code: "password-invalid", detail: "Ce mot de passe est trop courant." }, 400);
      }
      return jsonResponse({}, 401);
    });

    renderPage();
    await userEvent.type(screen.getByLabelText(/mot de passe/i), "password");
    await userEvent.click(screen.getByRole("button", { name: /valider/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ce mot de passe est trop courant.");
  });

  it("shows a discreet unreachable message and re-enables the button when the network fails", async () => {
    // openapi-fetch's `api` client has no `onError` middleware (client.ts), so a rejected
    // fetch rethrows out of `api.POST` itself instead of coming back as `{ error }` — this
    // must never leave the submit button disabled forever with nothing said on screen.
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    renderPage();
    await userEvent.type(screen.getByLabelText(/mot de passe/i), "correct-horse-battery");
    const submit = screen.getByRole("button", { name: /valider/i });
    await userEvent.click(submit);

    expect(await screen.findByRole("alert")).toHaveTextContent(/injoignable|unreachable/i);
    expect(submit).not.toBeDisabled();
  });

  it("refreshes the session and redirects home on success", async () => {
    mockFetch((url) => {
      if (url.includes("/core/invitations/accept")) return jsonResponse({ id: "1", email: "a@example.com" }, 200);
      if (url.includes("/auth/session")) {
        return jsonResponse({ data: { user: { id: 1, email: "a@example.com" } } }, 200);
      }
      return jsonResponse({}, 200);
    });

    renderPage();
    await userEvent.type(screen.getByLabelText(/mot de passe/i), "correct-horse-battery");
    await userEvent.click(screen.getByRole("button", { name: /valider/i }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/"));
  });
});
