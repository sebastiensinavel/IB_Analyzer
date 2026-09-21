import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@/api/session";
import { DbProvider, useDb } from "./DbProvider";
import { db } from "./schema";

function Probe() {
  const database = useDb();
  return <div data-testid="db-name">{database.name}</div>;
}

function renderWith(fetchImpl: typeof fetch) {
  vi.spyOn(globalThis, "fetch").mockImplementation(fetchImpl);
  return render(
    <SessionProvider>
      <DbProvider>
        <Probe />
      </DbProvider>
    </SessionProvider>,
  );
}

describe("DbProvider", () => {
  beforeEach(() => vi.restoreAllMocks());

  // Le bug du 2026-09-21 : la base suivait la session, donc toute coupure
  // affichait un portefeuille vide. Ce test est ce qui échouerait si on la
  // rebranchait.
  it.each([
    ["authentifiée", async () => new Response(JSON.stringify({ data: { user: { id: "9", email: "a@b.c" } } }), { status: 200 })],
    ["anonyme", async () => new Response("{}", { status: 401 })],
    ["serveur injoignable", async () => { throw new Error("offline"); }],
  ])("sert toujours la même base — session %s", async (_label, fetchImpl) => {
    renderWith(fetchImpl as typeof fetch);
    // The initial render already shows `db` (the provider's default state),
    // so an eager assertion would pass trivially even under the old,
    // session-dependent provider — it would only swap databases once its
    // effect resolves, a tick later. Let any such effect settle first, then
    // assert with strict equality: `toHaveTextContent` does a substring
    // match, so it would silently accept "ib-analyzer-9" as containing
    // "ib-analyzer".
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId("db-name").textContent).toBe(db.name);
    expect(db.name).toBe("ib-analyzer");
  });
});
