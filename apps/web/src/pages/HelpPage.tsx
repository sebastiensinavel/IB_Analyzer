import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";
import { Link, useLocation } from "react-router";
import { Button, buttonVariants } from "@ib/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { cn } from "@ib/ui/lib/utils";
import { useAgentIndex } from "@/agent/agentIndex";
import { ModesDiagram } from "@/components/help/ModesDiagram";
import { getLastAccountId } from "@/lib/accountStorage";

// Astral's own documented installers. Not our domain: fine in a versioned file.
const UV_INSTALL_UNIX = "curl -LsSf https://astral.sh/uv/install.sh | sh";
const UV_INSTALL_WINDOWS = 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"';

const COPIED_FEEDBACK_MS = 2000;

/**
 * A command to paste into a terminal, with a button that copies it whole: the page is written for
 * people who have never used one, and a mouse selection easily drops a character. No button where
 * the browser has no clipboard API — plain http off localhost — rather than one that does nothing.
 */
function Command({ children }: { children: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const canCopy = typeof navigator !== "undefined" && navigator.clipboard !== undefined;
  const copy = () => {
    navigator.clipboard.writeText(children).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted py-1 pr-1 pl-3">
      <pre className="min-w-0 flex-1 overflow-x-auto py-1 font-mono text-xs">
        <code>{children}</code>
      </pre>
      {canCopy && (
        <Button type="button" variant="ghost" size="xs" className="shrink-0" onClick={copy}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? t("help.copied") : t("help.copy")}
        </Button>
      )}
    </div>
  );
}

/**
 * One point inside a section. The agent needs seven of them and they are one story, so
 * they share a card rather than each claiming the weight of a top-level section — a newcomer
 * counting nine cards read eight of them as required before the application would work.
 */
function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0">
      <p className="font-heading font-medium">{title}</p>
      {children}
    </div>
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
  const terminalItems = t("help.terminal.open", { returnObjects: true }) as string[];

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="font-heading text-lg font-semibold tracking-tight">{t("help.title")}</h1>

      <Section title={t("help.app.title")}>
        <p className="text-muted-foreground">{t("help.app.text")}</p>
        <p className="rounded-md bg-muted px-3 py-2">{t("help.app.privacy")}</p>
        <p className="text-muted-foreground">{t("help.app.sources")}</p>
        <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
          {(t("help.app.tiers", { returnObjects: true }) as string[]).map((tier) => (
            <li key={tier}>{tier}</li>
          ))}
        </ul>
        <p className="text-muted-foreground">{t("help.app.history")}</p>
        <div className="mt-2 flex flex-col gap-3 border-t pt-4">
          <p className="font-heading font-medium">{t("help.modes.title")}</p>
          <ModesDiagram />
        </div>
      </Section>

      <Section title={t("help.offline.title")}>
        <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
          {(t("help.offline.items", { returnObjects: true }) as string[]).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Section>

      <Section id="statement" title={t("help.statement.title")}>
        <p className="text-muted-foreground">{t("help.statement.portal")}</p>
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
        <p>{t("help.flex.relay")}</p>
        <p className="text-muted-foreground">{t("help.flex.missing")}</p>
      </Section>

      <Section title={t("help.what.title")}>
        <p className="text-muted-foreground">{t("help.what.tws")}</p>
        <p className="text-muted-foreground">{t("help.what.text")}</p>
        <p className="text-muted-foreground">{t("help.what.dayValues")}</p>

        {/* Written for someone who has never opened a terminal: every step says what to expect
            back, and the messages that matter are quoted as the terminal prints them. */}
        <Step title={t("help.terminal.title")}>
          <p className="text-muted-foreground">{t("help.terminal.text")}</p>
          <ul className="list-disc space-y-1 pl-5">
            {terminalItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="text-muted-foreground">{t("help.terminal.paste")}</p>
        </Step>

        <Step title={t("help.uv.title")}>
          <p className="text-muted-foreground">{t("help.uv.text")}</p>
          <p>{t("help.uv.macLinux")}</p>
          <Command>{UV_INSTALL_UNIX}</Command>
          <p>{t("help.uv.windows")}</p>
          <Command>{UV_INSTALL_WINDOWS}</Command>
          <p className="text-muted-foreground">{t("help.uv.reopen")}</p>
          <Command>uv --version</Command>
          <p className="text-muted-foreground">{t("help.uv.notFound")}</p>
        </Step>

        <Step title={t("help.install.title")}>
          {index.status === "ok" && (
            <>
              <p className="text-muted-foreground">{t("help.install.text")}</p>
              <Command>{`uv tool install ${origin}/agent/${index.index.filename}`}</Command>
              <p className="text-muted-foreground">{t("help.install.path")}</p>
              <Command>uv tool update-shell</Command>
              <p className="text-muted-foreground">{t("help.install.update")}</p>
              <Command>uv tool uninstall ib-tws-agent</Command>
            </>
          )}
          {index.status === "unavailable" && <p className="text-muted-foreground">{t("help.install.unavailable")}</p>}
        </Step>

        <Step title={t("help.configure.title")}>
          <p className="text-muted-foreground">{t("help.configure.origin")}</p>
          <Command>{`ib-tws-agent origin add ${origin}`}</Command>
          <p className="text-muted-foreground">{t("help.configure.run")}</p>
          <Command>ib-tws-agent</Command>
          <p className="text-muted-foreground">{t("help.configure.stop")}</p>
          <p className="text-muted-foreground">{t("help.configure.others")}</p>
        </Step>

        <Step title={t("help.tws.title")}>
          <p className="text-muted-foreground">{t("help.tws.text")}</p>
          <ul className="list-disc space-y-1 pl-5">
            {twsItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Step>

        <Step title={t("help.chrome.title")}>
          <p className="text-muted-foreground">{t("help.chrome.text")}</p>
        </Step>

        <Step title={t("help.port.title")}>
          <p className="text-muted-foreground">{t("help.port.text")}</p>
          {lastAccountId && (
            <div>
              <Link to={`/accounts/${lastAccountId}/sources`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                {t("help.port.link")}
              </Link>
            </div>
          )}
        </Step>
      </Section>

      {/* Last on purpose: the server is a fallback and an option, never a step on the way in. */}
      <Section id="server" title={t("help.server.title")}>
        <p className="text-muted-foreground">{t("help.server.intro")}</p>

        <Step title={t("help.server.relay.title")}>
          <p className="text-muted-foreground">{t("help.server.relay.text")}</p>
          <p className="rounded-md bg-warning/10 px-3 py-2">{t("help.server.relay.degraded")}</p>
        </Step>

        <Step title={t("help.server.backup.title")}>
          <p className="text-muted-foreground">{t("help.server.backup.text")}</p>
          <p className="text-muted-foreground">{t("help.server.backup.encrypted")}</p>
          <div>
            <Link to="/settings" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              {t("help.server.backup.link")}
            </Link>
          </div>
        </Step>
      </Section>
    </div>
  );
}
