import { DEFAULT_CONDOR_ALERT_MARGIN, DEFAULT_WHEEL_ALERT_FRACTION, type AlertMargins } from "@ib/alerts";
import type { AccountRecord } from "@/db/schema";

/** Le seul lecteur de `AccountRecord.alertMargins` : une clé absente vaut le défaut du paquet. */
export function alertMargins(account: Pick<AccountRecord, "alertMargins"> | null | undefined): AlertMargins {
  return {
    wheel: account?.alertMargins?.wheel ?? DEFAULT_WHEEL_ALERT_FRACTION,
    condor: account?.alertMargins?.condor ?? DEFAULT_CONDOR_ALERT_MARGIN,
  };
}
