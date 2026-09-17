import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import fr from "../src/i18n/fr.json" with { type: "json" };

// The token comes from the environment: a Django management command creates the invitation
// before the run (see apps/web/playwright.config.ts's header comment and apps/api/README.md).
// No invitation, email or password is ever committed.
const TOKEN = process.env.E2E_INVITATION_TOKEN ?? "";
const EMAIL = "e2e@example.test";
const PASSWORD = "correct-horse-battery";

test.skip(TOKEN === "", "E2E_INVITATION_TOKEN is not set — see apps/web/playwright.config.ts");

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.toUpperCase().replace(/=+$/, "");
  let bits = "";
  for (const char of clean) {
    const value = alphabet.indexOf(char);
    if (value === -1) throw new Error(`invalid base32 character: ${char}`);
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/**
 * RFC 6238 TOTP (HMAC-SHA1, 30 s step, 6 digits unless the provisioning URL says otherwise) —
 * the exact algorithm django-allauth itself runs server-side (constaté in the installed
 * package, allauth/mfa/totp/internal/auth.py: hotp_value/format_hotp_value), reimplemented
 * here because Playwright has no access to the server's session-held secret except through
 * what SettingsPage displays on screen.
 */
function totpCode(secret: string, digits: number, period: number): string {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / period);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const truncated =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(truncated % 10 ** digits).padStart(digits, "0");
}

/**
 * django-allauth's TOTP_TOLERANCE defaults to 0 (constaté in app_settings.py): only the
 * exact current 30 s counter is accepted, no ±1 grace window. Filling and submitting the
 * code takes a real, if short, round trip through the browser and the Django server (observed
 * well under 1 s against the local dev stack), so computing it right as a period is about to
 * roll over is a genuine flake risk.
 *
 * Ensures at least `minHeadroomMs` remains in the current 30 s window before returning,
 * waiting out the rest of the window (landing at the very start of the next one) otherwise.
 * That means the worst case this can ever add is just under `minHeadroomMs` itself — not
 * `periodSeconds * 1000 - minHeadroomMs`, which an earlier version of this function
 * effectively did by only proceeding within the first `minHeadroomMs` of a period instead of
 * the last: with a 30 s period and a 5 s margin, that meant up to ~25 s of added wait for
 * only 5 s of guaranteed headroom — a bad trade for a fixed round trip that never needs more
 * than a couple of seconds. `minHeadroomMs` alone controls both the guaranteed headroom and
 * the worst-case wait; there is no way to shrink one without the other.
 */
async function waitForFreshTotpWindow(periodSeconds: number, minHeadroomMs = 5000): Promise<void> {
  const periodMs = periodSeconds * 1000;
  const msRemaining = periodMs - (Date.now() % periodMs);
  if (msRemaining < minHeadroomMs) {
    await new Promise((resolve) => setTimeout(resolve, msRemaining));
  }
}

