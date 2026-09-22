import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router";
import { Button } from "@ib/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { Input } from "@ib/ui/input";
import { authenticateSecondFactor } from "@/api/allauth";
import { useSessionActions } from "@/api/session";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";

interface LocationState {
  from?: string;
}

/**
 * No route in this app is protected (spec §2): reaching `/login` is always a choice, never a
 * redirect forced by a guard. Signing in only unlocks the Flex proxy — `location.state?.from`
 * lets a caller send the user back to whatever screen linked here, defaulting to `/`.
 */
export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { login, refresh } = useSessionActions();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const from = (location.state as LocationState | null)?.from ?? "/";

  async function handleCredentials(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await login(email, password);
    setSubmitting(false);
    if (result.ok) {
      navigate(from, { replace: true });
    } else if (result.kind === "mfa_required") {
      // A valid password with a second factor still pending is not a rejection: it never
      // reaches `auth.badCredentials` below, only the code step.
      setAwaitingCode(true);
    } else {
      setError(result.kind === "unreachable" ? t("auth.serverUnreachable") : t("auth.badCredentials"));
    }
  }

  async function handleCode(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await authenticateSecondFactor(code);
    if (result.ok) {
      // `authenticateSecondFactor` talks to allauth directly (task 14's frontier: components
      // never call fetch, but this page-level call still bypasses SessionProvider's own
      // `login` action), so the session context needs an explicit refresh to pick it up.
      await refresh();
      navigate(from, { replace: true });
    } else {
      setError(result.kind === "unreachable" ? t("auth.serverUnreachable") : t("auth.badCredentials"));
    }
    setSubmitting(false);
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-4 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary font-heading text-sm font-bold text-primary-foreground">
            IB
          </div>
          <span className="font-heading text-sm font-semibold tracking-tight">IB Analyzer</span>
        </Link>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-lg font-semibold tracking-tight">{t("auth.serverAccount")}</h1>
        {/* No route is protected (spec §7.3): reaching this page is always a choice. Saying so
            here is what keeps a newcomer from reading a closed door where there is an option. */}
        <p className="text-sm text-muted-foreground">{t("auth.intro.opens")}</p>
        <p className="text-sm text-muted-foreground">{t("auth.intro.without")}</p>
        <p className="text-sm text-muted-foreground">{t("auth.intro.invitation")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{awaitingCode ? t("auth.secondFactor") : t("auth.signIn")}</CardTitle>
        </CardHeader>
        <CardContent>
          {awaitingCode ? (
            <form onSubmit={handleCode} className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{t("auth.secondFactorHint")}</p>
              <label className="flex flex-col gap-1 text-sm">
                {t("auth.code")}
                <Input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" required />
              </label>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={submitting}>
                {t("auth.submit")}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleCredentials} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm">
                {t("auth.email")}
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {t("auth.password")}
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </label>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={submitting}>
                {t("auth.signIn")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <div>
        <Link to={from} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          {t("auth.back")}
        </Link>
      </div>
    </div>
  );
}
