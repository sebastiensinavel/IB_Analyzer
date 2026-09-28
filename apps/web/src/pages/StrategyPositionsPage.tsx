import { Fragment, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import {
  condorPositions,
  isCondorBoxId,
  isShareBoxId,
  LINE_BOX_IDS,
  SHARE_BOX_IDS,
  strategyBoxContents,
  strategyPositions,
  type CondorLine,
  type LineBoxId,
  type PositionsStrategy,
  type PricedSnapshot,
  type RiskReport,
  type ShareBoxId,
  type StrategyBoxContents,
  type StrategyLine,
  type WheelShareLine,
} from "@ib/coverage";
import { addTotals, contractId, formatContractLabel, type JournalRow } from "@ib/ledger";
import { Badge } from "@ib/ui/badge";
import { Card, CardContent } from "@ib/ui/card";
import { TableCell, TableRow } from "@ib/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ib/ui/tooltip";
import { CondorRows } from "@/components/CondorRows";
import { ExpiryFilterBar } from "@/components/ExpiryFilterBar";
import { headerTotals, HeaderTotals, type HeaderTotalsValue } from "@/components/HeaderTotals";
import { PositionChartRow } from "@/components/PositionChartRow";
import { NUMERIC, PositionRow, toneOf, UnderlyingDayChangeCell } from "@/components/PositionRow";
import { FilteredTableBox } from "@/components/table/FilteredTableBox";
import { PageSearchInput } from "@/components/table/PageSearchInput";
import { useAccountJournals, useAccountRiskReport, useAccountStrategies } from "@/db/AccountDataProvider";
import type { SnapshotRecord } from "@/db/schema";
import { useOpenChart, type OpenChart } from "@/hooks/useOpenChart";
import { useStrategyBoxViews } from "@/hooks/useStrategyBoxViews";
import { usePageSearch, type TableViewState } from "@/hooks/useTableView";
import { useUnderlyingDayChange } from "@/hooks/useUnderlyingDayChange";
import { condorColumnSpecs } from "@/lib/condorColumns";
import { expiryChoices, reportToday } from "@/lib/expiryFilter";
import { formatDayChange, formatMoney, formatPrice } from "@/lib/format";
import { POSITION_COLUMNS, POSITION_TABLE_MIN_WIDTH, WHEEL_SHARE_COLUMNS, WHEEL_SHARE_TABLE_MIN_WIDTH } from "@/lib/positionColumns";
import { strategyCoverageBadges, usedBadge } from "@/lib/riskReport";
import { STRATEGY_BOXES } from "@/lib/strategyBoxes";
import { strategyColumnSpecs, wheelShareColumnSpecs } from "@/lib/strategyColumns";
import { activeExpiry, filterBoxes, searchBoxes, type PreparedBox } from "@/lib/tableBoxes";
import { pageSearchKey } from "@/lib/tableViewStorage";
import { cn } from "@/lib/utils";

export type { PositionsStrategy };

type SectorOf = (symbol: string) => string | null;

const NO_ROWS: readonly JournalRow[] = [];

// The three sums of a box's shown lines (spec of sub-project 36, §4): a condor sums its own P/L
// column — realized of its closed legs plus latent of its open ones —, never its legs on top.
const lineTotals = (rows: readonly StrategyLine[]) =>
  headerTotals(rows, (l) => l.contract.currency, { daily: (l) => l.dailyPnl, value: (l) => l.marketValue, pnl: (l) => l.unrealizedPnl });
const shareTotals = (rows: readonly WheelShareLine[]) =>
  headerTotals(rows, (l) => l.currency, { daily: (l) => l.dailyPnl, value: (l) => l.marketValue, pnl: (l) => l.unrealizedPnl });
const condorTotals = (rows: readonly CondorLine[]) =>
  headerTotals(rows, (l) => l.contract.currency, { daily: (l) => l.dailyPnl, value: (l) => l.marketValue, pnl: (l) => l.pnl });

function pricedSnapshot(snapshot: SnapshotRecord | null | undefined, report: RiskReport | null | undefined): PricedSnapshot | null {
  return snapshot && report ? { positions: snapshot.positions, report, asOf: snapshot.asOf } : null;
}

function emptyBoxContents(): StrategyBoxContents {
  return {
    shares: Object.fromEntries(SHARE_BOX_IDS.map((id) => [id, [] as WheelShareLine[]])) as Record<ShareBoxId, WheelShareLine[]>,
    lines: Object.fromEntries(LINE_BOX_IDS.map((id) => [id, [] as StrategyLine[]])) as Record<LineBoxId, StrategyLine[]>,
  };
}

/**
 * A strategy's open positions (spec of sub-project 16, §5.2, extended by sub-project 21): its
 * journal's open lines priced from the snapshot, computed from what the shell already holds, never
 * stored, and equipped like the Positions page — one ticker search, the strategy's own expiries,
 * and a sort and filters per box. The Condors show one line per open condor of their journal, legs
 * unfolded under it (sub-project 34).
 */
export function StrategyPositionsPage({ strategy }: { strategy: PositionsStrategy }) {
  const { accountId = "" } = useParams<{ accountId: string }>();
  const { t } = useTranslation();
  const journals = useAccountJournals();
  const active = useAccountStrategies();
  const { snapshot, report, sectorOf } = useAccountRiskReport();
  const resolveUnderlying = useUnderlyingDayChange();
  const underlyingOf = useCallback((ticker: string) => resolveUnderlying(ticker).value, [resolveUnderlying]);
  const lineSpecs = useMemo(() => strategyColumnSpecs(sectorOf, strategy, underlyingOf), [sectorOf, strategy, underlyingOf]);
  const shareSpecs = useMemo(() => wheelShareColumnSpecs(sectorOf, underlyingOf), [sectorOf, underlyingOf]);
  const condorSpecs = useMemo(() => condorColumnSpecs(sectorOf, underlyingOf), [sectorOf, underlyingOf]);
  const search = usePageSearch(pageSearchKey(accountId, `positions:${strategy}`));
  const views = useStrategyBoxViews(accountId, strategy, lineSpecs, shareSpecs, condorSpecs);
  const chart = useOpenChart();
  // A stable array, never a literal recreated on each render: PositionChartRow memoizes its
  // levels directly on `strategies`, never wants a new reference for the same scope.
  const scope = useMemo(() => [strategy], [strategy]);
  const defs = STRATEGY_BOXES[strategy];
  const ready = journals.status === "ready" && snapshot !== undefined && report !== undefined && active !== undefined;
  const rows = journals.status === "ready" ? journals.report.rows : NO_ROWS;
  // Condors show one line per condor (condorPositions below), never StrategyLines: skip
  // strategyPositions/strategyBoxContents there and keep an empty StrategyBoxContents, `boxes`
  // itself staying the readiness signal (spec of sub-project 34, §2).
  const boxes = useMemo(
    () =>
      ready && active !== undefined
        ? strategy === "condors"
          ? emptyBoxContents()
          : strategyBoxContents(strategyPositions(rows, strategy, pricedSnapshot(snapshot, report), active), strategy)
        : null,
    [ready, rows, strategy, snapshot, report, active],
  );
  // Every strategy's rows, never the Condors' alone: the naked part of a contract is computed on
  // all the shorts the journals hold on it (spec of sub-project 34, §5).
  const condors = useMemo(
    () => (ready && active !== undefined && strategy === "condors" ? condorPositions(rows, pricedSnapshot(snapshot, report), active) : []),
    [ready, rows, strategy, snapshot, report, active],
  );
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const setExpiry = useCallback(
    (label: string | null) => defs.forEach((def) => views[def.id].setCriterion("position", label)),
    [defs, views],
  );

  if (!ready || boxes === null) return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;

  const viewOf = Object.fromEntries(defs.map((def) => [def.id, views[def.id].view]));
  const searchedLines = searchBoxes(
    defs.filter((def) => !isShareBoxId(def.id) && !isCondorBoxId(def.id)).map((def) => ({ id: def.id, title: t(def.titleKey), all: boxes.lines[def.id as LineBoxId] })),
    lineSpecs,
    { text: search.applied, ticker: (line: StrategyLine) => line.contract.ticker },
  );
  const searchedShares = searchBoxes(
    defs.filter((def) => isShareBoxId(def.id)).map((def) => ({ id: def.id, title: t(def.titleKey), all: boxes.shares[def.id as ShareBoxId] })),
    shareSpecs,
    { text: search.applied, ticker: (line: WheelShareLine) => line.ticker },
  );
  const searchedCondors = searchBoxes(
    defs.filter((def) => isCondorBoxId(def.id)).map((def) => ({ id: def.id, title: t(def.titleKey), all: condors })),
    condorSpecs,
    { text: search.applied, ticker: (line: CondorLine) => line.contract.ticker },
  );

  // The expiries of this strategy's own options, never the portfolio's: built after the search,
  // before the filters, and on every searched box — including the ones the expiry empties, so the
  // button that emptied them stays in the bar to be undone.
  const choices = expiryChoices(
    [
      ...searchedLines.flatMap((box) => box.searched.map((line) => ({ expiry: line.contract.expiry }))),
      ...searchedCondors.flatMap((box) => box.searched.map((line) => ({ expiry: line.contract.expiry }))),
    ],
    reportToday(),
  );
  const expiry = activeExpiry(choices, defs.map((def) => def.id), viewOf);
  const lines = new Map(filterBoxes(searchedLines, lineSpecs, viewOf, expiry !== null).map((box) => [box.id, box]));
  const shares = new Map(filterBoxes(searchedShares, shareSpecs, viewOf, expiry !== null).map((box) => [box.id, box]));
  const condorBoxes = new Map(filterBoxes(searchedCondors, condorSpecs, viewOf, expiry !== null).map((box) => [box.id, box]));

  // Page header: the shown lines of every rendered box (spec §5). A line is in one box only — the
  // free and covered parts of a ticker's Wheel shares are distinct lines —, so nothing counts twice.
  const parts = [
    ...[...lines.values()].map((box) => lineTotals(box.rows)),
    ...[...shares.values()].map((box) => shareTotals(box.rows)),
    ...[...condorBoxes.values()].map((box) => condorTotals(box.rows)),
  ];
  const pageTotals: HeaderTotalsValue = {
    daily: addTotals(...parts.map((part) => part.daily)),
    value: addTotals(...parts.map((part) => part.value)),
    pnl: addTotals(...parts.map((part) => part.pnl)),
  };

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="font-heading text-lg font-semibold tracking-tight">{t(`strategyPositions.title.${strategy}`)}</h1>
        <div data-testid="page-totals">
          <HeaderTotals totals={pageTotals} />
        </div>
      </div>

      <PageSearchInput search={search} />
      <ExpiryFilterBar choices={choices} active={expiry} onPick={setExpiry} />

      {lines.size === 0 && shares.size === 0 && condorBoxes.size === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("positions.noResults")}</p>
          </CardContent>
        </Card>
      )}

      {defs.map((def) => {
        const condorBox = condorBoxes.get(def.id);
        if (condorBox) {
          return (
            <CondorsBox
              key={def.id}
              box={condorBox}
              specs={condorSpecs}
              table={views[def.id]}
              scope={scope}
              sectorOf={sectorOf}
              chart={chart}
              unfolded={unfolded}
              onFold={(id) =>
                setUnfolded((current) => {
                  const next = new Set(current);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
            />
          );
        }
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
      minWidth={POSITION_TABLE_MIN_WIDTH}
      specs={specs}
      facetRows={box.facetRows}
      rows={box.rows}
      totals={lineTotals(box.rows)}
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
                ticker: line.contract.ticker,
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
                buyback: line.buyback,
                currency: line.contract.currency,
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

function CondorsBox({
  box,
  specs,
  table,
  scope,
  sectorOf,
  chart,
  unfolded,
  onFold,
}: {
  box: PreparedBox<CondorLine>;
  specs: ReturnType<typeof condorColumnSpecs>;
  table: TableViewState;
  scope: readonly PositionsStrategy[];
  sectorOf: SectorOf;
  chart: OpenChart;
  unfolded: ReadonlySet<string>;
  onFold: (id: string) => void;
}) {
  return (
    <FilteredTableBox
      title={box.title}
      columns={POSITION_COLUMNS}
      labelKey="positions.columns"
      minWidth={POSITION_TABLE_MIN_WIDTH}
      specs={specs}
      facetRows={box.facetRows}
      rows={box.rows}
      totals={condorTotals(box.rows)}
      table={table}
      emptyKey="positions.noResults"
      rowKey={(line) => line.id}
      renderRow={(line) => {
        const key = `condors|${line.id}`;
        return (
          <Fragment>
            <CondorRows
              line={line}
              sector={sectorOf(line.contract.ticker)}
              unfolded={unfolded.has(line.id)}
              onFold={() => onFold(line.id)}
              onChart={() => chart.toggle(key)}
              charted={chart.isOpen(key)}
            />
            {chart.isOpen(key) && (
              <PositionChartRow ticker={line.contract.ticker} strategies={scope} columnCount={POSITION_COLUMNS.length} currency={line.contract.currency} />
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
      minWidth={WHEEL_SHARE_TABLE_MIN_WIDTH}
      specs={specs}
      facetRows={box.facetRows}
      rows={box.rows}
      totals={shareTotals(box.rows)}
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
      <UnderlyingDayChangeCell ticker={line.ticker} />
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
