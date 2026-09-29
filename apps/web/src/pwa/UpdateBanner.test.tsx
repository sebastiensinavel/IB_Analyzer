import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UPDATE_CHECK_INTERVAL_MS } from "./updates";

const state = vi.hoisted(() => ({
  needRefresh: false,
  updateServiceWorker: vi.fn(async () => {}),
  options: undefined as undefined | { onRegisteredSW?: (url: string, r: ServiceWorkerRegistration | undefined) => void },
}));

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: (options: typeof state.options) => {
    state.options = options;
    return {
      needRefresh: [state.needRefresh, vi.fn()],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: state.updateServiceWorker,
    };
  },
}));

const { UpdateBanner } = await import("./UpdateBanner");

describe("UpdateBanner", () => {
  beforeEach(() => {
    state.needRefresh = false;
    state.updateServiceWorker.mockClear();
    state.options = undefined;
  });
  afterEach(() => vi.useRealTimers());

  it("ne montre rien tant qu'aucune version n'attend", () => {
    render(<UpdateBanner />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("annonce la version en attente et l'active au clic", async () => {
    state.needRefresh = true;
    render(<UpdateBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("Nouvelle version disponible");
    await userEvent.click(screen.getByRole("button", { name: "Recharger" }));
    expect(state.updateServiceWorker).toHaveBeenCalledTimes(1);
  });

  it("programme la vérification horaire une fois le Service Worker enregistré", () => {
    vi.useFakeTimers();
    render(<UpdateBanner />);
    const update = vi.fn().mockResolvedValue(undefined);
    state.options!.onRegisteredSW!("/sw.js", { update } as unknown as ServiceWorkerRegistration);
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("ne programme rien sans enregistrement", () => {
    render(<UpdateBanner />);
    expect(() => state.options!.onRegisteredSW!("/sw.js", undefined)).not.toThrow();
  });
});
