import { afterEach, describe, expect, it } from "vitest";
import { DEMO_DB_NAME, REAL_DB_NAME, databaseName, isDemo, storageKey } from "@/demo/mode";
import { clearTableViews, pageSearchKey, tableViewKey } from "@/lib/tableViewStorage";
import { getLastAccountId, setLastAccountId } from "@/lib/accountStorage";

afterEach(() => {
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