test("invitation, password, login, 2FA, logout", async ({ page }) => {
  await page.goto(`/invitation/${TOKEN}`);
  // SessionProvider (api/session.tsx) fetches the CSRF cookie asynchronously on mount; a
  // scripted actor can fill and submit the form faster than that first round trip resolves,
  // which a real, unhurried user never does. Wait for it explicitly rather than adding an
  // arbitrary sleep.
  await page.waitForFunction(() => document.cookie.includes("csrftoken="));
  await page.getByLabel(fr.invitation.choosePassword).fill(PASSWORD);
  await page.getByRole("button", { name: fr.auth.submit }).click();

  // Accepting the invitation logs the user in and navigates to "/", but RootRedirect
  // immediately replaces that with "/accounts" — this browser profile has no IndexedDB
  // account yet, so there is nothing to redirect to a dashboard for.
  await expect(page).toHaveURL(/\/accounts$/);

  // /settings needs at least one account to hang its sidebar navigation on (AppLayout
  // redirects to /accounts otherwise, constaté while writing this test) — a device account
  // is IndexedDB-local, not the django user this test is really exercising, so any account
  // will do here.
  await page.getByLabel(fr.accounts.label).fill("Bout en bout");
  await page.getByLabel(fr.accounts.ibAccountId).fill("U1234567");
  await page.getByRole("button", { name: fr.accounts.create }).click();
  await expect(page).toHaveURL(/\/accounts\/[^/]+\/sources$/);

  await page.getByRole("link", { name: fr.nav.settings, exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  // Same ambiguity as the sign-out/sign-in controls below: the sidebar's SessionMenuItem also
  // shows the signed-in email, alongside SettingsPage's own "Compte" card — an unscoped text
  // query intermittently hits a strict-mode violation once both have rendered (constaté: it
  // took several campaign runs to land on the timing that trips it). Scope to <main>.
  await expect(page.getByRole("main").getByText(EMAIL)).toBeVisible();

  // TOTP is not configured yet: SettingsPage fetches the status on mount and shows the fresh
  // provisioning secret straight away, no button click needed to "reveal" it. main.tsx wraps
  // the app in <StrictMode>, which double-invokes that mount effect in dev — firing the GET
  // twice — and the headless endpoint hands out a *freshly regenerated* secret on every GET
  // (allauth's ManageTOTPView.get() calls get_totp_secret(regenerate=True) unconditionally, no
  // caching). Whichever of the two responses lands last is the one actually held in the
  // server's session, so reading the secret the instant it first appears can catch the
  // already-stale first one (constaté while writing this test: an intermittent "Incorrect
  // code." on activation). Waiting for the DOM to stop moving before reading it is what a
  // patient human does implicitly; this makes the wait explicit instead of racing it.
  await expect(page.getByText(/^otpauth:\/\/totp\//)).toBeVisible();
  await page.waitForTimeout(1000);
  const totpUrlText = await page.getByText(/^otpauth:\/\/totp\//).innerText();
  const provisioning = new URL(totpUrlText);
  const secret = provisioning.searchParams.get("secret");
  if (!secret) throw new Error(`no secret in provisioning URL: ${totpUrlText}`);
  const digits = Number(provisioning.searchParams.get("digits") ?? 6);
  const period = Number(provisioning.searchParams.get("period") ?? 30);

  await waitForFreshTotpWindow(period);
  await page.getByLabel(fr.auth.code).fill(totpCode(secret, digits, period));
  await page.getByRole("button", { name: fr.settings.enableTotp }).click();
  await expect(page.getByText(fr.settings.totpConfigured)).toBeVisible();

  // Leave the account back in a password-only state: sync.spec.ts logs in as this same user
  // with just email and password, and must not have to solve a second factor to do it.
  await page.getByRole("button", { name: fr.settings.disableTotp }).click();
  await expect(page.getByText(fr.settings.totpConfigured)).toBeHidden();

  // AppLayout renders the sign-out control twice — once in the sidebar's SessionMenuItem, once
  // in SettingsPage's own "Compte" card — so an unscoped role query is ambiguous. <main> is
  // SettingsPage's own copy, the one this test is actually exercising.
  await page.getByRole("main").getByRole("button", { name: fr.auth.signOut }).click();

  // Not "expect a sign-in link back on this page": db/profile.ts's adoptDefaultProfile
  // absorbs the anonymous IndexedDB profile into a first-time user's own on login and never
  // gives it back, so DbProvider's async swap back to the (now empty) anonymous profile on
  // logout can make AppLayout redirect /settings straight to /accounts — which has no
  // sign-in/sign-out UI of its own at all — before or after this assertion gets to run. Which
  // page the SPA happens to land on is a race against that unrelated IndexedDB swap, not
  // something a test for the auth flow should depend on (constaté: an intermittent failure
  // here across repeated campaign runs while verifying this very test's reliability). What
  // this step actually needs to prove — the server session is really gone — doesn't depend on
  // it: ask the server directly.
  const session = await page.request.get("/_allauth/browser/v1/auth/session");
  expect(session.status()).toBe(401);
});
