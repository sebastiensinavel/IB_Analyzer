import { LogIn, LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button } from "@ib/ui/button";
import { useSession, useSessionActions } from "@/api/session";

/**
 * Sits at the foot of the sidebar. Three of `useSession`'s four states get a rendering:
 * `anonymous` and `unreachable` both read as "not signed in" here — a login is only ever
 * useful to reach the Flex proxy, so an unreachable server is never alarmed about, just
 * offered the same sign-in link as a plain anonymous visit. `loading` renders nothing rather
 * than a placeholder that would flash away a moment later.
 */
export function SessionMenuItem() {
  const { t } = useTranslation();
  const session = useSession();
  const { logout } = useSessionActions();

  if (session.status === "loading") return null;

  if (session.status === "authenticated") {
    return (
      <div className="flex w-full items-center justify-between gap-2 px-1">
        <span className="truncate text-xs text-muted-foreground" title={session.user.email}>
          {session.user.email}
        </span>
        <Button variant="ghost" size="icon-xs" aria-label={t("auth.signOut")} onClick={() => void logout()}>
          <LogOut />
        </Button>
      </div>
    );
  }

  return (
    <Link
      to="/login"
      title={t("auth.serverAccountTitle")}
      aria-label={t("auth.serverAccountTitle")}
      className="flex w-full items-center gap-1.5 px-1 text-xs text-muted-foreground hover:text-foreground"
    >
      <LogIn className="size-3.5" />
      {t("auth.serverAccount")}
      <span className="opacity-70">{t("auth.optional")}</span>
    </Link>
  );
}
