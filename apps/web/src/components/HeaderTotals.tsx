import { useTranslation } from "react-i18next";
import { sumByCurrency } from "@ib/coverage";
import type { CurrencyTotal } from "@ib/ledger";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ib/ui/tooltip";
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface HeaderTotalsValue {
  daily: CurrencyTotal[];
  value: CurrencyTotal[];
  pnl: CurrencyTotal[];
  /** Said in the value's tooltip: why it is not what the page would otherwise sum. */
  valueNote?: string;
}

/** The three sums of a set of lines (spec of sub-project 36, §4): the header of a page or a table. */
export function headerTotals<Row>(
  rows: readonly Row[],
  currencyOf: (row: Row) => string,
  pick: { daily: (row: Row) => number | null; value: (row: Row) => number | null; pnl: (row: Row) => number | null },
): HeaderTotalsValue {
  return {
    daily: sumByCurrency(rows, currencyOf, pick.daily),
    value: sumByCurrency(rows, currencyOf, pick.value),
    pnl: sumByCurrency(rows, currencyOf, pick.pnl),
  };
}

function Figure({ label, total, signed, note }: { label: string; total: CurrencyTotal | undefined; signed: boolean; note?: string }) {
  const { t } = useTranslation();
  const value = total?.total ?? null;
  const partial = total !== undefined && total.missing > 0 && value !== null;
  const tone = value === null ? "text-muted-foreground" : signed ? (value >= 0 ? "text-success" : "text-destructive") : undefined;
  const tip = [partial ? t("totals.partial", { count: total.missing }) : null, note ?? null].filter(Boolean).join(" ");
  const figure = (
    <span className="whitespace-nowrap">
      <span className="text-xs text-muted-foreground">{label}</span>{" "}
      <span className={cn("font-mono tabular-nums", tone)}>{value === null ? "—" : formatAmount(value)}</span>
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

/** One compact line per currency, beside a title; wraps on a narrow screen. */
export function HeaderTotals({ totals }: { totals: HeaderTotalsValue }) {
  const { t } = useTranslation();
  const currencies = [...new Set([...totals.daily, ...totals.value, ...totals.pnl].map((entry) => entry.currency))].sort();
  if (currencies.length === 0) return null;
  const of = (list: CurrencyTotal[], currency: string) => list.find((entry) => entry.currency === currency);
  return (
    <div className="flex flex-col items-end gap-0.5 text-sm">
      {currencies.map((currency) => (
        <div key={currency} data-testid={`header-totals-${currency}`} className="flex flex-wrap items-baseline justify-end gap-x-3 gap-y-0.5">
          <Figure label={t("totals.daily")} total={of(totals.daily, currency)} signed />
          <Figure label={t("totals.value")} total={of(totals.value, currency)} signed={false} note={totals.valueNote} />
          <Figure label={t("totals.pnl")} total={of(totals.pnl, currency)} signed />
          <span className="text-xs text-muted-foreground">{currency}</span>
        </div>
      ))}
    </div>
  );
}
