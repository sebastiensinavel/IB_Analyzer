import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * La pilule des alertes déclenchées (spec du sous-projet 42, §7.1) : cloche et nombre, jaune. Rien à
 * zéro, et jamais d'animation — le clignotement est réservé à la position non couverte.
 */
export function AlertBadge({ count }: { count: number }) {
  const { t } = useTranslation();
  if (count <= 0) return null;
  return (
    <span
      aria-label={t("alerts.badge", { count })}
      className="inline-flex items-center gap-1 rounded-full bg-warning px-1.5 text-[11px] font-medium text-warning-foreground tabular-nums"
    >
      <Bell aria-hidden className="size-3" />
      {count}
    </span>
  );
}
