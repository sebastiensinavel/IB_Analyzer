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
  /** Account-less entries (Settings) ignore the account id. */
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
      { labelKey: "nav.dashboard", icon: LayoutDashboard, to: accountPath("dashboard") },
      { labelKey: "nav.positions", icon: TrendingUp, to: accountPath("positions") },
      { labelKey: "nav.history", icon: History, to: accountPath("history") },
    ],
  },
  // One section per strategy: its journal first, then its open positions and its statistics when the strategy has them.
  {
    labelKey: "nav.sections.strategyWheel",
    items: [
      { labelKey: "nav.journal", icon: Coins, to: accountPath("journal/wheel") },
      { labelKey: "nav.positions", icon: TrendingUp, to: accountPath("positions/wheel") },
      { labelKey: "nav.stats", icon: BarChart3, to: accountPath("stats/wheel") },
    ],
  },
  {
    labelKey: "nav.sections.strategyLeaps",
    items: [
      { labelKey: "nav.journal", icon: CalendarRange, to: accountPath("journal/leaps") },
      { labelKey: "nav.positions", icon: TrendingUp, to: accountPath("positions/leaps") },
      { labelKey: "nav.stats", icon: BarChart3, to: accountPath("stats/leaps") },
    ],
  },
  {
    labelKey: "nav.sections.strategyCondors",
    items: [
      { labelKey: "nav.journal", icon: Bird, to: accountPath("journal/condors") },
      { labelKey: "nav.positions", icon: TrendingUp, to: accountPath("positions/condors") },
      { labelKey: "nav.stats", icon: BarChart3, to: accountPath("stats/condors") },
    ],
  },
  {
    labelKey: "nav.sections.strategyOthers",
    items: [
      { labelKey: "nav.journal", icon: Layers, to: accountPath("journal/others") },
      { labelKey: "nav.positions", icon: TrendingUp, to: accountPath("positions/others") },
    ],
  },
  {
    labelKey: "nav.sections.configuration",
    items: [
      { labelKey: "nav.sources", icon: Database, to: accountPath("sources") },
      { labelKey: "nav.sectors", icon: Tags, to: accountPath("sectors") },
      { labelKey: "nav.consistency", icon: ShieldCheck, to: accountPath("consistency") },
      { labelKey: "nav.settings", icon: Settings, to: () => "/settings" },
      { labelKey: "nav.help", icon: CircleQuestionMark, to: () => "/help" },
    ],
  },
] as const;

/** The nav entry a path belongs to, used to title pages outside the account scope. */
export function findNavItem(pathname: string, accountId: string): NavItem | undefined {
  return NAV_SECTIONS.flatMap((section) => section.items).find((item) => item.to(accountId) === pathname);
}
