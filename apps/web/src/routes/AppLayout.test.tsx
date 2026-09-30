import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { useState } from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { ACTIVABLE_STRATEGIES } from "@ib/ledger";
import i18n from "@/i18n";
import { db } from "@/db/schema";
import { useAccountJournals, useAccountRiskReport, useOptionalAccountAlerts } from "@/db/AccountDataProvider";
import { AppLayout } from "@/routes/AppLayout";
import { createManualAlert } from "@/db/alerts";
import { SAMPLE_JOURNAL_SNAPSHOT, SAMPLE_JOURNAL_TRANSACTIONS } from "@/mocks/journals";
import { SAMPLE_SNAPSHOT } from "@/mocks/positions";

function AccountDataProbe() {
  const { report } = useAccountRiskReport();
  const journals = useAccountJournals();
  return <div>{report === undefined || journals.status === "loading" ? "account data loading" : "account data ready"}</div>;
}

/** What an account-agnostic component — the sidebar — reads of the alerts. */
function AlertsProbe() {
  const alerts = useOptionalAccountAlerts();
  return <div>{alerts === null ? "no account alerts" : `account alerts ${alerts.status}`}</div>;
}

// Local state that survives only as long as the page stays mounted.
function StatefulPage() {
  const [clicks, setClicks] = useState(0);
  const navigate = useNavigate();
  return (
    <div>
      <button onClick={() => setClicks((n) => n + 1)}>clicks {clicks}</button>
      <button onClick={() => navigate("/accounts/beta/stateful")}>to beta</button>
    </div>
  );
}

