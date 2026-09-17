import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@/api/session";
import { SessionMenuItem } from "./SessionMenuItem";

function renderItem() {
  return render(
    <MemoryRouter>
      <SessionProvider>
        <SessionMenuItem />
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe("SessionMenuItem", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders nothing while the session is still loading", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));
    const { container } = renderItem();
    expect(container).toBeEmptyDOMElement();
  });

  it("offers a sign-in link when anonymous", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    renderItem();
    const link = await screen.findByRole("link", { name: "Se connecter" });
    expect(link).toHaveAttribute("href", "/login");
  });

  it("offers the same sign-in link when the server is unreachable, with no alarm", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    renderItem();
    const link = await screen.findByRole("link", { name: "Se connecter" });
    expect(link).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the email and a sign-out control when authenticated, which signs out on click", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/auth/session") && init?.method === "DELETE") {
        return new Response("{}", { status: 200 });
      }
      if (url.includes("/auth/session")) {
        return new Response(JSON.stringify({ data: { user: { id: 7, email: "a@example.com" } } }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    const user = userEvent.setup();
    renderItem();

    expect(await screen.findByText("a@example.com")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Se déconnecter" }));

    await waitFor(() => expect(screen.getByRole("link", { name: "Se connecter" })).toBeInTheDocument());
  });
});
