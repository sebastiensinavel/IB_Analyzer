import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@/api/session";
import { DbProvider, useDb } from "./DbProvider";
import { db } from "./schema";

vi.mock("./profile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./profile")>();
  return {
    ...actual,
    adoptDefaultProfile: vi.fn(async (userId: string) => {
      if (userId === "boom") throw new Error("boom");
      return actual.adoptDefaultProfile(userId);
    }),
  };
});

function Probe() {
  const database = useDb();
  return <div data-testid="db-name">{database.name}</div>;
}

function renderWithSession(fetchImpl: typeof fetch) {
  vi.spyOn(globalThis, "fetch").mockImplementation(fetchImpl);
  return render(
    <SessionProvider>
      <DbProvider>
        <Probe />
      </DbProvider>
    </SessionProvider>,
  );
}

function sessionResponseFor(userId: string) {
  return async () => new Response(JSON.stringify({ data: { user: { id: userId, email: "a@example.com" } } }), { status: 200 });
}

describe("DbProvider", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("serves the default profile while there is no session", async () => {
    renderWithSession(async () => new Response("{}", { status: 401 }));
    await waitFor(() => expect(screen.getByTestId("db-name")).toHaveTextContent(db.name));
  });

  it("falls back to the default profile, without an unhandled rejection, when opening the session's profile fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const rejections: unknown[] = [];
    const onRejection = (event: PromiseRejectionEvent) => rejections.push(event.reason);
    window.addEventListener("unhandledrejection", onRejection);

    renderWithSession(sessionResponseFor("boom"));

    // The failure is logged, not swallowed and not left as an unhandled
    // rejection for the console to report on its own.
    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to open the IndexedDB profile for the current session",
        expect.any(Error),
      ),
    );
    // Never stuck on nothing, and never silently left on a stale previous
    // profile: the fallback lands on the always-safe default database.
    expect(screen.getByTestId("db-name")).toHaveTextContent(db.name);

    // Give any late microtask a chance to surface as an unhandled rejection
    // before asserting there was none.
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.removeEventListener("unhandledrejection", onRejection);
    expect(rejections).toHaveLength(0);
  });
});