function renderAt(path: string) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/accounts" element={<div>accounts page</div>} />
          <Route path="/accounts/:accountId" element={<AppLayout />}>
            <Route path="dashboard" element={<div>dashboard content</div>} />
            <Route path="positions" element={<AccountDataProbe />} />
            <Route path="stateful" element={<StatefulPage />} />
            <Route path="alerts-probe" element={<AlertsProbe />} />
          </Route>
          <Route path="/help" element={<AppLayout />}>
            <Route index element={<div>help</div>} />
          </Route>
          <Route path="/settings" element={<AppLayout />}>
            <Route index element={<div>settings content</div>} />
            <Route path="alerts-probe" element={<AlertsProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

function navHrefs() {
  // The title bar's link to the Consistency page is not a nav entry.
  return screen
    .getAllByRole("link")
    .filter((el) => !el.closest("header"))
    .map((el) => el.getAttribute("href"));
}

function indicatorIcon(testId: string): SVGElement {
  return screen.getByTestId(testId).querySelector("svg") as SVGElement;
}

const account = (id: string, ib: string) => ({ id, label: id, ibAccountId: ib, createdAt: "", warnedDroppedKinds: [] });

beforeEach(async () => {
  window.localStorage.clear();
  await Promise.all([
    db.accounts.clear(),
    db.transactions.clear(),
    db.imports.clear(),
    db.snapshots.clear(),
    db.contracts.clear(),
    db.cashPoints.clear(),
    db.alerts.clear(),
    db.alertStates.clear(),
  ]);
  await db.accounts.bulkAdd([account("beta", "U0000002"), account("alpha", "U0000001")]);
});

describe("AppLayout", () => {
  it("renders the child route for a known account", async () => {
    renderAt("/accounts/alpha/dashboard");
    expect(await screen.findByText("dashboard content")).toBeInTheDocument();
  });

  it("remounts the page when the same page opens for another account", async () => {
    const user = userEvent.setup();
    renderAt("/accounts/alpha/stateful");
    await user.click(await screen.findByText("clicks 0"));
    expect(screen.getByText("clicks 1")).toBeInTheDocument();
    await user.click(screen.getByText("to beta"));
    expect(await screen.findByText("clicks 0")).toBeInTheDocument();
  });

  it("keeps a collapsed sidebar collapsed when leaving the account's pages for Settings", async () => {
    const user = userEvent.setup();
    renderAt("/accounts/alpha/dashboard");
    await screen.findByText("dashboard content");
    const sidebarState = () => document.querySelector("[data-slot=sidebar]")?.getAttribute("data-state");
    expect(sidebarState()).toBe("expanded");
    await user.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    expect(sidebarState()).toBe("collapsed");
    await user.click(screen.getByRole("link", { name: "Paramètres" }));
    expect(await screen.findByText("settings content")).toBeInTheDocument();
    expect(sidebarState()).toBe("collapsed");
  });

  it("gives the account's pages its journals and risk report", async () => {
    renderAt("/accounts/alpha/positions");
    expect(await screen.findByText("account data ready")).toBeInTheDocument();
  });

  it("shows the nav entry for every screen, scoped to the current account", async () => {
    await db.accounts.update("beta", { strategies: [...ACTIVABLE_STRATEGIES] });
    renderAt("/accounts/beta/dashboard");
    expect(await screen.findByText("dashboard content")).toBeInTheDocument();
    expect(navHrefs()).toEqual([
      "/accounts/beta/dashboard",
      "/accounts/beta/positions",
      "/accounts/beta/history",
      "/accounts/beta/journal/wheel",
      "/accounts/beta/positions/wheel",
      "/accounts/beta/stats/wheel",
      "/accounts/beta/journal/leaps",
      "/accounts/beta/positions/leaps",
      "/accounts/beta/stats/leaps",
      "/accounts/beta/journal/condors",
      "/accounts/beta/positions/condors",
      "/accounts/beta/stats/condors",
      "/accounts/beta/journal/others",
      "/accounts/beta/positions/others",
      "/accounts/beta/sources",
      "/accounts/beta/sectors",
      "/accounts/beta/consistency",
      "/settings",
      "/help",
      // The footer: the welcome page, then the alerts page.
      "/welcome",
      "/accounts/beta/alerts",
    ]);
  });

  it("remembers the visited account", async () => {
    renderAt("/accounts/beta/dashboard");
    await screen.findByText("dashboard content");
    await waitFor(() => expect(window.localStorage.getItem("ib2:lastAccountId")).toBe("beta"));
  });

  it("points the account-less settings route at the last visited account", async () => {
    window.localStorage.setItem("ib2:lastAccountId", "beta");
    renderAt("/settings");
    expect(await screen.findByText("settings content")).toBeInTheDocument();
    expect(navHrefs()[0]).toBe("/accounts/beta/dashboard");
  });

  it("shows the unknown-account page, with the nav, for an id that does not exist", async () => {
    renderAt("/accounts/nope/dashboard");
    expect(await screen.findByText("Compte inconnu")).toBeInTheDocument();
    expect(screen.queryByText("dashboard content")).toBeNull();
    expect(screen.getByRole("link", { name: "Gérer les comptes" })).toHaveAttribute("href", "/accounts");
  });

  // The central case this sub-project fixes: a browser that has just restored a backup has no
  // account yet, and Settings is the only place that restore can be triggered from. Redirecting
  // to /accounts here would make the backup irrecoverable exactly when it is needed.
  it("renders the settings route with no account at all, instead of redirecting", async () => {
    await db.accounts.clear();
    renderAt("/settings");
    expect(await screen.findByText("settings content")).toBeInTheDocument();
    expect(screen.queryByText("accounts page")).not.toBeInTheDocument();
  });

  it("gives an account's shell its alerts, and leaves Settings without any provider", async () => {
    renderAt("/accounts/alpha/alerts-probe");
    expect(await screen.findByText("account alerts ready")).toBeInTheDocument();
    cleanup();
    renderAt("/settings/alerts-probe");
    expect(await screen.findByText("no account alerts")).toBeInTheDocument();
  });

  describe("alerts in the menu", () => {
    const menuItem = (name: string, index = 0) => screen.getAllByRole("link", { name })[index].closest("li") as HTMLElement;
    const pill = (within_: HTMLElement) => within(within_).queryByLabelText(/alertes? déclenchée/);
    const footer = () => screen.getByRole("link", { name: "Alertes" }).parentElement as HTMLElement;

    async function seedTriggered() {
      await db.accounts.update("beta", { strategies: [...ACTIVABLE_STRATEGIES] });
      await db.transactions.bulkAdd(SAMPLE_JOURNAL_TRANSACTIONS);
      await db.snapshots.put(SAMPLE_JOURNAL_SNAPSHOT);
      const id = await createManualAlert(db, "beta", { ticker: "MQZA", price: 20, direction: "above" });
      await db.alertStates.put({
        accountId: "beta", alertId: id, triggeredAt: "2026-09-30T14:00:00.000Z", acknowledgedAt: null,
        disabled: false, armed: true, anchor: null, override: null,
      });
    }

    it("badges the overview Positions and the Positions of the strategy holding the ticker, and no other", async () => {
      await seedTriggered();
      renderAt("/accounts/beta/dashboard");
      await screen.findByText("dashboard content");
      await waitFor(() => expect(pill(menuItem("Positions", 0))).toHaveTextContent("1"));
      // Positions entries in menu order: overview, Wheel, LEAPS, Condors, Others.
      expect(pill(menuItem("Positions", 1))).toHaveTextContent("1");
      expect(pill(menuItem("Positions", 2))).toBeNull();
      expect(pill(menuItem("Positions", 3))).toBeNull();
      expect(pill(menuItem("Positions", 4))).toBeNull();
      expect(pill(menuItem("Historique"))).toBeNull();
    });

    it("always links to the alerts page from the footer, with no pill while nothing is triggered", async () => {
      renderAt("/accounts/alpha/dashboard");
      await screen.findByText("dashboard content");
      expect(screen.getByRole("link", { name: "Alertes" })).toHaveAttribute("href", "/accounts/alpha/alerts");
      expect(pill(footer())).toBeNull();
    });

    it("adds the pill to the footer link when an alert is triggered", async () => {
      await seedTriggered();
      renderAt("/accounts/beta/dashboard");
      await screen.findByText("dashboard content");
      await waitFor(() => expect(pill(footer())).toHaveTextContent("1"));
    });

    it("keeps the footer link on Settings, where no alert is computed, without a pill", async () => {
      await seedTriggered();
      window.localStorage.setItem("ib2:lastAccountId", "beta");
      renderAt("/settings");
      await screen.findByText("settings content");
      expect(screen.getByRole("link", { name: "Alertes" })).toHaveAttribute("href", "/accounts/beta/alerts");
      expect(pill(footer())).toBeNull();
    });

    it("shows no alerts link with no account at all", async () => {
      await db.accounts.clear();
      renderAt("/help");
      await screen.findByText("help");
      expect(screen.queryByRole("link", { name: "Alertes" })).toBeNull();
    });
  });

  it("offers adding an account and the welcome page when there is no account at all", async () => {
    await db.accounts.clear();
    renderAt("/help");
    expect(await screen.findByRole("link", { name: "Ajouter un compte IB" })).toHaveAttribute("href", "/accounts");
    expect(screen.getByRole("link", { name: "Découvrir IB Analyzer" })).toHaveAttribute("href", "/welcome");
  });

  it("keeps a discreet link to the welcome page with accounts", async () => {
    renderAt("/accounts/alpha/dashboard");
    expect(await screen.findByRole("link", { name: "Découvrir IB Analyzer" })).toHaveAttribute("href", "/welcome");
    expect(screen.queryByRole("link", { name: "Ajouter un compte IB" })).toBeNull();
  });

  it("still sends a scoped route to the accounts page when there is no account at all", async () => {
    await db.accounts.clear();
    renderAt("/accounts/alpha/dashboard");
    expect(await screen.findByText("accounts page")).toBeInTheDocument();
  });

  it("hides every account link in the sidebar with no account at all, keeping Settings and Help", async () => {
    await db.accounts.clear();
    renderAt("/settings");
    await screen.findByText("settings content");
    // The two header links (add an account, discover) come before the account-less nav entries.
    expect(navHrefs()).toEqual(["/accounts", "/welcome", "/settings", "/help"]);
  });
});

describe("AppLayout: menu of the active strategies", () => {
  it("shows the Wheel and Others only for an account that never chose", async () => {
    await db.accounts.put(account("alpha", "U0000001"));
    renderAt("/accounts/alpha/dashboard");
    await screen.findByText("dashboard content");
    const hrefs = navHrefs();
    expect(hrefs).toContain("/accounts/alpha/journal/wheel");
    expect(hrefs).toContain("/accounts/alpha/journal/others");
    expect(hrefs.some((href) => href?.includes("leaps") || href?.includes("condors"))).toBe(false);
  });

  it("shows each account's own strategies", async () => {
    await db.accounts.bulkPut([
      { ...account("alpha", "U0000001"), strategies: ["leaps"] },
      { ...account("beta", "U0000002"), strategies: ["condors"] },
    ]);
    renderAt("/accounts/beta/dashboard");
    await screen.findByText("dashboard content");
    const hrefs = navHrefs();
    expect(hrefs).toContain("/accounts/beta/journal/condors");
    expect(hrefs.some((href) => href?.includes("wheel") || href?.includes("leaps"))).toBe(false);
  });

  it("keeps Others with no strategy active", async () => {
    await db.accounts.put({ ...account("alpha", "U0000001"), strategies: [] });
    renderAt("/accounts/alpha/dashboard");
    await screen.findByText("dashboard content");
    expect(navHrefs().filter((href) => href?.includes("/journal/"))).toEqual(["/accounts/alpha/journal/others"]);
  });
});

describe("AppLayout: consistency indicators", () => {
  it("says both verdicts in one link to the Consistency page, only the uncovered one blinking", async () => {
    // alpha: one naked call, and no ledger to rebuild the snapshot from.
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderAt("/accounts/alpha/dashboard");
    const summary = "Couverture : 1 position non couverte. Reconstitution : 10 écarts avec le snapshot du 2026-09-02";
    const link = await screen.findByRole("link", { name: summary });
    expect(link).toHaveAttribute("href", "/accounts/alpha/consistency");
    expect(link).toHaveAttribute("title", summary);
    expect(link).toHaveClass("hover:bg-muted", "focus-visible:bg-muted");
    expect(link).toHaveTextContent("Couverture");
    expect(link).toHaveTextContent("Reconstitution");
    expect(screen.getByTestId("coverage-indicator")).toHaveAttribute("data-status", "alert");
    expect(indicatorIcon("coverage-indicator")).toHaveClass("text-destructive", "motion-safe:animate-pulse");
    expect(screen.getByTestId("reconstitution-indicator")).toHaveAttribute("data-status", "alert");
    expect(indicatorIcon("reconstitution-indicator")).toHaveClass("text-destructive");
    expect(indicatorIcon("reconstitution-indicator")).not.toHaveClass("motion-safe:animate-pulse");
  });

  it("turns both green on a covered portfolio the ledger rebuilds exactly, blinking nothing", async () => {
    await db.transactions.bulkAdd(SAMPLE_JOURNAL_TRANSACTIONS);
    await db.snapshots.put(SAMPLE_JOURNAL_SNAPSHOT);
    renderAt("/accounts/beta/dashboard");
    expect(
      await screen.findByRole("link", { name: "Couverture : aucune position non couverte. Reconstitution : conforme au snapshot du 2026-09-02" }),
    ).toBeInTheDocument();
    for (const id of ["coverage-indicator", "reconstitution-indicator"]) {
      expect(screen.getByTestId(id)).toHaveAttribute("data-status", "ok");
      expect(indicatorIcon(id)).toHaveClass("text-success");
      expect(indicatorIcon(id)).not.toHaveClass("motion-safe:animate-pulse");
    }
  });

  it("greys both, without blinking, when there is no snapshot", async () => {
    renderAt("/accounts/beta/dashboard");
    expect(
      await screen.findByRole("link", { name: "Couverture : aucun snapshot de positions. Reconstitution : aucun snapshot de positions" }),
    ).toBeInTheDocument();
    for (const id of ["coverage-indicator", "reconstitution-indicator"]) {
      expect(screen.getByTestId(id)).toHaveAttribute("data-status", "unknown");
      expect(indicatorIcon(id)).toHaveClass("text-muted-foreground");
      expect(indicatorIcon(id)).not.toHaveClass("motion-safe:animate-pulse");
    }
  });

  it("follows the base: a snapshot imported later turns the verdicts", async () => {
    renderAt("/accounts/beta/dashboard");
    await screen.findByRole("link", { name: /^Couverture : aucun snapshot de positions/ });
    await db.transactions.bulkAdd(SAMPLE_JOURNAL_TRANSACTIONS);
    await db.snapshots.put(SAMPLE_JOURNAL_SNAPSHOT);
    expect(await screen.findByRole("link", { name: /^Couverture : aucune position non couverte\. Reconstitution : conforme/ })).toBeInTheDocument();
  });

  it("shows no indicator outside an account", async () => {
    window.localStorage.setItem("ib2:lastAccountId", "beta");
    renderAt("/settings");
    expect(await screen.findByText("settings content")).toBeInTheDocument();
    expect(screen.queryByTestId("coverage-indicator")).not.toBeInTheDocument();
    expect(screen.queryByTestId("reconstitution-indicator")).not.toBeInTheDocument();
  });

  it("shows no indicator on an unknown account", async () => {
    renderAt("/accounts/nope/dashboard");
    expect(await screen.findByText("Compte inconnu")).toBeInTheDocument();
    expect(screen.queryByTestId("coverage-indicator")).not.toBeInTheDocument();
  });
});

describe("AppLayout: snapshot status", () => {
  it("says live in the title bar, just left of the verdicts", async () => {
    await db.snapshots.put({ ...SAMPLE_SNAPSHOT, source: "agent", asOf: "2026-09-06T09:02:00.000Z" });
    await db.accounts.update("alpha", { lastAgentSyncAt: "2026-09-06T13:02:01.000Z" });
    renderAt("/accounts/alpha/dashboard");
    const badge = await screen.findByText(/^En direct, \d{2}:\d{2}$/);
    const header = badge.closest("header") as HTMLElement;
    expect(header).not.toBeNull();
    const verdicts = within(header).getByRole("link", { name: /^Couverture/ });
    expect(badge.compareDocumentPosition(verdicts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/^Données du/)).not.toBeInTheDocument();
  });

  it("dates a file snapshot in the title bar", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    renderAt("/accounts/alpha/dashboard");
    expect((await screen.findByText("Données du 2026-09-02")).closest("header")).not.toBeNull();
  });

  it("shows no snapshot status outside an account", async () => {
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    window.localStorage.setItem("ib2:lastAccountId", "alpha");
    renderAt("/settings");
    expect(await screen.findByText("settings content")).toBeInTheDocument();
    expect(screen.queryByText(/^Données du/)).not.toBeInTheDocument();
  });
});

describe("AppLayout on a phone", () => {
  const desktopWidth = window.innerWidth;
  beforeEach(() => {
    window.innerWidth = 400;
  });
  afterEach(() => {
    window.innerWidth = desktopWidth;
  });

  it("closes the menu drawer once a page is picked in it", async () => {
    const user = userEvent.setup();
    renderAt("/accounts/alpha/dashboard");
    expect(await screen.findByText("dashboard content")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    const drawer = await screen.findByRole("dialog");
    const positions = within(drawer)
      .getAllByRole("link")
      .find((link) => link.getAttribute("href") === "/accounts/alpha/positions");
    await user.click(positions as HTMLElement);
    expect(await screen.findByText("account data ready")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
