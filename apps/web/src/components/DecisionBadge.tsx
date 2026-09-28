import { useTranslation } from "react-i18next";
import type { BuybackAdvice } from "@ib/coverage";
import { Badge } from "@ib/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ib/ui/tooltip";
import { formatPrice } from "@/lib/format";
import { decisionBadge } from "@/lib/riskReport";

/** The Décision column: the badge, and the price under which a buyback pays (spec of sub-project 38, §5). */
export function DecisionBadge({
  decision,
  advice,
  currency,
}: {
  decision: "buy back" | "keep" | null;
  advice: BuybackAdvice | null;
  currency: string;
}) {
  const { t } = useTranslation();
  const badge = decisionBadge(decision);
  if (!badge) return null;
  const node = <Badge variant={badge.variant}>{badge.label}</Badge>;
  if (!advice) return node;
  const price = `${formatPrice(advice.threshold)} ${currency}`;
  const text =
    advice.remainingDays !== null && advice.totalDays !== null
      ? t("positions.buyback.timed", { price, remaining: Math.round(advice.remainingDays), total: Math.round(advice.totalDays) })
      : t("positions.buyback.half", { price });
  return (
    <Tooltip>
      <TooltipTrigger render={node} />
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}
