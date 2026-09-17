import { expect, test, type Page } from "@playwright/test";
import fr from "../src/i18n/fr.json" with { type: "json" };
import agentSnapshot from "../src/mocks/agent-snapshot.json" with { type: "json" };

/**
 * Asserts the agent's fill (AAPL, quantity -1, dated 2026-09-06 in the fixture) sits at the
 * top of History — by cell, not by substring of the row's whole text. The seeded ledger
 * already carries an unrelated AAPL trade (quantity 100, amount -18,050.00, commission -1.50 —
 * apps/web/src/mocks/ledger.ts's `flex:trade:4`), and both of the latter two numbers contain
 * the substring "-1": a row-wide `toContainText("AAPL")` / `toContainText("-1")` would still
 * pass against that seeded row alone, so a regression that dropped the agent's execution
 * entirely (a bug in `readExecution` or `planImport`) would go undetected. Column order —
 * date, type, symbol, quantity, ... — is HistoryPage.test.tsx's own comment, not counted from
 * the markup here. The date cell pins the row further: the fixture's execution is
 * 2026-09-06T14:31:02Z, brought back to New York's wall clock by `parseAgentSnapshot`
 * (EDT, −4 h in September) and rendered by `formatDateTime` (`YYYY-MM-DD HH:mm:ss`) as
 * "2026-09-06 10:31:02" — the seeded ledger is entirely August 2026, so this substring is
 * unambiguous. Only the hour moves; the day the assertion checks does not.
 */
async function expectAgentFillRow(page: Page): Promise<void> {
  const cells = page.getByRole("row").nth(1).getByRole("cell");
  await expect(cells.nth(0)).toContainText("2026-09-06");
  await expect(cells.nth(2)).toHaveText("AAPL");
  await expect(cells.nth(3)).toHaveText("-1");
}

/**
 * No server, no session: the agent path needs neither (spec fondateur §2 — the app is usable
 * without a login, the server only fronts the Flex proxy). Playwright plays the agent by
 * intercepting 127.0.0.1:8100 the way run-frontend's driver.mjs does, and the account is seeded
 * straight into IndexedDB rather than created through an invitation. Unlike auth.spec.ts and
 * sync.spec.ts, this file needs neither Django nor PostgreSQL running — only the Vite dev
 * server that playwright.config.ts's `webServer` already starts (or reuses) for every spec —
 * and it must keep working when they are down: `/api/csrf` and `/_allauth/...` answer 502
 * through Vite's proxy in that case, which SessionProvider is built to tolerate silently.
 */
test("a seeded account goes live, finds today's fill in History, and names a TWS outage", async ({ page }) => {
  let twsUp = true;
  await page.route("http://127.0.0.1:8100/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/health") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ version: "0.1.0" }),
      });
    }
    return route.fulfill({
      status: twsUp ? 200 : 503,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(twsUp ? agentSnapshot : { code: "tws-unreachable", detail: "ConnectionRefusedError" }),
    });
  });

  await page.goto("/");
  await page.evaluate(() => import("/src/mocks/seed.ts").then((m) => m.seedDemo()));
  await page.evaluate(() => import("/src/db/schema.ts").then((m) => m.db.accounts.update("alpha", { twsPort: 7502 })));

  await page.goto("/accounts/alpha/positions");
  await expect(page.getByText(/^En direct, \d{2}:\d{2}$/)).toBeVisible();
  await expect(page.getByText("AAPL 2026-01-16 C 150")).toBeVisible();

  await page.getByRole("link", { name: fr.nav.history, exact: true }).click();
  await expect(page).toHaveURL(/\/history$/);
  await expectAgentFillRow(page);

  twsUp = false;
  await page.getByRole("button", { name: fr.snapshot.refresh }).click();
  await expect(page.getByText(fr.agent.errors["tws-unreachable"])).toBeVisible();
  // A failed pass names its cause but never wipes the screen (CLAUDE.md's "jamais une erreur
  // à travers l'application"): the last known fill must still be sitting right there.
  await expectAgentFillRow(page);

  await page.getByRole("link", { name: fr.nav.sources, exact: true }).click();
  await expect(page.getByText(fr.agent.detected.replace("{{version}}", "0.1.0"))).toBeVisible();
  await expect(page.getByText(fr.agent.lastFailed.replace("{{reason}}", fr.agent.errors["tws-unreachable"]))).toBeVisible();
});
