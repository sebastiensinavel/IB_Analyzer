import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ensureCsrfCookie } from "./client";

describe("api client", () => {
  beforeEach(() => {
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    vi.restoreAllMocks();
  });

  it("sends the CSRF token from the cookie", async () => {
    document.cookie = "csrftoken=abc123; path=/";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "1", email: "a@example.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await api.POST("/api/core/invitations/accept", { body: { token: "t", password: "p" } });

    const request = fetchSpy.mock.calls[0][0] as Request;
    expect(request.headers.get("X-CSRFToken")).toBe("abc123");
    expect(request.url).toContain("/api/core/invitations/accept");
  });

  it("sends no CSRF header when there is no cookie", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await api.POST("/api/core/invitations/accept", { body: { token: "t", password: "p" } });
    const request = fetchSpy.mock.calls[0][0] as Request;
    expect(request.headers.get("X-CSRFToken")).toBeNull();
  });

  it("ensureCsrfCookie calls the endpoint that sets it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await ensureCsrfCookie();
    expect((fetchSpy.mock.calls[0][0] as Request).url).toContain("/api/csrf");
  });
});
