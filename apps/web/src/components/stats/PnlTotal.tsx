import { useTranslation } from "react-i18next";
import type { StrategyStats } from "@ib/ledger";
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A scope's total profit or loss, green or red, and the amounts it had to leave out. */
export function PnlTotal({ stats }: { stats: StrategyStats }) {
  const { t } = useTranslation();
  return (
    <>
      <p className={cn("font-mono text-2xl font-semibold tabular-nums", stats.total >= 0 ? "text-success" : "text-destructive")}>
        {formatAmount(stats.total)} {stats.currency}
      </p>
      {stats.incomplete > 0 && <p className="text-xs text-muted-foreground">{t("stats.incomplete", { count: stats.incomplete })}</p>}
    </>
  );
}
