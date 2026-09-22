import { useState, type FormEvent } from "react";
import { LogOut } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Button, buttonVariants } from "@ib/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { Input } from "@ib/ui/input";
import { cn } from "@ib/ui/lib/utils";
import { useSession, useSessionActions } from "@/api/session";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AccountError, createAccount } from "@/db/accounts";
import { useDb } from "@/db/DbProvider";
import { useAccounts } from "@/db/hooks";

export function AccountsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const db = useDb();
  const accounts = useAccounts();
  const [label, setLabel] = useState("");
  const [ibAccountId, setIbAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const account = await createAccount(db, { label, ibAccountId });
      navigate(`/accounts/${account.id}/sources`);
    } catch (e) {
      if (e instanceof AccountError) setError(t(`accounts.errors.${e.code}`));
      else throw e;
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 p-4 md:p-6">
      {/* The title sits UNDER the buttons, on a line of its own. This page is `max-w-lg`, and
          four controls plus a six-word heading on one row wrapped the heading onto four lines.
          Giving it the full width costs one line and reads straight. */}
      <div className="flex items-center justify-end gap-2">
        {/* The one path into Settings from a device that holds no account at all: without it,
            restoring a backup onto a fresh browser needs a URL nobody would guess. */}
        <Link to="/settings" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          {t("nav.settings")}
        </Link>
        <SessionCorner />
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
      <h1 className="font-heading text-lg font-semibold tracking-tight">{t("accounts.title")}</h1>

      <Card>
        <CardContent className="flex flex-col gap-2 py-4">
          {accounts && accounts.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("accounts.empty")}</p>
          )}
          {accounts?.map((account) => (
            <div key={account.id} className="flex items-center justify-between gap-2">
              <div>
                <div className="font-medium">{account.label}</div>
                <div className="font-mono text-xs text-muted-foreground">{account.ibAccountId}</div>
              </div>
              <Button variant="outline" size="sm" nativeButton={false} role="link" render={<Link to={`/accounts/${account.id}/dashboard`} />}>
                {t("accounts.open")}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("accounts.addTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t("accounts.addHint")}</p>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              {t("accounts.label")}
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={t("accounts.labelPlaceholder")}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t("accounts.ibAccountId")}
              <Input value={ibAccountId} onChange={(e) => setIbAccountId(e.target.value)} placeholder="U1234567" required />
            </label>
            <p className="-mt-2 text-xs text-muted-foreground">{t("accounts.ibAccountIdHint")}</p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit">{t("accounts.create")}</Button>
          </form>
        </CardContent>
      </Card>

      {/* Last, not first (decided 2026-09-22): the page's job is to open or add an account, and
          a returning user should meet their own accounts before a pitch they have read. The page
          is short enough that a newcomer still finds it. */}
      <WelcomeCard />
    </div>
  );
}

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
function SessionCorner() {
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

/**
 * `/accounts` is the landing page of a device with no local account, and the only route a
 * newcomer reaches on their own: nothing else tells them what this application is. Rendered
 * whatever the number of accounts — decided 2026-09-22 — because the page keeps serving to
 * add another account and to open one, and a block that vanished on the first add would
 * change the page under the user right after they acted.
 */
function WelcomeCard() {
  const { t } = useTranslation();
  const benefits = t("accounts.welcome.benefits", { returnObjects: true }) as string[];
  const steps = t("accounts.welcome.steps", { returnObjects: true }) as string[];

  return (
    <Card>
      <CardHeader>
        <CardTitle>IB Analyzer</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p>{t("accounts.welcome.tagline")}</p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          {benefits.map((benefit) => (
            <li key={benefit}>{benefit}</li>
          ))}
        </ul>
        <p className="rounded-md bg-muted px-3 py-2">{t("accounts.welcome.privacy")}</p>
        <div className="flex flex-col gap-1">
          <p className="font-medium">{t("accounts.welcome.howTitle")}</p>
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
        <div>
          <Link to="/help" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            {t("accounts.welcome.helpLink")}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
