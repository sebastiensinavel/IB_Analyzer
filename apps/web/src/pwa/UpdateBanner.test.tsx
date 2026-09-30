import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UPDATE_CHECK_INTERVAL_MS, UPDATE_RELOAD_FALLBACK_MS } from "./updates";

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

  it("dit que la mise à jour est en cours dès le clic, bouton désactivé", async () => {
    state.needRefresh = true;
    render(<UpdateBanner />);
    await userEvent.click(screen.getByRole("button", { name: "Recharger" }));
    expect(screen.getByRole("status")).toHaveTextContent("Mise à jour en cours…");
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("n'active la version qu'une fois, même cliqué plusieurs fois", async () => {
    state.needRefresh = true;
    render(<UpdateBanner />);
    const button = screen.getByRole("button", { name: "Recharger" });
    await userEvent.click(button);
    await userEvent.click(button);
    await userEvent.click(button);
    expect(state.updateServiceWorker).toHaveBeenCalledTimes(1);
  });

  it("recharge de lui-même si le nouveau Service Worker n'a pas pris la main à temps", () => {
    vi.useFakeTimers();
    state.needRefresh = true;
    const reload = vi.fn();
    render(<UpdateBanner reload={reload} />);
    act(() => vi.advanceTimersByTime(UPDATE_RELOAD_FALLBACK_MS));
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Recharger" }));
    act(() => vi.advanceTimersByTime(UPDATE_RELOAD_FALLBACK_MS - 1));
    expect(reload).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(reload).toHaveBeenCalledTimes(1);
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
