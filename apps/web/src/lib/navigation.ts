import {
  BarChart3,
  Bird,
  CalendarRange,
  CircleQuestionMark,
  Coins,
  Database,
  History,
  Layers,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Tags,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  labelKey: string;
  icon: LucideIcon;
  /** False for account-less entries (Settings, Help): `to` ignores the account id it is given,
   *  and the sidebar keeps showing them even with no account at all, unlike every other entry. */
  accountScoped: boolean;
  to: (accountId: string) => string;
}

export interface NavSection {
  labelKey: string;
  items: readonly NavItem[];
}

function accountPath(path: string) {
  return (accountId: string) => `/accounts/${accountId}/${path}`;
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    labelKey: "nav.sections.overview",
    items: [
      { labelKey: "nav.dashboard", icon: LayoutDashboard, accountScoped: true, to: accountPath("dashboard") },
      { labelKey: "nav.positions", icon: TrendingUp, accountScoped: true, to: accountPath("positions") },
      { labelKey: "nav.history", icon: History, accountScoped: true, to: accountPath("history") },
    ],
  },
  // One section per strategy: its journal first, then its open positions and its statistics when the strategy has them.
  {
    labelKey: "nav.sections.strategyWheel",
    items: [
      { labelKey: "nav.journal", icon: Coins, accountScoped: true, to: accountPath("journal/wheel") },
      { labelKey: "nav.positions", icon: TrendingUp, accountScoped: true, to: accountPath("positions/wheel") },
      { labelKey: "nav.stats", icon: BarChart3, accountScoped: true, to: accountPath("stats/wheel") },
    ],
  },
  {
    labelKey: "nav.sections.strategyLeaps",
    items: [
      { labelKey: "nav.journal", icon: CalendarRange, accountScoped: true, to: accountPath("journal/leaps") },
      { labelKey: "nav.positions", icon: TrendingUp, accountScoped: true, to: accountPath("positions/leaps") },
      { labelKey: "nav.stats", icon: BarChart3, accountScoped: true, to: accountPath("stats/leaps") },
    ],
  },
  {
    labelKey: "nav.sections.strategyCondors",
    items: [
      { labelKey: "nav.journal", icon: Bird, accountScoped: true, to: accountPath("journal/condors") },
      { labelKey: "nav.positions", icon: TrendingUp, accountScoped: true, to: accountPath("positions/condors") },
      { labelKey: "nav.stats", icon: BarChart3, accountScoped: true, to: accountPath("stats/condors") },
    ],
  },
  {
    labelKey: "nav.sections.strategyOthers",
    items: [
      { labelKey: "nav.journal", icon: Layers, accountScoped: true, to: accountPath("journal/others") },
      { labelKey: "nav.positions", icon: TrendingUp, accountScoped: true, to: accountPath("positions/others") },
    ],
  },
  {
    labelKey: "nav.sections.configuration",
    items: [
      { labelKey: "nav.sources", icon: Database, accountScoped: true, to: accountPath("sources") },
      { labelKey: "nav.sectors", icon: Tags, accountScoped: true, to: accountPath("sectors") },
      { labelKey: "nav.consistency", icon: ShieldCheck, accountScoped: true, to: accountPath("consistency") },
      { labelKey: "nav.settings", icon: Settings, accountScoped: false, to: () => "/settings" },
      { labelKey: "nav.help", icon: CircleQuestionMark, accountScoped: false, to: () => "/help" },
    ],
  },
] as const;

/** The nav entry a path belongs to, used to title pages outside the account scope. */
export function findNavItem(pathname: string, accountId: string): NavItem | undefined {
  return NAV_SECTIONS.flatMap((section) => section.items).find((item) => item.to(accountId) === pathname);
}
