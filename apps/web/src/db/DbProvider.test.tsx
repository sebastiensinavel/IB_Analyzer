import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@/api/session";
import { DbProvider, useDb } from "./DbProvider";
import { db } from "./schema";

/**
 * Runs enough real event-loop turns for any effect chain triggered by the session settling to
 * finish, including IndexedDB round-trips: fake-indexeddb schedules its own continuations with
 * `setImmediate` (see useAgentSync.test.tsx), a real macrotask, not a microtask a bare `await
 * Promise.resolve()` would flush. This is a fixed number of *turns*, not a wall-clock delay: on
 * a slow CI each turn just takes as long as it takes, so unlike a `setTimeout(…, 50)` sleep it
 * cannot pass by running out of clock before the chain is done.
 */
async function flushEventLoop(turns = 20) {
  for (let i = 0; i < turns; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function Probe({ observed }: { observed: string[] }) {
  const database = useDb();
  // Record every render's database name, not just the last one: a future regression
  // could flicker through a wrong database before settling back on the right one, which
  // a single end-of-test check would miss.
  observed.push(database.name);
  return <div data-testid="db-name">{database.name}</div>;
}

function renderWith(fetchImpl: typeof fetch, observed: string[]) {
  vi.spyOn(globalThis, "fetch").mockImplementation(fetchImpl);
  return render(
    <SessionProvider>
      <DbProvider>
        <Probe observed={observed} />
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
    const observed: string[] = [];
    renderWith(fetchImpl as typeof fetch, observed);
    // The initial render already shows `db` (the provider's default state), so an eager
    // assertion right after mount would pass trivially even under a session-dependent
    // provider — it would only swap databases once its effect resolves, a tick later.
    // `fetch` having been called proves the session resolution this test watches has
    // actually happened, so the assertion below never concludes before that event.
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await flushEventLoop();
    // The point isn't "50ms later it's still the right base" (arbitrary, and silently
    // blind to any effect slower than that guess) but "no render, ever, showed a
    // different one": every value `useDb()` produced across every render collapses to
    // the single database the app is allowed to use.
    expect(new Set(observed)).toEqual(new Set([db.name]));
    expect(db.name).toBe("ib-analyzer");
  });
});
