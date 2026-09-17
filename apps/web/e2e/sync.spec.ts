import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import fr from "../src/i18n/fr.json" with { type: "json" };

// Reuses the account auth.spec.ts creates through the invitation flow: this file runs after
// it (playwright.config.ts pins `workers: 1`, and Playwright discovers `auth.spec.ts` before
// `sync.spec.ts` alphabetically), and logs in with the same email/password rather than
// spending a second invitation token — the campaign only ever hands out one.
const EMAIL = "e2e@example.test";
const PASSWORD = "correct-horse-battery";

// The account id inside the anonymised fixture (see packages/ib-parsers/tests/fixtures/) —
// used as this test's IB account id too, so the import carries no account-mismatch warning.
const IB_ACCOUNT_ID = "U0000001";
const REFERENCE_CODE = "1234567890";

const STATEMENT_XML = readFileSync(
  fileURLToPath(new URL("../../../packages/ib-parsers/tests/fixtures/flex_activity_sample.xml", import.meta.url)),
  "utf-8",
);

const SEND_REQUEST_SUCCESS = `<?xml version="1.0"?>
<FlexStatementResponse timestamp="04 September, 2026 08:00 AM EDT">
  <Status>Success</Status>
  <ReferenceCode>${REFERENCE_CODE}</ReferenceCode>
  <Url>https://ndcdyn.interactivebrokers.com/x</Url>
</FlexStatementResponse>`;

const GET_STATEMENT_NOT_READY = `<?xml version="1.0"?>
<FlexStatementResponse>
  <Status>Fail</Status>
  <ErrorCode>1019</ErrorCode>
  <ErrorMessage>Statement generation in progress. Please try again shortly.</ErrorMessage>
</FlexStatementResponse>`;

test("a full sync fills the history and Sources shows a last sync", async ({ page }) => {
  let getStatementCalls = 0;
  // The agent is absent here: nothing listens on 8100.
  await page.route("http://127.0.0.1:8100/**", (route) => route.abort("connectionrefused"));
  // The real two-step Flex Web Service wire protocol (spec fondateur §3.2, ib-parsers'
  // flexEnvelope.ts): send-request answers a reference code, get-statement answers the
  // "not ready yet" envelope once (IB's own 1019, "statement generation in progress") before
  // handing back the actual statement — never a shortcut straight to the statement.
  await page.route("**/api/ib/flex/send-request", (route) =>
    route.fulfill({ contentType: "application/xml", body: SEND_REQUEST_SUCCESS }),
  );
  await page.route("**/api/ib/flex/get-statement", (route) => {
    getStatementCalls += 1;
    return route.fulfill({
      contentType: "application/xml",
      body: getStatementCalls === 1 ? GET_STATEMENT_NOT_READY : STATEMENT_XML,
    });
  });

  await page.goto("/login");
  // See auth.spec.ts: SessionProvider fetches the CSRF cookie asynchronously on mount, and a
  // scripted actor can otherwise submit before that first round trip lands.
  await page.waitForFunction(() => document.cookie.includes("csrftoken="));
  await page.getByLabel(fr.auth.email).fill(EMAIL);
  await page.getByLabel(fr.auth.password).fill(PASSWORD);
  await page.getByRole("button", { name: fr.auth.signIn }).click();
  await expect(page).toHaveURL(/\/accounts$/);

  await page.getByLabel(fr.accounts.label).fill("Bout en bout");
  await page.getByLabel(fr.accounts.ibAccountId).fill(IB_ACCOUNT_ID);
  await page.getByRole("button", { name: fr.accounts.create }).click();
  await expect(page).toHaveURL(/\/accounts\/[^/]+\/sources$/);

  // Scoped to the Flex Query card: AgentCard's own save button (TWS port) carries the same
  // "Enregistrer" label, and a bare role lookup would hit both.
  const flexQueryCard = page.getByTestId("flex-query-card");
  await page.getByLabel(fr.sources.flexToken).fill("fake-flex-token");
  await page.getByLabel(fr.sources.flexQueryId).fill("999999");
  await flexQueryCard.getByRole("button", { name: fr.sources.saveCredentials }).click();
  await expect(page.getByText(fr.sources.credentialsSaved)).toBeVisible();

  // The default relays through the local agent only (sous-projet 19): this scenario is the
  // server's proxy, so it opts in first.
  await page.getByRole("radio", { name: fr.sources.flexRelay.agentAndServer }).click();
  await expect(page.getByRole("radio", { name: fr.sources.flexRelay.agentAndServer })).toBeChecked();

  // "Dernière synchronisation réussie : —" (the never-synced-yet placeholder, SourcesPage.tsx's
  // SyncCard) is already on screen the instant credentials are saved — asserting on that prefix
  // alone, before the run finishes, would pass whether or not the sync loop below actually ran.
  const lastSyncPrefix = fr.sync.lastSync.split("{{")[0].trim();
  const neverSyncedMessage = fr.sync.lastSync.replace("{{date}}", "—");
  await expect(page.getByText(neverSyncedMessage)).toBeVisible();

  await page.getByRole("button", { name: fr.sync.run }).click();
  await expect(page.getByRole("button", { name: fr.sync.running })).toBeVisible();

  // The app really waits its two pauses out — 1.5 s between send-request and the first
  // get-statement, then 7 s on the 1019 (flex/sync.ts's FIRST_STATEMENT_WAIT_MS and
  // RETRY_WAIT_MS, both sized against our own proxy throttle) — with real `setTimeout`s, not
  // something a browser-level test can inject around, so the assertion below just budgets for
  // the 8.5 s instead of trying to fake the clock. Waiting for the button to go back to its
  // idle label is what actually proves the run finished, not just started.
  await expect(page.getByRole("button", { name: fr.sync.run })).toBeVisible({ timeout: 20_000 });
  expect(getStatementCalls).toBe(2);
  await expect(page.getByText(neverSyncedMessage)).toBeHidden();
  await expect(page.getByText(lastSyncPrefix)).toBeVisible();
  await expect(page.getByText(/via le serveur\.$/)).toBeVisible();

  await page.getByRole("link", { name: fr.nav.history, exact: true }).click();
  await expect(page).toHaveURL(/\/history$/);
  // Exact match: the fixture also carries option contracts on "SYM16" and others whose cell
  // text starts with "SYM1", which a substring match would also — wrongly — satisfy.
  await expect(page.getByText("SYM1", { exact: true })).toBeVisible();
});

