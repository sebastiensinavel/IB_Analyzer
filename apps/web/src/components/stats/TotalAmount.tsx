import { useTranslation } from "react-i18next";
import type { CurrencyTotal } from "@ib/ledger";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ib/ui/tooltip";
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A total of the dashboard in one currency: « — » when unknown, green or red when `signed`, and an
 * asterisk whose tooltip counts the lines left out when the sum is partial (spec of sub-project 36, §3).
 */
export function TotalAmount({ total, signed, large = false }: { total: CurrencyTotal | null; signed: boolean; large?: boolean }) {
  const { t } = useTranslation();
  const value = total?.total ?? null;
  const partial = total !== null && value !== null && total.missing > 0;
  const tone = value === null ? "text-muted-foreground" : signed ? (value >= 0 ? "text-success" : "text-destructive") : undefined;
  const figure = (
    <span className={cn("font-mono tabular-nums", large && "text-2xl font-semibold", tone)}>
      {value === null ? "—" : formatAmount(value)}
      {partial && <span className="text-muted-foreground">*</span>}
    </span>
  );
  return partial ? (
    <Tooltip>
      <TooltipTrigger render={<span />}>{figure}</TooltipTrigger>
      <TooltipContent>{t("totals.partial", { count: total.missing })}</TooltipContent>
    </Tooltip>
  ) : (
    figure
  );
}
