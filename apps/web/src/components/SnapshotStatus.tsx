import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@ib/ui/badge";
import { Button } from "@ib/ui/button";
import { useAgentSync } from "@/agent/useAgentSync";
import { useAccount, useSnapshot } from "@/db/hooks";
import { formatClockTime } from "@/lib/format";

/**
 * The title bar's snapshot piece, in view on every page of an account, just left of the
 * consistency verdicts: what the data is as of, why the last agent pass failed if it did, and
 * the Refresh button — shown only when the agent is detected and a port is set, so that
 * paliers 1 and 2 never see a dead button.
 */
export function SnapshotStatus({ accountId }: { accountId: string }) {
  const { t } = useTranslation();
  const snapshot = useSnapshot(accountId);
  const account = useAccount(accountId);
  const { presence, state, run } = useAgentSync(accountId);
  const status = account?.lastAgentSyncStatus;
  const canRefresh = presence.status === "present" && account?.twsPort !== undefined;

  return (
    <div className="flex items-center gap-2">
      {snapshot &&
        (snapshot.source === "agent" ? (
          // `asOf` is New York's wall clock like every IB time; the badge reads the true
          // instant of the last pass, shown on the viewer's own clock.
          <Badge variant="success">
            {t("snapshot.live", { time: account?.lastAgentSyncAt ? formatClockTime(account.lastAgentSyncAt) : "—" })}
          </Badge>
        ) : (
          // Flex positions are always as of the previous close: the date is always shown.
          <Badge variant="warning">{t("positions.asOf", { date: snapshot.asOf })}</Badge>
        ))}
      {status && !status.ok && status.code && <Badge variant="secondary">{t(`agent.errors.${status.code}`)}</Badge>}
      {canRefresh && (
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={t("snapshot.refresh")}
          disabled={state === "running"}
          onClick={() => void run()}
        >
          <RefreshCw className={state === "running" ? "animate-spin" : undefined} />
        </Button>
      )}
    </div>
  );
}
