import { describe, expect, it } from "vitest";
import { activeCriteria, applyView, EMPTY_VIEW, facetValues, isActiveCriterion, nextSort, type ColumnSpec, type TableView } from "@/lib/tableView";

interface Row {
  id: string;
  name: string;
  amount: number | null;
  kind: string | null;
  tags: string[];
  ticker: string | null;
}

const ROWS: Row[] = [
  { id: "a", name: "AAPL 2026-01-16 150 C", amount: 100, kind: "trade", tags: ["cash"], ticker: "AAPL" },
  { id: "b", name: "AAPL 2026-01-16 95 C", amount: null, kind: "dividend", tags: [], ticker: "AAPL" },
  { id: "c", name: "MSFT", amount: -50, kind: "trade", tags: ["stock", "UNCOVERED"], ticker: "MSFT" },
  { id: "d", name: "deposit", amount: 100, kind: null, tags: ["UNCOVERED"], ticker: null },
];

const SPECS: ColumnSpec<Row>[] = [
  { key: "name", type: "text", sortable: true, value: (row) => row.name },
  { key: "amount", type: "number", sortable: true, value: (row) => row.amount },
  { key: "kind", type: "enum", sortable: true, value: (row) => row.kind, label: (value) => ({ trade: "Zz trade", dividend: "Aa dividend" })[value] ?? value },
  { key: "tags", type: "enum", sortable: false, value: (row) => row.tags },
];

const ids = (rows: Row[]) => rows.map((row) => row.id);
const view = (partial: Partial<TableView>): TableView => ({ ...EMPTY_VIEW, ...partial });
const TICKER = { ticker: (row: Row) => row.ticker };

describe("applyView — filters", () => {
  it("keeps the input order without sort nor criteria", () => {
    expect(ids(applyView(ROWS, SPECS, EMPTY_VIEW))).toEqual(["a", "b", "c", "d"]);
  });

  it("ANDs the criteria of several columns", () => {
    expect(ids(applyView(ROWS, SPECS, view({ criteria: { amount: ">0", kind: ["trade"] } })))).toEqual(["a"]);
  });

  it("ignores an invalid criterion, an unknown column and a text criterion on an enum column", () => {
    expect(ids(applyView(ROWS, SPECS, view({ criteria: { amount: ">abc", ghost: "x", kind: "trade" } })))).toEqual(["a", "b", "c", "d"]);
  });

  it("filters an enum on the checked values, null standing for —", () => {
    expect(ids(applyView(ROWS, SPECS, view({ criteria: { kind: [null, "dividend"] } })))).toEqual(["b", "d"]);
    expect(ids(applyView(ROWS, SPECS, view({ criteria: { kind: [] } })))).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps a multi-valued row when at least one of its values is checked, an empty one only under —", () => {
    expect(ids(applyView(ROWS, SPECS, view({ criteria: { tags: ["UNCOVERED"] } })))).toEqual(["c", "d"]);
    expect(ids(applyView(ROWS, SPECS, view({ criteria: { tags: [null] } })))).toEqual(["b"]);
  });

  it("applies the page search on the ticker, with the text grammar", () => {
    expect(ids(applyView(ROWS, SPECS, EMPTY_VIEW, { text: "=AAPL|=MSFT", ...TICKER }))).toEqual(["a", "b", "c"]);
    expect(ids(applyView(ROWS, SPECS, EMPTY_VIEW, { text: "150", ...TICKER }))).toEqual([]);
    expect(ids(applyView(ROWS, SPECS, EMPTY_VIEW, { text: ">x", ...TICKER }))).toEqual(["a", "b", "c", "d"]);
  });
});

describe("applyView — sort", () => {
  it("sorts numbers with null last in both directions, stably", () => {
    expect(ids(applyView(ROWS, SPECS, view({ sort: [{ column: "amount", dir: "asc" }] })))).toEqual(["c", "a", "d", "b"]);
    expect(ids(applyView(ROWS, SPECS, view({ sort: [{ column: "amount", dir: "desc" }] })))).toEqual(["a", "d", "c", "b"]);
  });

  it("sorts text naturally: 95 before 150", () => {
    expect(ids(applyView(ROWS, SPECS, view({ sort: [{ column: "name", dir: "asc" }] })))).toEqual(["b", "a", "d", "c"]);
  });

  it("sorts an enum on its label, then on a secondary key", () => {
    expect(ids(applyView(ROWS, SPECS, view({ sort: [{ column: "kind", dir: "asc" }, { column: "amount", dir: "asc" }] })))).toEqual([
      "b", "c", "a", "d",
    ]);
  });

  it("ignores a non-sortable or unknown column", () => {
    expect(ids(applyView(ROWS, SPECS, view({ sort: [{ column: "tags", dir: "asc" }, { column: "ghost", dir: "desc" }] })))).toEqual([
      "a", "b", "c", "d",
    ]);
  });
});

describe("facetValues", () => {
  it("counts each value, sorted by label, null last", () => {
    expect(facetValues(ROWS, SPECS[2], [])).toEqual([
      { value: "dividend", label: "Aa dividend", count: 1 },
      { value: "trade", label: "Zz trade", count: 2 },
      { value: null, label: null, count: 1 },
    ]);
  });

  it("keeps a checked value that no row carries, at 0", () => {
    expect(facetValues(ROWS.slice(0, 1), SPECS[2], ["dividend"])).toEqual([
      { value: "dividend", label: "Aa dividend", count: 0 },
      { value: "trade", label: "Zz trade", count: 1 },
    ]);
  });

  it("counts every value of a multi-valued row once, and an empty row as —", () => {
    expect(facetValues(ROWS, SPECS[3], [])).toEqual([
      { value: "cash", label: "cash", count: 1 },
      { value: "stock", label: "stock", count: 1 },
      { value: "UNCOVERED", label: "UNCOVERED", count: 2 },
      { value: null, label: null, count: 1 },
    ]);
  });
});

describe("nextSort", () => {
  it("cycles a lone column asc → desc → none", () => {
    const asc = nextSort([], "amount", false);
    expect(asc).toEqual([{ column: "amount", dir: "asc" }]);
    const desc = nextSort(asc, "amount", false);
    expect(desc).toEqual([{ column: "amount", dir: "desc" }]);
    expect(nextSort(desc, "amount", false)).toEqual([]);
  });

  it("replaces the whole sort on a plain click on another column", () => {
    expect(nextSort([{ column: "amount", dir: "desc" }, { column: "name", dir: "asc" }], "name", false)).toEqual([{ column: "name", dir: "asc" }]);
  });

  it("adds, flips and removes one key with shift, leaving the others", () => {
    const two = nextSort([{ column: "amount", dir: "desc" }], "name", true);
    expect(two).toEqual([{ column: "amount", dir: "desc" }, { column: "name", dir: "asc" }]);
    const flipped = nextSort(two, "name", true);
    expect(flipped).toEqual([{ column: "amount", dir: "desc" }, { column: "name", dir: "desc" }]);
    expect(nextSort(flipped, "name", true)).toEqual([{ column: "amount", dir: "desc" }]);
  });
});

describe("activeCriteria", () => {
  it("lists only the criteria that filter, in spec order", () => {
    const active = activeCriteria(SPECS, view({ criteria: { kind: ["trade"], amount: ">0", name: "  ", tags: [], ghost: "x" } }));
    expect(active.map((entry) => entry.spec.key)).toEqual(["amount", "kind"]);
    expect(isActiveCriterion(SPECS[1], ">abc")).toBe(false);
    expect(isActiveCriterion(SPECS[1], undefined)).toBe(false);
  });
});
