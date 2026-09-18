import { useTranslation } from "react-i18next";
import { Button } from "@ib/ui/button";
import type { ExpiryChoice } from "@/lib/expiryFilter";

export interface ExpiryFilterBarProps {
  choices: readonly ExpiryChoice[];
  /** The label filtering every table, or `null` when no expiry is chosen. */
  active: string | null;
  /** The label to filter on, `null` to drop the filter. */
  onPick: (label: string | null) => void;
}

/**
 * The coming expiries as buttons, nearest first, under the Positions page's ticker search. Picking
 * one writes its label in the Position column of every table, exactly as typing it there would.
 * Nothing shows when no option of the page expires from today on.
 */
export function ExpiryFilterBar({ choices, active, onPick }: ExpiryFilterBarProps) {
  const { t } = useTranslation();
  if (choices.length === 0) return null;
  return (
    <div role="group" aria-label={t("positions.expiries.label")} className="flex flex-wrap items-center gap-1.5">
      {choices.map((choice) => {
        const chosen = choice.label === active;
        return (
          <Button
            key={choice.expiry}
            size="xs"
            variant={chosen ? "default" : "outline"}
            aria-pressed={chosen}
            className="font-mono"
            onClick={() => onPick(chosen ? null : choice.label)}
          >
            {choice.label}
          </Button>
        );
      })}
      {active !== null && (
        <Button size="xs" variant="ghost" onClick={() => onPick(null)}>
          {t("positions.expiries.clearAll")}
        </Button>
      )}
    </div>
  );
}
