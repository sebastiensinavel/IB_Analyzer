import { Button } from "@ib/ui/button";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRegisterSW } from "virtual:pwa-register/react";
import { scheduleUpdateChecks, UPDATE_RELOAD_FALLBACK_MS } from "./updates";

/**
 * Annonce une version publiée depuis le chargement (sous-projet 40). Le clic l'active ; chaque
 * onglet recharge alors par `reloadOnControllerChange` (main.tsx). Posé hors du routeur, il
 * paraît sur toutes les routes, avec ou sans compte.
 *
 * Dès le clic, le bandeau dit que la mise à jour est en cours et son bouton se désactive :
 * l'activation du nouveau Service Worker prend un moment pendant lequel rien d'autre ne bouge.
 * Si elle n'aboutit pas en `UPDATE_RELOAD_FALLBACK_MS`, l'onglet recharge de lui-même.
 */
export function UpdateBanner({ reload = () => window.location.reload() }: { reload?: () => void }) {
  const { t } = useTranslation();
  const [updating, setUpdating] = useState(false);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (registration) scheduleUpdateChecks(registration, () => navigator.onLine);
    },
  });
  useEffect(() => {
    if (!updating) return;
    const id = setTimeout(reload, UPDATE_RELOAD_FALLBACK_MS);
    return () => clearTimeout(id);
    // `reload` est lu à l'armement : un parent qui le recrée ne doit pas relancer le délai.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updating]);
  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-4 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-sm shadow-lg"
      style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}
    >
      <span>{t(updating ? "pwa.updating" : "pwa.updateAvailable")}</span>
      {/*
        Constaté : la bibliothèque ignore son argument et recharge tout onglet qui a montré
        l'invite, sur « controlling » avec `isUpdate` vrai (jamais l'onglet de la première
        installation) ; notre écouteur recharge aussi : deux window.location.reload() dans la
        même tâche, une seule navigation.
      */}
      <Button
        size="sm"
        disabled={updating}
        onClick={() => {
          setUpdating(true);
          void updateServiceWorker(false);
        }}
      >
        {updating && <RefreshCw className="animate-spin" />}
        {t("pwa.reload")}
      </Button>
    </div>
  );
}
