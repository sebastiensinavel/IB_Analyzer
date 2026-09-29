import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Button, buttonVariants } from "@ib/ui/button";
import { cn } from "@ib/ui/lib/utils";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { SessionCorner } from "@/components/SessionCorner";
import { ThemeToggle } from "@/components/ThemeToggle";

export function WelcomePage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-12 p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-heading text-sm font-semibold tracking-tight">IB Analyzer</span>
        <div className="flex flex-wrap items-center gap-2">
          <SessionCorner />
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>
      <WelcomeActions />
    </div>
  );
}

export function WelcomeActions() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Link to="/accounts" className={cn(buttonVariants())}>{t("welcome.addAccount")}</Link>
        <Button variant="outline">{t("welcome.exploreDemo")}</Button>
      </div>
      <div className="flex gap-4 text-sm text-muted-foreground">
        <Link to="/help" className="underline">{t("welcome.help")}</Link>
        <Link to="/settings" className="underline">{t("welcome.restore")}</Link>
      </div>
    </div>
  );
}
