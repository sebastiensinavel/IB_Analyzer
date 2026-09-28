import { useTranslation } from "react-i18next";
import type { Strategy } from "@ib/ledger";
import { Badge } from "@ib/ui/badge";
import { STRATEGY_BADGE } from "@/lib/strategyBadges";

// Two of these, one under the other with a 2 px gap, fill 34 of the row's 36 px (HISTORY_ROW_HEIGHT):
// the badge's own h-5 would not fit twice.
const COMPACT = "h-4 px-1.5 py-0 text-[9.5px]";

/** How many lines of badges a history row holds. */
const MAX_LINES = 2;

/**
 * The strategies a transaction served, stacked one under the other so that the column needs the
 * width of one badge only (spec of sub-project 37, §3). Two lines at most: a third strategy and
 * beyond are counted after the second badge, and the title names them all.
 */
export function StrategyStack({ strategies }: { strategies: readonly Strategy[] }) {
  const { t } = useTranslation();
  const names = strategies.map((strategy) => t(`history.strategies.${strategy}`));
  const hidden = strategies.length - MAX_LINES;
  return (
    <div className="flex flex-col items-start justify-center gap-0.5 overflow-hidden" title={names.join(", ")}>
      {strategies.slice(0, MAX_LINES).map((strategy, index) => (
        <div key={strategy} className="flex items-center gap-1">
          <Badge variant={STRATEGY_BADGE[strategy].variant} className={`${COMPACT} ${STRATEGY_BADGE[strategy].className ?? ""}`}>
            {names[index]}
          </Badge>
          {index === MAX_LINES - 1 && hidden > 0 && <span className="text-[9.5px] text-muted-foreground">+{hidden}</span>}
        </div>
      ))}
    </div>
  );
}
