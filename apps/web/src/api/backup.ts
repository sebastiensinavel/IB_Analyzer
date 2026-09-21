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

export type BackupFailure = "unreachable" | "anonymous" | "too-large" | "missing" | "failed";
export type BackupResult<T> = { ok: true; value: T } | { ok: false; kind: BackupFailure };

export interface BackupStatus {
  present: boolean;
  updatedAt: string | null;
  bytes: number | null;
}

function failureFor(status: number): BackupFailure {
  if (status === 401 || status === 403) return "anonymous";
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

export async function fetchBackupStatus(): Promise<BackupResult<BackupStatus>> {
  const answer = await call("/status");
  if (answer === null) return { ok: false, kind: "unreachable" };
  if (!answer.ok) return { ok: false, kind: failureFor(answer.status) };
  return { ok: true, value: (await answer.json()) as BackupStatus };
}

export async function putBackup(blob: Uint8Array): Promise<BackupResult<{ updatedAt: string; bytes: number }>> {
  const answer = await call("", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: blob as BodyInit,
  });
  if (answer === null) return { ok: false, kind: "unreachable" };
  if (!answer.ok) return { ok: false, kind: failureFor(answer.status) };
  const body = (await answer.json()) as BackupStatus;
  return { ok: true, value: { updatedAt: body.updatedAt ?? "", bytes: body.bytes ?? blob.byteLength } };
}

export async function getBackup(): Promise<BackupResult<Uint8Array>> {
  const answer = await call("");
  if (answer === null) return { ok: false, kind: "unreachable" };
  if (!answer.ok) return { ok: false, kind: failureFor(answer.status) };
  return { ok: true, value: new Uint8Array(await answer.arrayBuffer()) };
}

export async function deleteBackup(): Promise<BackupResult<void>> {
  const answer = await call("", { method: "DELETE" });
  if (answer === null) return { ok: false, kind: "unreachable" };
  if (!answer.ok) return { ok: false, kind: failureFor(answer.status) };
  return { ok: true, value: undefined };
}
