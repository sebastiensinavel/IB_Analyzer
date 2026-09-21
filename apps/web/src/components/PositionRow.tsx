import { Badge } from "@ib/ui/badge";
import { TableCell, TableRow } from "@ib/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ib/ui/tooltip";
import { formatDayChange, formatMoney, formatPrice } from "@/lib/format";
import { decisionBadge, type CoverageBadge } from "@/lib/riskReport";
import { cn } from "@/lib/utils";

export const NUMERIC = "text-right font-mono tabular-nums";

/** Green above zero, red below, nothing for an absent value: the tone every day or P&L cell takes. */
export const toneOf = (value: number | null) => value !== null && (value >= 0 ? "text-success" : "text-destructive");

/** What one line of a position table shows, whatever computed it: an IB position, or a strategy's part of one. */
export interface PositionRowValues {
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
  const decision = decisionBadge(values.decision);
  return (
    <TableRow
      onClick={onClick}
      data-state={expanded ? "selected" : undefined}
      className={cn(onClick && "cursor-pointer")}
    >
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
      <TableCell>{decision && <Badge variant={decision.variant}>{decision.label}</Badge>}</TableCell>
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
