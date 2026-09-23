import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ACTIVABLE_STRATEGIES, type ActivableStrategy } from "@ib/ledger";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { Checkbox } from "@ib/ui/checkbox";
import { setActiveStrategies } from "@/db/accounts";
import { db, type AccountRecord } from "@/db/schema";
import { activeStrategies } from "@/lib/strategies";

/**
 * One box per strategy, saved the moment it changes (spec of sub-project 30, §6.1).
 *
 * The checked state is held locally, seeded from the account and reset only when the
 * account itself changes: `account` comes from `useAccount`'s live query, which only
 * round-trips through IndexedDB after this component's own write resolves. Deriving
 * `checked` straight from the prop would race two clicks made in quick succession — the
 * second would still read the pre-write list and undo the first.
 */
export function StrategiesCard({ account }: { account: AccountRecord }) {
  const { t } = useTranslation();
  const [active, setActive] = useState<ActivableStrategy[]>(() => activeStrategies(account));

  useEffect(() => {
    setActive(activeStrategies(account));
    // Only `account.id` in the dependency list: `account` itself changes reference on every
    // write this component makes (it comes from `useAccount`'s live query), and re-seeding
    // from it then would just replay the value already held locally.
  }, [account.id]);

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
                onCheckedChange={(on) =>
                  setActive((current) => {
                    const next = on === true ? [...current, strategy] : current.filter((s) => s !== strategy);
                    void setActiveStrategies(db, account.id, next);
                    return next;
                  })
                }
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
