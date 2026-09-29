import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Button, buttonVariants } from "@ib/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { Input } from "@ib/ui/input";
import { cn } from "@ib/ui/lib/utils";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { SessionCorner } from "@/components/SessionCorner";
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
      <div className="flex flex-wrap items-center justify-end gap-2">
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

      <Link to="/welcome" className="text-sm text-muted-foreground underline">{t("welcome.discover")}</Link>
    </div>
  );
}
