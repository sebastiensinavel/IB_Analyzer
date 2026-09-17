import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router";
import flexXml from "../../../../packages/ib-parsers/tests/fixtures/flex_activity_sample.xml?raw";
import statementHtml from "../../../../packages/ib-parsers/tests/fixtures/activity_statement_sample.htm?raw";
import i18n from "@/i18n";
import { SessionProvider } from "@/api/session";
import { refreshPresence, resetAgentState } from "@/agent/useAgentSync";
import { db } from "@/db/schema";
import { syncAccount } from "@/flex/sync";
import { AGENT_REPROBE_MS, SourcesPage } from "@/pages/SourcesPage";
import { WithAccountData } from "@/test/WithAccountData";

// Only the "SourcesPage: synchronization" describe block below wraps <SessionProvider> and
// authenticates, which is what could ever let `useFlexAutoSync`'s auto-trigger effect call the
// real `syncAccount` (session "loading", the default without a provider, always short-circuits
// it). Mocking it here, file-wide, keeps every other test in this file — none of which cares
// about Flex synchronization — from ever depending on that real network round trip.
vi.mock("@/flex/sync", () => ({ syncAccount: vi.fn(async () => ({ status: "ok", report: {} })) }));

function Probe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderSources(accountId = "test") {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[`/accounts/${accountId}/sources`]}>
        <Probe />
        <Routes>
          <Route
            path="/accounts/:accountId/sources"
            element={
              <WithAccountData>
                <SourcesPage />
              </WithAccountData>
            }
          />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

const account = { id: "test", label: "Test", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [] };

