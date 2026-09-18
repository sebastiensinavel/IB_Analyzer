import { useCallback, useEffect, useState } from "react";
import { applySort, type ColumnMeta, type Criterion, type SortDirection, type TableView } from "@/lib/tableView";
import { readPageSearch, readTableView, writePageSearch, writeTableView } from "@/lib/tableViewStorage";

export const PAGE_SEARCH_DEBOUNCE_MS = 300;

export interface TableViewState {
  view: TableView;
  /** `null`, a blank text or an empty list removes the column's criterion. */
  setCriterion: (column: string, criterion: Criterion | null) => void;
  /** `null` resets: the whole sort when plain, only this column when additive. */
  setSort: (column: string, dir: SortDirection | null, additive: boolean) => void;
  clearColumn: (column: string) => void;
  /** Criteria and sort of this table; never the page search. */
  clearAll: () => void;
}

const isEmptyCriterion = (criterion: Criterion | null) =>
  criterion === null || (typeof criterion === "string" ? criterion.trim() === "" : criterion.length === 0);

/**
 * The sort and criteria of one table, remembered under `storageKey`. A new key (another account) is
 * read during the render that brings it, never after: an effect would first paint, and write, the
 * previous account's view under the new key.
 */
export function useTableView(storageKey: string, columns: readonly ColumnMeta[]): TableViewState {
  const [state, setState] = useState(() => ({ key: storageKey, view: readTableView(storageKey, columns) }));
  let current = state;
  if (state.key !== storageKey) {
    current = { key: storageKey, view: readTableView(storageKey, columns) };
    setState(current);
  }
  const { view } = current;

  const update = useCallback(
    (change: (view: TableView) => TableView) => {
      setState((previous) => {
        if (previous.key !== storageKey) return previous;
        const next = change(previous.view);
        writeTableView(storageKey, next);
        return { key: storageKey, view: next };
      });
    },
    [storageKey],
  );

  const setCriterion = useCallback(
    (column: string, criterion: Criterion | null) =>
      update((previous) => {
        const criteria = { ...previous.criteria };
        if (isEmptyCriterion(criterion)) delete criteria[column];
        else criteria[column] = criterion as Criterion;
        return { ...previous, criteria };
      }),
    [update],
  );
  const setSort = useCallback(
    (column: string, dir: SortDirection | null, additive: boolean) => update((previous) => ({ ...previous, sort: applySort(previous.sort, column, dir, additive) })),
    [update],
  );
  const clearColumn = useCallback((column: string) => setCriterion(column, null), [setCriterion]);
  const clearAll = useCallback(() => update(() => ({ sort: [], criteria: {} })), [update]);

  return { view, setCriterion, setSort, clearColumn, clearAll };
}

export interface PageSearchState {
  input: string;
  setInput: (text: string) => void;
  /** The debounced text, the one that filters and is stored. */
  applied: string;
}

export function usePageSearch(storageKey: string): PageSearchState {
  const [state, setState] = useState(() => {
    const text = readPageSearch(storageKey);
    return { key: storageKey, input: text, applied: text };
  });
  let current = state;
  if (state.key !== storageKey) {
    const text = readPageSearch(storageKey);
    current = { key: storageKey, input: text, applied: text };
    setState(current);
  }

  useEffect(() => {
    if (current.input === current.applied) return;
    const id = setTimeout(() => {
      writePageSearch(storageKey, current.input);
      setState((previous) => (previous.key === storageKey ? { ...previous, applied: previous.input } : previous));
    }, PAGE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [storageKey, current.input, current.applied]);

  const setInput = useCallback(
    (text: string) => setState((previous) => (previous.key === storageKey ? { ...previous, input: text } : previous)),
    [storageKey],
  );

  return { input: current.input, setInput, applied: current.applied };
}
