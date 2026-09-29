import { afterEach, describe, expect, it, vi } from "vitest";
import { UPDATE_CHECK_INTERVAL_MS, reloadOnControllerChange, scheduleUpdateChecks } from "./updates";

function fakeContainer(controller: object | null) {
  const target = new EventTarget();
  return Object.assign(target, { controller }) as unknown as ServiceWorkerContainer;
}

describe("reloadOnControllerChange", () => {
  it("recharge un onglet qui avait déjà un contrôleur : une mise à jour a pris la main", () => {
    const container = fakeContainer({});
    const reload = vi.fn();
    reloadOnControllerChange(container, reload);
    container.dispatchEvent(new Event("controllerchange"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("ne recharge pas l'onglet de la première installation", () => {
    const container = fakeContainer(null);
    const reload = vi.fn();
    reloadOnControllerChange(container, reload);
    container.dispatchEvent(new Event("controllerchange"));
    expect(reload).not.toHaveBeenCalled();
  });

  it("ne recharge qu'une fois, même sur deux événements", () => {
    const container = fakeContainer({});
    const reload = vi.fn();
    reloadOnControllerChange(container, reload);
    container.dispatchEvent(new Event("controllerchange"));
    container.dispatchEvent(new Event("controllerchange"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("ne fait rien sans Service Worker dans le navigateur", () => {
    expect(() => reloadOnControllerChange(undefined, vi.fn())()).not.toThrow();
  });
});

describe("scheduleUpdateChecks", () => {
  afterEach(() => vi.useRealTimers());

  it("vérifie toutes les heures", () => {
    vi.useFakeTimers();
    const update = vi.fn().mockResolvedValue(undefined);
    const stop = scheduleUpdateChecks({ update }, () => true);
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS - 1);
    expect(update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(update).toHaveBeenCalledTimes(1);
    stop();
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("ne vérifie pas hors ligne", () => {
    vi.useFakeTimers();
    const update = vi.fn().mockResolvedValue(undefined);
    scheduleUpdateChecks({ update }, () => false);
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    expect(update).not.toHaveBeenCalled();
  });

  it("avale l'échec d'une vérification, serveur coupé", async () => {
    vi.useFakeTimers();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const update = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    scheduleUpdateChecks({ update }, () => true);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    await Promise.resolve();
    process.off("unhandledRejection", unhandled);
    expect(update).toHaveBeenCalledTimes(1);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
