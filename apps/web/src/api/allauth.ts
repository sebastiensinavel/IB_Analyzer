/**
 * django-allauth headless, browser client. Not in Ninja's OpenAPI schema — the installed
 * django-allauth 65.19.2 exposes no machine-readable spec for its headless endpoints (see
 * apps/api/README.md), so this module talks to the wire protocol by hand. Paths come from
 * the survey recorded at the top of apps/api/tests/test_allauth_wiring.py, walked against
 * the live URL resolver for this exact version.
 */
import { csrfToken } from "./csrf";

// Absolute, like client.ts's baseUrl: a relative fetch("/foo") throws "Failed to parse
// URL from /foo" under Node's undici, which is the global `fetch` in both the production
// build and jsdom tests (jsdom itself ships no fetch implementation).
const BASE = `${window.location.origin}/_allauth/browser/v1`;

export interface SessionUser {
  id: string;
  email: string;
}

/**
 * Login stage id allauth reports when the password matched but a second factor is still
 * required. Hardcoded rather than imported from allauth.mfa.internal.constants.LoginStageKey:
 * this literal is the wire contract the browser actually sees, and it fails loudly if the
 * server ever renames the stage, where a shared constant would silently drift instead.
 */
const MFA_AUTHENTICATE_STAGE = "mfa_authenticate";

export type AllauthResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "anonymous" | "unreachable" | "rejected"; detail?: string }
  // A valid password with a second factor still pending is not a rejection: allauth answers
  // it with a distinct, 401 body carrying data.flows, not the login-endpoint's plain 400
  // (constaté against the real endpoint — see apps/web/src/api/allauth.test.ts). Task 14
  // drives the second step from this variant.
  | { ok: false; kind: "mfa_required"; methods: string[] };

/** One answer from allauth, body included: `null` when the body was absent or not JSON at all. */
interface Answer {
  ok: boolean;
  status: number;
  body: unknown;
}

/**
 * Calls allauth and reads the body of whatever comes back, even when no caller looks at it: a
 * `fetch` response left unread keeps its request hanging in the browser, so the page never reaches
 * network idle — and /auth/session answers its anonymous 401 on every single page load.
 */
async function call(path: string, init: RequestInit = {}): Promise<Answer | null> {
  const token = csrfToken();
  try {
    const response = await fetch(`${BASE}${path}`, {
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        ...(token ? { "X-CSRFToken": token } : {}),
        ...(init.headers ?? {}),
      },
      ...init,
    });
    return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) };
  } catch {
    // A network failure is never an error shown across the app (spec §2): the server is
    // optional, and "unreachable" is a normal, expected state, not an exception to surface.
    return null;
  }
}

/** The first error message of a refusal, allauth's `errors` array; `undefined` when it carries none. */
function errorDetail(body: unknown): string | undefined {
  const errors = (body as { errors?: { message?: unknown }[] } | null)?.errors;
  const message = Array.isArray(errors) ? errors[0]?.message : undefined;
  return typeof message === "string" ? message : undefined;
}

export async function fetchSession(): Promise<AllauthResult<SessionUser>> {
  const answer = await call("/auth/session");
  if (answer === null) return { ok: false, kind: "unreachable" };
  if (!answer.ok) return { ok: false, kind: "anonymous" };
  // A 200 with no JSON body at all (a misrouted request landing on the SPA's own index.html,
  // an intermediary's error page, ...) is not a real allauth response: treat it the same as an
  // unreachable server, never a thrown error (spec §2).
  if (answer.body === null) return { ok: false, kind: "unreachable" };
  const user = (answer.body as { data?: { user?: { id: unknown; email: unknown } } }).data?.user;
  if (!user) return { ok: false, kind: "anonymous" };
  return { ok: true, value: { id: String(user.id), email: String(user.email) } };
}

/**
 * Reads the pending `mfa_authenticate` flow out of a failed /auth/login response body, if
 * present. Constaté shape (django-allauth 65.19.2, HTTP 401):
 *   { "data": { "flows": [{ "id": "login" }, { "id": "mfa_authenticate", "is_pending": true,
 *     "types": ["recovery_codes", "totp"] }] }, "meta": { "is_authenticated": false } }
 * A rejected password never carries a `data` key at all: it is HTTP 400 with a top-level
 * `errors` array instead, which is what falls through to the "rejected" branch below.
 */
function pendingMfaFlow(body: unknown): { types: string[] } | null {
  const flows = (body as { data?: { flows?: unknown } } | null)?.data?.flows;
  if (!Array.isArray(flows)) return null;
  const flow = flows.find(
    (candidate): candidate is { id: string; is_pending: boolean; types?: string[] } =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as { id?: unknown }).id === MFA_AUTHENTICATE_STAGE,
  );
  if (!flow || flow.is_pending !== true) return null;
  return { types: flow.types ?? [] };
}

