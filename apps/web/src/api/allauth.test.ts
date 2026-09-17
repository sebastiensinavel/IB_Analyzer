import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateTotp,
  authenticateSecondFactor,
  deactivateTotp,
  fetchSession,
  generateRecoveryCodes,
  login,
  logout,
} from "./allauth";

function mockFetchOnce(status: number, body: unknown) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

describe("allauth client", () => {
  beforeEach(() => {
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    vi.restoreAllMocks();
  });

  it("fetchSession reports the user on a 200", async () => {
    mockFetchOnce(200, { data: { user: { id: 7, email: "a@example.com" } } });
    const result = await fetchSession();
    expect(result).toEqual({ ok: true, value: { id: "7", email: "a@example.com" } });
  });

  it("fetchSession reports anonymous on a 401", async () => {
    mockFetchOnce(401, { meta: { is_authenticated: false } });
    expect(await fetchSession()).toEqual({ ok: false, kind: "anonymous" });
  });

  it("fetchSession reports unreachable when the network fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await fetchSession()).toEqual({ ok: false, kind: "unreachable" });
  });

  it("fetchSession reports unreachable, never throws, on a 200 with a non-JSON body", async () => {
    // A misrouted request can land on the SPA's own index.html (or a proxy's error page)
    // with a 200 status and an HTML body. That is not a real allauth response.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } }),
    );
    await expect(fetchSession()).resolves.toEqual({ ok: false, kind: "unreachable" });
  });

  it("login authenticates directly when no second factor is configured", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { user: { id: 1, email: "a@example.com" } } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { user: { id: 1, email: "a@example.com" } } }), { status: 200 }),
      );
    const result = await login("a@example.com", "correct-horse-battery");
    expect(result).toEqual({ ok: true, value: { id: "1", email: "a@example.com" } });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/auth/login"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("login reports rejected on a wrong password, distinct from a pending second factor", async () => {
    // Constaté against the real allauth headless endpoint (django-allauth 65.19.2): a
    // rejected password is HTTP 400 with a top-level `errors` array, no `data` key at all.
    mockFetchOnce(400, {
      status: 400,
      errors: [{ message: "The email address and/or password you specified are not correct.", code: "email_password_mismatch", param: "password" }],
    });
    const result = await login("a@example.com", "wrong-password");
    expect(result).toEqual({
      ok: false,
      kind: "rejected",
      detail: "The email address and/or password you specified are not correct.",
    });
  });

  it("login reports mfa_required when the password matched but a second factor is pending", async () => {
    // Constaté shape (django-allauth 65.19.2, HTTP 401): a valid password with a second
    // factor pending is *not* the login endpoint's 400 rejection shape above. It carries
    // data.flows with an `mfa_authenticate` entry marked is_pending, distinct from a plain
    // "no session" 401 (which carries no such flow).
    mockFetchOnce(401, {
      status: 401,
      data: {
        flows: [{ id: "login" }, { id: "mfa_authenticate", is_pending: true, types: ["recovery_codes", "totp"] }],
      },
      meta: { is_authenticated: false },
    });
    const result = await login("a@example.com", "correct-horse-battery");
    expect(result).toEqual({ ok: false, kind: "mfa_required", methods: ["recovery_codes", "totp"] });
  });

  it("login reports unreachable when the network fails, never throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(login("a@example.com", "correct-horse-battery")).resolves.toEqual({
      ok: false,
      kind: "unreachable",
    });
  });

  it("logout calls DELETE on the session endpoint and never throws when unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(logout()).resolves.toBeUndefined();
  });

  it("logout sends the CSRF token from the cookie", async () => {
    document.cookie = "csrftoken=abc123; path=/";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await logout();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/auth/session");
    expect(new Headers(init.headers).get("X-CSRFToken")).toBe("abc123");
    expect(init.method).toBe("DELETE");
  });

  it("authenticateSecondFactor posts the code and reports the user on success", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { user: { id: 1, email: "a@example.com" } } }), { status: 200 }),
      );
    const result = await authenticateSecondFactor("123456");
    expect(result).toEqual({ ok: true, value: { id: "1", email: "a@example.com" } });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/auth/2fa/authenticate"),
      expect.objectContaining({ method: "POST", body: JSON.stringify({ code: "123456" }) }),
    );
  });

  it("authenticateSecondFactor reports rejected on a wrong code, same shape as a wrong password", async () => {
    mockFetchOnce(400, {
      status: 400,
      errors: [{ message: "Incorrect code.", code: "incorrect_code", param: "code" }],
    });
    const result = await authenticateSecondFactor("000000");
    expect(result).toEqual({ ok: false, kind: "rejected", detail: "Incorrect code." });
  });

  it("activateTotp posts the code and reports rejected on a wrong one", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { type: "totp" } }), { status: 200 }));
    expect(await activateTotp("654321")).toEqual({ ok: true, value: undefined });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/account/authenticators/totp"),
      expect.objectContaining({ method: "POST", body: JSON.stringify({ code: "654321" }) }),
    );

    mockFetchOnce(400, { status: 400, errors: [{ message: "Incorrect code.", code: "incorrect_code" }] });
    expect(await activateTotp("000000")).toEqual({ ok: false, kind: "rejected", detail: "Incorrect code." });
  });

  it("deactivateTotp sends DELETE and reports unreachable, never throws, on a network failure", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await deactivateTotp()).toEqual({ ok: true, value: undefined });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/account/authenticators/totp"),
      expect.objectContaining({ method: "DELETE" }),
    );

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await deactivateTotp()).toEqual({ ok: false, kind: "unreachable" });
  });

  it("generateRecoveryCodes posts and returns the freshly generated codes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { total_code_count: 10, unused_code_count: 10, unused_codes: ["aaaa-1111", "bbbb-2222"] },
        }),
        { status: 200 },
      ),
    );
    const result = await generateRecoveryCodes();
    expect(result).toEqual({
      ok: true,
      value: { generated: true, totalCodeCount: 10, unusedCodeCount: 10, codes: ["aaaa-1111", "bbbb-2222"] },
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/account/authenticators/recovery-codes"),
      expect.objectContaining({ method: "POST" }),
    );
  });
});