test("with the agent present, a sync goes through it and never reaches the server's proxy", async ({ page }) => {
  let serverCalls = 0;
  let getStatementCalls = 0;
  await page.route("**/api/ib/flex/**", (route) => {
    serverCalls += 1;
    return route.abort();
  });
  await page.route("http://127.0.0.1:8100/health", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ version: "0.1.0" }), headers: { "access-control-allow-origin": "*" } }),
  );
  await page.route("http://127.0.0.1:8100/flex/send-request", (route) =>
    route.fulfill({ contentType: "application/xml", body: SEND_REQUEST_SUCCESS, headers: { "access-control-allow-origin": "*" } }),
  );
  await page.route("http://127.0.0.1:8100/flex/get-statement", (route) => {
    getStatementCalls += 1;
    return route.fulfill({
      contentType: "application/xml",
      body: getStatementCalls === 1 ? GET_STATEMENT_NOT_READY : STATEMENT_XML,
      headers: { "access-control-allow-origin": "*" },
    });
  });

  // No sign-in at all: the agent needs no session.
  await page.goto("/accounts");
  await page.getByLabel(fr.accounts.label).fill("Agent relais");
  await page.getByLabel(fr.accounts.ibAccountId).fill(IB_ACCOUNT_ID);
  await page.getByRole("button", { name: fr.accounts.create }).click();
  await expect(page).toHaveURL(/\/accounts\/[^/]+\/sources$/);

  // Scoped to the Flex Query card: AgentCard's own save button (TWS port) carries the same
  // "Enregistrer" label, and a bare role lookup would hit both.
  await page.getByLabel(fr.sources.flexToken).fill("fake-flex-token");
  await page.getByLabel(fr.sources.flexQueryId).fill("999999");
  await page.getByTestId("flex-query-card").getByRole("button", { name: fr.sources.saveCredentials }).click();
  await expect(page.getByRole("radio", { name: fr.sources.flexRelay.agent })).toBeChecked();

  await page.getByRole("button", { name: fr.sync.run }).click();
  await expect(page.getByRole("button", { name: fr.sync.run })).toBeVisible({ timeout: 20_000 });
  expect(getStatementCalls).toBe(2);
  expect(serverCalls).toBe(0);
  await expect(page.getByText(/via l'agent local\.$/)).toBeVisible();
});
