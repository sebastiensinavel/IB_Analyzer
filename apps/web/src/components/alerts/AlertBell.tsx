import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type { AlertThreshold } from "@ib/alerts";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ib/ui/tooltip";
import type { AlertView } from "@/alerts/useAlertEngine";
import { formatLocalePrice } from "@/lib/format";

/**
 * Les seuils qu'une alerte déclenchée a franchis : ceux que le cours connu dépasse, sinon tous —
 * le cours a pu revenir, et un condor en porte deux dont un seul a sonné.
 */
function crossedThresholds({ alert, price }: AlertView): AlertThreshold[] {
  const thresholds = alert.thresholds ?? [];
  if (price === null) return thresholds;
  const crossed = thresholds.filter((t) => (t.direction === "above" ? price.price >= t.price : price.price <= t.price));
  return crossed.length > 0 ? crossed : thresholds;
}

/**
 * La cloche d'une ligne de positions (suite du sous-projet 42) : la pilule du menu sans nombre,
 * à gauche de la variation du jour, lien vers la page des alertes. Seules les alertes déclenchées
 * l'allument (`rowAlertMarks`) ; rien sans alerte, et jamais d'animation.
 */
export function AlertBell({ alerts }: { alerts: readonly AlertView[] }) {
  const { t, i18n } = useTranslation();
  const { accountId = "" } = useParams<{ accountId: string }>();
  if (alerts.length === 0) return null;
  const lines = alerts.flatMap(crossedThresholds).map((threshold) =>
    t("alerts.bell", { arrow: threshold.direction === "above" ? "↑" : "↓", price: formatLocalePrice(threshold.price, i18n.language) }),
  );
  const label = lines.join(", ");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            to={`/accounts/${accountId}/alerts`}
            aria-label={label}
            onClick={(event) => event.stopPropagation()}
            className="inline-flex shrink-0 items-center rounded-full bg-warning p-0.5 text-warning-foreground"
          />
        }
      >
        <Bell aria-hidden className="size-3" />
      </TooltipTrigger>
      <TooltipContent>
        <span className="flex flex-col">
          {lines.map((line, index) => (
            <span key={index}>{line}</span>
          ))}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
