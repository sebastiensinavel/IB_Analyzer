import { Fragment, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import {
  isShareBoxId,
  strategyBoxContents,
  strategyPositions,
  type LineBoxId,
  type PositionsStrategy,
  type PricedSnapshot,
  type RiskReport,
  type ShareBoxId,
  type StrategyLine,
  type WheelShareLine,
} from "@ib/coverage";
import { contractId, formatContractLabel, type JournalRow } from "@ib/ledger";
import { Badge } from "@ib/ui/badge";
import { Card, CardContent } from "@ib/ui/card";
import { TableCell, TableRow } from "@ib/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ib/ui/tooltip";
import { ExpiryFilterBar } from "@/components/ExpiryFilterBar";
import { PositionChartRow } from "@/components/PositionChartRow";
import { NUMERIC, PositionRow, toneOf } from "@/components/PositionRow";
import { FilteredTableBox } from "@/components/table/FilteredTableBox";
import { PageSearchInput } from "@/components/table/PageSearchInput";
import { useAccountJournals, useAccountRiskReport, useAccountStrategies } from "@/db/AccountDataProvider";
import type { SnapshotRecord } from "@/db/schema";
import { useOpenChart, type OpenChart } from "@/hooks/useOpenChart";
import { useStrategyBoxViews } from "@/hooks/useStrategyBoxViews";
import { usePageSearch, type TableViewState } from "@/hooks/useTableView";
import { expiryChoices, reportToday } from "@/lib/expiryFilter";
import { formatDayChange, formatMoney, formatPrice } from "@/lib/format";
import { POSITION_COLUMNS, WHEEL_SHARE_COLUMNS } from "@/lib/positionColumns";
import { strategyCoverageBadges, usedBadge } from "@/lib/riskReport";
import { STRATEGY_BOXES } from "@/lib/strategyBoxes";
import { strategyColumnSpecs, wheelShareColumnSpecs } from "@/lib/strategyColumns";
import { activeExpiry, filterBoxes, searchBoxes, type PreparedBox } from "@/lib/tableBoxes";
import { pageSearchKey } from "@/lib/tableViewStorage";
import { cn } from "@/lib/utils";

export type { PositionsStrategy };

type SectorOf = (symbol: string) => string | null;

const NO_ROWS: readonly JournalRow[] = [];

function pricedSnapshot(snapshot: SnapshotRecord | null | undefined, report: RiskReport | null | undefined): PricedSnapshot | null {
  return snapshot && report ? { positions: snapshot.positions, report } : null;
}

/**
 * A strategy's open positions (spec of sub-project 16, §5.2, extended by sub-project 21): its
 * journal's open lines priced from the snapshot, computed from what the shell already holds, never
 * stored, and equipped like the Positions page — one ticker search, the strategy's own expiries,
 * and a sort and filters per box.
 */
export function StrategyPositionsPage({ strategy }: { strategy: PositionsStrategy }) {
  const { accountId = "" } = useParams<{ accountId: string }>();
  const { t } = useTranslation();
  const journals = useAccountJournals();
  const active = useAccountStrategies();
  const { snapshot, report, sectorOf } = useAccountRiskReport();
  const lineSpecs = useMemo(() => strategyColumnSpecs(sectorOf, strategy), [sectorOf, strategy]);
  const shareSpecs = useMemo(() => wheelShareColumnSpecs(sectorOf), [sectorOf]);
  const search = usePageSearch(pageSearchKey(accountId, `positions:${strategy}`));
  const views = useStrategyBoxViews(accountId, strategy, lineSpecs, shareSpecs);
  const chart = useOpenChart();
  // A stable array, never a literal recreated on each render: PositionChartRow memoizes its
  // levels directly on `strategies`, never wants a new reference for the same scope.
  const scope = useMemo(() => [strategy], [strategy]);
  const defs = STRATEGY_BOXES[strategy];
  const ready = journals.status === "ready" && snapshot !== undefined && report !== undefined && active !== undefined;
  const rows = journals.status === "ready" ? journals.report.rows : NO_ROWS;
  const boxes = useMemo(
    () =>
      ready && active !== undefined
        ? strategyBoxContents(strategyPositions(rows, strategy, pricedSnapshot(snapshot, report), active), strategy)
        : null,
    [ready, rows, strategy, snapshot, report, active],
  );
  const setExpiry = useCallback(
    (label: string | null) => defs.forEach((def) => views[def.id].setCriterion("position", label)),
    [defs, views],
  );

  if (!ready || boxes === null) return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;

  const viewOf = Object.fromEntries(defs.map((def) => [def.id, views[def.id].view]));
  const searchedLines = searchBoxes(
    defs.filter((def) => !isShareBoxId(def.id)).map((def) => ({ id: def.id, title: t(def.titleKey), all: boxes.lines[def.id as LineBoxId] })),
    lineSpecs,
    { text: search.applied, ticker: (line: StrategyLine) => line.contract.ticker },
  );
  const searchedShares = searchBoxes(
    defs.filter((def) => isShareBoxId(def.id)).map((def) => ({ id: def.id, title: t(def.titleKey), all: boxes.shares[def.id as ShareBoxId] })),
    shareSpecs,
    { text: search.applied, ticker: (line: WheelShareLine) => line.ticker },
  );

  // The expiries of this strategy's own options, never the portfolio's: built after the search,
  // before the filters, and on every searched box — including the ones the expiry empties, so the
  // button that emptied them stays in the bar to be undone.
  const choices = expiryChoices(
    searchedLines.flatMap((box) => box.searched.map((line) => ({ expiry: line.contract.expiry }))),
    reportToday(),
  );
  const expiry = activeExpiry(choices, defs.map((def) => def.id), viewOf);
  const lines = new Map(filterBoxes(searchedLines, lineSpecs, viewOf, expiry !== null).map((box) => [box.id, box]));
  const shares = new Map(filterBoxes(searchedShares, shareSpecs, viewOf, expiry !== null).map((box) => [box.id, box]));

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="font-heading text-lg font-semibold tracking-tight">{t(`strategyPositions.title.${strategy}`)}</h1>

      <PageSearchInput search={search} />
      <ExpiryFilterBar choices={choices} active={expiry} onPick={setExpiry} />

      {lines.size === 0 && shares.size === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("positions.noResults")}</p>
          </CardContent>
        </Card>
      )}

      {defs.map((def) => {
        const holdings = shares.get(def.id);
        if (holdings) {
          return <SharesBox key={def.id} box={holdings} specs={shareSpecs} table={views[def.id]} sectorOf={sectorOf} chart={chart} boxId={def.id} />;
        }
        const box = lines.get(def.id);
        return box ? (
          <LinesBox
            key={def.id}
            box={box}
            specs={lineSpecs}
            table={views[def.id]}
            strategy={strategy}
            scope={scope}
            sectorOf={sectorOf}
            chart={chart}
            boxId={def.id}
          />
        ) : null;
      })}
    </div>
  );
}

