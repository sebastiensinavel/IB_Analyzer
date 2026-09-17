import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import fr from "../src/i18n/fr.json" with { type: "json" };

// The three-file corpus written for sub-project 7 (packages/ib-parsers/tests/fixtures/) —
// three yearly activity statements of one synthetic account, anonymized by
// anonymize-statement.mjs, exercising the seven forms of contract identity and corporate
// action the engine resolves (packages/ledger/src/journals/identities.ts,
// journals/corporate.ts). The account id embedded in the fixtures themselves (constaté:
// `node -e "..."` against tbl..._U9000000Body`), used here too so the import carries no
// account-mismatch warning.
const IB_ACCOUNT_ID = "U9000000";
const YEARS = ["2022", "2023", "2024"] as const;
const FIXTURES = YEARS.map((year) =>
  fileURLToPath(
    new URL(`../../../packages/ib-parsers/tests/fixtures/statement_ca_corpus_${year}.htm`, import.meta.url),
  ),
);

/**
 * No login, no Django, no PostgreSQL needed for anything this test does: account creation
 * and file import are both pure IndexedDB (db/accounts.ts, db/importFile.ts have no fetch
 * calls at all), and CLAUDE.md is explicit that no SPA route is ever gated on a session — only
 * the Flex proxy is. `/accounts` is reachable directly, the same way AccountsPage.tsx's own
 * comment describes it: "the only route a newcomer reaches on their own".
 *
 * Corpus.oracle.test.ts (packages/ib-parsers/src/) is the unit-level oracle this spec mirrors
 * at the UI: replaying the same three files, it asserts `buildJournals` "opens not one ghost
 * short on a converted ticker" — no row with `ongoing && kind === "short_shares"`. That is the
 * only shape a broken date/ticker resolution takes here: a `short_shares` row is only ever
 * built from a negative-quantity STK lot (journals/context.ts), and `short_shares`/`shares`
 * rows are the only ones JournalPage ever routes to the "others" strategy (journals/replay.ts).
 * The UI itself never renders `row.kind` as text (points-reportes.md, "CloseEvent affiché nulle
 * part" — the same gap covers `kind`), so there is no literal label to assert on; the
 * DOM-visible proxy for "no ghost short" is: no row of the Others table is simultaneously
 * flagged ongoing ("1") and carries a negative quantity. Confirmed against this exact corpus
 * before writing this assertion: today it produces 147 "others" rows, 145 of them `shares`,
 * zero `short_shares` — a regression that reintroduced a ghost short would turn one of those
 * 145 into a negative, ongoing row and this loop would catch it.
 */
test("the corpus imports, contracts get identified, and no ghost short survives in Others", async ({ page }) => {
  await page.goto("/accounts");
  await page.getByLabel(fr.accounts.label).fill("Corpus opérations sur titres");
  await page.getByLabel(fr.accounts.ibAccountId).fill(IB_ACCOUNT_ID);
  await page.getByRole("button", { name: fr.accounts.create }).click();
  await expect(page).toHaveURL(/\/accounts\/[^/]+\/sources$/);

  const importInput = page.getByLabel(fr.sources.import.button);
  const history = page.getByTestId("import-history");
  for (const [index, fixture] of FIXTURES.entries()) {
    await importInput.setInputFiles(fixture);
    // Waiting for the report's own success title, not just any state change: an error report
    // (e.g. a rejected account mismatch) would otherwise let the loop race ahead having
    // written nothing, and the later assertions would then fail on an empty ledger instead of
    // on the real cause.
    await expect(page.getByTestId("import-report").getByText(fr.sources.report.ok)).toBeVisible();
    // The history table lists every import by file name; waiting for this year's row is what
    // actually proves this iteration's write landed before the loop hands the (shared, cleared
    // after each read) file input to the next file.
    await expect(history.getByText(new RegExp(`statement_ca_corpus_${YEARS[index]}\\.htm$`))).toBeVisible();
  }

  // "Identité des contrats" (sources.contracts.title): a non-zero contract count is the
  // simplest UI-visible proof that Contract Information from all three statements landed in
  // the `contracts` store (db/contracts.ts's `mergeContractRecords`), which `useJournals`
  // needs to resolve any of the corpus's renamed tickers at all.
  const contractsCard = page.getByTestId("contracts-card");
  await expect(contractsCard.getByText(fr.sources.contracts.empty)).toBeHidden();
  await expect(contractsCard.getByText(/contrats? connus?, \d+ noms/)).toBeVisible();

  // Positions is untouched by this whole sub-project (CLAUDE.md, "La page Positions n'est pas
  // touchée. Elle lit le snapshot..."): the HTML statement parser writes no snapshot at all
  // (corpus.oracle.test.ts's own comment says so), so three statement-only imports must leave
  // Positions exactly where a fresh account with no Flex/agent snapshot always sits — its
  // empty state, not an error and not a stale render from the sources page.
  // Three nav links read "Positions" (overview, Wheel, LEAPS): the href names the overview's.
  await page.locator('a[href$="/positions"]').click();
  await expect(page).toHaveURL(/\/positions$/);
  await expect(page.getByText(fr.positions.empty)).toBeVisible();

  // Others journal: the ghost-short check described above. The sidebar carries every account
  // route (AppLayout), so this link is reachable straight from Positions.
  // Every strategy section names its journal link "Journal": the href tells them apart.
  await page.locator('a[href$="/journal/others"]').click();
  await expect(page).toHaveURL(/\/journal\/others$/);
  // useJournals recomputes asynchronously; `evaluateAll` below takes a single snapshot with no
  // retry of its own, so wait for the table to actually have rows first.
  await expect(page.locator("table tbody tr").first()).toBeVisible();

  const rows = await page.locator("table tbody tr").evaluateAll((trs) =>
    trs.map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent?.trim() ?? "")),
  );
  expect(rows.length).toBeGreaterThan(0);
  // Column order is JournalPage.tsx's own COLUMNS constant: label is index 1, ticker index 2,
  // quantity index 3, ongoing (rendered "0"/"1" by JournalPage's `flag`) the last, index 15.
  // "Others" also carries naked options that never joined a wheel/LEAPS/condor structure
  // (constaté running this spec against the corpus: a short call, "ACO Jan17'25 5 Call",
  // ongoing with quantity -3 — a real, legitimate open short position, not a ghost). A ghost
  // short is a *stock* lot only (journals/context.ts: `short_shares` never applies to OPT), so
  // it must be told apart from a short option before the ongoing+negative test above means
  // anything. `formatContractLabel` returns the bare ticker for STK and "TICKER expiry strike
  // Call/Put" for OPT (packages/ledger/src/journals/contract.ts) — label === ticker is exactly
  // that STK/OPT split, read off the same cells the UI renders rather than re-deriving it.
  const ghosts = rows.filter((cells) => cells[15] === "1" && cells[1] === cells[2] && Number(cells[3]) < 0);
  expect(ghosts).toEqual([]);
});
