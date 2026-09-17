import { parseCriterion, type CellValue, type ColumnType, type Predicate } from "@/lib/tableCriteria";

export type SortDirection = "asc" | "desc";

export interface SortKey {
  column: string;
  dir: SortDirection;
}

/** Text typed for text/number/date columns, raw checked values for enum columns. */
export type Criterion = string | readonly (string | null)[];

/** What one table shows: its sort keys, first one first, and its column criteria. */
export interface TableView {
  sort: readonly SortKey[];
  criteria: Readonly<Record<string, Criterion>>;
}

export const EMPTY_VIEW: TableView = { sort: [], criteria: {} };

export interface ColumnMeta {
  key: string;
  type: ColumnType;
  sortable: boolean;
}

export interface ColumnSpec<Row> extends ColumnMeta {
  /** `null` for "—"; an array for a multi-valued enum column. */
  value: (row: Row) => CellValue | readonly string[];
  /** Display label of an enum value (translated by the caller). */
  label?: (value: string) => string;
}

export interface PageSearch<Row> {
  text: string;
  ticker: (row: Row) => string | null;
}

export interface Facet {
  value: string | null;
  /** `null` for the "—" entry: the component translates it. */
  label: string | null;
  count: number;
}

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** The predicate of a criterion over a row's value, or `null` when it filters nothing. */
function criterionTest(meta: ColumnMeta, criterion: Criterion | undefined): ((value: CellValue | readonly string[]) => boolean) | null {
  if (criterion === undefined) return null;
  if (meta.type === "enum") {
    if (typeof criterion === "string" || criterion.length === 0) return null;
    const checked = new Set(criterion);
    return (value) =>
      Array.isArray(value) ? (value.length === 0 ? checked.has(null) : value.some((item) => checked.has(item))) : checked.has(value as string | null);
  }
  if (typeof criterion !== "string") return null;
  const parsed = parseCriterion(criterion, meta.type);
  if (!parsed.ok || parsed.test === null) return null;
  const test: Predicate = parsed.test;
  return (value) => !Array.isArray(value) && test(value as CellValue);
}

export function isActiveCriterion(meta: ColumnMeta, criterion: Criterion | undefined): boolean {
  return criterionTest(meta, criterion) !== null;
}

export function activeCriteria<Row>(specs: readonly ColumnSpec<Row>[], view: TableView): { spec: ColumnSpec<Row>; criterion: Criterion }[] {
  return specs.flatMap((spec) => {
    const criterion = view.criteria[spec.key];
    return criterion !== undefined && isActiveCriterion(spec, criterion) ? [{ spec, criterion }] : [];
  });
}

function sortableValue<Row>(spec: ColumnSpec<Row>, row: Row): string | number | null {
  const value = spec.value(row);
  if (Array.isArray(value) || value === null) return null;
  if (spec.type === "enum" && typeof value === "string") return spec.label?.(value) ?? value;
  return value as string | number;
}

function compareValues(a: string | number | null, b: string | number | null, dir: SortDirection): number {
  // Absent values sink to the bottom whatever the direction.
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  const order = typeof a === "number" && typeof b === "number" ? a - b : COLLATOR.compare(String(a), String(b));
  return dir === "asc" ? order : -order;
}

export function applyView<Row>(rows: readonly Row[], specs: readonly ColumnSpec<Row>[], view: TableView, search?: PageSearch<Row>): Row[] {
  const tests = specs.flatMap((spec) => {
    const test = criterionTest(spec, view.criteria[spec.key]);
    return test ? [(row: Row) => test(spec.value(row))] : [];
  });
  if (search) {
    const parsed = parseCriterion(search.text, "text");
    if (parsed.ok && parsed.test) {
      const test = parsed.test;
      tests.unshift((row) => test(search.ticker(row)));
    }
  }
  const filtered = tests.length === 0 ? [...rows] : rows.filter((row) => tests.every((test) => test(row)));
  const keys = view.sort.flatMap((key) => {
    const spec = specs.find((candidate) => candidate.key === key.column);
    return spec && spec.sortable ? [{ spec, dir: key.dir }] : [];
  });
  if (keys.length === 0) return filtered;
  // Array.prototype.sort is stable: rows equal on every key keep their input order.
  return filtered.sort((left, right) => {
    for (const { spec, dir } of keys) {
      const order = compareValues(sortableValue(spec, left), sortableValue(spec, right), dir);
      if (order !== 0) return order;
    }
    return 0;
  });
}

export function facetValues<Row>(rows: readonly Row[], spec: ColumnSpec<Row>, checked: readonly (string | null)[]): Facet[] {
  const counts = new Map<string | null, number>();
  const bump = (value: string | null) => counts.set(value, (counts.get(value) ?? 0) + 1);
  for (const row of rows) {
    const value = spec.value(row);
    if (Array.isArray(value)) {
      if (value.length === 0) bump(null);
      else new Set(value).forEach((item) => bump(item));
    } else {
      bump(value === null ? null : String(value));
    }
  }
  for (const value of checked) if (!counts.has(value)) counts.set(value, 0);
  const labelOf = (value: string) => spec.label?.(value) ?? value;
  const named = [...counts.entries()]
    .filter((entry): entry is [string, number] => entry[0] !== null)
    .map(([value, count]) => ({ value, label: labelOf(value), count }))
    .sort((a, b) => COLLATOR.compare(a.label, b.label));
  const empty = counts.get(null);
  return empty === undefined ? named : [...named, { value: null, label: null, count: empty }];
}

export function nextSort(sort: readonly SortKey[], column: string, additive: boolean): SortKey[] {
  const index = sort.findIndex((key) => key.column === column);
  if (!additive) {
    if (sort.length === 1 && index === 0) return sort[0].dir === "asc" ? [{ column, dir: "desc" }] : [];
    return [{ column, dir: "asc" }];
  }
  if (index < 0) return [...sort, { column, dir: "asc" }];
  if (sort[index].dir === "asc") return sort.map((key, i) => (i === index ? { column, dir: "desc" } : key));
  return sort.filter((_, i) => i !== index);
}
