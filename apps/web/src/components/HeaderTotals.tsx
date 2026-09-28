import { useTranslation } from "react-i18next";
import { sumByCurrency, type CurrencyTotal } from "@ib/ledger";
import { TotalAmount } from "@/components/stats/TotalAmount";

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
          <TotalAmount label={t("totals.daily")} total={of(totals.daily, currency)} signed />
          <TotalAmount label={t("totals.value")} total={of(totals.value, currency)} signed={false} note={totals.valueNote} />
          <TotalAmount label={t("totals.pnl")} total={of(totals.pnl, currency)} signed />
          <span className="text-xs text-muted-foreground">{currency}</span>
        </div>
      ))}
    </div>
  );
}
