/**
 * The three backup routes. Plain `fetch` rather than the generated `openapi-fetch` client:
 * the deposit and the download carry raw bytes, which that client is not shaped for. Same
 * precedent as `allauth.ts`, and the same absolute URL rule as `client.ts` — Node's undici
 * rejects a relative one, in the build and in jsdom alike.
 *
 * Mounted under Django's `core` router (`config/api.py`: `api.add_router("/core", core_router)`),
 * not directly under `/api` — hence `/api/core/backup`, not `/api/backup`.
 */
import { csrfToken } from "./csrf";

const BASE = `${window.location.origin}/api/core/backup`;

/**
 * The server's own ceiling, mirrored from `core.models.MAX_BACKUP_BYTES`, and checked here
 * before the POST rather than only after it. Django reads `request.body` under
 * `DATA_UPLOAD_MAX_MEMORY_SIZE` and raises `RequestDataTooBig` — a bare 400 — before the view
 * can answer 413, so past that one-megabyte margin the server is no longer able to name the
 * cause and the user reads "L'opération a échoué" for what is simply the ceiling. Refusing
 * here names it, and spares twenty megabytes an upload that would be thrown away.
 */
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

export type BackupFailure = "unreachable" | "anonymous" | "csrf" | "too-large" | "missing" | "failed";
export type BackupResult<T> = { ok: true; value: T } | { ok: false; kind: BackupFailure };

export interface BackupStatus {
  present: boolean;
  updatedAt: string | null;
  bytes: number | null;
}

// django-ninja's `SessionAuth` (ninja/security/session.py) raises 401 when
// `request.user.is_authenticated` is false — genuinely no session. `APIKeyCookie._get_key`
// (ninja/security/apikey.py), which every cookie-based authenticator including `SessionAuth`
// inherits from, raises 403 on its own for a failed CSRF check, *before* authentication even
// runs — so 403 can hit a signed-in user just as easily as an anonymous one, e.g. a stale
// token after a long tab. Folding it into "anonymous" would tell that signed-in user to sign
// in again, which they already are; the fix for 403 is reloading the page, not the account.
function failureFor(status: number): BackupFailure {
  if (status === 401) return "anonymous";
  if (status === 403) return "csrf";
  if (status === 413) return "too-large";
  if (status === 404) return "missing";
  return "failed";
}

// `init` is spread first, then `credentials`/`headers`: `init` itself carries `headers` (the
// raw-bytes content-type on a deposit), and spreading it last would let it overwrite the
// merged headers object wholesale, silently dropping X-CSRFToken from every POST/DELETE —
// Django would then answer 403 to all of them. See backup.test.ts's "porte le jeton CSRF ET
// le content-type sur un dépôt", which fails on the opposite order.
async function call(path: string, init: RequestInit = {}): Promise<Response | null> {
  const token = csrfToken();
  try {
    return await fetch(`${BASE}${path}`, {
      ...init,
      credentials: "same-origin",
      headers: { ...(token ? { "X-CSRFToken": token } : {}), ...(init.headers ?? {}) },
    });
  } catch {
    // The server is optional (spec §2): unreachable is a state, never an exception.
    return null;
  }
}

/**
 * A 200 is not proof of a readable body: a captive portal, a misconfigured proxy or an
 * infrastructure error page can all answer 200 with HTML. `Response.json()` throws on that,
 * and the exception must never cross into the caller — same rule as `allauth.ts:61`'s
 * `response.json().catch(() => null)`. `null` here means "the body did not parse", read by
 * every caller as `kind: "failed"`.
 */
async function readJson(answer: Response): Promise<unknown> {
  return answer.json().catch(() => null);
}

export async function fetchBackupStatus(): Promise<BackupResult<BackupStatus>> {
  const answer = await call("/status");
  if (answer === null) return { ok: false, kind: "unreachable" };
  if (!answer.ok) return { ok: false, kind: failureFor(answer.status) };
  const body = await readJson(answer);
  if (body === null) return { ok: false, kind: "failed" };
  return { ok: true, value: body as BackupStatus };
}

export async function putBackup(blob: Uint8Array): Promise<BackupResult<{ updatedAt: string; bytes: number }>> {
  if (blob.byteLength > MAX_BACKUP_BYTES) return { ok: false, kind: "too-large" };
  const answer = await call("", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: blob as BodyInit,
  });
  if (answer === null) return { ok: false, kind: "unreachable" };
  if (!answer.ok) return { ok: false, kind: failureFor(answer.status) };
  const body = await readJson(answer);
  // A value absent from a confirmed deposit stays absent, never fabricated from the local
  // blob (a guessed size, an empty date): a 200 that does not carry both fields is not a
  // confirmation, it is a malformed answer — report it as such rather than invent what the
  // server never said.
  const status = body as Partial<BackupStatus> | null;
  if (status === null || typeof status.updatedAt !== "string" || typeof status.bytes !== "number") {
    return { ok: false, kind: "failed" };
  }
  return { ok: true, value: { updatedAt: status.updatedAt, bytes: status.bytes } };
}

export async function getBackup(): Promise<BackupResult<Uint8Array<ArrayBuffer>>> {
  const answer = await call("");
  if (answer === null) return { ok: false, kind: "unreachable" };
  if (!answer.ok) return { ok: false, kind: failureFor(answer.status) };
  try {
    return { ok: true, value: new Uint8Array(await answer.arrayBuffer()) };
  } catch {
    // A connection dropped mid-download rejects `arrayBuffer()`; the server being optional
    // means that failure is a state the client renders, never an exception that escapes here.
    return { ok: false, kind: "failed" };
  }
}

export async function deleteBackup(): Promise<BackupResult<void>> {
  const answer = await call("", { method: "DELETE" });
  if (answer === null) return { ok: false, kind: "unreachable" };
  if (!answer.ok) return { ok: false, kind: failureFor(answer.status) };
  return { ok: true, value: undefined };
}