beforeEach(async () => {
  resetAgentState();
  await Promise.all([
    db.accounts.clear(),
    db.transactions.clear(),
    db.imports.clear(),
    db.snapshots.clear(),
    db.sectors.clear(),
    db.statements.clear(),
    db.contracts.clear(),
  ]);
  await db.accounts.add(account);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function pickFile(content: string, name: string) {
  const user = userEvent.setup();
  const input = screen.getByLabelText("Importer des fichiers") as HTMLInputElement;
  await user.upload(input, new File([content], name, { type: "text/xml" }));
}

describe("SourcesPage", () => {
  it("shows the account", async () => {
    renderSources();
    expect(await screen.findByText("U0000001")).toBeInTheDocument();
  });

  it("imports a Flex file and shows the report, then lists the import", async () => {
    renderSources();
    await screen.findByText("U0000001");
    await pickFile(flexXml, "flex.xml");

    expect(await screen.findByText("Import terminé.")).toBeInTheDocument();
    const report = screen.getByTestId("import-report");
    expect(within(report).getByText("Flex Query")).toBeInTheDocument();
    expect(within(report).getByText("2025-09-03 → 2026-09-02")).toBeInTheDocument();
    expect(within(report).queryByText("Section absente")).not.toBeInTheDocument();

    const history = await screen.findByTestId("import-history");
    expect(within(history).getByText("flex.xml")).toBeInTheDocument();
    expect(await db.transactions.count()).toBeGreaterThan(0);
  });

  it("imports several files picked together, reports each by name in period order, and sums them up", async () => {
    renderSources();
    await screen.findByText("U0000001");
    const input = screen.getByLabelText("Importer des fichiers") as HTMLInputElement;
    // user-event keeps only the first file on an input without `multiple`, and drops the files
    // its `accept` refuses, as a browser's picker would: the refused one here is let through
    // by its name and turned down by its content.
    await userEvent.setup().upload(input, [
      new File([flexXml], "flex.xml", { type: "text/xml" }),
      new File(["hello"], "notes.xml", { type: "text/xml" }),
      new File([statementHtml], "2025.htm", { type: "text/html" }),
    ]);

    const reports = await screen.findAllByTestId("import-report");
    expect(reports).toHaveLength(3);
    expect(within(reports[0]).getByText("2025.htm")).toBeInTheDocument();
    expect(within(reports[0]).getByText("Import terminé.")).toBeInTheDocument();
    expect(within(reports[1]).getByText("flex.xml")).toBeInTheDocument();
    expect(within(reports[2]).getByText("notes.xml")).toBeInTheDocument();
    expect(within(reports[2]).getByText("Import annulé, rien n'a été écrit.")).toBeInTheDocument();
    expect(screen.getByTestId("import-summary")).toHaveTextContent("3 fichiers — importés : 2, annulés : 1.");

    const history = await screen.findByTestId("import-history");
    expect(within(history).getByText("flex.xml")).toBeInTheDocument();
    expect(within(history).getByText("2025.htm")).toBeInTheDocument();
  });

  it("does not sum up a single file", async () => {
    renderSources();
    await screen.findByText("U0000001");
    await pickFile(flexXml, "flex.xml");
    expect(await screen.findByTestId("import-report")).toBeInTheDocument();
    expect(screen.queryByTestId("import-summary")).toBeNull();
  });

  it("disables the file input while an import is in flight", async () => {
    renderSources();
    await screen.findByText("U0000001");
    const user = userEvent.setup();
    const input = screen.getByLabelText("Importer des fichiers") as HTMLInputElement;
    expect(input).not.toBeDisabled();

    const upload = user.upload(input, new File([flexXml], "flex.xml", { type: "text/xml" }));
    await waitFor(() => expect(input).toBeDisabled());

    await upload;
    await waitFor(() => expect(input).not.toBeDisabled());
  });

  it("shows the error and writes nothing for a file of another account", async () => {
    await db.accounts.update("test", { ibAccountId: "U9999999" });
    renderSources();
    await screen.findByText("U9999999");
    await pickFile(flexXml, "flex.xml");

    expect(await screen.findByText("Import annulé, rien n'a été écrit.")).toBeInTheDocument();
    expect(screen.getByText("Fichier d'un autre compte")).toBeInTheDocument();
    expect(await db.transactions.count()).toBe(0);
    expect(screen.getByText("Rien n'a encore été importé.")).toBeInTheDocument();
  });

  it("deletes the account after confirmation and leaves for the accounts page", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderSources();
    await screen.findByText("U0000001");
    await userEvent.setup().click(screen.getByRole("button", { name: "Supprimer le compte" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/accounts"));
    expect(await db.accounts.count()).toBe(0);
  });

  it("keeps the account when the confirmation is refused", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderSources();
    await screen.findByText("U0000001");
    await userEvent.setup().click(screen.getByRole("button", { name: "Supprimer le compte" }));
    expect(await db.accounts.count()).toBe(1);
  });

  it("no longer carries the sector table: it has its own page", async () => {
    renderSources();
    await screen.findByText("U0000001");
    expect(screen.queryByTestId("sector-card")).toBeNull();
    expect(screen.queryByLabelText("Importer un CSV")).toBeNull();
  });
});

describe("SourcesPage: positions", () => {
  it("reports the positions and cash read from a Flex file, and counts them in the history", async () => {
    renderSources();
    await screen.findByText("U0000001");
    await pickFile(flexXml, "flex.xml");
    const report = await screen.findByTestId("import-report");
    expect(within(report).getByText("Positions")).toBeInTheDocument();
    expect(within(report).getByText("30")).toBeInTheDocument();
    expect(within(report).getByText("Cash disponible")).toBeInTheDocument();
    const history = await screen.findByTestId("import-history");
    expect(within(history).getByText(/30 positions/)).toBeInTheDocument();
    expect(await db.snapshots.get("test")).toBeDefined();
  });

  it("says when a file's positions were ignored as older than the cache", async () => {
    renderSources();
    await screen.findByText("U0000001");
    await pickFile(flexXml, "flex.xml");
    await screen.findByTestId("import-report");
    await pickFile(flexXml.replaceAll('reportDate="20260902"', 'reportDate="20260101"'), "old.xml");
    expect(await screen.findByText("Positions ignorées : le fichier est plus ancien que les positions en cache.")).toBeInTheDocument();
  });

  // The other edge of task 15's defect: resetting the form on mount fixed "the token written
  // to the wrong account" and created "the token silently erased". The form never shows a
  // stored token, so someone returning to fix only the query id leaves the token box empty —
  // which used to mean "erase".
  it("keeps a stored token when the form is saved with the token field left empty", async () => {
    await db.accounts.update("test", { flexToken: "kept-secret", flexQueryId: "111" });
    renderSources();
    const user = userEvent.setup();
    await screen.findByText("U0000001");

    await user.type(screen.getByLabelText("Identifiant de requête"), "222");
    // Scoped: the Agent card added below also has an "Enregistrer" button (task 13).
    await user.click(within(screen.getByTestId("flex-query-card")).getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Identifiants enregistrés.");

    const account = await db.accounts.get("test");
    expect(account?.flexToken).toBe("kept-secret");
    expect(account?.flexQueryId).toBe("222");
  });

  it("says a token is stored without ever putting it on screen", async () => {
    await db.accounts.update("test", { flexToken: "kept-secret", flexQueryId: "111" });
    renderSources();
    expect(await screen.findByText("Un jeton est enregistré pour ce compte.")).toBeInTheDocument();
    expect(screen.getByText("Identifiant de requête enregistré : 111")).toBeInTheDocument();
    // Not merely "not rendered as text": nowhere in the DOM at all, value attributes included.
    expect(document.body.innerHTML).not.toContain("kept-secret");
    expect((screen.getByLabelText("Jeton Flex") as HTMLInputElement).value).toBe("");
  });

  it("says so when nothing is stored, and refuses to save an empty form", async () => {
    renderSources();
    expect(await screen.findByText("Aucun jeton enregistré.")).toBeInTheDocument();
    expect(screen.getByText("Aucun identifiant de requête enregistré.")).toBeInTheDocument();
    // Scoped: the Agent card added below also has an "Enregistrer" button (task 13).
    expect(within(screen.getByTestId("flex-query-card")).getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Effacer les identifiants" })).not.toBeInTheDocument();
  });

  it("erases both credentials only on the explicit action", async () => {
    await db.accounts.update("test", { flexToken: "kept-secret", flexQueryId: "111" });
    renderSources();
    const user = userEvent.setup();
    await screen.findByText("Un jeton est enregistré pour ce compte.");

    await user.click(screen.getByRole("button", { name: "Effacer les identifiants" }));
    await screen.findByText("Identifiants effacés.");

    const account = await db.accounts.get("test");
    expect(account?.flexToken).toBeUndefined();
    expect(account?.flexQueryId).toBeUndefined();
  });

  it("does not save a token typed for one account onto a different account reached without unmounting the page", async () => {
    // AppLayout renders <Outlet /> without a key on the account id (see AppLayout.tsx), so
    // switching accounts through ordinary in-app navigation — back/forward, a bookmark, a
    // typed URL — keeps this exact SourcesPage instance mounted while :accountId changes
    // underneath it. This Link inside the same Routes tree reproduces that: it changes the
    // route param without remounting SourcesPage, unlike swapping `initialEntries`.
    const other = { id: "other", label: "Other", ibAccountId: "U0000002", createdAt: "", warnedDroppedKinds: [] };
    await db.accounts.add(other);

    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={["/accounts/test/sources"]}>
          <Link to="/accounts/other/sources">switch account</Link>
          <Routes>
            <Route
              path="/accounts/:accountId/sources"
              element={
                <WithAccountData>
                  <SourcesPage />
                </WithAccountData>
              }
            />
            <Route path="*" element={null} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>,
    );

    const user = userEvent.setup();
    await screen.findByText("U0000001");
    await user.type(screen.getByLabelText("Jeton Flex"), "secret-typed-for-test");

    await user.click(screen.getByRole("link", { name: "switch account" }));
    await screen.findByText("U0000002");

    // Scoped: the Agent card added below also has an "Enregistrer" button (task 13).
    await user.click(within(screen.getByTestId("flex-query-card")).getByRole("button", { name: "Enregistrer" }));

    expect((await db.accounts.get("other"))?.flexToken).toBeUndefined();
    expect((await db.accounts.get("test"))?.flexToken).toBeUndefined();
  });
});

describe("Flex relay choice", () => {
  it("selects agent only on an account that never chose, and explains both options", async () => {
    renderSources();
    const card = await screen.findByTestId("flex-query-card");
    expect(within(card).getByRole("radio", { name: "Agent local seulement" })).toBeChecked();
    expect(within(card).getByRole("radio", { name: "Agent local et serveur" })).not.toBeChecked();
    expect(within(card).getByText(/Rien ne passe par le serveur\./)).toBeInTheDocument();
    expect(within(card).getByText(/sans être journalisés ni conservés/)).toBeInTheDocument();
  });

  it("saves the choice the moment it changes, without the credentials button", async () => {
    renderSources();
    const card = await screen.findByTestId("flex-query-card");
    await userEvent.setup().click(within(card).getByRole("radio", { name: "Agent local et serveur" }));
    await waitFor(async () => expect((await db.accounts.get("test"))?.flexRelay).toBe("agent-and-server"));
    // Controlled by the live-queried account: the re-render may land after the write is readable.
    await waitFor(() => expect(within(card).getByRole("radio", { name: "Agent local et serveur" })).toBeChecked());
    expect((await db.accounts.get("test"))?.flexToken).toBeUndefined();
  });

  // renderSources("other") alone would only ever mount fresh at the other account's route,
  // which the radio would get right even if it silently kept reading the account it first
  // mounted with. The switch below reproduces the same in-place route change as "does not
  // save a token typed for one account onto a different account" above, so the assertion
  // actually exercises the radio following the route's account, not just its initial props.
  it("follows the account of the route", async () => {
    await db.accounts.update("test", { flexRelay: "agent-and-server" });
    const other = { id: "other", label: "Other", ibAccountId: "U0000002", createdAt: "", warnedDroppedKinds: [] };
    await db.accounts.add(other);

    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={["/accounts/test/sources"]}>
          <Link to="/accounts/other/sources">switch account</Link>
          <Routes>
            <Route
              path="/accounts/:accountId/sources"
              element={
                <WithAccountData>
                  <SourcesPage />
                </WithAccountData>
              }
            />
            <Route path="*" element={null} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>,
    );

    const user = userEvent.setup();
    await screen.findByText("U0000001");
    expect(within(screen.getByTestId("flex-query-card")).getByRole("radio", { name: "Agent local et serveur" })).toBeChecked();

    await user.click(screen.getByRole("link", { name: "switch account" }));
    await screen.findByText("U0000002");

    expect(within(screen.getByTestId("flex-query-card")).getByRole("radio", { name: "Agent local seulement" })).toBeChecked();
  });
});

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** `authenticated` when true, `anonymous` when false. Nothing else is mocked. */
function authFetch(loggedIn: boolean): typeof fetch {
  return async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/auth/session")) {
      return loggedIn ? jsonResponse({ data: { user: { id: 7, email: "a@example.com" } } }, 200) : jsonResponse({}, 401);
    }
    return jsonResponse({}, 200);
  };
}

function renderSourcesWithSession(fetchImpl: typeof fetch, accountId = "test") {
  vi.spyOn(globalThis, "fetch").mockImplementation(fetchImpl);
  return render(
    <I18nextProvider i18n={i18n}>
      <SessionProvider>
        <MemoryRouter initialEntries={[`/accounts/${accountId}/sources`]}>
          <Routes>
            <Route
              path="/accounts/:accountId/sources"
              element={
                <WithAccountData>
                  <SourcesPage />
                </WithAccountData>
              }
            />
            <Route path="*" element={null} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </I18nextProvider>,
  );
}

describe("SourcesPage: synchronization card", () => {
  // The last test below overrides `syncAccount`'s implementation to control timing; restore
  // the file-wide default before every test so that override never leaks into another one.
  beforeEach(() => {
    vi.mocked(syncAccount).mockImplementation(async () => ({ status: "ok", report: {} }) as never);
  });

  it("explains that an account is needed, with a sign-in link, and disables the button — never an error", async () => {
    await db.accounts.update("test", { flexRelay: "agent-and-server" });
    renderSourcesWithSession(authFetch(false));
    await screen.findByText("U0000001");
    expect(
      await screen.findByText("Démarrez l'agent local ou connectez-vous pour synchroniser ce compte."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Se connecter" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("button", { name: "Synchroniser" })).toBeDisabled();
  });

  it("shows a discreet notice, never an alarm, when the server is unreachable", async () => {
    await db.accounts.update("test", { flexRelay: "agent-and-server" });
    renderSourcesWithSession(async () => {
      throw new TypeError("Failed to fetch");
    });
    await screen.findByText("U0000001");
    expect(
      await screen.findByText("Serveur injoignable : la synchronisation est indisponible pour l'instant."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Synchroniser" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Se connecter" })).not.toBeInTheDocument();
  });

  it("says credentials are missing once signed in, and keeps the button disabled", async () => {
    await db.accounts.update("test", { flexRelay: "agent-and-server" });
    renderSourcesWithSession(authFetch(true));
    await screen.findByText("U0000001");
    expect(
      await screen.findByText(
        "Renseignez le jeton et l'identifiant de requête Flex Query ci-dessus pour activer la synchronisation.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Synchroniser" })).toBeDisabled();
  });

  it("shows a dash for an account with credentials that has never synced, and enables the button", async () => {
    // No agent here (`/health` answers `{}`): the server relays, as the account allows it.
    await db.accounts.update("test", { flexToken: "tok", flexQueryId: "123", flexRelay: "agent-and-server" });
    renderSourcesWithSession(authFetch(true));
    await screen.findByText("U0000001");
    expect(await screen.findByText("Dernière synchronisation réussie : —")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Synchroniser" })).not.toBeDisabled();
  });

  it("shows the last successful sync date once credentials are set", async () => {
    await db.accounts.update("test", {
      flexToken: "tok",
      flexQueryId: "123",
      flexRelay: "agent-and-server",
      // Fresh enough that the auto-trigger effect (task 19) never fires during this test.
      lastFlexSyncAt: new Date().toISOString(),
    });
    renderSourcesWithSession(authFetch(true));
    await screen.findByText("U0000001");
    expect(await screen.findByText(/Dernière synchronisation réussie : \w/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Synchroniser" })).not.toBeDisabled();
  });

  it("shows the raw code of the last failed attempt, and still keeps the button active", async () => {
    await db.accounts.update("test", {
      flexToken: "tok",
      flexQueryId: "123",
      flexRelay: "agent-and-server",
      lastFlexSyncAt: new Date().toISOString(),
      lastFlexSyncStatus: { at: "2026-09-04T08:00:00.000Z", ok: false, code: "flex-timeout" },
    });
    renderSourcesWithSession(authFetch(true));
    await screen.findByText("U0000001");
    expect(await screen.findByText("Dernière tentative en échec (flex-timeout).")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Synchroniser" })).not.toBeDisabled();
  });

  it("disables the button and shows the running label while a manual sync is in flight", async () => {
    await db.accounts.update("test", {
      flexToken: "tok",
      flexQueryId: "123",
      lastFlexSyncAt: new Date().toISOString(),
      // No agent here (`/health` answers `{}`): the manual sync goes through the server.
      flexRelay: "agent-and-server",
    });
    let resolveSync: (() => void) | undefined;
    vi.mocked(syncAccount).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSync = () => resolve({ status: "ok", report: {} } as never);
        }),
    );
    renderSourcesWithSession(authFetch(true));
    await screen.findByText("U0000001");

    await userEvent.setup().click(await screen.findByRole("button", { name: "Synchroniser" }));

    expect(await screen.findByRole("button", { name: "Synchronisation en cours…" })).toBeDisabled();

    resolveSync?.();
    await waitFor(() => expect(screen.getByRole("button", { name: "Synchroniser" })).not.toBeDisabled());
  });

  it("says the agent is needed in the default mode when it is absent, links to its installation, and disables the button", async () => {
    await db.accounts.update("test", { flexToken: "tok", flexQueryId: "123", lastFlexSyncAt: new Date().toISOString() });
    renderSourcesWithSession(authFetch(true));
    await screen.findByText("U0000001");
    expect(
      await screen.findByText("Agent non détecté : en mode agent local seulement, la synchronisation passe par lui."),
    ).toBeInTheDocument();
    const syncCard = screen.getByTestId("sync-card");
    expect(within(syncCard).getByRole("link", { name: "Installer l'agent" })).toHaveAttribute("href", "/help");
    expect(within(syncCard).getByRole("button", { name: "Synchroniser" })).toBeDisabled();
  });

  it("enables the button with the agent present and no session, and says the last sync went through it", async () => {
    await db.accounts.update("test", {
      flexToken: "tok",
      flexQueryId: "123",
      lastFlexSyncAt: new Date().toISOString(),
      lastFlexSyncStatus: { at: new Date().toISOString(), ok: true, relay: "agent" },
    });
    renderSourcesWithSession(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/health")) return jsonResponse({ version: "0.1.0" }, 200);
      if (url.includes("/auth/session")) return jsonResponse({}, 401);
      return jsonResponse({}, 200);
    });
    await screen.findByText("U0000001");
    expect(await screen.findByText(/^Dernière synchronisation réussie : .+, via l'agent local\.$/)).toBeInTheDocument();
    expect(within(screen.getByTestId("sync-card")).getByRole("button", { name: "Synchroniser" })).not.toBeDisabled();
  });

  it("names the relay of a failed attempt", async () => {
    await db.accounts.update("test", {
      flexToken: "tok",
      flexQueryId: "123",
      flexRelay: "agent-and-server",
      lastFlexSyncAt: new Date().toISOString(),
      lastFlexSyncStatus: { at: "2026-09-16T08:00:00.000Z", ok: false, code: "flex-timeout", relay: "server" },
    });
    renderSourcesWithSession(authFetch(true));
    await screen.findByText("U0000001");
    expect(await screen.findByText("Dernière tentative en échec (flex-timeout), via le serveur.")).toBeInTheDocument();
  });

  it("sees an agent started after the page opened, without leaving the page", async () => {
    await db.accounts.update("test", {
      flexToken: "tok",
      flexQueryId: "123",
      lastFlexSyncAt: new Date().toISOString(),
    });
    let agentUp = false;
    renderSourcesWithSession(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/health")) {
        if (!agentUp) throw new TypeError("Failed to fetch");
        return jsonResponse({ version: "0.1.0" }, 200);
      }
      return authFetch(false)(input);
    });
    await screen.findByText("U0000001");
    expect(
      await screen.findByText("Agent non détecté : en mode agent local seulement, la synchronisation passe par lui."),
    ).toBeInTheDocument();

    agentUp = true;
    // Focus re-probes at once; the interval would too, only later.
    window.dispatchEvent(new Event("focus"));

    expect(await screen.findByText(/^Dernière synchronisation réussie : /)).toBeInTheDocument();
    expect(within(screen.getByTestId("sync-card")).getByRole("button", { name: "Synchroniser" })).not.toBeDisabled();
  });

  it("re-probes an absent agent every few seconds while the page stays open", async () => {
    await db.accounts.update("test", {
      flexToken: "tok",
      flexQueryId: "123",
      lastFlexSyncAt: new Date().toISOString(),
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let agentUp = false;
      renderSourcesWithSession(async (input) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.endsWith("/health")) {
          if (!agentUp) throw new TypeError("Failed to fetch");
          return jsonResponse({ version: "0.1.0" }, 200);
        }
        return authFetch(false)(input);
      });
      expect(
        await screen.findByText("Agent non détecté : en mode agent local seulement, la synchronisation passe par lui."),
      ).toBeInTheDocument();

      agentUp = true;
      await vi.advanceTimersByTimeAsync(AGENT_REPROBE_MS);

      expect(await screen.findByText(/^Dernière synchronisation réussie : /)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says it is loading while the session settles, with the agent absent in agent-and-server mode", async () => {
    await db.accounts.update("test", { flexToken: "tok", flexQueryId: "123", flexRelay: "agent-and-server" });
    renderSourcesWithSession(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/health")) throw new TypeError("Failed to fetch");
      if (url.includes("/auth/session")) return new Promise<Response>(() => {});
      return jsonResponse({}, 200);
    });
    await screen.findByText("U0000001");
    const syncCard = screen.getByTestId("sync-card");
    expect(await within(syncCard).findByText("Chargement…")).toBeInTheDocument();
    expect(within(syncCard).getByRole("button", { name: "Synchroniser" })).toBeDisabled();
  });

  it("looks for the agent before saying anything else", async () => {
    await db.accounts.update("test", { flexToken: "tok", flexQueryId: "123" });
    let answerHealth: (() => void) | undefined;
    renderSourcesWithSession(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/health")) {
        return new Promise<Response>((resolve) => {
          answerHealth = () => resolve(jsonResponse({ version: "0.1.0" }, 200));
        });
      }
      return authFetch(true)(input);
    });
    await screen.findByText("U0000001");
    expect(await screen.findByText("Recherche de l'agent local…")).toBeInTheDocument();
    answerHealth?.();
    await waitFor(() => expect(screen.queryByText("Recherche de l'agent local…")).not.toBeInTheDocument());
  });
});

