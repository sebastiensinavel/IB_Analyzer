import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "@/App";

describe("App", () => {
  beforeEach(() => {
    // App now mounts SessionProvider, which fetches on mount. Mock fetch so this test never
    // depends on whatever happens to be reachable at window.location.origin on the machine
    // running it (a stray dev server, a real network) — it isn't testing the session state.
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
  });

  it("mounts with the shared i18n and router providers", async () => {
    render(<App />);
    expect(await screen.findByText("Comptes")).toBeInTheDocument();
  });
});
