import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/App";
import { applyStoredTheme } from "@/hooks/useTheme";
import { db } from "@/db/schema";
import { reloadOnControllerChange } from "@/pwa/updates";
import { reloadOnVersionChange } from "@/db/reloadOnVersionChange";
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
