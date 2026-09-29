import { useTranslation } from "react-i18next";
import type { CapitalScope } from "@ib/ledger";
import { type CapitalSeries, SCOPE_SERIES } from "@/lib/capitalCharts";

/** The lines a scope's capital chart draws, named in the language on screen. */
export function useCapitalSeries(scope: CapitalScope): CapitalSeries[] {
  const { t } = useTranslation();
  return SCOPE_SERIES[scope].map((key) => ({ key, name: t(`stats.capital.${key}`) }));
}
