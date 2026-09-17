import { beforeEach, describe, expect, it } from "vitest";
import { csrfToken } from "./csrf";

function clearCookies() {
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

describe("csrfToken", () => {
  beforeEach(() => clearCookies());

  it("returns null when the csrftoken cookie is absent", () => {
    expect(csrfToken()).toBeNull();
  });

  it("reads the token when it is the only cookie", () => {
    document.cookie = "csrftoken=abc123; path=/";
    expect(csrfToken()).toBe("abc123");
  });

  it("finds the token among other cookies, in either position", () => {
    document.cookie = "sessionid=xyz; path=/";
    document.cookie = "csrftoken=abc123; path=/";
    document.cookie = "theme=dark; path=/";
    expect(csrfToken()).toBe("abc123");
  });

  it("decodes a URI-encoded token", () => {
    document.cookie = `csrftoken=${encodeURIComponent("a+b/c=d")}; path=/`;
    expect(csrfToken()).toBe("a+b/c=d");
  });

  it("does not match a cookie whose name only ends with csrftoken", () => {
    document.cookie = "othercsrftoken=wrong; path=/";
    expect(csrfToken()).toBeNull();
  });
});
