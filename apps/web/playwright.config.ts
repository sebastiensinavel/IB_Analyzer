import { defineConfig } from "@playwright/test";
import { devPorts } from "../../tools/dev-env/ports.mjs";

// Same derivation as vite.config.ts: a worktree's e2e run drives its own Vite, never the
// main checkout's. Django must listen on the matching port — `pnpm dev:api` does that.
const base = `http://127.0.0.1:${devPorts().web}`;

/**
 * End-to-end tests against the full stack: Vite dev server, Django, Postgres. Not part of
 * `pnpm check` (see CLAUDE.md) — run with `pnpm --filter web e2e`, or `pnpm --filter web exec
 * playwright test` directly. See apps/api/README.md for starting Django and its database.
 *
 * `workers: 1` and `fullyParallel: false` are load-bearing, not defaults left in place:
 * sync.spec.ts logs in with the email/password that auth.spec.ts's invitation flow creates,
 * so the two files must run one after another, in the alphabetical order Playwright discovers
 * them in (auth.spec.ts, then sync.spec.ts) — never as two workers racing each other.
 *
 * `timeout: 60_000` doubles Playwright's own 30 s default. auth.spec.ts's TOTP step
 * (waitForFreshTotpWindow) is bounded to add well under 5 s by construction, but this is a
 * real-network test against a real stack — invitation accept, account creation, settings
 * navigation, TOTP activation, sync's own 8.5 s of throttle-safe waits — not a unit test, so
 * the default budget leaves little room for ordinary variance (a slower CI machine, a loaded
 * dev server) before an unlucky draw fails the test on timing alone rather than on an
 * actual regression.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: { baseURL: base },
  webServer: {
    command: "pnpm dev",
    url: base,
    // Safe to reuse: the port is this checkout's own, so whatever answers there serves
    // this checkout's code.
    reuseExistingServer: true,
  },
});
