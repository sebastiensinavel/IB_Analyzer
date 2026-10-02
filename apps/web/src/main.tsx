import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/App";
import { startAlertWatcher } from "@/alerts/watcher";
import { applyStoredTheme } from "@/hooks/useTheme";
import { db } from "@/db/schema";
import { isDemo } from "@/demo/mode";
import { startApp } from "@/startup";
import { reloadOnControllerChange } from "@/pwa/updates";
import { reloadOnVersionChange } from "@/db/reloadOnVersionChange";
import { router } from "@/routes/router";
import "@/index.css";

// Sync <html class="dark"> from localStorage before the first render: since sub-project 28
// the theme toggle only lives on the Settings page, so a page that never calls useTheme()
// itself (Positions, Historique, un Journal) must not depend on some other page's hook
// having mounted first to pick up a stored dark preference.
applyStoredTheme();

// Une nouvelle version du Service Worker a pris la main (bandeau « Recharger », sous-projet
// 40) : chaque onglet recharge, pas seulement celui du clic.
reloadOnControllerChange(navigator.serviceWorker, () => window.location.reload());

// Un autre onglet monte la base à un schéma plus récent (sous-projet 40) : cet onglet
// est dépassé, on le recharge.
reloadOnVersionChange(db, () => window.location.reload());

// The demo base fills itself before the first render (sub-project 41): no page may meet it empty.
// A failed seed is logged and the application mounts anyway (`startApp`).
void startApp(
  async () => {
    if (isDemo()) await (await import("@/demo/seed")).ensureDemoSeeded(db);
  },
  () => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    // Les alertes de tous les comptes, sur toutes les pages, onglet masqué compris (sous-projet 43) :
    // après la graine de démonstration, jamais avant.
    startAlertWatcher({ db, open: (path) => void router.navigate(path) });
  },
);
