import { Navigate, createBrowserRouter } from "react-router";
import { AppLayout } from "@/routes/AppLayout";
import { RootRedirect } from "@/routes/RootRedirect";
import { AccountsPage } from "@/pages/AccountsPage";
import { ConsistencyPage } from "@/pages/ConsistencyPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { HelpPage } from "@/pages/HelpPage";
import { HistoryPage } from "@/pages/HistoryPage";
import InvitationPage from "@/pages/InvitationPage";
import { JournalPage } from "@/pages/JournalPage";
import LoginPage from "@/pages/LoginPage";
import { PositionsPage } from "@/pages/PositionsPage";
import { SectorsPage } from "@/pages/SectorsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SourcesPage } from "@/pages/SourcesPage";
import { StatsPage } from "@/pages/StatsPage";
import { StrategyPositionsPage } from "@/pages/StrategyPositionsPage";

// Neither /login nor /invitation/:token sit under an account or under AppLayout: signing in
// is never required to reach any other route (spec §2), and an invitation link may be the
// very first page a new user ever opens, before any account exists on this device.
export const router = createBrowserRouter([
  { path: "/", element: <RootRedirect /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/invitation/:token", element: <InvitationPage /> },
  { path: "/accounts", element: <AccountsPage /> },
  {
    path: "/accounts/:accountId",
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="dashboard" replace /> },
      { path: "dashboard", element: <DashboardPage /> },
      { path: "positions", element: <PositionsPage /> },
      { path: "history", element: <HistoryPage /> },
      { path: "journal/wheel", element: <JournalPage strategy="wheel" /> },
      { path: "journal/leaps", element: <JournalPage strategy="leaps" /> },
      { path: "journal/condors", element: <JournalPage strategy="condors" /> },
      { path: "journal/others", element: <JournalPage strategy="others" /> },
      { path: "positions/wheel", element: <StrategyPositionsPage strategy="wheel" /> },
      { path: "positions/leaps", element: <StrategyPositionsPage strategy="leaps" /> },
      { path: "stats/wheel", element: <StatsPage strategy="wheel" /> },
      { path: "stats/leaps", element: <StatsPage strategy="leaps" /> },
      { path: "stats/condors", element: <StatsPage strategy="condors" /> },
      { path: "sources", element: <SourcesPage /> },
      // Under the account although the table is shared by every account: the shell — title
      // bar verdicts, Flex auto-sync, agent polling — stays alive while the user edits it.
      { path: "sectors", element: <SectorsPage /> },
      { path: "consistency", element: <ConsistencyPage /> },
      // Kept so bookmarks of the former "Primes" screen keep working.
      { path: "premiums", element: <Navigate to="../journal/wheel" replace /> },
    ],
  },
  {
    path: "/settings",
    element: <AppLayout />,
    children: [{ index: true, element: <SettingsPage /> }],
  },
  {
    path: "/help",
    element: <AppLayout />,
    children: [{ index: true, element: <HelpPage /> }],
  },
]);
