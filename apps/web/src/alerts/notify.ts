import type { TFunction } from "i18next";
import { isCrossed, type Alert } from "@ib/alerts";
import { isDemo } from "@/demo/mode";
import { alertNoteText } from "./noteText";
import { formatLocalePrice } from "@/lib/format";

/**
 * Le seul lecteur de l'API `Notification` (spec §6.4). Une API absente, un refus ou la
 * démonstration ne produisent jamais d'erreur : seulement aucune notification.
 */
function api(): typeof Notification | null {
  return typeof globalThis.Notification === "function" ? globalThis.Notification : null;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  return api()?.permission ?? "unsupported";
}

export async function requestNotificationPermission(): Promise<void> {
  const notification = api();
  if (notification === null || isDemo() || notification.permission !== "default") return;
  try {
    await notification.requestPermission();
  } catch {
    // Un navigateur qui refuse la demande elle-même : rien de plus qu'un refus.
  }
}

function body(alert: Alert, t: TFunction): string | undefined {
  switch (alert.kind) {
    case "wheel":
      return t("alerts.notify.wheel", { strike: String(alert.strike) });
    case "condor":
      return t("alerts.notify.condor", { put: String(alert.strikes[1]), call: String(alert.strikes[2]) });
    case "manual":
      return alertNoteText(alert.note, t) ?? undefined;
  }
}

/**
 * Une alerte vient de se déclencher : titre « ZXAB ↑ 38,20 », le seuil écrit dans la langue
 * `locale`, un clic ramène sur l'onglet puis `onOpen`. `price`, le cours qui l'a déclenchée, choisit l'aile d'un condor : le seuil qu'il
 * franchit, sinon le premier. `account`, à partir de deux comptes dans le navigateur
 * (sous-projet 43) : le titre le nomme.
 */
export function notifyTriggered(alert: Alert, onOpen: () => void, t: TFunction, locale: string, price?: number, account?: string): void {
  const notification = api();
  if (notification === null || isDemo() || notification.permission !== "granted" || alert.thresholds === null) return;
  const threshold = alert.thresholds.find((th) => price !== undefined && isCrossed([th], price)) ?? alert.thresholds[0];
  const bare = t(threshold.direction === "above" ? "alerts.notify.title_above" : "alerts.notify.title_below", {
    ticker: alert.ticker,
    price: formatLocalePrice(threshold.price, locale),
  });
  const title = account === undefined ? bare : t("alerts.notify.title_account", { account, title: bare, interpolation: { escapeValue: false } });
  try {
    const shown = new notification(title, { body: body(alert, t) });
    shown.onclick = () => {
      window.focus();
      onOpen();
    };
  } catch {
    // Chrome sur Android refuse le constructeur hors Service Worker : aucune notification.
  }
}