function LinesBox({
  box,
  specs,
  table,
  strategy,
  scope,
  sectorOf,
  chart,
  boxId,
}: {
  box: PreparedBox<StrategyLine>;
  specs: ReturnType<typeof strategyColumnSpecs>;
  table: TableViewState;
  strategy: PositionsStrategy;
  scope: readonly PositionsStrategy[];
  sectorOf: SectorOf;
  chart: OpenChart;
  boxId: string;
}) {
  return (
    <FilteredTableBox
      title={box.title}
      columns={POSITION_COLUMNS}
      labelKey="positions.columns"
      minWidth="70rem"
      specs={specs}
      facetRows={box.facetRows}
      rows={box.rows}
      table={table}
      emptyKey="positions.noResults"
      rowKey={(line) => contractId(line.contract)}
      renderRow={(line) => {
        const key = `${boxId}|${contractId(line.contract)}`;
        return (
          <Fragment>
            <PositionRow
              onClick={() => chart.toggle(key)}
              expanded={chart.isOpen(key)}
              values={{
                contract: formatContractLabel(line.contract),
                label: line.label,
                sector: sectorOf(line.contract.ticker),
                marketValue: line.marketValue,
                quantity: line.quantity,
                avgPrice: line.avgPrice,
                lastPrice: line.lastPrice,
                dayChange: line.dayChange,
                dailyPnl: line.dailyPnl,
                unrealizedPnl: line.unrealizedPnl,
                decision: line.decision,
                coverage: strategyCoverageBadges(line, strategy),
              }}
            />
            {chart.isOpen(key) && (
              <PositionChartRow
                ticker={line.contract.ticker}
                strategies={scope}
                columnCount={POSITION_COLUMNS.length}
                currency={line.contract.currency}
              />
            )}
          </Fragment>
        );
      }}
    />
  );
}

