import { afterEach, describe, expect, it, vi } from "vitest";
import { UPDATE_CHECK_INTERVAL_MS, reloadOnControllerChange, scheduleUpdateChecks } from "./updates";

/**
 * `registration` : ce que `getRegistration()` rend au chargement — `"active"` pour un onglet
 * dont l'origine a déjà un Service Worker actif (Maj+Recharger), `null` pour la première
 * visite ; une promesse passée telle quelle permet de retenir la réponse.
 */
function fakeContainer(
  controller: object | null,
  registration: "active" | null | Promise<ServiceWorkerRegistration | undefined> = controller ? "active" : null,
) {
  const target = new EventTarget();
  const getRegistration = vi.fn(() =>
    registration instanceof Promise
      ? registration
      : Promise.resolve(registration === "active" ? ({ active: {} } as ServiceWorkerRegistration) : undefined),
  );
  return Object.assign(target, { controller, getRegistration }) as unknown as ServiceWorkerContainer;
}

const change = (container: ServiceWorkerContainer) => container.dispatchEvent(new Event("controllerchange"));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("reloadOnControllerChange", () => {
  it("recharge un onglet qui avait déjà un contrôleur : une mise à jour a pris la main", () => {
    const container = fakeContainer({});
    const reload = vi.fn();
    reloadOnControllerChange(container, reload);
    change(container);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("première installation : ignore la prise de contrôle, recharge à la mise à jour suivante", async () => {
    const container = fakeContainer(null, null);
    const reload = vi.fn();
    reloadOnControllerChange(container, reload);
    await flush();
    change(container);
    expect(reload).not.toHaveBeenCalled();
    change(container);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("onglet sans contrôleur mais Service Worker déjà actif (Maj+Recharger) : recharge au premier changement", async () => {
    const container = fakeContainer(null, "active");
    const reload = vi.fn();
    reloadOnControllerChange(container, reload);
    await flush();
    change(container);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("un changement arrivé avant la réponse de getRegistration compte pour la première installation", async () => {
    let answer!: (r: ServiceWorkerRegistration | undefined) => void;
    const container = fakeContainer(null, new Promise((resolve) => (answer = resolve)));
    const reload = vi.fn();
    reloadOnControllerChange(container, reload);
    change(container);
    answer({ active: {} } as ServiceWorkerRegistration);
    await flush();
    expect(reload).not.toHaveBeenCalled();
    change(container);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("getRegistration en échec : se comporte comme une première installation", async () => {
    const container = fakeContainer(null, Promise.reject(new Error("SecurityError")));
    const reload = vi.fn();
    reloadOnControllerChange(container, reload);
    await flush();
    change(container);
    expect(reload).not.toHaveBeenCalled();
    change(container);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("ne recharge qu'une fois, même sur plusieurs événements", async () => {
    for (const container of [fakeContainer({}), fakeContainer(null, "active"), fakeContainer(null, null)]) {
      const reload = vi.fn();
      reloadOnControllerChange(container, reload);
      await flush();
      change(container);
      change(container);
      change(container);
      expect(reload).toHaveBeenCalledTimes(1);
    }
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
