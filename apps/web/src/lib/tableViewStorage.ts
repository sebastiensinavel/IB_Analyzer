import { EMPTY_VIEW, isActiveCriterion, type ColumnMeta, type Criterion, type SortKey, type TableView } from "@/lib/tableView";

/**
 * Sort and filters of a table, remembered per browser in localStorage: a display preference, never
 * portfolio data, so never in IndexedDB nor on the server. One key per account and table, so two
 * accounts never share a filter. Every access is best-effort: storage can be missing or throw.
 */

const VIEW_PREFIX = "ib2:tableView:";
const SEARCH_PREFIX = "ib2:pageSearch:";
const VERSION = 1;

export function tableViewKey(accountId: string, table: string): string {
  return `${VIEW_PREFIX}${accountId}:${table}`;
}

export function pageSearchKey(accountId: string, page: string): string {
  return `${SEARCH_PREFIX}${accountId}:${page}`;
}

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeOrRemove(key: string, value: object | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify({ v: VERSION, ...value }));
  } catch {
    // Best-effort only (e.g. storage disabled in private browsing).
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readTableView(key: string, columns: readonly ColumnMeta[]): TableView {
  const stored = readJson(key);
  if (!isRecord(stored) || stored.v !== VERSION) return EMPTY_VIEW;
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const sort: SortKey[] = Array.isArray(stored.sort)
    ? stored.sort.flatMap((entry): SortKey[] => {
        if (!isRecord(entry) || typeof entry.column !== "string") return [];
        if (entry.dir !== "asc" && entry.dir !== "desc") return [];
        return byKey.get(entry.column)?.sortable ? [{ column: entry.column, dir: entry.dir }] : [];
      })
    : [];
  const criteria: Record<string, Criterion> = {};
  if (isRecord(stored.criteria)) {
    for (const [column, raw] of Object.entries(stored.criteria)) {
      const meta = byKey.get(column);
      if (!meta) continue;
      let criterion: Criterion | null = null;
      if (meta.type === "enum" && Array.isArray(raw)) {
        criterion = raw.filter((value): value is string | null => value === null || typeof value === "string");
      } else if (meta.type !== "enum" && typeof raw === "string") {
        criterion = raw;
      }
      if (criterion !== null && isActiveCriterion(meta, criterion)) criteria[column] = criterion;
    }
  }
  return sort.length === 0 && Object.keys(criteria).length === 0 ? EMPTY_VIEW : { sort, criteria };
}

export function writeTableView(key: string, view: TableView): void {
  const criteria = Object.fromEntries(
    Object.entries(view.criteria).filter(([, criterion]) => (typeof criterion === "string" ? criterion.trim() !== "" : criterion.length > 0)),
  );
  const empty = view.sort.length === 0 && Object.keys(criteria).length === 0;
  writeOrRemove(key, empty ? null : { sort: view.sort, criteria });
}

export function readPageSearch(key: string): string {
  const stored = readJson(key);
  return isRecord(stored) && stored.v === VERSION && typeof stored.text === "string" ? stored.text : "";
}

export function writePageSearch(key: string, text: string): void {
  writeOrRemove(key, text.trim() === "" ? null : { text });
}

/** Forgets every table view and page search of one account; the trailing ":" spares an id it prefixes. */
export function clearTableViews(accountId: string): void {
  try {
    const prefixes = [`${VIEW_PREFIX}${accountId}:`, `${SEARCH_PREFIX}${accountId}:`];
    const doomed: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key !== null && prefixes.some((prefix) => key.startsWith(prefix))) doomed.push(key);
    }
    doomed.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Same as above.
  }
}
