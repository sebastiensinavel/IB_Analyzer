import { describe, expect, it } from "vitest";
import { activeExpiry, filterBoxes, searchBoxes, type TableBoxInput } from "@/lib/tableBoxes";
import { EMPTY_VIEW, type ColumnSpec, type TableView } from "@/lib/tableView";

interface Line {
  ticker: string;
  position: string;
  quantity: number;
}

const SPECS: ColumnSpec<Line>[] = [
  { key: "position", type: "text", sortable: true, value: (line) => line.position },
  { key: "quantity", type: "number", sortable: true, value: (line) => line.quantity },
];

const line = (ticker: string, position: string, quantity = 1): Line => ({ ticker, position, quantity });

const BOXES: TableBoxInput<Line>[] = [
  { id: "long", title: "Positions longues", all: [line("AAPL", "AAPL", 200)] },
  { id: "optionSells", title: "Ventes d'options", all: [line("XOM", "XOM Mar20'26 100 Put"), line("AAPL", "AAPL Feb20'26 155 Call")] },
  { id: "other", title: "Autres positions", all: [] },
];

const search = (text: string) => ({ text, ticker: (line: Line) => line.ticker });

describe("searchBoxes", () => {
  it("drops a box with no line at all, before anything is rendered", () => {
    expect(searchBoxes(BOXES, SPECS, search("")).map((box) => box.id)).toEqual(["long", "optionSells"]);
  });

  it("drops a box the page search empties, and keeps the lines it matches", () => {
    const searched = searchBoxes(BOXES, SPECS, search("=XOM"));
    expect(searched.map((box) => box.id)).toEqual(["optionSells"]);
    expect(searched[0].searched.map((line) => line.position)).toEqual(["XOM Mar20'26 100 Put"]);
  });

  it("keeps every box when the search is blank", () => {
    const searched = searchBoxes(BOXES, SPECS, search("  "));
    expect(searched.map((box) => box.searched.length)).toEqual([1, 2]);
  });
});

describe("filterBoxes", () => {
  const searched = () => searchBoxes(BOXES, SPECS, search(""));

  it("keeps a box its own column filter empties, so the filter can be cleared", () => {
    const views: Record<string, TableView> = { long: { sort: [], criteria: { quantity: ">1000" } } };
    const boxes = filterBoxes(searched(), SPECS, views, false);
    expect(boxes.map((box) => box.id)).toEqual(["long", "optionSells"]);
    expect(boxes[0].rows).toEqual([]);
  });

  it("drops a box an expiry empties, which no filter of its own could fill", () => {
    const views: Record<string, TableView> = { long: { sort: [], criteria: { position: "Mar20'26" } }, optionSells: { sort: [], criteria: { position: "Mar20'26" } } };
    const boxes = filterBoxes(searched(), SPECS, views, true);
    expect(boxes.map((box) => box.id)).toEqual(["optionSells"]);
    expect(boxes[0].rows.map((line) => line.position)).toEqual(["XOM Mar20'26 100 Put"]);
  });

  it("counts the facets on the whole box, whatever the search and the filters", () => {
    const boxes = filterBoxes(searchBoxes(BOXES, SPECS, search("=XOM")), SPECS, {}, false);
    expect(boxes[0].facetRows).toHaveLength(2);
    expect(boxes[0].rows).toHaveLength(1);
  });

  it("sorts on the box's own view", () => {
    const views: Record<string, TableView> = { optionSells: { sort: [{ column: "position", dir: "asc" }], criteria: {} } };
    const boxes = filterBoxes(searched(), SPECS, views, false);
    expect(boxes[1].rows.map((line) => line.position)).toEqual(["AAPL Feb20'26 155 Call", "XOM Mar20'26 100 Put"]);
  });

  it("treats a box with no stored view as unfiltered and unsorted", () => {
    expect(filterBoxes(searched(), SPECS, {}, false)[1].rows).toHaveLength(2);
  });
});

describe("activeExpiry", () => {
  const choices = [
    { expiry: "2026-02-20", label: "Feb20'26" },
    { expiry: "2026-03-20", label: "Mar20'26" },
  ];

  it("reads the expiry every declared box filters on", () => {
    const criteria = { sort: [], criteria: { position: "Mar20'26" } };
    expect(activeExpiry(choices, ["long", "optionSells"], { long: criteria, optionSells: criteria })).toBe("Mar20'26");
  });

  it("reads none when one box filters on something else", () => {
    expect(
      activeExpiry(choices, ["long", "optionSells"], {
        long: { sort: [], criteria: { position: "Mar20'26" } },
        optionSells: EMPTY_VIEW,
      }),
    ).toBeNull();
  });
});
