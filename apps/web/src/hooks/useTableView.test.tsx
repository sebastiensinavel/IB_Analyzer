import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAGE_SEARCH_DEBOUNCE_MS, usePageSearch, useTableView } from "@/hooks/useTableView";
import type { ColumnMeta } from "@/lib/tableView";

const COLUMNS: ColumnMeta[] = [
  { key: "amount", type: "number", sortable: true },
  { key: "kind", type: "enum", sortable: true },
];

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useTableView", () => {
  it("starts from what storage holds and writes every change back", () => {
    window.localStorage.setItem("ib2:tableView:alpha:history", JSON.stringify({ v: 1, sort: [], criteria: { amount: ">0" } }));
    const { result } = renderHook(() => useTableView("ib2:tableView:alpha:history", COLUMNS));
    expect(result.current.view.criteria).toEqual({ amount: ">0" });
    act(() => result.current.setCriterion("kind", ["trade"]));
    act(() => result.current.toggleSort("amount", false));
    expect(result.current.view).toEqual({ sort: [{ column: "amount", dir: "asc" }], criteria: { amount: ">0", kind: ["trade"] } });
    expect(JSON.parse(window.localStorage.getItem("ib2:tableView:alpha:history")!)).toEqual({ v: 1, ...result.current.view });
  });

  it("removes a criterion set to null, blank or empty, and clears the whole table", () => {
    const { result } = renderHook(() => useTableView("ib2:tableView:alpha:history", COLUMNS));
    act(() => result.current.setCriterion("amount", ">0"));
    act(() => result.current.setCriterion("kind", ["trade"]));
    act(() => result.current.setCriterion("amount", "  "));
    act(() => result.current.clearColumn("kind"));
    expect(result.current.view.criteria).toEqual({});
    act(() => result.current.setCriterion("amount", ">0"));
    act(() => result.current.toggleSort("amount", true));
    act(() => result.current.clearAll());
    expect(result.current.view).toEqual({ sort: [], criteria: {} });
    expect(window.localStorage.getItem("ib2:tableView:alpha:history")).toBeNull();
  });

  it("reads the other account's view as soon as the key changes, never writing one into the other", () => {
    window.localStorage.setItem("ib2:tableView:beta:history", JSON.stringify({ v: 1, sort: [], criteria: { kind: ["dividend"] } }));
    const { result, rerender } = renderHook(({ key }) => useTableView(key, COLUMNS), { initialProps: { key: "ib2:tableView:alpha:history" } });
    act(() => result.current.setCriterion("amount", ">0"));
    rerender({ key: "ib2:tableView:beta:history" });
    expect(result.current.view.criteria).toEqual({ kind: ["dividend"] });
    expect(JSON.parse(window.localStorage.getItem("ib2:tableView:alpha:history")!).criteria).toEqual({ amount: ">0" });
  });
});

describe("usePageSearch", () => {
  it("applies and stores the input after the debounce, and reloads it per key", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ key }) => usePageSearch(key), { initialProps: { key: "ib2:pageSearch:alpha:positions" } });
    act(() => result.current.setInput("AAPL"));
    expect(result.current.input).toBe("AAPL");
    expect(result.current.applied).toBe("");
    act(() => vi.advanceTimersByTime(PAGE_SEARCH_DEBOUNCE_MS));
    expect(result.current.applied).toBe("AAPL");
    expect(JSON.parse(window.localStorage.getItem("ib2:pageSearch:alpha:positions")!)).toEqual({ v: 1, text: "AAPL" });
    rerender({ key: "ib2:pageSearch:beta:positions" });
    expect(result.current.input).toBe("");
    expect(result.current.applied).toBe("");
    act(() => vi.advanceTimersByTime(PAGE_SEARCH_DEBOUNCE_MS));
    expect(window.localStorage.getItem("ib2:pageSearch:beta:positions")).toBeNull();
    rerender({ key: "ib2:pageSearch:alpha:positions" });
    expect(result.current.applied).toBe("AAPL");
  });
});
