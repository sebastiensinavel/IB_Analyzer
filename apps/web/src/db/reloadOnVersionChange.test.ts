import Dexie from "dexie";
import { describe, expect, it, vi } from "vitest";
import { AppDatabase } from "./schema";
import { reloadOnVersionChange } from "./reloadOnVersionChange";

describe("reloadOnVersionChange", () => {
  it("recharge l'onglet dont une autre connexion monte le schéma, et ne la bloque pas", async () => {
    const name = "reload-on-versionchange";
    const old = new AppDatabase(name);
    await old.open();
    const reload = vi.fn();
    reloadOnVersionChange(old, reload);

    const newer = new Dexie(name);
    newer.version(old.verno + 1).stores({});
    await newer.open(); // se bloquerait si l'ancienne connexion restait ouverte

    expect(reload).toHaveBeenCalledTimes(1);
    expect(old.isOpen()).toBe(false);
    newer.close();
    await Dexie.delete(name);
  });

  it("ne recharge pas sur une simple ouverture au même schéma", async () => {
    const name = "reload-on-versionchange-same";
    const a = new AppDatabase(name);
    await a.open();
    const reload = vi.fn();
    reloadOnVersionChange(a, reload);
    const b = new AppDatabase(name);
    await b.open();
    expect(reload).not.toHaveBeenCalled();
    a.close();
    b.close();
    await Dexie.delete(name);
  });
});
