import { CONDOR_KIND_LABELS, COVER_NONE, type CondorKind, type CondorLine } from "@ib/coverage";
import { asPercent, type UnderlyingOf } from "@/lib/positionColumns";
import type { ColumnSpec } from "@/lib/tableView";

type SectorOf = (symbol: string) => string | null;

/**
 * What the thirteen shared columns read on a condor line (spec of sub-project 34, §3, extended by
 * sub-project 35, §5): same keys and order as POSITION_COLUMNS. `underlyingDayChange` is sortable
 * on a condor — it has an underlying — unlike `dayChange`: the average price is the credit, the
 * last price the cost to close, the P/L the condor's total; a day move on the composite itself
 * means nothing, so `dayChange` is always null.
 */
export function condorColumnSpecs(sectorOf: SectorOf, underlyingOf: UnderlyingOf): ColumnSpec<CondorLine>[] {
  return [
    { key: "underlyingDayChange", type: "number", sortable: true, value: (line) => asPercent(underlyingOf(line.contract.ticker)) },
    { key: "position", type: "text", sortable: true, value: (line) => line.title },
    { key: "type", type: "enum", sortable: true, value: (line) => line.kind, label: (kind) => CONDOR_KIND_LABELS[kind as CondorKind] ?? kind },
    { key: "sector", type: "enum", sortable: true, value: (line) => sectorOf(line.contract.ticker) },
    { key: "marketValue", type: "number", sortable: true, value: (line) => line.marketValue },
    { key: "quantity", type: "number", sortable: true, value: (line) => line.quantity },
    { key: "avgPrice", type: "number", sortable: true, value: (line) => line.credit },
    { key: "lastPrice", type: "number", sortable: true, value: (line) => line.closingCost },
    { key: "dayChange", type: "number", sortable: false, value: () => null },
    { key: "dailyPnl", type: "number", sortable: true, value: (line) => line.dailyPnl },
    { key: "unrealizedPnl", type: "number", sortable: true, value: (line) => line.pnl },
    { key: "decision", type: "enum", sortable: true, value: (line) => line.decision },
    { key: "coverage", type: "enum", sortable: false, value: (line) => (line.naked > 0 ? [COVER_NONE] : []) },
  ];
}
