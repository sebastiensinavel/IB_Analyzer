import { useTranslation } from "react-i18next";
import type { BuybackAdvice } from "@ib/coverage";
import { Badge } from "@ib/ui/badge";
import { TableCell, TableRow } from "@ib/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ib/ui/tooltip";
import type { ContractKey } from "@ib/ledger";
import { AlertBell } from "@/components/alerts/AlertBell";
import { DecisionBadge } from "@/components/DecisionBadge";
import { useAccountAlerts } from "@/db/AccountDataProvider";
import { useUnderlyingDayChange } from "@/hooks/useUnderlyingDayChange";
import { formatDayChange, formatMoney, formatPrice } from "@/lib/format";
import { type CoverageBadge } from "@/lib/riskReport";
import { rowAlertMarks, type RowAlertTarget } from "@/lib/rowAlerts";
import { cn } from "@/lib/utils";

export const NUMERIC = "text-right font-mono tabular-nums";

/** Green above zero, red below, nothing for an absent value: the tone every day or P&L cell takes. */
export const toneOf = (value: number | null) => value !== null && (value >= 0 ? "text-success" : "text-destructive");

/**
 * The underlying's day move (spec of sub-project 35, §5, held-first addendum): the account on
 * screen's own live `dayChange` when it holds the ticker as stock, no tooltip; the delayed
 * `/quotes` value otherwise, with a tooltip saying so.
 * Every row of one ticker shows the same value. On its left, the bell of the triggered alerts the
 * line answers to (`rowAlertMarks`): its ticker's manual ones always, a Wheel or condor alert only
 * on the line `alert` names — its contract, or its condor.
 */
export function UnderlyingDayChangeCell({ ticker, alert }: { ticker: string; alert?: Omit<RowAlertTarget, "ticker"> }) {
  const { t } = useTranslation();
  const { value, delayed } = useUnderlyingDayChange()(ticker);
  const alerts = useAccountAlerts();
  const marks = alerts.status === "ready" ? rowAlertMarks(alerts.alerts, { ticker, ...alert }) : [];
  const text = formatDayChange(value);
  const tooltip = delayed ? t("quotes.delayed") : null;
  const change = tooltip ? (
    <Tooltip>
      <TooltipTrigger render={<span>{text}</span>} />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  ) : (
    text
  );
  return (
    <TableCell className={cn(NUMERIC, toneOf(value))}>
      {marks.length > 0 ? (
        <span className="inline-flex items-center justify-end gap-0.5">
          <AlertBell alerts={marks} />
          {change}
        </span>
      ) : (
        change
      )}
    </TableCell>
  );
}

/** What one line of a position table shows, whatever computed it: an IB position, or a strategy's part of one. */
export interface PositionRowValues {
  /** The underlying's ticker, which the first column is quoted on. */
  ticker: string;
  /** The line's contract, which a Wheel or condor alert's bell is matched on; absent, only the ticker's manual alerts ring. */
  contractKey?: ContractKey | null;
  contract: string;
  label: string;
  sector: string | null;
  marketValue: number | null;
  quantity: number;
  avgPrice: number | null;
  lastPrice: number | null;
  /** Today's move of the mark price, `null` for a contract traded today (no comparable open). */
  dayChange: number | null;
  /** TWS's day P&L, relayed by the agent; `null` without it. */
  dailyPnl: number | null;
  unrealizedPnl: number | null;
  decision: "buy back" | "keep" | null;
  /** The advice behind `decision`, for its tooltip. */
  buyback: BuybackAdvice | null;
  /** The position's currency, which the tooltip's price is in. */
  currency: string;
  /** The coverage badges of the line, computed by the page: the whole IB position's, or a strategy's part of it. */
  coverage: readonly CoverageBadge[];
}

export interface PositionRowProps {
  values: PositionRowValues;
  /** Prototype (graphes) : set on a table whose lines open a chart. */
  onClick?: () => void;
  /** The line whose chart is open: kept highlighted while its row hangs below it. */
  expanded?: boolean;
}

export function PositionRow({ values, onClick, expanded = false }: PositionRowProps) {
  return (
    <TableRow
      onClick={onClick}
      data-state={expanded ? "selected" : undefined}
      className={cn(onClick && "cursor-pointer")}
    >
      <UnderlyingDayChangeCell ticker={values.ticker} alert={{ contract: values.contractKey }} />
      <TableCell className="font-medium">{values.contract}</TableCell>
      <TableCell className="text-muted-foreground">{values.label}</TableCell>
      <TableCell>{values.sector && <Badge variant="outline">{values.sector}</Badge>}</TableCell>
      <TableCell className={NUMERIC}>{formatMoney(values.marketValue)}</TableCell>
      <TableCell className={NUMERIC}>{values.quantity}</TableCell>
      <TableCell className={NUMERIC}>{formatPrice(values.avgPrice)}</TableCell>
      <TableCell className={NUMERIC}>{formatPrice(values.lastPrice)}</TableCell>
      <TableCell className={cn(NUMERIC, toneOf(values.dayChange))}>{formatDayChange(values.dayChange)}</TableCell>
      <TableCell className={cn(NUMERIC, toneOf(values.dailyPnl))}>{formatMoney(values.dailyPnl)}</TableCell>
      <TableCell className={cn(NUMERIC, toneOf(values.unrealizedPnl))}>{formatMoney(values.unrealizedPnl)}</TableCell>
      <TableCell>
        <DecisionBadge decision={values.decision} advice={values.buyback} currency={values.currency} />
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {values.coverage.map((badge, index) =>
            badge.tooltip ? (
              <Tooltip key={index}>
                <TooltipTrigger render={<Badge variant={badge.variant}>{badge.label}</Badge>} />
                <TooltipContent>{badge.tooltip}</TooltipContent>
              </Tooltip>
            ) : (
              <Badge key={index} variant={badge.variant}>
                {badge.label}
              </Badge>
            ),
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
