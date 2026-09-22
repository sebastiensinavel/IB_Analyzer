import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import { buttonVariants } from "@ib/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { cn } from "@ib/ui/lib/utils";
import { useAgentIndex } from "@/agent/agentIndex";
import { getLastAccountId } from "@/lib/accountStorage";

// Astral's own documented installers. Not our domain: fine in a versioned file.
const UV_INSTALL_UNIX = "curl -LsSf https://astral.sh/uv/install.sh | sh";
const UV_INSTALL_WINDOWS = 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"';

function Command({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
      <code>{children}</code>
    </pre>
  );
}

function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <Card id={id}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">{children}</CardContent>
    </Card>
  );
}

/**
 * Scrolls to the section a `#hash` names — `/help#statement` from the first-step card. The
 * router is a `createBrowserRouter` with no `ScrollRestoration`, so a client-side navigation
 * would otherwise land at the top of the page and the anchor would promise nothing.
 * `scrollIntoView` is guarded: jsdom does not implement it.
 */
function useHashScroll(hash: string) {
  useEffect(() => {
    const id = hash.replace(/^#/, "");
    if (!id) return;
    const target = document.getElementById(id);
    target?.scrollIntoView?.({ block: "start" });
  }, [hash]);
}

/**
 * Every command is built from `window.location.origin` and from the index the site serves
 * next to the agent's wheel: no domain name, no version, no file name in this code
 * (spec §8). Reading the origin at render time is what keeps CLAUDE.md's rule true.
 */
export function HelpPage() {
  const { t } = useTranslation();
  useHashScroll(useLocation().hash);
  const origin = window.location.origin;
  const index = useAgentIndex(origin);
  const lastAccountId = getLastAccountId();
  const twsItems = t("help.tws.items", { returnObjects: true }) as string[];

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="font-heading text-lg font-semibold tracking-tight">{t("help.title")}</h1>

      <Section title={t("help.app.title")}>
        <p className="text-muted-foreground">{t("help.app.text")}</p>
        <p className="rounded-md bg-muted px-3 py-2">{t("help.app.privacy")}</p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          {(t("help.app.tiers", { returnObjects: true }) as string[]).map((tier) => (
            <li key={tier}>{tier}</li>
          ))}
        </ul>
      </Section>

      <Section id="statement" title={t("help.statement.title")}>
        <p className="text-muted-foreground">{t("help.statement.text")}</p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          {(t("help.statement.items", { returnObjects: true }) as string[]).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Section>

      <Section id="flex" title={t("help.flex.title")}>
        <p className="text-muted-foreground">{t("help.flex.text")}</p>
        <p>{t("help.flex.selectAll")}</p>
        <div className="flex flex-col gap-1">
          <p className="font-medium">{t("help.flex.sectionsTitle")}</p>
          <ul className="list-disc space-y-1 pl-5 font-mono text-xs">
            {(t("help.flex.sections", { returnObjects: true }) as string[]).map((section) => (
              <li key={section}>{section}</li>
            ))}
          </ul>
        </div>
        <p className="text-muted-foreground">{t("help.flex.corporateActions")}</p>
        <p className="text-muted-foreground">{t("help.flex.token")}</p>
        <p className="text-muted-foreground">{t("help.flex.missing")}</p>
      </Section>

      <Section title={t("help.what.title")}>
        <p className="text-muted-foreground">{t("help.what.text")}</p>
        <p className="text-muted-foreground">{t("help.what.dayValues")}</p>
      </Section>

      <Section title={t("help.uv.title")}>
        <p className="text-muted-foreground">{t("help.uv.text")}</p>
        <p>{t("help.uv.macLinux")}</p>
        <Command>{UV_INSTALL_UNIX}</Command>
        <p>{t("help.uv.windows")}</p>
        <Command>{UV_INSTALL_WINDOWS}</Command>
      </Section>

      <Section title={t("help.install.title")}>
        <p className="text-muted-foreground">{t("help.install.text")}</p>
        {index.status === "ok" && <Command>{`uv tool install ${origin}/agent/${index.index.filename}`}</Command>}
        {index.status === "unavailable" && <p className="text-muted-foreground">{t("help.install.unavailable")}</p>}
      </Section>

      <Section title={t("help.configure.title")}>
        <p className="text-muted-foreground">{t("help.configure.text")}</p>
        <Command>{`ib-tws-agent init --origin ${origin}`}</Command>
        <Command>ib-tws-agent</Command>
      </Section>

      <Section title={t("help.tws.title")}>
        <p className="text-muted-foreground">{t("help.tws.text")}</p>
        <ul className="list-disc space-y-1 pl-5">
          {twsItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Section>

      <Section title={t("help.chrome.title")}>
        <p className="text-muted-foreground">{t("help.chrome.text")}</p>
      </Section>

      <Section title={t("help.port.title")}>
        <p className="text-muted-foreground">{t("help.port.text")}</p>
        {lastAccountId && (
          <div>
            <Link to={`/accounts/${lastAccountId}/sources`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              {t("help.port.link")}
            </Link>
          </div>
        )}
      </Section>
    </div>
  );
}
