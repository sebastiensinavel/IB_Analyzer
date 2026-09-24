import { afterEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "ib2:theme";

describe("applyStoredTheme", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
    window.localStorage.clear();
    vi.resetModules();
  });

  it("adds the dark class at startup when localStorage says dark, before any component mounts useTheme", async () => {
    window.localStorage.setItem(STORAGE_KEY, "dark");
    // isDark is read once at module load (module-scoped store): reset modules and
    // import fresh so this test sees the same startup sequence as main.tsx.
    vi.resetModules();
    const { applyStoredTheme } = await import("./useTheme");

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    applyStoredTheme();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes the dark class at startup when localStorage says light", async () => {
    window.localStorage.setItem(STORAGE_KEY, "light");
    document.documentElement.classList.add("dark");
    vi.resetModules();
    const { applyStoredTheme } = await import("./useTheme");

    applyStoredTheme();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
