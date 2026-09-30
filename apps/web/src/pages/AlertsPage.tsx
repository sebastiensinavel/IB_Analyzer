import { Fragment, useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { acknowledge, reactivate, type AlertStatus } from "@ib/alerts";
import { Badge } from "@ib/ui/badge";
import { Button } from "@ib/ui/button";
import { Card, CardContent } from "@ib/ui/card";
import { Input } from "@ib/ui/input";
import { TableBody, TableCell, TableRow } from "@ib/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ib/ui/tooltip";
import { useAgentPresence } from "@/agent/useAgentSync";
import { notificationPermission, requestNotificationPermission } from "@/alerts/notify";
import type { AlertView } from "@/alerts/useAlertEngine";
import { DataTable, DataTableHeader, type ColumnDef } from "@/components/table/DataTable";
import { useAccountAlerts } from "@/db/AccountDataProvider";
import { setAlertMargins } from "@/db/accounts";
import { deleteManualAlert, patchAlertStates, reactivateManualAlert, setAlertOverride } from "@/db/alerts";
import { useDb } from "@/db/DbProvider";
import { useAccount } from "@/db/hooks";
import { alertMargins } from "@/lib/alertMargins";
import { formatPrice, formatRate } from "@/lib/format";
import { STRATEGY_BADGE } from "@/lib/strategyBadges";
import { cn } from "@/lib/utils";

const COLUMNS: readonly ColumnDef[] = [
  { key: "type", numeric: false },
  { key: "ticker", numeric: false },
  { key: "thresholds", numeric: true },
  { key: "price", numeric: true },
  { key: "distance", numeric: true },
  { key: "detail", numeric: false },
  { key: "actions", numeric: false },
];

/** The strategy whose badge an automatic alert wears. */
const typeStrategy = { wheel: "wheel", condor: "condors" } as const;

const GROUPS: readonly AlertStatus[] = ["triggered", "active", "disabled"];

/** Un ratio en champ de pourcentage : 0,7 → « 70 », sans traîne de flottants. */
const toPercentText = (ratio: number | null): string => (ratio === null ? "" : String(Math.round(ratio * 10000) / 100));

interface PercentFieldProps {
  /** Le ratio courant, `null` quand le champ est vide. */
  value: number | null;
  label: string;
  className: string;
  placeholder?: string;
  /** Un vide rétablit le réglage du compte ; sans cela un vide est refusé. */
  clearable: boolean;
  onCommit: (value: number | null) => void;
}

/**
 * Un champ en pourcentage qui s'écrit au blur ou à Entrée. Une valeur hors ]0, 100[ est refusée et
 * le champ rétabli sur la valeur enregistrée.
 */
function PercentField({ value, label, className, placeholder, clearable, onCommit }: PercentFieldProps) {
  const [text, setText] = useState(toPercentText(value));
  // The stored value moved (a write came back): the field shows it, adjusted during render.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(toPercentText(value));
  }

  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === "") {
      if (clearable) onCommit(null);
      else setText(toPercentText(value));
      return;
    }
    const percent = Number(trimmed);
    if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) {
      setText(toPercentText(value));
      return;
    }
    const ratio = percent / 100;
    if (ratio !== value) onCommit(ratio);
    else setText(toPercentText(value));
  };

  return (
    <Input
      type="number"
      aria-label={label}
      placeholder={placeholder}
      value={text}
      className={cn("h-7 px-1.5 text-right font-mono text-xs tabular-nums md:text-xs", className)}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

function Direction({ direction }: { direction: "above" | "below" }) {
  const Icon = direction === "above" ? ArrowUp : ArrowDown;
  return <Icon aria-hidden className="size-3" />;
}

export function AlertsPage() {
  const { t } = useTranslation();
  const db = useDb();
  const { accountId = "" } = useParams<{ accountId: string }>();
  const view = useAccountAlerts();
  const account = useAccount(accountId);
  const presence = useAgentPresence().status;
  const [permission, setPermission] = useState(notificationPermission);

  const margins = alertMargins(account);
  const agentPresent = presence === "present";
  const alerts = view.status === "ready" ? view.alerts : [];

  const enableNotifications = async () => {
    await requestNotificationPermission();
    setPermission(notificationPermission());
  };

  const acknowledgeAlert = (row: AlertView) =>
    patchAlertStates(db, accountId, [acknowledge(row.alert, new Date().toISOString())]);

  // Seule une manuelle se désactive : la réactiver réarme aussi sa direction (`reactivateManualAlert`).
  const reactivateAlert = (row: AlertView) =>
    row.alert.kind === "manual"
      ? reactivateManualAlert(db, accountId, row.alert.id, row.price?.price ?? null)
      : patchAlertStates(db, accountId, [reactivate(row.alert.id)]);

  const linkTo = (row: AlertView) => {
    const { alert } = row;
    const suffix = alert.kind === "wheel" ? "/wheel" : alert.kind === "condor" ? "/condors" : "";
    return `/accounts/${accountId}/positions${suffix}`;
  };

  const renderRow = (row: AlertView) => {
    const { alert, state, status } = row;
    // Without the agent nothing is evaluated: a price kept in memory from before is not shown.
    const price = agentPresent ? row.price : null;
    const distance = agentPresent ? row.distance : null;
    return (
      <TableRow
        key={alert.id}
        data-status={status}
        className={cn(status === "triggered" && "border-l-2 border-l-warning", status === "disabled" && "opacity-60")}
      >
        <TableCell>
          {alert.kind === "manual" ? (
            <Badge variant="outline">{t("alerts.types.manual")}</Badge>
          ) : (
            <Badge variant={STRATEGY_BADGE[typeStrategy[alert.kind]].variant} className={STRATEGY_BADGE[typeStrategy[alert.kind]].className}>
              {t(`alerts.types.${alert.kind}`)}
            </Badge>
          )}
        </TableCell>
        <TableCell className="font-medium">
          <Link to={linkTo(row)} className="underline-offset-2 hover:underline">
            {alert.ticker}
          </Link>
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">
          {alert.thresholds === null ? (
            "—"
          ) : (
            <span className="inline-flex flex-col items-end">
              {alert.thresholds.map((threshold) => (
                <span
                  key={`${threshold.direction}:${threshold.price}`}
                  className="inline-flex items-center gap-1"
                  aria-label={t(`alerts.${threshold.direction}`, { price: formatPrice(threshold.price) })}
                >
                  <Direction direction={threshold.direction} />
                  {formatPrice(threshold.price)}
                </span>
              ))}
            </span>
          )}
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">
          {price === null ? (
            "—"
          ) : (
            <Tooltip>
              <TooltipTrigger render={<span className="cursor-default" />}>{formatPrice(price.price)}</TooltipTrigger>
              <TooltipContent>{t(price.realtime ? "alerts.price.realtime" : "alerts.price.delayed")}</TooltipContent>
            </Tooltip>
          )}
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">
          {distance === null || price === null
            ? "—"
            : alert.kind === "condor"
              ? `${formatRate(distance)} · ${t("alerts.points", { value: formatPrice(Math.round(distance * price.price * 100) / 100) })}`
              : formatRate(distance)}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {alert.kind === "manual"
            ? (alert.note ?? "—")
            : alert.kind === "wheel"
              ? state.anchor
                ? t("alerts.detail.anchor", { price: formatPrice(state.anchor.price), source: t(`alerts.source.${state.anchor.source}`) })
                : t("alerts.detail.anchorPending")
              : t("alerts.detail.condor", { put: alert.strikes[1], call: alert.strikes[2], offset: formatPrice(alert.offset) })}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            {status === "triggered" && (
              <Button size="xs" variant="outline" onClick={() => void acknowledgeAlert(row)}>
                {t("alerts.actions.acknowledge")}
              </Button>
            )}
            {status === "disabled" && (
              <Button size="xs" variant="outline" onClick={() => void reactivateAlert(row)}>
                {t("alerts.actions.reactivate")}
              </Button>
            )}
            {alert.kind === "manual" ? (
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={t("alerts.actions.delete", { ticker: alert.ticker })}
                onClick={() => void deleteManualAlert(db, accountId, alert.id)}
              >
                <Trash2 aria-hidden />
              </Button>
            ) : (
              <PercentField
                value={state.override}
                clearable
                className="w-14"
                placeholder={toPercentText(alert.kind === "wheel" ? margins.wheel : margins.condor)}
                label={t(alert.kind === "wheel" ? "alerts.actions.overrideWheel" : "alerts.actions.overrideCondor", { ticker: alert.ticker })}
                onCommit={(value) => void setAlertOverride(db, accountId, alert.id, value)}
              />
            )}
          </div>
        </TableCell>
      </TableRow>
    );
  };

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="font-heading text-xl font-semibold tracking-tight">{t("nav.alerts")}</h1>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5">
            {t("alerts.margins.wheel")}
            <PercentField
              value={margins.wheel}
              clearable={false}
              className="w-16"
              label={t("alerts.margins.wheel")}
              onCommit={(value) => void setAlertMargins(db, accountId, { wheel: value ?? undefined })}
            />
            <span className="text-muted-foreground">{t("alerts.margins.unit")}</span>
          </label>
          <label className="flex items-center gap-1.5">
            {t("alerts.margins.condor")}
            <PercentField
              value={margins.condor}
              clearable={false}
              className="w-16"
              label={t("alerts.margins.condor")}
              onCommit={(value) => void setAlertMargins(db, accountId, { condor: value ?? undefined })}
            />
            <span className="text-muted-foreground">{t("alerts.margins.unit")}</span>
          </label>
          {permission === "default" && (
            <Button variant="outline" size="sm" onClick={() => void enableNotifications()}>
              {t("alerts.enableNotifications")}
            </Button>
          )}
        </div>
      </div>
      {!agentPresent && <p className="text-xs text-muted-foreground">{t("alerts.noAgent")}</p>}
      <Card>
        <CardContent className="overflow-x-auto">
          {view.status === "loading" ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("alerts.empty")}</p>
          ) : (
            <DataTable columns={COLUMNS} minWidth="56rem">
              <DataTableHeader columns={COLUMNS} labelKey="alerts.columns" />
              <TableBody>
                {GROUPS.map((group) => {
                  const rows = alerts.filter((row) => row.status === group);
                  if (rows.length === 0) return null;
                  return (
                    <Fragment key={group}>
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={COLUMNS.length} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {t(`alerts.groups.${group}`)} ({rows.length})
                        </TableCell>
                      </TableRow>
                      {rows.map(renderRow)}
                    </Fragment>
                  );
                })}
              </TableBody>
            </DataTable>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