export async function login(email: string, password: string): Promise<AllauthResult<SessionUser>> {
  const answer = await call("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  if (answer === null) return { ok: false, kind: "unreachable" };
  if (answer.ok) return fetchSession();
  const pending = pendingMfaFlow(answer.body);
  if (pending) return { ok: false, kind: "mfa_required", methods: pending.types };
  return { ok: false, kind: "rejected", detail: errorDetail(answer.body) };
}

export async function logout(): Promise<void> {
  await call("/auth/session", { method: "DELETE" });
}

/**
 * Submits the pending second-factor code from the `mfa_authenticate` login stage. Wire
 * shape read straight from the installed django-allauth 65.19.2 sources (headless/mfa/views.py
 * `AuthenticateView`, headless/base/response.py `AuthenticationResponse`): success answers
 * exactly like `/auth/login`'s success case (200, `data.user`), and a wrong code answers
 * exactly like a rejected password (400, top-level `errors` array) — there is no separate
 * "mfa_required" branch to handle here, this endpoint only ever accepts or rejects the code.
 */
export async function authenticateSecondFactor(code: string): Promise<AllauthResult<SessionUser>> {
  const answer = await call("/auth/2fa/authenticate", { method: "POST", body: JSON.stringify({ code }) });
  if (answer === null) return { ok: false, kind: "unreachable" };
  if (answer.ok) return fetchSession();
  return { ok: false, kind: "rejected", detail: errorDetail(answer.body) };
}

/**
 * Changes the signed-in user's password. `currentPassword` is required by allauth whenever
 * the account already has a usable password (always true here: accounts are only ever
 * created through the invitation flow, which sets one) — see headless/account/inputs.py
 * `ChangePasswordInput`. Not covered by the task-4 endpoint survey: read straight from the
 * installed allauth sources instead (headless/account/urls.py, `ChangePasswordView`).
 */
export async function changePassword(newPassword: string, currentPassword: string): Promise<AllauthResult<void>> {
  const answer = await call("/account/password/change", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
  if (answer === null) return { ok: false, kind: "unreachable" };
  if (answer.ok) return { ok: true, value: undefined };
  return { ok: false, kind: "rejected", detail: errorDetail(answer.body) };
}

export type TotpStatus = { configured: true } | { configured: false; secret: string; totpUrl: string };

/**
 * Reads whether TOTP is set up on the signed-in account. A `GET` with no authenticator
 * configured yet answers 404 with a JSON body carrying a fresh provisioning secret and URL
 * (`meta.secret`, `meta.totp_url`) — allauth's way of saying "not configured", not a routing
 * failure (constaté at task 4, apps/api/tests/test_allauth_wiring.py). Only a 404 *without*
 * that body is treated as unreachable/misrouted.
 */
export async function fetchTotpStatus(): Promise<AllauthResult<TotpStatus>> {
  const answer = await call("/account/authenticators/totp");
  if (answer === null) return { ok: false, kind: "unreachable" };
  if (answer.status === 404) {
    const meta = (answer.body as { meta?: { secret?: unknown; totp_url?: unknown } } | null)?.meta;
    if (typeof meta?.secret === "string" && typeof meta.totp_url === "string") {
      return { ok: true, value: { configured: false, secret: meta.secret, totpUrl: meta.totp_url } };
    }
    return { ok: false, kind: "unreachable" };
  }
  if (!answer.ok) return { ok: false, kind: "rejected" };
  return { ok: true, value: { configured: true } };
}

/** Activates TOTP with the code generated from the secret handed out by `fetchTotpStatus`. */
export async function activateTotp(code: string): Promise<AllauthResult<void>> {
  const answer = await call("/account/authenticators/totp", { method: "POST", body: JSON.stringify({ code }) });
  if (answer === null) return { ok: false, kind: "unreachable" };
  if (answer.ok) return { ok: true, value: undefined };
  return { ok: false, kind: "rejected", detail: errorDetail(answer.body) };
}

export async function deactivateTotp(): Promise<AllauthResult<void>> {
  const answer = await call("/account/authenticators/totp", { method: "DELETE" });
  if (answer === null) return { ok: false, kind: "unreachable" };
  if (answer.ok) return { ok: true, value: undefined };
  return { ok: false, kind: "rejected" };
}

export interface RecoveryCodesStatus {
  /** `false` before any code has ever been generated for this account. */
  generated: boolean;
  totalCodeCount: number | null;
  unusedCodeCount: number | null;
  /**
   * The actual codes, shown by allauth exactly once — right after a fetch or a generate call
   * that it marks viewable (`can_view`). `null` once they have already been viewed: never
   * re-displayed on a later `GET` (headless/mfa/response.py `RecoveryCodesResponse`).
   */
  codes: string[] | null;
}

function parseRecoveryCodes(body: unknown): RecoveryCodesStatus {
  const data = (
    body as {
      data?: { total_code_count?: unknown; unused_code_count?: unknown; unused_codes?: unknown };
    } | null
  )?.data;
  return {
    generated: true,
    totalCodeCount: typeof data?.total_code_count === "number" ? data.total_code_count : null,
    unusedCodeCount: typeof data?.unused_code_count === "number" ? data.unused_code_count : null,
    codes: Array.isArray(data?.unused_codes) ? (data.unused_codes as string[]) : null,
  };
}

/** A 404 here means no recovery codes have ever been generated — not an error. */
export async function fetchRecoveryCodes(): Promise<AllauthResult<RecoveryCodesStatus>> {
  const answer = await call("/account/authenticators/recovery-codes");
  if (answer === null) return { ok: false, kind: "unreachable" };
  if (answer.status === 404) {
    return { ok: true, value: { generated: false, totalCodeCount: null, unusedCodeCount: null, codes: null } };
  }
  if (!answer.ok) return { ok: false, kind: "rejected" };
  return { ok: true, value: parseRecoveryCodes(answer.body) };
}

/** Replaces every recovery code with a fresh set, returned once in the response body. */
export async function generateRecoveryCodes(): Promise<AllauthResult<RecoveryCodesStatus>> {
  const answer = await call("/account/authenticators/recovery-codes", { method: "POST" });
  if (answer === null) return { ok: false, kind: "unreachable" };
  if (!answer.ok) return { ok: false, kind: "rejected" };
  return { ok: true, value: parseRecoveryCodes(answer.body) };
}
