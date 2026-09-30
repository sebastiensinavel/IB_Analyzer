import { Fragment } from "react";
import { Bell } from "lucide-react";
import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@ib/ui/sidebar";
import { buttonVariants } from "@ib/ui/button";
import { cn } from "@ib/ui/lib/utils";
import { AlertBadge } from "@/components/alerts/AlertBadge";
import { AccountSwitcher } from "@/components/AccountSwitcher";
import { SessionMenuItem } from "@/components/SessionMenuItem";
import { useOptionalAccountAlerts } from "@/db/AccountDataProvider";
import { NAV_SECTIONS } from "@/lib/navigation";
import { activeStrategies } from "@/lib/strategies";
import type { AccountRecord } from "@/db/schema";

interface AppSidebarProps {
  /** Null with no account on this device at all: the sidebar still renders, its account-scoped
   *  links just hidden (CLAUDE.md, "Paramètres et Aide s'atteignent sans aucun compte"). */
  accountId: string | null;
  accounts: readonly AccountRecord[];
}

export function AppSidebar({ accountId, accounts }: AppSidebarProps) {
  const { t } = useTranslation();
  const location = useLocation();
  // On a phone the sidebar is a drawer over the page: picking an entry closes it, or the new
  // page would load behind its backdrop. A no-op on a desktop, where openMobile stays false.
  const { setOpenMobile } = useSidebar();

  // The sidebar is inside AccountDataProvider only on an account's pages, never on Settings or
  // Help (sub-project 42), so it reads the account's chosen strategies straight from the record
  // it already has, through the same reader as everywhere
  // else. A section with no `strategy` (Overview, Others, Configuration) always shows.
  const alerts = useOptionalAccountAlerts();
  const badges = alerts?.status === "ready" ? alerts.badges : null;
  const active = activeStrategies(accounts.find((account) => account.id === accountId));

  // Every account-scoped entry needs a real accountId to link to; without one they are simply
  // not rendered rather than pointing nowhere or being disabled. Sections left empty by the
  // filter (every section but Configuration) are dropped too, so no empty group header shows.
  const visibleSections = NAV_SECTIONS.filter((section) => section.strategy === undefined || active.includes(section.strategy))
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => accountId !== null || !item.accountScoped),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <Sidebar>
      <SidebarHeader className="gap-3 px-2 pt-3">
        <div className="flex items-center gap-2 px-1">
          <div className="flex size-7 items-center justify-center rounded-md bg-linear-135 from-(--logo-from) to-(--logo-to) font-heading text-sm font-bold text-(--logo-foreground) shadow-(--logo-shadow)">
            IB
          </div>
          <span className="font-heading text-sm font-semibold tracking-tight">IB Analyzer</span>
        </div>
        {accountId !== null ? (
          <AccountSwitcher accountId={accountId} accounts={accounts} />
        ) : (
          <div className="flex flex-col gap-1">
            <Link to="/accounts" onClick={() => setOpenMobile(false)} className={cn(buttonVariants({ size: "sm" }), "w-full")}>
              {t("welcome.addAccount")}
            </Link>
            <Link
              to="/welcome"
              onClick={() => setOpenMobile(false)}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-full")}
            >
              {t("welcome.discover")}
            </Link>
          </div>
        )}
      </SidebarHeader>
      <SidebarContent>
        {visibleSections.map((section, index) => (
          <Fragment key={section.labelKey}>
            {index > 0 && <SidebarSeparator />}
            <SidebarGroup>
              <SidebarGroupLabel>{t(section.labelKey)}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {section.items.map((item) => {
                    // Safe: an account-scoped item only survives the filter above when
                    // accountId is not null. The fallback only satisfies the type for the
                    // account-less entries (Settings, Help), whose `to` ignores it anyway.
                    const to = item.to(accountId ?? "");
                    const Icon = item.icon;
                    return (
                      <SidebarMenuItem key={item.labelKey}>
                        <SidebarMenuButton
                          render={<Link to={to} onClick={() => setOpenMobile(false)} />}
                          isActive={location.pathname === to}
                        >
                          <Icon />
                          {t(item.labelKey)}
                        </SidebarMenuButton>
                        {badges !== null && item.alertScope !== undefined && (
                          <SidebarMenuBadge>
                            <AlertBadge count={badges[item.alertScope]} />
                          </SidebarMenuBadge>
                        )}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </Fragment>
        ))}
      </SidebarContent>
      <SidebarFooter className="gap-2">
        {accountId !== null && (
          <div className="flex items-center justify-between gap-2 px-2 text-xs">
            <Link
              to="/welcome"
              onClick={() => setOpenMobile(false)}
              className="whitespace-nowrap text-muted-foreground underline-offset-2 hover:underline"
            >
              {t("welcome.discover")}
            </Link>
            {/* Always there once an account is shown, even on Settings where no alert is computed. */}
            <span className="flex shrink-0 items-center gap-1.5">
              <Link
                to={`/accounts/${accountId}/alerts`}
                onClick={() => setOpenMobile(false)}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                <Bell aria-hidden className="size-3.5" />
                {t("nav.alerts")}
              </Link>
              {badges !== null && <AlertBadge count={badges.all} />}
            </span>
          </div>
        )}
        <SessionMenuItem />
      </SidebarFooter>
    </Sidebar>
  );
}
