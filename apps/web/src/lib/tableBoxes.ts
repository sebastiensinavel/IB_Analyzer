import type { ExpiryChoice } from "@/lib/expiryFilter";
import { applyView, EMPTY_VIEW, type ColumnSpec, type PageSearch, type TableView } from "@/lib/tableView";

/**
 * Which boxes a positions page shows, and what each one holds (spec of sub-project 21, §3.3). Two
 * steps, because the expiry bar is built between them: it must offer the expiries of every box the
 * search left, including the ones the chosen expiry empties — otherwise the button that emptied
 * them would vanish from the bar and there would be no way back.
 */

export interface TableBoxInput<Row> {
  /** Suffix of the stored view's key, and the key React renders the box under. */
  id: string;
  title?: string;
  /** Every line of the box, before search and filters. */
  all: readonly Row[];
}

export interface SearchedBox<Row> extends TableBoxInput<Row> {
  searched: Row[];
}

export interface PreparedBox<Row> extends SearchedBox<Row> {
  /** `all`: the facets count the whole box, so a value filtered out keeps the entry that brings it back. */
  facetRows: readonly Row[];
  rows: Row[];
}

/**
 * The boxes the page search leaves. A box with no line at all never renders — the strategy holds
 * nothing of that kind — and neither does one the search empties: the search means the same thing
 * in every box and is cleared from the top of the page, so losing the box coins nobody.
 */
export function searchBoxes<Row>(
  boxes: readonly TableBoxInput<Row>[],
  specs: readonly ColumnSpec<Row>[],
  search: PageSearch<Row>,
): SearchedBox<Row>[] {
  const kept: SearchedBox<Row>[] = [];
  for (const box of boxes) {
    if (box.all.length === 0) continue;
    const searched = applyView(box.all, specs, EMPTY_VIEW, search);
    if (searched.length === 0) continue;
    kept.push({ ...box, searched });
  }
  return kept;
}

/**
 * The boxes left once each one's own view has run. A box emptied by its own column filters stays,
 * with its headers and its pills: they are the only way to clear them. A box emptied while an
 * expiry is chosen goes away instead — the shares have no expiry, and a grid nothing can fill
 * teaches nothing.
 */
export function filterBoxes<Row>(
  boxes: readonly SearchedBox<Row>[],
  specs: readonly ColumnSpec<Row>[],
  views: Readonly<Record<string, TableView>>,
  expiryActive: boolean,
): PreparedBox<Row>[] {
  const kept: PreparedBox<Row>[] = [];
  for (const box of boxes) {
    const rows = applyView(box.searched, specs, views[box.id] ?? EMPTY_VIEW);
    if (rows.length === 0 && expiryActive) continue;
    kept.push({ ...box, facetRows: box.all, rows });
  }
  return kept;
}

/**
 * The expiry the page is filtering on: the one whose label is the Position criterion of every
 * declared box, `null` otherwise. An expiry is a page-wide choice, so a box left out of it — a
 * hand-typed criterion in one box only — is not that choice.
 */
export function activeExpiry(
  choices: readonly ExpiryChoice[],
  ids: readonly string[],
  views: Readonly<Record<string, TableView>>,
): string | null {
  return choices.find((choice) => ids.every((id) => views[id]?.criteria.position === choice.label))?.label ?? null;
}
