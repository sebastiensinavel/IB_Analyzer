import { Badge } from "@ib/ui/badge";
import { TableCell, TableRow } from "@ib/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ib/ui/tooltip";
import { formatMoney, formatPrice } from "@/lib/format";
import { decisionBadge, type CoverageBadge } from "@/lib/riskReport";
import { cn } from "@/lib/utils";

/** What one line of a position table shows, whatever computed it: an IB position, or a strategy's part of one. */
export interface PositionRowValues {
  contract: string;
  label: string;
  sector: string | null;
  marketValue: number | null;
  quantity: number;
  avgPrice: number | null;
  lastPrice: number | null;
  unrealizedPnl: number | null;
  decision: "buy back" | "keep" | null;
  /** The coverage badges of the line, computed by the page: the whole IB position's, or a strategy's part of it. */
  coverage: readonly CoverageBadge[];
}

export function PositionRow({ values }: { values: PositionRowValues }) {
  const decision = decisionBadge(values.decision);
  const pnl = values.unrealizedPnl;
  return (
    <TableRow>
      <TableCell className="font-medium">{values.contract}</TableCell>
      <TableCell className="text-muted-foreground">{values.label}</TableCell>
      <TableCell>{values.sector && <Badge variant="outline">{values.sector}</Badge>}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">{formatMoney(values.marketValue)}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">{values.quantity}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">{formatPrice(values.avgPrice)}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">{formatPrice(values.lastPrice)}</TableCell>
      <TableCell className={cn("text-right font-mono tabular-nums", pnl !== null && (pnl >= 0 ? "text-success" : "text-destructive"))}>
        {formatMoney(pnl)}
      </TableCell>
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
