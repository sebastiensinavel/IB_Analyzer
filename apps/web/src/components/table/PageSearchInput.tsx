import { useTranslation } from "react-i18next";
import { Input } from "@ib/ui/input";
import type { PageSearchState } from "@/hooks/useTableView";

/**
 * The ticker search of a page, the same on Positions, on every strategy's positions and on every
 * journal: one field above the tables, whose text filters them all. It takes the criterion grammar
 * of a column filter — `AAPL|MSFT`, `!SPY`, `=XOM` — and is remembered per account and per page.
 */
export function PageSearchInput({ search }: { search: PageSearchState }) {
  const { t } = useTranslation();
  return (
    <Input
      value={search.input}
      onChange={(event) => search.setInput(event.target.value)}
      placeholder={t("search.placeholder")}
      aria-label={t("search.label")}
      className="font-mono"
    />
  );
}
