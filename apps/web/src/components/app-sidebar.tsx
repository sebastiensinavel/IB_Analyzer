import { Fragment } from "react";
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
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@ib/ui/sidebar";
import { AccountSwitcher } from "@/components/AccountSwitcher";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { SessionMenuItem } from "@/components/SessionMenuItem";
import { ThemeToggle } from "@/components/ThemeToggle";
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

  // The sidebar lives outside AccountDataProvider (CLAUDE.md), so it reads the account's chosen
  // strategies straight from the record it already has, through the same reader as everywhere
  // else. A section with no `strategy` (Overview, Others, Configuration) always shows.
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
          <div className="flex size-7 items-center justify-center rounded-md bg-primary font-heading text-sm font-bold text-primary-foreground">
            IB
          </div>
          <span className="font-heading text-sm font-semibold tracking-tight">IB Analyzer</span>
        </div>
        {accountId !== null && <AccountSwitcher accountId={accountId} accounts={accounts} />}
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
                          render={<Link to={to} />}
                          isActive={location.pathname === to}
                        >
                          <Icon />
                          {t(item.labelKey)}
                        </SidebarMenuButton>
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
        <SessionMenuItem />
        <div className="flex items-center justify-between gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
