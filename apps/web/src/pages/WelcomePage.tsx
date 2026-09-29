import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Button, buttonVariants } from "@ib/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { cn } from "@ib/ui/lib/utils";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { SessionCorner } from "@/components/SessionCorner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ShotFrame } from "@/components/welcome/ShotFrame";
import type { ShotId } from "@/welcome/shots";

interface Step { title: string; text: string }
interface Faq { q: string; a: string }

const FEATURES = [
  { key: "positions", shot: "positions" },
  { key: "wheel", shot: "wheel" },
  { key: "journal", shot: "journal-wheel" },
  { key: "condors", shot: "condors" },
] as const;

const STEP_LINKS = ["/help#statement", "/help#flex", "/help#agent"];

function FeatureSection({ index, title, text, shot, alt }: { index: number; title: string; text: string; shot: ShotId; alt: string }) {
  return (
    <section className={cn("flex flex-col items-center gap-6 md:gap-10", index % 2 === 0 ? "md:flex-row" : "md:flex-row-reverse")}>
      <div className="flex flex-col gap-2 md:w-2/5">
        <h2 className="font-heading text-xl font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
      <ShotFrame id={shot} alt={alt} className="w-full md:w-3/5" />
    </section>
  );
}

export function WelcomePage() {
  const { t } = useTranslation();
  const more = t("welcome.more.items", { returnObjects: true }) as string[];
  const steps = t("welcome.how.steps", { returnObjects: true }) as Step[];
  const faq = t("welcome.faq.items", { returnObjects: true }) as Faq[];
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

      <header className="flex flex-col gap-6 md:flex-row md:items-center md:gap-10">
        <div className="flex flex-col gap-6 md:w-1/2">
          <h1 className="font-heading text-3xl font-semibold tracking-tight md:text-4xl">{t("welcome.title")}</h1>
          <p className="text-muted-foreground">{t("welcome.subtitle")}</p>
          <WelcomeActions />
        </div>
        <ShotFrame id="dashboard" alt={t("welcome.heroAlt")} eager className="w-full md:w-1/2" />
      </header>

      {FEATURES.map((f, i) => (
        <FeatureSection
          key={f.key}
          index={i}
          title={t(`welcome.features.${f.key}.title`)}
          text={t(`welcome.features.${f.key}.text`)}
          shot={f.shot}
          alt={t(`welcome.features.${f.key}.alt`)}
        />
      ))}

      <section className="flex flex-col items-center gap-6 md:flex-row md:gap-10">
        <ShotFrame id="history" alt={t("welcome.more.alt")} className="w-full md:w-1/2" />
        <div className="flex flex-col gap-2 md:w-1/2">
          <h2 className="font-heading text-xl font-semibold tracking-tight">{t("welcome.more.title")}</h2>
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            {more.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      </section>

      <Card className="border-l-4 border-l-primary">
        <CardHeader>
          <CardTitle>{t("welcome.privacy.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3 text-sm">
          <p className="text-muted-foreground">{t("welcome.privacy.text")}</p>
          <Link to="/help#security" className="underline">{t("welcome.privacy.link")}</Link>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-4">
        <h2 className="font-heading text-xl font-semibold tracking-tight">{t("welcome.how.title")}</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {steps.map((step, i) => (
            <li key={step.title} className="flex flex-col gap-1 rounded-md border border-border p-4">
              <span className="text-sm text-muted-foreground">{i + 1}</span>
              <Link to={STEP_LINKS[i] ?? "/help"} className="font-medium underline">{step.title}</Link>
              <p className="text-sm text-muted-foreground">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-xl font-semibold tracking-tight">{t("welcome.faq.title")}</h2>
        {faq.map((item) => (
          <details key={item.q} className="rounded-md border border-border p-3">
            <summary className="cursor-pointer font-medium">{item.q}</summary>
            <p className="mt-2 text-sm text-muted-foreground">{item.a}</p>
          </details>
        ))}
      </section>

      <footer className="flex flex-wrap items-center gap-4 border-t border-border pt-4 text-sm text-muted-foreground">
        <Link to="/help" className="underline">{t("welcome.help")}</Link>
        <Link to="/settings" className="underline">{t("nav.settings")}</Link>
        <span>{t("welcome.footer.shots")}</span>
      </footer>
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
