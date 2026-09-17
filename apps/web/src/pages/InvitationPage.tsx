import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { Button } from "@ib/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { Input } from "@ib/ui/input";
import { api } from "@/api/client";
import { useSessionActions } from "@/api/session";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function InvitationPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { token = "" } = useParams<{ token: string }>();
  const { refresh } = useSessionActions();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { error: apiError } = await api.POST("/api/core/invitations/accept", { body: { token, password } });
      if (apiError) {
        // "invitation-invalid" gets its own copy; every other code (starting with
        // "password-invalid") shows the server's own detail, which already explains what was
        // wrong with the password.
        setError(apiError.code === "invitation-invalid" ? t("invitation.invalid") : apiError.detail);
        return;
      }
      await refresh();
      navigate("/", { replace: true });
    } catch {
      // `api` (openapi-fetch) has no `onError` middleware registered (see client.ts), so a
      // network failure rejects `api.POST` itself instead of coming back as `{ error }` —
      // same discreet handling as everywhere else a server that's merely optional (spec §2)
      // can go unreachable, never an error left to vanish across the screen (compare
      // SourcesPage.tsx's import handler, which guards the same way for the same reason).
      setError(t("auth.serverUnreachable"));
    } finally {
      setSubmitting(false);
    }
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

      <Card>
        <CardHeader>
          <CardTitle>{t("invitation.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              {t("invitation.choosePassword")}
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            <p className="-mt-2 text-xs text-muted-foreground">{t("invitation.weakPassword")}</p>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" disabled={submitting}>
              {t("auth.submit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