/** The Wheel's assigned shares only ever carry the Wheel's own levels: a stable array, never a
 * literal recreated on each render (PositionChartRow memoizes its levels directly on `strategies`). */
const WHEEL_SCOPE: readonly PositionsStrategy[] = ["wheel"];

function SharesBox({
  box,
  specs,
  table,
  sectorOf,
  chart,
  boxId,
}: {
  box: PreparedBox<WheelShareLine>;
  specs: ReturnType<typeof wheelShareColumnSpecs>;
  table: TableViewState;
  sectorOf: SectorOf;
  chart: OpenChart;
  boxId: string;
}) {
  return (
    <FilteredTableBox
      title={box.title}
      columns={WHEEL_SHARE_COLUMNS}
      labelKey="strategyPositions.columns"
      minWidth="63rem"
      specs={specs}
      facetRows={box.facetRows}
      rows={box.rows}
      table={table}
      emptyKey="positions.noResults"
      rowKey={(line) => `${line.ticker}|${line.currency}`}
      renderRow={(line) => {
        const key = `${boxId}|${line.ticker}|${line.currency}`;
        return (
          <Fragment>
            <WheelShareRow line={line} sector={sectorOf(line.ticker)} onClick={() => chart.toggle(key)} expanded={chart.isOpen(key)} />
            {chart.isOpen(key) && (
              <PositionChartRow
                ticker={line.ticker}
                strategies={WHEEL_SCOPE}
                columnCount={WHEEL_SHARE_COLUMNS.length}
                currency={line.currency}
              />
            )}
          </Fragment>
        );
      }}
    />
  );
}

function WheelShareRow({
  line,
  sector,
  onClick,
  expanded = false,
}: {
  line: WheelShareLine;
  sector: string | null;
  /** The line whose chart is open: kept highlighted while its row hangs below it. */
  onClick?: () => void;
  expanded?: boolean;
}) {
  const { t } = useTranslation();
  const pnl = line.unrealizedPnl;
  const callPrice = formatPrice(line.averageCallStrike);
  // The same badge as the Positions page gives a long stock position, on the Wheel's own shares.
  const covered = usedBadge(line.coveredShares, line.quantity);
  return (
    <TableRow onClick={onClick} data-state={expanded ? "selected" : undefined} className={cn(onClick && "cursor-pointer")}>
      <TableCell className="font-medium">{line.ticker}</TableCell>
      <TableCell>{sector && <Badge variant="outline">{sector}</Badge>}</TableCell>
      <TableCell className={NUMERIC}>{line.quantity}</TableCell>
      <TableCell className={NUMERIC}>{formatPrice(line.averageAssignmentPrice)}</TableCell>
      {line.callStrikeBelowAssignment ? (
        <TableCell className={cn(NUMERIC, "bg-warning/25")}>
          <Tooltip>
            <TooltipTrigger render={<span>{callPrice}</span>} />
            <TooltipContent>{t("strategyPositions.callBelowAssignment")}</TooltipContent>
          </Tooltip>
        </TableCell>
      ) : (
        <TableCell className={NUMERIC}>{callPrice}</TableCell>
      )}
      <TableCell className={NUMERIC}>{formatMoney(line.assignedTotal)}</TableCell>
      <TableCell className={NUMERIC}>{formatPrice(line.lastPrice)}</TableCell>
      <TableCell className={cn(NUMERIC, toneOf(line.dayChange))}>{formatDayChange(line.dayChange)}</TableCell>
      <TableCell className={cn(NUMERIC, toneOf(line.dailyPnl))}>{formatMoney(line.dailyPnl)}</TableCell>
      <TableCell className={cn(NUMERIC, toneOf(pnl))}>{formatMoney(pnl)}</TableCell>
      <TableCell>
        <Badge variant={covered.variant}>{covered.label}</Badge>
      </TableCell>
    </TableRow>
  );
}
