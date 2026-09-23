import { useTranslation } from "react-i18next";
import { ACTIVABLE_STRATEGIES } from "@ib/ledger";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { Checkbox } from "@ib/ui/checkbox";
import { toggleActiveStrategy } from "@/db/accounts";
import { db, type AccountRecord } from "@/db/schema";
import { activeStrategies } from "@/lib/strategies";

/**
 * One box per strategy, saved the moment it changes (spec of sub-project 30, §6.1).
 *
 * `checked` reads straight from `account`, kept fresh by `useAccount`'s live query — including
 * a write made from another tab or a future source. `toggleActiveStrategy` does its own
 * read-modify-write inside one IndexedDB transaction, so two rapid, un-awaited clicks compose
 * correctly instead of racing on a value held in this component.
 */
export function StrategiesCard({ account }: { account: AccountRecord }) {
  const { t } = useTranslation();
  const active = activeStrategies(account);
  return (
    <Card data-testid="strategies-card">
      <CardHeader>
        <CardTitle>{t("sources.strategies.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-6">
          {ACTIVABLE_STRATEGIES.map((strategy) => (
            <label key={strategy} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={active.includes(strategy)}
                onCheckedChange={(on) => void toggleActiveStrategy(db, account.id, strategy, on === true)}
              />
              {t(`sources.strategies.names.${strategy}`)}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t("sources.strategies.hint")}</p>
      </CardContent>
    </Card>
  );
}
