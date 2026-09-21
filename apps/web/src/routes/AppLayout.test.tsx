import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import i18n from "@/i18n";
import { db } from "@/db/schema";
import { useAccountJournals, useAccountRiskReport } from "@/db/AccountDataProvider";
import { AppLayout } from "@/routes/AppLayout";
import { SAMPLE_JOURNAL_SNAPSHOT, SAMPLE_JOURNAL_TRANSACTIONS } from "@/mocks/journals";
import { SAMPLE_SNAPSHOT } from "@/mocks/positions";

function AccountDataProbe() {
  const { report } = useAccountRiskReport();
  const journals = useAccountJournals();
  return <div>{report === undefined || journals.status === "loading" ? "account data loading" : "account data ready"}</div>;
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
          </Route>
          <Route path="/settings" element={<AppLayout />}>
            <Route index element={<div>settings content</div>} />
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
  ]);
  await db.accounts.bulkAdd([account("beta", "U0000002"), account("alpha", "U0000001")]);
});

describe("AppLayout", () => {
  it("renders the child route for a known account", async () => {
    renderAt("/accounts/alpha/dashboard");
    expect(await screen.findByText("dashboard content")).toBeInTheDocument();
  });

  it("gives the account's pages its journals and risk report", async () => {
    renderAt("/accounts/alpha/positions");
    expect(await screen.findByText("account data ready")).toBeInTheDocument();
  });

  it("shows the nav entry for every screen, scoped to the current account", async () => {
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

  it("still sends a scoped route to the accounts page when there is no account at all", async () => {
    await db.accounts.clear();
    renderAt("/accounts/alpha/dashboard");
    expect(await screen.findByText("accounts page")).toBeInTheDocument();
  });

  it("hides every account link in the sidebar with no account at all, keeping Settings and Help", async () => {
    await db.accounts.clear();
    renderAt("/settings");
    await screen.findByText("settings content");
    expect(navHrefs()).toEqual(["/settings", "/help"]);
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
