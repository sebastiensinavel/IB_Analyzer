import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_VIEW, type ColumnMeta } from "@/lib/tableView";
import {
  clearTableViews,
  pageSearchKey,
  readPageSearch,
  readTableView,
  tableViewKey,
  writePageSearch,
  writeTableView,
} from "@/lib/tableViewStorage";

const COLUMNS: ColumnMeta[] = [
  { key: "amount", type: "number", sortable: true },
  { key: "kind", type: "enum", sortable: true },
  { key: "coverage", type: "enum", sortable: false },
];

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tableViewStorage", () => {
  it("builds the keys on the ib2: prefix, per account and table", () => {
    expect(tableViewKey("alpha", "positions:optionSells")).toBe("ib2:tableView:alpha:positions:optionSells");
    expect(pageSearchKey("beta", "history")).toBe("ib2:pageSearch:beta:history");
  });

  it("reads back what it wrote", () => {
    const view = { sort: [{ column: "amount", dir: "desc" as const }], criteria: { amount: ">0", kind: ["trade", null] } };
    writeTableView(tableViewKey("alpha", "history"), view);
    expect(JSON.parse(window.localStorage.getItem("ib2:tableView:alpha:history")!)).toEqual({ v: 1, ...view });
    expect(readTableView(tableViewKey("alpha", "history"), COLUMNS)).toEqual(view);
  });

  it("keeps alpha and beta apart", () => {
    writeTableView(tableViewKey("alpha", "history"), { sort: [], criteria: { amount: ">0" } });
    expect(readTableView(tableViewKey("beta", "history"), COLUMNS)).toEqual(EMPTY_VIEW);
  });

  it("removes the key when the view is empty", () => {
    const key = tableViewKey("alpha", "history");
    writeTableView(key, { sort: [], criteria: { amount: ">0" } });
    writeTableView(key, { sort: [], criteria: { amount: "", kind: [] } });
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("drops what it cannot understand and keeps the rest", () => {
    const key = tableViewKey("alpha", "history");
    window.localStorage.setItem(
      key,
      JSON.stringify({
        v: 1,
        sort: [{ column: "ghost", dir: "asc" }, { column: "coverage", dir: "asc" }, { column: "kind", dir: "sideways" }, { column: "amount", dir: "asc" }],
        criteria: { ghost: "x", amount: ">abc", kind: ["trade", 3], coverage: "UNCOVERED" },
      }),
    );
    expect(readTableView(key, COLUMNS)).toEqual({ sort: [{ column: "amount", dir: "asc" }], criteria: { kind: ["trade"] } });
  });

  it("falls back to an empty view on unreadable JSON or another version", () => {
    const key = tableViewKey("alpha", "history");
    window.localStorage.setItem(key, "{not json");
    expect(readTableView(key, COLUMNS)).toEqual(EMPTY_VIEW);
    window.localStorage.setItem(key, JSON.stringify({ v: 2, sort: [{ column: "amount", dir: "asc" }], criteria: {} }));
    expect(readTableView(key, COLUMNS)).toEqual(EMPTY_VIEW);
  });

  it("works without storage: a throwing localStorage gives an empty state and no error", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readTableView(tableViewKey("alpha", "history"), COLUMNS)).toEqual(EMPTY_VIEW);
    expect(() => writeTableView(tableViewKey("alpha", "history"), { sort: [], criteria: { amount: ">0" } })).not.toThrow();
    expect(readPageSearch(pageSearchKey("alpha", "history"))).toBe("");
    expect(() => writePageSearch(pageSearchKey("alpha", "history"), "AAPL")).not.toThrow();
  });

  it("stores the page search, and removes it when blank", () => {
    const key = pageSearchKey("alpha", "positions");
    writePageSearch(key, "AAPL|MSFT");
    expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual({ v: 1, text: "AAPL|MSFT" });
    expect(readPageSearch(key)).toBe("AAPL|MSFT");
    writePageSearch(key, "  ");
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("clears one account's keys, never those of an account whose id it prefixes", () => {
    writeTableView(tableViewKey("a", "history"), { sort: [], criteria: { amount: ">0" } });
    writePageSearch(pageSearchKey("a", "positions"), "AAPL");
    writeTableView(tableViewKey("ab", "history"), { sort: [], criteria: { amount: ">0" } });
    writePageSearch(pageSearchKey("ab", "positions"), "AAPL");
    window.localStorage.setItem("ib2:theme", "dark");
    clearTableViews("a");
    expect(Object.keys(window.localStorage).sort()).toEqual(["ib2:pageSearch:ab:positions", "ib2:tableView:ab:history", "ib2:theme"]);
  });
});
