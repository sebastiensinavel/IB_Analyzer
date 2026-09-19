import { KIND_LABELS, type PositionKind, type PositionsStrategy, type StrategyLine, type WheelShareLine } from "@ib/coverage";
import { formatContractLabel } from "@ib/ledger";
import { strategyCoverageValues } from "@/lib/riskReport";
import type { ColumnSpec } from "@/lib/tableView";

type SectorOf = (symbol: string) => string | null;

/**
 * What each shared column compares, filters and sorts on for a strategy's line. Same keys and
 * order as POSITION_COLUMNS — the twelve columns are declared once, in positionColumns.ts, and
 * this file only says what they read on a StrategyLine.
 */
export function strategyColumnSpecs(sectorOf: SectorOf, strategy: PositionsStrategy): ColumnSpec<StrategyLine>[] {
  return [
    { key: "position", type: "text", sortable: true, value: (line) => formatContractLabel(line.contract) },
    { key: "type", type: "enum", sortable: true, value: (line) => line.kind, label: (kind) => KIND_LABELS[kind as PositionKind] ?? kind },
    { key: "sector", type: "enum", sortable: true, value: (line) => sectorOf(line.contract.ticker) },
    { key: "marketValue", type: "number", sortable: true, value: (line) => line.marketValue },
    { key: "quantity", type: "number", sortable: true, value: (line) => line.quantity },
    { key: "avgPrice", type: "number", sortable: true, value: (line) => line.avgPrice },
    { key: "lastPrice", type: "number", sortable: true, value: (line) => line.lastPrice },
    // A fraction on the row, a percentage here: a filter typed "> 5" has to mean +5 %.
    { key: "dayChange", type: "number", sortable: true, value: (line) => (line.dayChange === null ? null : line.dayChange * 100) },
    { key: "dailyPnl", type: "number", sortable: true, value: (line) => line.dailyPnl },
    { key: "unrealizedPnl", type: "number", sortable: true, value: (line) => line.unrealizedPnl },
    { key: "decision", type: "enum", sortable: true, value: (line) => line.decision },
    { key: "coverage", type: "enum", sortable: false, value: (line) => strategyCoverageValues(line, strategy) },
  ];
}

/**
 * The same for the eleven columns of the Wheel's assigned shares (WHEEL_SHARE_COLUMNS), which do not
 * line up on the shared twelve: this table is deliberately its own.
 */
export function wheelShareColumnSpecs(sectorOf: SectorOf): ColumnSpec<WheelShareLine>[] {
  return [
    { key: "position", type: "text", sortable: true, value: (line) => line.ticker },
    { key: "sector", type: "enum", sortable: true, value: (line) => sectorOf(line.ticker) },
    { key: "quantity", type: "number", sortable: true, value: (line) => line.quantity },
    { key: "averageAssignmentPrice", type: "number", sortable: true, value: (line) => line.averageAssignmentPrice },
    { key: "averageCallStrike", type: "number", sortable: true, value: (line) => line.averageCallStrike },
    { key: "assignedTotal", type: "number", sortable: true, value: (line) => line.assignedTotal },
    { key: "lastPrice", type: "number", sortable: true, value: (line) => line.lastPrice },
    // A fraction on the row, a percentage here: a filter typed "> 5" has to mean +5 %.
    { key: "dayChange", type: "number", sortable: true, value: (line) => (line.dayChange === null ? null : line.dayChange * 100) },
    { key: "dailyPnl", type: "number", sortable: true, value: (line) => line.dailyPnl },
    { key: "unrealizedPnl", type: "number", sortable: true, value: (line) => line.unrealizedPnl },
    { key: "coverage", type: "enum", sortable: false, value: (line) => [line.coveredShares > 0 ? "used" : "unused"] },
  ];
}
