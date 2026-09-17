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
import type { AccountRecord } from "@/db/schema";

interface AppSidebarProps {
  accountId: string;
  accounts: readonly AccountRecord[];
}

export function AppSidebar({ accountId, accounts }: AppSidebarProps) {
  const { t } = useTranslation();
  const location = useLocation();

  return (
    <Sidebar>
      <SidebarHeader className="gap-3 px-2 pt-3">
        <div className="flex items-center gap-2 px-1">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary font-heading text-sm font-bold text-primary-foreground">
            IB
          </div>
          <span className="font-heading text-sm font-semibold tracking-tight">IB Analyzer</span>
        </div>
        <AccountSwitcher accountId={accountId} accounts={accounts} />
      </SidebarHeader>
      <SidebarContent>
        {NAV_SECTIONS.map((section, index) => (
          <Fragment key={section.labelKey}>
            {index > 0 && <SidebarSeparator />}
            <SidebarGroup>
              <SidebarGroupLabel>{t(section.labelKey)}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {section.items.map((item) => {
                    const to = item.to(accountId);
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
