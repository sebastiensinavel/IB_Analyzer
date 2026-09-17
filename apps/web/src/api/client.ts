import createClient, { type Middleware } from "openapi-fetch";
import { csrfToken } from "./csrf";
import type { paths } from "./schema";

/**
 * `openapi.json` is generated from Django's URL resolution (`path("api/", api.urls)`), so
 * every path key already carries the `/api` prefix — e.g. `/api/csrf`, not `/csrf` relative
 * to a `/api` base. `baseUrl` therefore carries only the origin, same-origin deployment
 * (spec: SPA and Django served from the same domain, Traefik routing `/api` to Django).
 *
 * A plain relative `baseUrl` (e.g. `""` or `"/api"`) would also be correct in a real browser,
 * but the global `Request`/`fetch` used by both this app and its tests (Node's `undici`, not
 * jsdom's — jsdom ships no `fetch`) reject a relative URL outright: `new Request("/api/csrf")`
 * throws `Failed to parse URL from /api/csrf`. `window.location.origin` keeps every URL
 * absolute in both the browser and the jsdom test environment.
 */
const BASE_URL = window.location.origin;

const csrfMiddleware: Middleware = {
  onRequest({ request }) {
    const token = csrfToken();
    if (token) request.headers.set("X-CSRFToken", token);
    return request;
  },
};

export const api = createClient<paths>({
  baseUrl: BASE_URL,
  credentials: "same-origin",
  // openapi-fetch reads `fetch` once, at client construction, and reuses that
  // reference for every request. Indirecting through `globalThis.fetch` here
  // (rather than passing it directly) keeps each call looking it up fresh, so
  // `vi.spyOn(globalThis, "fetch")` in tests — set up after this module has
  // already been imported — is actually exercised.
  fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
});
api.use(csrfMiddleware);

/** Call once at boot: Django only sets the cookie on a view that asks for it. */
export async function ensureCsrfCookie(): Promise<void> {
  await api.GET("/api/csrf");
}
