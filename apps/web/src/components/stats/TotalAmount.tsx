import { useTranslation } from "react-i18next";
import type { CurrencyTotal } from "@ib/ledger";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ib/ui/tooltip";
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";

interface TotalAmountProps {
  /** `null` or absent: « — ». */
  total: CurrencyTotal | null | undefined;
  /** Green or red by its sign; neutral otherwise. */
  signed: boolean;
  /** Said before the amount, small and muted: the headers' compact figures. */
  label?: string;
  /** Said in the tooltip after the partial count, and marked by the asterisk on its own. */
  note?: string;
  /** The dashboard cards' big figure. */
  large?: boolean;
}

/**
 * The one renderer of a total in one currency (spec of sub-project 36, §3), for the headers and the
 * dashboard alike: « — » when unknown, green or red when `signed`, and an asterisk whose tooltip
 * counts the lines left out when the sum is partial, or carries `note`.
 */
export function TotalAmount({ total, signed, label, note, large = false }: TotalAmountProps) {
  const { t } = useTranslation();
  const value = total?.total ?? null;
  const partial = total !== null && total !== undefined && total.missing > 0 && value !== null;
  const tone = value === null ? "text-muted-foreground" : signed ? (value >= 0 ? "text-success" : "text-destructive") : undefined;
  const tip = [partial ? t("totals.partial", { count: total.missing }) : null, note ?? null].filter(Boolean).join(" ");
  const figure = (
    <span className="whitespace-nowrap">
      {label !== undefined && (
        <>
          <span className="text-xs text-muted-foreground">{label}</span>{" "}
        </>
      )}
      <span className={cn("font-mono tabular-nums", large && "text-2xl font-semibold", tone)}>{value === null ? "—" : formatAmount(value)}</span>
      {(partial || note) && <span className="text-muted-foreground">*</span>}
    </span>
  );
  return tip ? (
    <Tooltip>
      <TooltipTrigger render={<span />}>{figure}</TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  ) : (
    figure
  );
}
