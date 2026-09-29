import { Button } from "@ib/ui/button";
import { useTranslation } from "react-i18next";
import { useRegisterSW } from "virtual:pwa-register/react";
import { scheduleUpdateChecks } from "./updates";

/**
 * Annonce une version publiée depuis le chargement (sous-projet 40). Le clic l'active ; chaque
 * onglet recharge alors par `reloadOnControllerChange` (main.tsx). Posé hors du routeur, il
 * paraît sur toutes les routes, avec ou sans compte.
 */
export function UpdateBanner() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (registration) scheduleUpdateChecks(registration, () => navigator.onLine);
    },
  });
  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-4 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-sm shadow-lg"
      style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}
    >
      <span>{t("pwa.updateAvailable")}</span>
      {/* Constaté : la bibliothèque ignore son argument et recharge l'onglet du clic sur « controlling », sauf dans l'onglet de la première installation ; notre écouteur recharge aussi, deux window.location.reload() dans la même tâche, une seule navigation. */}
      <Button size="sm" onClick={() => void updateServiceWorker(false)}>
        {t("pwa.reload")}
      </Button>
    </div>
  );
}