/** `present` when true, absent (network failure) when false. Recopied from SnapshotStatus.test.tsx: a .test.tsx file is not a shared module. */
function mockAgent(present: boolean) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/health")) {
      return present ? new Response(JSON.stringify({ version: "0.1.0" }), { status: 200 }) : Promise.reject(new TypeError("Failed to fetch"));
    }
    return new Response(JSON.stringify({ accounts: ["U0000001"], fetchedAt: "2026-09-06T13:10:00.000Z", cashAvailable: 1, positions: [], executions: [] }), { status: 200 });
  });
}

describe("Agent card", () => {
  it("asks for the port and says nothing is called without it", async () => {
    renderSources();
    expect(await screen.findByText("Agent local")).toBeInTheDocument();
    expect(screen.getByText("Renseignez le port pour activer les données en direct.")).toBeInTheDocument();
    const card = screen.getByTestId("agent-card");
    expect(within(card).getByRole("button", { name: "Actualiser" })).toBeDisabled();
  });

  it("saves a port and refuses one out of range without touching the stored one", async () => {
    renderSources();
    const user = userEvent.setup();
    const card = await screen.findByTestId("agent-card");
    const input = within(card).getByLabelText("Port TWS");
    await user.type(input, "7502");
    await user.click(within(card).getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Port enregistré.")).toBeInTheDocument();
    expect((await db.accounts.get("test"))?.twsPort).toBe(7502);

    await user.clear(input);
    await user.type(input, "70000");
    await user.click(within(card).getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Le port doit être un entier entre 1 et 65535.")).toBeInTheDocument();
    expect((await db.accounts.get("test"))?.twsPort).toBe(7502);
  });

  it("clears the port when the field is emptied", async () => {
    await db.accounts.update("test", { twsPort: 7502 });
    renderSources();
    const user = userEvent.setup();
    const card = await screen.findByTestId("agent-card");
    const input = within(card).getByLabelText("Port TWS");
    // A plain text input (see SourcesPage.tsx), not type="number": toHaveValue reads its
    // value as a string.
    expect(input).toHaveValue("7502");
    await user.clear(input);
    await user.click(within(card).getByRole("button", { name: "Enregistrer" }));
    await waitFor(async () => expect((await db.accounts.get("test"))?.twsPort).toBeUndefined());
  });

  it("links to the Help page when the agent is absent", async () => {
    mockAgent(false);
    await refreshPresence();
    await db.accounts.update("test", { twsPort: 7502 });
    renderSources();
    expect(await screen.findByText("Agent non détecté sur cette machine.")).toBeInTheDocument();
    // Scoped: the Sync card also links to "/help" as "Installer l'agent" once it too sees the
    // agent absent (task 7).
    const card = screen.getByTestId("agent-card");
    expect(within(card).getByRole("link", { name: "Installer l'agent" })).toHaveAttribute("href", "/help");
    expect(within(card).getByRole("button", { name: "Actualiser" })).toBeDisabled();
  });

  it("shows the version, the last pass, and runs one on the button", async () => {
    mockAgent(true);
    await refreshPresence();
    await db.accounts.update("test", { twsPort: 7502, lastAgentSyncStatus: { at: "2026-09-06T13:00:00.000Z", ok: false, code: "tws-unreachable" } });
    renderSources();
    expect(await screen.findByText("Agent détecté, version 0.1.0.")).toBeInTheDocument();
    expect(screen.getByText("Dernier passage en échec : TWS injoignable")).toBeInTheDocument();
    const card = screen.getByTestId("agent-card");
    await userEvent.setup().click(within(card).getByRole("button", { name: "Actualiser" }));
    expect(await screen.findByText(/^Dernier passage réussi : /)).toBeInTheDocument();
  });

  it("does not save a port typed for one account onto a different account reached without unmounting the page", async () => {
    // Mirrors the Flex Query form's own test above: AppLayout renders <Outlet /> without a
    // key on the account id, so switching accounts through ordinary in-app navigation keeps
    // this exact SourcesPage instance (and AgentCard instance) mounted while :accountId
    // changes underneath it. This Link inside the same Routes tree reproduces that.
    const other = { id: "other", label: "Other", ibAccountId: "U0000002", createdAt: "", warnedDroppedKinds: [] };
    await db.accounts.add(other);

    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={["/accounts/test/sources"]}>
          <Link to="/accounts/other/sources">switch account</Link>
          <Routes>
            <Route
              path="/accounts/:accountId/sources"
              element={
                <WithAccountData>
                  <SourcesPage />
                </WithAccountData>
              }
            />
            <Route path="*" element={null} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>,
    );

    const user = userEvent.setup();
    await screen.findByText("U0000001");
    const card = await screen.findByTestId("agent-card");
    await user.type(within(card).getByLabelText("Port TWS"), "9999");

    await user.click(screen.getByRole("link", { name: "switch account" }));
    await screen.findByText("U0000002");

    // The account-switch guard reset the field for the new account: nothing typed for "test"
    // is sitting in it. Polled, not a synchronous assertion: the reset runs in an effect,
    // which commits a beat after `findByText` above resolves.
    await waitFor(() =>
      expect(within(screen.getByTestId("agent-card")).getByLabelText("Port TWS")).toHaveValue(""),
    );

    await user.click(within(screen.getByTestId("agent-card")).getByRole("button", { name: "Enregistrer" }));

    expect((await db.accounts.get("other"))?.twsPort).toBeUndefined();
    expect((await db.accounts.get("test"))?.twsPort).toBeUndefined();
  });
});

describe("SourcesPage: statements kept", () => {
  it("says nothing is kept and cannot replay before any statement is imported", async () => {
    renderSources();
    expect(await screen.findByText("Aucun relevé conservé.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Relire les relevés" })).toBeDisabled();
  });

  it("lists the statement kept by an import, with its declared period", async () => {
    renderSources();
    await screen.findByRole("button", { name: "Importer des fichiers" });
    await pickFile(statementHtml, "2025.htm");

    const card = await screen.findByTestId("statement-store");
    expect(await within(card).findByText("2025-01-01 → 2025-12-31")).toBeInTheDocument();
    expect(within(card).getByText("2025.htm")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Relire les relevés" })).toBeEnabled());
  });

  it("keeps nothing of a Flex import", async () => {
    renderSources();
    await screen.findByRole("button", { name: "Importer des fichiers" });
    await pickFile(flexXml, "flex.xml");

    await screen.findByTestId("import-report");
    expect(within(screen.getByTestId("statement-store")).getByText("Aucun relevé conservé.")).toBeInTheDocument();
  });

  it("replays the kept statements and says what it rebuilt", async () => {
    renderSources();
    await screen.findByRole("button", { name: "Importer des fichiers" });
    await pickFile(statementHtml, "2025.htm");
    await waitFor(() => expect(screen.getByRole("button", { name: "Relire les relevés" })).toBeEnabled());
    const importedRows = await db.transactions.where("accountId").equals("test").count();

    await userEvent.setup().click(screen.getByRole("button", { name: "Relire les relevés" }));

    expect(await screen.findByTestId("replay-report")).toHaveTextContent("1 relevé relu");
    expect(await db.transactions.where("accountId").equals("test").count()).toBe(importedRows);
  });

  it("purges the derived rows once confirmed, and keeps the statements and the configuration", async () => {
    renderSources();
    await screen.findByRole("button", { name: "Importer des fichiers" });
    await pickFile(flexXml, "flex.xml");
    await waitFor(async () => expect(await db.imports.count()).toBe(1));
    await pickFile(statementHtml, "2025.htm");
    await waitFor(async () => expect(await db.imports.count()).toBe(2));
    expect(await db.contracts.count()).toBeGreaterThan(0);
    expect(await db.snapshots.count()).toBe(1);
    expect(await db.cashPoints.count()).toBeGreaterThan(0);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await userEvent.setup().click(screen.getByRole("button", { name: "Supprimer les transactions" }));

    await screen.findByTestId("purge-report");
    expect(await db.transactions.count()).toBe(0);
    expect(await db.contracts.count()).toBe(0);
    expect(await db.snapshots.count()).toBe(0);
    expect(await db.cashPoints.count()).toBe(0);
    expect(await db.imports.count()).toBe(0);
    expect(await db.statements.count()).toBe(1);
    expect(await db.accounts.get("test")).toEqual(account);
  });

  it("purges nothing when the confirmation is declined", async () => {
    renderSources();
    await screen.findByRole("button", { name: "Importer des fichiers" });
    await pickFile(statementHtml, "2025.htm");
    await waitFor(async () => expect(await db.transactions.count()).toBeGreaterThan(0));
    const rows = await db.transactions.count();
    vi.spyOn(window, "confirm").mockReturnValue(false);

    await userEvent.setup().click(screen.getByRole("button", { name: "Supprimer les transactions" }));

    expect(await db.transactions.count()).toBe(rows);
    expect(screen.queryByTestId("purge-report")).not.toBeInTheDocument();
  });

  it("says what the purge removed and what a replay can bring back", async () => {
    renderSources();
    await screen.findByRole("button", { name: "Importer des fichiers" });
    await pickFile(statementHtml, "2025.htm");
    await waitFor(async () => expect(await db.transactions.count()).toBeGreaterThan(0));
    const rows = await db.transactions.count();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await userEvent.setup().click(screen.getByRole("button", { name: "Supprimer les transactions" }));

    expect(await screen.findByTestId("purge-report")).toHaveTextContent(`${rows} lignes`);
  });

  it("deletes a kept statement once confirmed, and its rows with it", async () => {
    renderSources();
    await screen.findByRole("button", { name: "Importer des fichiers" });
    await pickFile(statementHtml, "2025.htm");
    const card = await screen.findByTestId("statement-store");
    await within(card).findByText("2025.htm");
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await userEvent.setup().click(within(card).getByRole("button", { name: /^Supprimer / }));

    await waitFor(() => expect(within(card).getByText("Aucun relevé conservé.")).toBeInTheDocument());
    expect(await db.transactions.where("accountId").equals("test").count()).toBe(0);
  });

  it("keeps the statement when the confirmation is declined", async () => {
    renderSources();
    await screen.findByRole("button", { name: "Importer des fichiers" });
    await pickFile(statementHtml, "2025.htm");
    const card = await screen.findByTestId("statement-store");
    await within(card).findByText("2025.htm");
    vi.spyOn(window, "confirm").mockReturnValue(false);

    await userEvent.setup().click(within(card).getByRole("button", { name: /^Supprimer / }));

    expect(within(card).getByText("2025.htm")).toBeInTheDocument();
    expect(await db.statements.count()).toBe(1);
  });
});

describe("SourcesPage: a rebuild that would lose history", () => {
  /** A row from a statement imported before the files were kept: no file can write it again. */
  const orphan = {
    accountId: "test", externalId: "html:old", source: "statement_html" as const, kind: "trade" as const,
    symbol: "AAPL", secType: "STK", right: "" as const, strike: null, expiry: null, quantity: 1, price: 1,
    amount: -1, commission: null, currency: "USD", when: "2019-05-02T13:00:00.000Z", description: "deep history",
  };

  it("asks before dropping rows no kept statement could write again, and obeys a refusal", async () => {
    renderSources();
    await screen.findByRole("button", { name: "Importer des fichiers" });
    await pickFile(statementHtml, "2025.htm");
    await waitFor(() => expect(screen.getByRole("button", { name: "Relire les relevés" })).toBeEnabled());
    await db.transactions.put(orphan);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    await userEvent.setup().click(screen.getByRole("button", { name: "Relire les relevés" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("1 ligne"));
    expect(await db.transactions.get(["test", "html:old"])).toMatchObject({ externalId: "html:old" });
    expect(screen.queryByTestId("replay-report")).not.toBeInTheDocument();
  });

  it("rebuilds once the loss is accepted", async () => {
    renderSources();
    await screen.findByRole("button", { name: "Importer des fichiers" });
    await pickFile(statementHtml, "2025.htm");
    await waitFor(() => expect(screen.getByRole("button", { name: "Relire les relevés" })).toBeEnabled());
    await db.transactions.put(orphan);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await userEvent.setup().click(screen.getByRole("button", { name: "Relire les relevés" }));

    await screen.findByTestId("replay-report");
    expect(await db.transactions.get(["test", "html:old"])).toBeUndefined();
  });

  it("does not ask when every statement row comes from a kept file", async () => {
    renderSources();
    await screen.findByRole("button", { name: "Importer des fichiers" });
    await pickFile(statementHtml, "2025.htm");
    await waitFor(() => expect(screen.getByRole("button", { name: "Relire les relevés" })).toBeEnabled());
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    await userEvent.setup().click(screen.getByRole("button", { name: "Relire les relevés" }));

    expect(await screen.findByTestId("replay-report")).toHaveTextContent("1 relevé relu");
    expect(confirm).not.toHaveBeenCalled();
  });
});

// These three tests reuse the file's shared, fixed-id `account` rather than seeding a fresh
// one: isolation across tests (and across this describe block and the ones above it) relies on
// the top-level `beforeEach` clearing `db.contracts` before each run.
describe("Contract identity card", () => {
  it("counts the contracts it knows and the aliases it resolved", async () => {
    await db.contracts.bulkPut([
      { accountId: account.id, conid: "1", isin: "", secType: "STK", currency: "USD", description: "",
        aliases: [{ ticker: "ZXAB", firstSeen: "2022-01-01", lastSeen: "2022-12-31" }, { ticker: "ZXABQ", firstSeen: "2023-01-01", lastSeen: "2023-12-31" }],
        updatedAt: "2026-09-09T10:00:00.000Z" },
    ]);
    renderSources();
    expect(await screen.findByText("1 contrat connu, 2 noms")).toBeInTheDocument();
  });

  it("lists what it could not settle, in plain words", async () => {
    await db.contracts.bulkPut([
      { accountId: account.id, conid: "1", isin: "", secType: "STK", currency: "USD", description: "",
        aliases: [{ ticker: "ZXAA", firstSeen: "2022-01-01", lastSeen: "2023-06-22" }], updatedAt: "2026-09-09T10:00:00.000Z" },
      { accountId: account.id, conid: "2", isin: "", secType: "STK", currency: "USD", description: "",
        aliases: [{ ticker: "ZXAA", firstSeen: "2023-06-23", lastSeen: "2023-12-31" }], updatedAt: "2026-09-09T10:00:00.000Z" },
    ]);
    renderSources();
    expect(await screen.findByText(/ZXAA names 2 contracts/)).toBeInTheDocument();
  });

  it("says nothing alarming when the account has no contract at all", async () => {
    renderSources();
    expect(await screen.findByText("Aucun contrat identifié pour l'instant.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
