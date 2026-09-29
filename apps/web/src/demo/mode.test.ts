import Dexie from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "@/db/schema";
import { DEMO_DB_NAME, REAL_DB_NAME, clearDemo, databaseName, enterDemo, isDemo, leaveDemo, navigation, storageKey } from "@/demo/mode";
import { clearTableViews, pageSearchKey, tableViewKey } from "@/lib/tableViewStorage";
import { getLastAccountId, setLastAccountId } from "@/lib/accountStorage";

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe("isDemo", () => {
  it("is false without the flag, true with it", () => {
    expect(isDemo()).toBe(false);
    window.sessionStorage.setItem("ib2:demo", "1");
    expect(isDemo()).toBe(true);
  });
});

describe("databaseName", () => {
  it("names the real base outside the demo and the demo base inside", () => {
    expect(databaseName()).toBe(REAL_DB_NAME);
    window.sessionStorage.setItem("ib2:demo", "1");
    expect(databaseName()).toBe(DEMO_DB_NAME);
  });
});

describe("storageKey", () => {
  it("leaves every key alone outside the demo", () => {
    expect(storageKey("ib2:lastAccountId")).toBe("ib2:lastAccountId");
  });
  it("prefixes ib2 keys in the demo, and only those", () => {
    window.sessionStorage.setItem("ib2:demo", "1");
    expect(storageKey("ib2:lastAccountId")).toBe("ib2:demo:lastAccountId");
    expect(storageKey("other")).toBe("other");
  });
  it("keeps a real account named demo apart from the demo account", () => {
    setLastAccountId("demo");
    window.localStorage.setItem(tableViewKey("demo", "history"), "{}");
    window.sessionStorage.setItem("ib2:demo", "1");
    expect(getLastAccountId()).toBeNull();
    expect(tableViewKey("demo", "history")).toBe("ib2:demo:tableView:demo:history");
    expect(pageSearchKey("demo", "positions")).toBe("ib2:demo:pageSearch:demo:positions");
    clearTableViews("demo");
    window.sessionStorage.clear();
    expect(getLastAccountId()).toBe("demo");
    expect(window.localStorage.getItem("ib2:tableView:demo:history")).toBe("{}");
  });
});

describe("enterDemo and leaveDemo", () => {
  it("enters the demo on its dashboard", () => {
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => {});
    enterDemo();
    expect(window.sessionStorage.getItem("ib2:demo")).toBe("1");
    expect(assign).toHaveBeenCalledWith("/accounts/demo/dashboard");
  });

  it("leaves nothing behind, and touches neither the real base nor the real keys", async () => {
    const real = new AppDatabase("ib-analyzer");
    await real.accounts.put({ id: "alpha", label: "alpha", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [] });
    window.localStorage.setItem("ib2:lastAccountId", "alpha");
    window.sessionStorage.setItem("ib2:demo", "1");
    const demo = new AppDatabase(DEMO_DB_NAME);
    await demo.accounts.put({ id: "demo", label: "Démo", ibAccountId: "U0000000", createdAt: "", warnedDroppedKinds: [] });
    window.localStorage.setItem("ib2:demo:lastAccountId", "demo");
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => {});
    await leaveDemo(demo, "/accounts");
    expect(await Dexie.exists(DEMO_DB_NAME)).toBe(false);
    expect(window.localStorage.getItem("ib2:demo:lastAccountId")).toBeNull();
    expect(window.sessionStorage.getItem("ib2:demo")).toBeNull();
    expect(window.localStorage.getItem("ib2:lastAccountId")).toBe("alpha");
    expect(await real.accounts.get("alpha")).toBeDefined();
    expect(assign).toHaveBeenCalledWith("/accounts");
    real.close();
  });

  it("clearDemo alone does not navigate", async () => {
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => {});
    await clearDemo(new AppDatabase(DEMO_DB_NAME));
    expect(assign).not.toHaveBeenCalled();
  });
});
