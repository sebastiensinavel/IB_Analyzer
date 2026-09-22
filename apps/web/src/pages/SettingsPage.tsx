import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button, buttonVariants } from "@ib/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { Input } from "@ib/ui/input";
import { cn } from "@ib/ui/lib/utils";
import {
  activateTotp,
  changePassword,
  deactivateTotp,
  fetchRecoveryCodes,
  fetchTotpStatus,
  generateRecoveryCodes,
  type RecoveryCodesStatus,
  type TotpStatus,
} from "@/api/allauth";
import { useSession, useSessionActions } from "@/api/session";
import { BackupCard } from "@/components/settings/BackupCard";

/**
 * The server is optional (spec §2): every card below except "Compte" only makes sense once
 * signed in, since they all call authenticated allauth endpoints. They render only for
 * `session.status === "authenticated"` — never as a disabled husk that invites clicking into
 * a 401 for a merely anonymous or unreachable visit.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const session = useSession();
  const { logout } = useSessionActions();

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="font-heading text-lg font-semibold tracking-tight">{t("settings.title")}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.account")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {session.status === "loading" && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
          {session.status === "authenticated" && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm">{t("settings.signedInAs", { email: session.user.email })}</p>
              <Button variant="outline" size="sm" onClick={() => void logout()}>
                {t("auth.signOut")}
              </Button>
            </div>
          )}
          {(session.status === "anonymous" || session.status === "unreachable") && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">{t("settings.signedOut")}</p>
              <Link
                to="/login"
                title={t("auth.serverAccountTitle")}
                aria-label={t("auth.serverAccountTitle")}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
              >
                {t("auth.serverAccount")}
                <span className="text-xs font-normal text-muted-foreground">{t("auth.optional")}</span>
              </Link>
            </div>
          )}
          {session.status === "unreachable" && (
            <p className="text-xs text-muted-foreground">{t("settings.unreachableHint")}</p>
          )}
        </CardContent>
      </Card>

      <BackupCard />

      {session.status === "authenticated" && (
        <>
          <PasswordCard />
          <TwoFactorCard />
          <RecoveryCodesCard />
        </>
      )}
    </div>
  );
}

function PasswordCard() {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setSubmitting(true);
    const result = await changePassword(newPassword, currentPassword);
    setSubmitting(false);
    if (result.ok) {
      setCurrentPassword("");
      setNewPassword("");
      setMessage({ ok: true, text: t("settings.passwordChanged") });
      return;
    }
    setMessage({
      ok: false,
      // `AllauthResult`'s "mfa_required" branch carries no `detail` (it can never happen here,
      // this endpoint never answers with it, but the type is shared across every `AllauthResult<T>`).
      text:
        result.kind === "unreachable"
          ? t("auth.serverUnreachable")
          : ("detail" in result && result.detail) || t("settings.actionFailed"),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.changePassword")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {t("settings.currentPassword")}
            <Input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("settings.newPassword")}
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
          </label>
          {message && (
            <p
              role={message.ok ? undefined : "alert"}
              className={message.ok ? "text-sm text-success" : "text-sm text-destructive"}
            >
              {message.text}
            </p>
          )}
          <div>
            <Button type="submit" disabled={submitting}>
              {t("auth.submit")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function TwoFactorCard() {
  const { t } = useTranslation();
  // `undefined` while loading, `null` when the server could not be reached, otherwise the
  // real status — mirrors the `undefined`/`null`/value convention used by the IndexedDB hooks.
  const [status, setStatus] = useState<TotpStatus | null | undefined>(undefined);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    const result = await fetchTotpStatus();
    setStatus(result.ok ? result.value : null);
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleActivate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await activateTotp(code);
    setSubmitting(false);
    if (result.ok) {
      setCode("");
      await load();
      return;
    }
    setError(
      result.kind === "unreachable"
        ? t("auth.serverUnreachable")
        : ("detail" in result && result.detail) || t("settings.actionFailed"),
    );
  }

  async function handleDeactivate() {
    setError(null);
    setSubmitting(true);
    const result = await deactivateTotp();
    setSubmitting(false);
    if (result.ok) {
      await load();
      return;
    }
    setError(result.kind === "unreachable" ? t("auth.serverUnreachable") : t("settings.actionFailed"));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.twoFactor")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {status === undefined && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
        {status === null && <p className="text-xs text-muted-foreground">{t("auth.serverUnreachable")}</p>}
        {status?.configured === true && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm">{t("settings.totpConfigured")}</p>
            <Button variant="destructive" size="sm" onClick={() => void handleDeactivate()} disabled={submitting}>
              {t("settings.disableTotp")}
            </Button>
          </div>
        )}
        {status?.configured === false && (
          <form onSubmit={handleActivate} className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">{t("settings.totpSecretHint", { secret: status.secret })}</p>
            <p className="break-all font-mono text-xs text-muted-foreground">{status.totpUrl}</p>
            <label className="flex flex-col gap-1 text-sm">
              {t("auth.code")}
              <Input value={code} onChange={(e) => setCode(e.target.value)} required />
            </label>
            <div>
              <Button type="submit" disabled={submitting}>
                {t("settings.enableTotp")}
              </Button>
            </div>
          </form>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function RecoveryCodesCard() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<RecoveryCodesStatus | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      const result = await fetchRecoveryCodes();
      setStatus(result.ok ? result.value : null);
    })();
  }, []);

  async function handleGenerate() {
    setError(null);
    setSubmitting(true);
    const result = await generateRecoveryCodes();
    setSubmitting(false);
    if (result.ok) {
      setStatus(result.value);
      return;
    }
    setError(result.kind === "unreachable" ? t("auth.serverUnreachable") : t("settings.actionFailed"));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.recoveryCodes")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t("settings.recoveryCodesHint")}</p>
        {status === undefined && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
        {status === null && <p className="text-xs text-muted-foreground">{t("auth.serverUnreachable")}</p>}
        {status && !status.generated && (
          <p className="text-sm text-muted-foreground">{t("settings.recoveryCodesNotGenerated")}</p>
        )}
        {status?.codes && status.codes.length > 0 && (
          <ul className="grid grid-cols-2 gap-1 font-mono text-sm" data-testid="recovery-codes">
            {status.codes.map((recoveryCode) => (
              <li key={recoveryCode}>{recoveryCode}</li>
            ))}
          </ul>
        )}
        {status?.generated && status.totalCodeCount !== null && status.unusedCodeCount !== null && (
          <p className="text-xs text-muted-foreground">
            {t("settings.recoveryCodesRemaining", { count: status.unusedCodeCount, total: status.totalCodeCount })}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div>
          <Button variant="outline" onClick={() => void handleGenerate()} disabled={submitting}>
            {t("settings.recoveryCodesGenerate")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
