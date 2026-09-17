/**
 * Reads Django's CSRF cookie (`csrftoken`) straight from `document.cookie`. Absent until
 * `ensureCsrfCookie()` (client.ts) has run once against a view that sets it.
 *
 * Shared by every caller that talks to the server directly: `client.ts` (the typed
 * `openapi-fetch` client, via a middleware) and `allauth.ts` (hand-written `fetch` calls to
 * django-allauth's headless endpoints, outside the OpenAPI schema). Extracted here rather than
 * duplicated so the cookie-parsing logic has exactly one definition in the repository — task
 * 17's `apps/web/src/flex/proxy.ts` (raw `fetch` to the Flex proxy) will be a third caller.
 */
export function csrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}
