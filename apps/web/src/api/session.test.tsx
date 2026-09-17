import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionProvider, useSession } from "./session";

function Probe() {
  const session = useSession();
  return <div data-testid="state">{session.status === "authenticated" ? session.user.email : session.status}</div>;
}

function renderProbe() {
  render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
}

describe("useSession", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("reports the user when the session endpoint answers 200", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/auth/session")) {
        return new Response(JSON.stringify({ data: { user: { id: 7, email: "a@example.com" } } }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("a@example.com"));
  });

  it("reports anonymous on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("anonymous"));
  });

  it("reports unreachable when the network fails, never an error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("unreachable"));
  });
});
