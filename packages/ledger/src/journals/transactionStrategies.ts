import { STRATEGIES, type JournalRow, type Strategy } from "./types.ts";

/**
 * The strategies each transaction served, by `externalId`, in the order of STRATEGIES; a
 * transaction no journal line names is absent (spec of sub-project 37, §2). A line's `openIds`
 * always count for its strategy, its `closeIds` too except on a takeover's `integrated` close:
 * those ids are the covered call's, a Wheel operation that must not bring the lot's original
 * strategy in. A condor's composite carries its legs' `closeIds` only once every leg is closed,
 * so its `legs` are read too: a wing bought back while the condor stays open carries Condors.
 */
export function transactionStrategies(rows: readonly JournalRow[]): Map<string, Strategy[]> {
  const sets = new Map<string, Set<Strategy>>();
  const add = (id: string, strategy: Strategy) => {
    const set = sets.get(id);
    if (set) set.add(strategy);
    else sets.set(id, new Set([strategy]));
  };
  const addRow = (row: JournalRow) => {
    for (const id of row.openIds) add(id, row.strategy);
    if (row.event !== "integrated") for (const id of row.closeIds) add(id, row.strategy);
  };
  for (const row of rows) {
    addRow(row);
    for (const leg of row.legs ?? []) addRow(leg);
  }
  return new Map([...sets].map(([id, set]) => [id, STRATEGIES.filter((strategy) => set.has(strategy))]));
}
