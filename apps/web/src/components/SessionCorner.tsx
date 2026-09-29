import { LogOut } from "lucide-react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Button, buttonVariants } from "@ib/ui/button";
import { cn } from "@ib/ui/lib/utils";
import { useSession, useSessionActions } from "@/api/session";

/**
 * `/accounts` is where a device with no local account lands, and the only route a newcomer
 * reaches on their own — but `SessionMenuItem` lives in the sidebar footer, which this page
 * does not render. Signing in was therefore unreachable here without already knowing the
 * `/login` URL. Written for this header rather than reusing `SessionMenuItem`: that one is
 * shaped for the sidebar (`w-full`, `justify-between`, `text-xs`) and would stretch across
 * this row.
 *
 * The three settled session states get the same treatment as everywhere else: `anonymous` and
 * `unreachable` both simply offer the way in — the server is optional (spec §2), so an
 * unreachable one is never alarmed about — and `loading` renders nothing rather than a
 * placeholder that would flash away.
 */
export function SessionCorner() {
  const { t } = useTranslation();
  const session = useSession();
  const { logout } = useSessionActions();

  if (session.status === "loading") return null;

  if (session.status === "authenticated") {
    return (
      <div className="flex items-center gap-1">
        <span className="max-w-40 truncate text-xs text-muted-foreground" title={session.user.email}>
          {session.user.email}
        </span>
        <Button variant="ghost" size="icon-xs" aria-label={t("auth.signOut")} onClick={() => void logout()}>
          <LogOut />
        </Button>
      </div>
    );
  }

  return (
    // `cn(...)` is not decoration: `buttonVariants` emits both `border-transparent` (base)
    // and `border-border` (outline), and only tailwind-merge picks the winner.
    <Link
      to="/login"
      title={t("auth.serverAccountTitle")}
      aria-label={t("auth.serverAccountTitle")}
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
    >
      {t("auth.serverAccount")}
      <span className="text-xs font-normal text-muted-foreground">{t("auth.optional")}</span>
    </Link>
  );
}
